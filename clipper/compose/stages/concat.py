import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import List, Optional, Tuple


def run(
    normalized_paths: List[str],
    transitions: List[Tuple[str, Optional[int]]],  # [(type, dur_ms), ...] len = N-1
    out_path: str,
) -> None:
    """Concat N normalized.mp4 files with optional per-pair transitions."""
    n = len(normalized_paths)
    if n == 0:
        raise ValueError("No segments to concat")
    if n == 1:
        shutil.copy2(normalized_paths[0], out_path)
        return

    # If all transitions are 'cut', use the fast concat demuxer (lossless)
    all_cut = all(t[0] == "cut" for t in transitions)
    if all_cut:
        _concat_demuxer(normalized_paths, out_path)
    else:
        _concat_xfade(normalized_paths, transitions, out_path)


def _concat_demuxer(paths: List[str], out_path: str) -> None:
    fd, list_path = tempfile.mkstemp(suffix=".txt", prefix="concat_")
    try:
        with os.fdopen(fd, "w") as f:
            for p in paths:
                abs_p = str(Path(p).resolve())
                f.write(f"file '{abs_p}'\n")
        cmd = [
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0", "-i", list_path,
            "-c", "copy",
            out_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"concat demuxer failed:\n{result.stderr[-2000:]}")
    finally:
        os.unlink(list_path)


_XFADE_TYPE = {
    "fade":     "fade",
    "slide_up": "slideup",
    "cut":      "fade",  # instant crossfade for cut within a mixed-transition chain
}
_DEFAULT_DUR_MS = {"fade": 125, "slide_up": 300, "cut": 20}


def _probe_video_duration(path: str) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=duration", "-of", "default=nw=1:nk=1", path],
        capture_output=True, text=True,
    )
    val = result.stdout.strip()
    if val:
        try:
            return float(val)
        except ValueError:
            pass
    # Fallback: format duration
    result2 = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", path],
        capture_output=True, text=True,
    )
    return float(result2.stdout.strip())


def _concat_xfade(
    paths: List[str],
    transitions: List[Tuple[str, Optional[int]]],
    out_path: str,
) -> None:
    n = len(paths)
    durations = [_probe_video_duration(p) for p in paths]

    fc_parts = []
    # Label each input video stream
    for i in range(n):
        fc_parts.append(f"[{i}:v]setsar=1[v{i}]")

    # Chain xfade pairs for video
    cum_dur = durations[0]
    prev_v = "v0"
    for i, (t_type, t_dur_ms) in enumerate(transitions):
        xfade_dur = (t_dur_ms if t_dur_ms else _DEFAULT_DUR_MS.get(t_type, 125)) / 1000.0
        xfade_type = _XFADE_TYPE.get(t_type, "fade")
        offset = max(0.0, cum_dur - xfade_dur)
        out_v = f"vx{i}" if i < len(transitions) - 1 else "vout"
        fc_parts.append(
            f"[{prev_v}][v{i + 1}]xfade=transition={xfade_type}"
            f":duration={xfade_dur:.3f}:offset={offset:.3f}[{out_v}]"
        )
        cum_dur += durations[i + 1] - xfade_dur
        prev_v = out_v

    # Chain acrossfade pairs for audio
    prev_a = "0:a"
    for i, (t_type, t_dur_ms) in enumerate(transitions):
        xfade_dur = (t_dur_ms if t_dur_ms else _DEFAULT_DUR_MS.get(t_type, 125)) / 1000.0
        out_a = f"ax{i}" if i < len(transitions) - 1 else "aout"
        fc_parts.append(
            f"[{prev_a}][{i + 1}:a]acrossfade=d={xfade_dur:.3f}[{out_a}]"
        )
        prev_a = out_a

    filter_complex = ";\n".join(fc_parts)

    cmd = ["ffmpeg", "-y"]
    for p in paths:
        cmd += ["-i", p]
    cmd += [
        "-filter_complex", filter_complex,
        "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-crf", "18", "-preset", "medium",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        out_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"concat xfade failed:\n{result.stderr[-2000:]}")
