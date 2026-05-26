import logging
import shutil
import subprocess
import traceback
from pathlib import Path

import clipper.compose.db as compose_db
from clipper.compose.stages import ingest as compose_ingest
from clipper.compose.stages import normalize as compose_normalize
from clipper.compose.stages import caption as compose_caption
from clipper.compose.stages import concat as compose_concat
from clipper.compose.stages import pad as compose_pad
from clipper.compose.stages import thumbs as compose_thumbs

log = logging.getLogger(__name__)


def _trim_to_duration(src: str, duration: float, out_path: str) -> None:
    """Stream-copy trim to exactly `duration` seconds. Keyframe-aligned (fast)."""
    cmd = [
        "ffmpeg", "-y",
        "-i", src,
        "-t", str(duration),
        "-c", "copy",
        out_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"trim failed:\n{result.stderr[-2000:]}")


def _probe_duration(path: str) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", path],
        capture_output=True, text=True,
    )
    return float(result.stdout.strip())


def _run_render(comp_id: str) -> None:
    try:
        comp = compose_db.get_composition(comp_id)
        if not comp:
            log.error("Render: composition %s not found", comp_id)
            return

        segments = compose_db.get_segments(comp_id)
        if not segments:
            compose_db.update_composition(comp_id, status="failed", error="No segments to render")
            return

        comp_dir = compose_db._comp_dir(comp_id)

        # Step 1: ingest + normalize each segment in order
        for i, seg in enumerate(segments):
            log.info("Render %s: ingest segment %d/%d (id=%s)", comp_id, i + 1, len(segments), seg["id"])
            compose_ingest.run_for_segment(comp, seg)
            seg = compose_db.get_segment(seg["id"])
            if seg["status"] == "failed":
                raise RuntimeError(f"Segment {seg['id']} ingest failed: {seg.get('error')}")

            log.info("Render %s: normalize segment %d/%d", comp_id, i + 1, len(segments))
            compose_normalize.run_for_segment(comp, seg)
            seg = compose_db.get_segment(seg["id"])
            if seg["status"] == "failed":
                raise RuntimeError(f"Segment {seg['id']} normalize failed: {seg.get('error')}")

        # Re-fetch segments (statuses and file paths may have been updated)
        segments = compose_db.get_segments(comp_id)

        # Step 2: collect normalized paths and build transition specs
        normalized_paths = []
        for seg in segments:
            seg_dir = compose_db._comp_dir(comp_id) / "segments" / str(seg["idx"])
            normalized = seg_dir / "normalized.mp4"
            if not normalized.exists():
                raise RuntimeError(f"normalized.mp4 missing for segment {seg['id']} (idx={seg['idx']})")
            normalized_paths.append(str(normalized))

        transitions = []
        for seg in segments[:-1]:
            t_type = seg.get("transition_to_next") or "cut"
            t_dur = seg.get("transition_dur_ms")
            transitions.append((t_type, t_dur))

        # Step 3: concat segments
        intermediate_path = str(comp_dir / "concat_raw.mp4")
        log.info("Render %s: concat %d segment(s)", comp_id, len(normalized_paths))
        compose_concat.run(normalized_paths, transitions, intermediate_path)

        # Step 4: fit to target — pad if too short, trim if too long
        concat_dur = _probe_duration(intermediate_path)
        target_sec = float(comp.get("target_sec") or 38.0)
        picture_path = intermediate_path

        if concat_dur < target_sec - 0.1:
            pad_dur = target_sec - concat_dur
            pad_path = str(comp_dir / "pad.mp4")
            log.info("Render %s: padding %.2fs (got %.2fs, target %.2fs)", comp_id, pad_dur, concat_dur, target_sec)
            compose_pad.make_black_padding(pad_dur, pad_path)

            padded_path = str(comp_dir / "picture.mp4")
            compose_concat.run([intermediate_path, pad_path], [("cut", None)], padded_path)
            picture_path = padded_path

        elif concat_dur > target_sec + 0.1:
            trimmed_path = str(comp_dir / "picture.mp4")
            log.info("Render %s: trimming %.2fs → %.2fs", comp_id, concat_dur, target_sec)
            _trim_to_duration(intermediate_path, target_sec, trimmed_path)
            picture_path = trimmed_path

        # Step 4b: caption alignment + burn
        captioned_path = str(comp_dir / "picture_captioned.mp4")
        log.info("Render %s: captions (mode=%s)", comp_id, comp.get("captions_mode", "script"))
        compose_caption.run(comp, picture_path, captioned_path)
        picture_path = captioned_path

        # Step 5: write last_render.mp4
        last_render_path = str(comp_dir / "last_render.mp4")
        shutil.copy2(picture_path, last_render_path)

        final_dur = _probe_duration(last_render_path)

        # Extract hover-scrub thumbnails (non-fatal if ffmpeg struggles)
        try:
            thumbs_dir = str(comp_dir / "thumbs")
            compose_thumbs.extract_thumbs(last_render_path, thumbs_dir)
            log.info("Render %s: thumbnails extracted", comp_id)
        except Exception:
            log.warning("Render %s: thumb extraction failed (non-fatal)", comp_id, exc_info=True)

        compose_db.update_composition(
            comp_id,
            status="rendered",
            last_render_path=last_render_path,
            last_render_duration=final_dur,
            error=None,
        )
        log.info("Render %s: complete, duration=%.2fs", comp_id, final_dur)

    except Exception:
        err = traceback.format_exc()
        log.error("Render %s failed:\n%s", comp_id, err)
        compose_db.update_composition(comp_id, status="failed", error=err[-1000:])
