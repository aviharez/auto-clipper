"""
Watermark stage — burns a small bottom-center text watermark onto the finished clip.

Visible from hook_duration to end of clip (not during the hook segment).
Watermark text is WATERMARK_TEXT from config.py. Single-channel tool; promote to
a batch input if multi-channel support is ever needed.

Input priority: branded.mp4 > hooked.mp4 > captioned.mp4 > raw.mp4
Output: watermarked.mp4
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
    WATERMARK_TEXT, WATERMARK_FONT_FILE,
    WATERMARK_FONT_SIZE_FRAC, WATERMARK_COLOR, WATERMARK_MARGIN_BOTTOM_PX,
    DEFAULT_HOOK_DURATION,
)

log = logging.getLogger(__name__)


def run(job: dict, cand_id: str, candidate: dict) -> Optional[str]:
    """Burn bottom-center watermark. Returns watermarked.mp4 path or None."""
    if not WATERMARK_TEXT.strip():
        return None

    clip_dir = JOBS_DIR / job["id"] / "clips" / cand_id

    src = None
    src_has_hook = False
    for name in ("branded.mp4", "hooked.mp4", "captioned.mp4", "raw.mp4"):
        f = clip_dir / name
        if f.exists():
            src = f
            src_has_hook = name in ("branded.mp4", "hooked.mp4")
            break

    if src is None:
        log.warning("No source clip found for candidate %s — skipping watermark", cand_id)
        return None

    hook_delay = 0.0
    if src_has_hook and candidate.get("hook_enabled"):
        hook_delay = float(candidate.get("hook_duration") or DEFAULT_HOOK_DURATION)

    out_path = clip_dir / "watermarked.mp4"
    _apply_watermark(str(src), str(out_path), hook_delay)
    log.info("Watermark applied → %s (starts at t=%.1fs)", out_path, hook_delay)
    return str(out_path)


# ── Internal ──────────────────────────────────────────────────────────────────


def _filter_path(path) -> str:
    return Path(path).relative_to(BASE_DIR).as_posix()


def _escape_drawtext(text: str) -> str:
    text = text.replace("\\", "\\\\")
    text = text.replace("'", "\\'")
    text = text.replace(":", "\\:")
    return text


def _apply_watermark(src: str, out: str, hook_delay: float):
    font_size = int(CLIP_HEIGHT * WATERMARK_FONT_SIZE_FRAC)
    font_rel = _filter_path(WATERMARK_FONT_FILE)
    text_escaped = _escape_drawtext(WATERMARK_TEXT)

    # Bottom-center: (w-text_w)/2 centers horizontally; y clears the TikTok/Shorts UI.
    x = "(w-text_w)/2"
    y = f"h-text_h-{WATERMARK_MARGIN_BOTTOM_PX}"

    enable = f":enable='gte(t,{hook_delay:.3f})'" if hook_delay > 0 else ""

    vf = (
        f"drawtext="
        f"fontfile={font_rel}"
        f":text={text_escaped}"
        f":x={x}:y={y}"
        f":fontsize={font_size}"
        f":fontcolor={WATERMARK_COLOR}@0.75"
        f"{enable}"
    )

    cmd = [
        "ffmpeg", "-y",
        "-i", src,
        "-vf", vf,
        "-c:v", "libx264", "-crf", str(VIDEO_CRF), "-preset", VIDEO_PRESET,
        "-c:a", "copy",
        "-movflags", "+faststart",
        out,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(BASE_DIR))
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg watermark failed:\n{result.stderr}")
