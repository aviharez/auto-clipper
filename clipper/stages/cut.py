"""
cut.py — Stage: precise re-encode + 9:16 vertical reframe.

Always re-encodes (never stream-copy) so the cut lands exactly on the
requested second (plan §5.1). The vertical reframe is delegated to
`reframe.plan` (Tier 2a cut-aware multi-face fit-all): the clip span is
segmented into camera shots, each reframed on its own. This stage encodes
every shot separately and losslessly concatenates them into raw.mp4.

Every shot boundary — including switches into and out of a split-screen
shot — is a hard cut, joined losslessly with the concat demuxer.

On any failure — planning, a shot encode, or the join — this stage falls
back to a plain Tier 1 centre crop so a cut is always produced.
"""
import json
import logging
import subprocess
from pathlib import Path

from clipper.config import (
    BASE_DIR, VIDEO_CRF, VIDEO_PRESET, AUDIO_BITRATE, JOBS_DIR,
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

    # Multi-shot edited span -> encode each shot, then losslessly concatenate
    # them. Every boundary is a hard cut (including into/out of split-screen).
    # Any failure here falls back to a single Tier 1 centre crop of the span.
    try:
        parts: list[Path] = []
        for i, shot in enumerate(rplan.shots):
            part = out_dir / f"shot{i:02d}.mp4"
            _encode_shot(source, shot, part, has_audio)
            parts.append(part)
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
