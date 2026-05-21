"""
Branding overlay stage — burns a YouTube logo + channel name into the top-left
of the finished clip.  Runs after hook.py, before assembly.

When the input is hooked.mp4 the overlay is hidden during the hook segment
(via ffmpeg's enable='gte(t,HOOK_DURATION)') so it only appears once the main
content begins.

Skipped silently when job["channel_name"] is empty/None so existing jobs
without a channel name are unaffected.

Input priority: hooked.mp4 > captioned.mp4 > raw.mp4
Output: branded.mp4
"""
import logging
import subprocess
from pathlib import Path
from typing import Optional

from clipper.config import (
    BASE_DIR,
    CLIP_HEIGHT,
    VIDEO_CRF, VIDEO_PRESET,
    FONTS_DIR, JOBS_DIR,
    YOUTUBE_LOGO_PATH, YOUTUBE_LOGO_ASPECT,
    BRANDING_LOGO_HEIGHT_FRAC, BRANDING_MARGIN_PX,
    BRANDING_FONT_FILE, BRANDING_FONT_SIZE_FRAC,
    DEFAULT_HOOK_DURATION,
)

log = logging.getLogger(__name__)


def run(job: dict, cand_id: str, candidate: dict) -> Optional[str]:
    """Overlay YouTube logo + channel name. Returns branded.mp4 path or None."""
    channel_name = (job.get("channel_name") or "").strip()
    if not channel_name:
        return None

    if not YOUTUBE_LOGO_PATH.exists():
        log.warning("YouTube logo not found at %s — skipping branding", YOUTUBE_LOGO_PATH)
        return None

    clip_dir = JOBS_DIR / job["id"] / "clips" / cand_id

    # Pick the best already-produced clip as input; track whether it has a hook.
    src = None
    src_has_hook = False
    for name in ("hooked.mp4", "captioned.mp4", "raw.mp4"):
        candidate_file = clip_dir / name
        if candidate_file.exists():
            src = candidate_file
            src_has_hook = (name == "hooked.mp4")
            break

    if src is None:
        log.warning("No source clip found for candidate %s — skipping branding", cand_id)
        return None

    # Hide the overlay during the hook segment so it only appears on main content.
    hook_delay = DEFAULT_HOOK_DURATION if src_has_hook else 0.0

    out_path = clip_dir / "branded.mp4"
    _apply_branding(str(src), str(out_path), channel_name, hook_delay)
    log.info("Branding applied → %s (overlay starts at t=%.1fs)", out_path, hook_delay)
    return str(out_path)


# ── Internal ──────────────────────────────────────────────────────────────────


def _escape_drawtext(text: str) -> str:
    """Escape special characters for ffmpeg drawtext filter."""
    text = text.replace("\\", "\\\\")
    text = text.replace("'", "\\'")
    text = text.replace(":", "\\:")
    return text


def _filter_path(path) -> str:
    return Path(path).relative_to(BASE_DIR).as_posix()


def _apply_branding(src: str, out: str, channel_name: str, hook_delay: float):
    logo_h = int(CLIP_HEIGHT * BRANDING_LOGO_HEIGHT_FRAC)
    logo_w = int(logo_h * YOUTUBE_LOGO_ASPECT)
    font_size = int(CLIP_HEIGHT * BRANDING_FONT_SIZE_FRAC)
    margin = BRANDING_MARGIN_PX

    text_x = margin + logo_w + 12
    text_y = margin + (logo_h - font_size) // 2

    logo_rel = _filter_path(YOUTUBE_LOGO_PATH)
    font_rel = _filter_path(BRANDING_FONT_FILE)
    name_escaped = _escape_drawtext(channel_name)

    # enable expression: show overlay only after hook ends (or always if no hook).
    if hook_delay > 0:
        enable = f":enable='gte(t,{hook_delay:.3f})'"
    else:
        enable = ""

    filter_complex = (
        f"[1:v]scale=-1:{logo_h}[logo];"
        f"[0:v][logo]overlay={margin}:{margin}{enable}[vl];"
        f"[vl]drawtext="
        f"fontfile={font_rel}"
        f":text={name_escaped}"
        f":x={text_x}:y={text_y}"
        f":fontsize={font_size}"
        f":fontcolor=white"
        f":borderw=2:bordercolor=black"
        f"{enable}"
        f"[v]"
    )

    cmd = [
        "ffmpeg", "-y",
        "-i", src,
        "-i", str(YOUTUBE_LOGO_PATH),
        "-filter_complex", filter_complex,
        "-map", "[v]",
        "-map", "0:a",
        "-c:v", "libx264", "-crf", str(VIDEO_CRF), "-preset", VIDEO_PRESET,
        "-c:a", "copy",
        "-movflags", "+faststart",
        out,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(BASE_DIR))
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg branding failed:\n{result.stderr}")
