import subprocess
from pathlib import Path

import clipper.compose.db as compose_db
from clipper.compose.stages.image_motion import render_image_segment


def run_for_segment(comp: dict, seg: dict) -> None:
    """Re-encode a segment to 1080x1920/30fps/yuv420p/48k-stereo normalized.mp4."""
    seg_id = seg["id"]
    comp_id = seg["composition_id"]
    seg_idx = seg["idx"]

    seg_dir = compose_db._comp_dir(comp_id) / "segments" / str(seg_idx)
    out_path = seg_dir / "normalized.mp4"

    if seg.get("status") == "normalized" and out_path.exists():
        return

    seg_dir.mkdir(parents=True, exist_ok=True)

    try:
        if seg["kind"] == "image":
            src = _find_source(seg, seg_dir)
            dur = seg.get("duration") or 3.0
            motion = seg.get("motion") or "static"
            render_image_segment(str(src), float(dur), motion, str(out_path))
        else:
            src = _find_source(seg, seg_dir)
            trim_in = float(seg.get("trim_in") or 0.0)
            trim_out = seg.get("trim_out")

            cmd = ["ffmpeg", "-y", "-ss", str(trim_in)]
            if trim_out is not None:
                cmd += ["-to", str(float(trim_out))]
            cmd += ["-i", str(src)]

            if _has_audio(str(src)):
                cmd += [
                    "-vf", "scale=-2:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p",
                    "-af", "aresample=48000,aformat=channel_layouts=stereo",
                    "-c:v", "libx264", "-crf", "18", "-preset", "medium",
                    "-c:a", "aac", "-b:a", "192k",
                    "-movflags", "+faststart",
                    str(out_path),
                ]
            else:
                # Add silent stereo track
                cmd += [
                    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
                    "-vf", "scale=-2:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p",
                    "-c:v", "libx264", "-crf", "18", "-preset", "medium",
                    "-c:a", "aac", "-b:a", "192k",
                    "-shortest",
                    "-movflags", "+faststart",
                    str(out_path),
                ]

            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                raise RuntimeError(f"normalize ffmpeg failed:\n{result.stderr[-2000:]}")

        compose_db.update_segment(seg_id, status="normalized")

    except Exception as exc:
        import traceback
        compose_db.update_segment(
            seg_id,
            status="failed",
            error=traceback.format_exc()[-800:],
        )
        raise


def _find_source(seg: dict, seg_dir: Path) -> Path:
    if seg.get("source_file"):
        p = Path(seg["source_file"])
        if p.exists():
            return p
    found = next(seg_dir.glob("source.*"), None)
    if not found:
        raise RuntimeError(f"No source file found in {seg_dir}")
    return found


def _has_audio(path: str) -> bool:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a",
         "-show_entries", "stream=codec_type", "-of", "csv=p=0", path],
        capture_output=True, text=True,
    )
    return bool(result.stdout.strip())
