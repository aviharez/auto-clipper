"""
cut.py — Stage: precise re-encode + 9:16 vertical reframe.

Always re-encodes (never stream-copy) so the cut lands exactly on the
requested second (plan §5.1). The vertical reframe is delegated to
`reframe.plan` (Tier 2a cut-aware multi-face fit-all): the clip span is
segmented into camera shots, each reframed on its own. This stage encodes
every shot separately and losslessly concatenates them into raw.mp4.

Shots are joined losslessly (concat demuxer) when every boundary is a plain
source cut. When the span contains a split-screen shot, the boundaries next
to it are dipped through black instead — switching into/out of split-screen
is a big layout change that looks rough as a hard cut — so those clips are
joined with an xfade filter pass (one re-encode); plain cuts stay hard.

On any failure — planning, a shot encode, or the join — this stage falls
back to a plain Tier 1 centre crop so a cut is always produced.
"""
import json
import logging
import subprocess
from pathlib import Path

from clipper.config import (
    BASE_DIR, VIDEO_CRF, VIDEO_PRESET, AUDIO_BITRATE, JOBS_DIR,
    REFRAME_SPLIT_XFADE_SEC,
)
from clipper.stages import reframe

log = logging.getLogger(__name__)


def _probe_video(video_path: Path) -> tuple[int, int, float, bool]:
    """Returns (width, height, fps, has_audio)."""
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", str(video_path)],
        capture_output=True, text=True, check=True,
    )
    streams = json.loads(result.stdout).get("streams", [])
    width = height = None
    fps = 30.0
    has_audio = False
    for s in streams:
        if s.get("codec_type") == "video" and width is None:
            width, height = int(s["width"]), int(s["height"])
            num, den = s.get("r_frame_rate", "30/1").split("/")
            fps = float(num) / max(float(den), 1)
        elif s.get("codec_type") == "audio":
            has_audio = True
    if width is None:
        raise ValueError(f"No video stream in {video_path}")
    return width, height, fps, has_audio


def _encode_shot(source: Path, shot: reframe.ShotPlan, out_path: Path,
                 has_audio: bool) -> None:
    """Precisely re-encode + reframe one shot ([shot.start, shot.end])."""
    # Audio is normalised with asetpts to match the video's setpts-reset
    # timeline (reframe resets each shot's video PTS so the pan schedule lines up).
    filter_complex = shot.filter_complex
    maps = ["-map", "[v]"]
    audio_args: list[str] = []
    if has_audio:
        filter_complex += ";[0:a]asetpts=PTS-STARTPTS[a]"
        maps += ["-map", "[a]"]
        audio_args = ["-c:a", "aac", "-b:a", AUDIO_BITRATE]

    cmd = [
        "ffmpeg", "-y",
        "-ss", f"{shot.start:.3f}",
        "-to", f"{shot.end:.3f}",
        "-i", str(source),
        "-filter_complex", filter_complex,
        *maps,
        "-c:v", "libx264", "-crf", str(VIDEO_CRF), "-preset", VIDEO_PRESET,
        *audio_args,
        "-movflags", "+faststart",
        str(out_path),
    ]
    # cwd=BASE_DIR so the relative sendcmd path inside filter_complex resolves.
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(BASE_DIR))
    if result.returncode != 0:
        raise RuntimeError(
            f"ffmpeg shot encode failed (reframe mode={shot.mode}):\n{result.stderr[-1500:]}"
        )


def _concat(parts: list[Path], out_path: Path) -> None:
    """Losslessly join shot clips (identical encode params) via the concat demuxer."""
    list_path = out_path.parent / "shots.txt"
    list_path.write_text(
        "".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8",
    )
    cmd = [
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0", "-i", str(list_path),
        "-c", "copy", "-movflags", "+faststart",
        str(out_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    list_path.unlink(missing_ok=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg shot concat failed:\n{result.stderr[-1500:]}")


def _probe_duration(path: Path) -> float:
    """Container duration of an encoded shot, in seconds."""
    r = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-print_format", "json", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(json.loads(r.stdout)["format"]["duration"])


def _join_xfade(parts: list[Path], shots: list, out_path: Path,
                has_audio: bool, fps: float) -> None:
    """
    Join shot clips, dipping through black at the boundaries next to a
    split-screen shot and hard-cutting the rest. xfade overlaps (and so
    shortens) the timeline by the transition length; acrossfade does the same
    to audio, so the two streams stay in sync. Re-encodes once (decoded
    frames required).
    """
    durs = [_probe_duration(p) for p in parts]
    inputs: list[str] = []
    for p in parts:
        inputs += ["-i", str(p)]

    chains: list[str] = []
    # Normalise every input's frame rate + timebase first: xfade refuses to
    # chain streams whose timebases differ, and concat/xfade emit AV_TIME_BASE
    # while a raw mp4 input carries its own (e.g. 1/12800).
    for k in range(len(parts)):
        chains.append(f"[{k}:v]fps={fps:g},settb=AVTB[nv{k}]")
        if has_audio:
            chains.append(f"[{k}:a]asettb=AVTB[na{k}]")

    # Build the join pairwise, left to right, tracking the accumulated length
    # so each xfade's offset (where the dissolve starts) is exact.
    prev_v, prev_a = "[nv0]", "[na0]"
    acc = durs[0]
    for k in range(1, len(parts)):
        split_adj = shots[k - 1].mode == "split" or shots[k].mode == "split"
        out_v, out_a = f"[v{k}]", f"[a{k}]"
        if split_adj and REFRAME_SPLIT_XFADE_SEC > 0:
            d = min(REFRAME_SPLIT_XFADE_SEC, 0.4 * durs[k - 1], 0.4 * durs[k])
            # fadeblack (dip through black), NOT a cross-dissolve: a dissolve
            # superimposes the two layouts, and since a face sits at very
            # different places in a close-up vs a split-screen it appears to
            # slide/"drag". Dipping through black never overlaps them.
            chains.append(
                f"{prev_v}[nv{k}]xfade=transition=fadeblack:"
                f"duration={d:.3f}:offset={acc - d:.3f}{out_v}"
            )
            if has_audio:
                chains.append(f"{prev_a}[na{k}]acrossfade=d={d:.3f}{out_a}")
            acc += durs[k] - d
        else:
            chains.append(f"{prev_v}[nv{k}]concat=n=2:v=1:a=0{out_v}")
            if has_audio:
                chains.append(f"{prev_a}[na{k}]concat=n=2:v=0:a=1{out_a}")
            acc += durs[k]
        prev_v, prev_a = out_v, out_a

    maps = ["-map", prev_v]
    audio_args: list[str] = []
    if has_audio:
        maps += ["-map", prev_a]
        audio_args = ["-c:a", "aac", "-b:a", AUDIO_BITRATE]

    cmd = [
        "ffmpeg", "-y", *inputs,
        "-filter_complex", ";".join(chains),
        *maps,
        "-c:v", "libx264", "-crf", str(VIDEO_CRF), "-preset", VIDEO_PRESET,
        *audio_args,
        "-movflags", "+faststart",
        str(out_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg shot xfade-join failed:\n{result.stderr[-1500:]}")


def run(job: dict, candidate_id: str, candidate: dict) -> str:
    """Precisely re-encode + reframe a clip segment. Returns path to raw.mp4."""
    source = Path(job["source_video_path"])
    out_dir = JOBS_DIR / job["id"] / "clips" / candidate_id
    out_path = out_dir / "raw.mp4"
    out_dir.mkdir(parents=True, exist_ok=True)

    src_w, src_h, fps, has_audio = _probe_video(source)

    # Plan the reframe. Any failure here -> Tier 1 centre crop, never a crash.
    try:
        rplan = reframe.plan(
            source, candidate["start"], candidate["end"], src_w, src_h, fps, out_dir
        )
    except Exception:
        log.warning("reframe planning failed — falling back to Tier 1 centre crop",
                    exc_info=True)
        rplan = reframe.tier1_plan(src_w, src_h, candidate["start"],
                                   candidate["end"], "planning error")

    log.info("cut %s: %s", candidate_id, rplan.description)

    # Single shot -> encode straight to raw.mp4 (no concat needed).
    if len(rplan.shots) == 1:
        _encode_shot(source, rplan.shots[0], out_path, has_audio)
        return str(out_path)

    # Multi-shot edited span -> encode each shot, then join them. Split-screen
    # boundaries are cross-dissolved (xfade join); otherwise a lossless concat.
    # Any failure here falls back to a single Tier 1 centre crop of the span.
    try:
        parts: list[Path] = []
        for i, shot in enumerate(rplan.shots):
            part = out_dir / f"shot{i:02d}.mp4"
            _encode_shot(source, shot, part, has_audio)
            parts.append(part)
        if any(s.mode == "split" for s in rplan.shots):
            _join_xfade(parts, rplan.shots, out_path, has_audio, fps)
        else:
            _concat(parts, out_path)
        for part in parts:
            part.unlink(missing_ok=True)
    except Exception:
        log.warning("multi-shot reframe failed — falling back to Tier 1 centre crop",
                    exc_info=True)
        fallback = reframe.tier1_plan(src_w, src_h, candidate["start"],
                                      candidate["end"], "multi-shot encode error")
        _encode_shot(source, fallback.shots[0], out_path, has_audio)

    return str(out_path)
