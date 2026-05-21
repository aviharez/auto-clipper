"""
Hook opener stage — prepends a short blurred teaser to the main clip.

blur_self (default): takes the first N seconds of raw.mp4, heavily blurs +
darkens them, and burns the hook_text as a centred ASS subtitle.  The hook
segment has silent audio; voice content starts when the main clip begins.

external-asset mode is a future extension (not built here).
"""
import logging
import subprocess
from pathlib import Path
from typing import Optional

from clipper.config import (
    BASE_DIR,
    CAPTION_PRESETS, DEFAULT_CAPTION_PRESET,
    HOOK_PRESETS, DEFAULT_HOOK_PRESET,
    CLIP_WIDTH, CLIP_HEIGHT,
    VIDEO_CRF, VIDEO_PRESET, AUDIO_BITRATE,
    DEFAULT_HOOK_DURATION,
    FONTS_DIR, JOBS_DIR,
)

log = logging.getLogger(__name__)


def run(job: dict, cand_id: str, candidate: dict) -> Optional[str]:
    """Prepend hook segment to the (captioned) clip. Returns hooked.mp4 path or None."""
    if not candidate["hook_enabled"] or not (candidate.get("hook_text") or "").strip():
        return None

    clip_dir = JOBS_DIR / job["id"] / "clips" / cand_id
    raw      = clip_dir / "raw.mp4"
    captioned = clip_dir / "captioned.mp4"
    hook_out  = clip_dir / "hook.mp4"
    out_path  = clip_dir / "hooked.mp4"

    # Hook background always comes from raw.mp4 — captioned.mp4 has burnt-in
    # subtitle text that would look wrong blurred.
    # The main content appended after the hook is captioned.mp4 if it exists.
    main_clip = captioned if captioned.exists() else raw

    hook_preset_name = candidate.get("hook_preset") or DEFAULT_HOOK_PRESET
    preset = HOOK_PRESETS.get(hook_preset_name) or HOOK_PRESETS[DEFAULT_HOOK_PRESET]

    _create_hook_segment(
        src=str(raw),
        out=str(hook_out),
        hook_text=candidate["hook_text"],
        duration=DEFAULT_HOOK_DURATION,
        preset=preset,
    )
    _concatenate(str(hook_out), str(main_clip), str(out_path))
    log.info("Hook prepended → %s", out_path)
    return str(out_path)


# ── Hook segment creation ─────────────────────────────────────────────────────


def _format_ass_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    cs = int(s * 100) % 100
    return f"{h}:{m:02d}:{int(s):02d}.{cs:02d}"


def _rgb_to_ass(hex_color: str) -> str:
    r = int(hex_color[1:3], 16)
    g = int(hex_color[3:5], 16)
    b = int(hex_color[5:7], 16)
    return f"&H00{b:02X}{g:02X}{r:02X}&"


def _build_hook_ass(hook_text: str, duration: float, preset: dict) -> str:
    """Generate a simple centred ASS file that shows hook_text for `duration` seconds."""
    font_size_pct = preset.get("font_size_pct", 7)
    font_size   = int(font_size_pct / 100 * CLIP_HEIGHT)
    font_family = preset.get("font_family", "Arial")
    outline_w   = preset.get("outline_width", 6)
    shadow      = 2 if preset.get("shadow", True) else 0
    text_color  = _rgb_to_ass(preset.get("text_color", "#FFFFFF"))

    t_end = _format_ass_time(duration)

    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {CLIP_WIDTH}",
        f"PlayResY: {CLIP_HEIGHT}",
        "ScaledBorderAndShadow: yes",
        "WrapStyle: 1",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour,"
        " BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle,"
        " BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        # Alignment 5 = centre both axes; large L/R margins so long text wraps nicely.
        (
            f"Style: Default,{font_family},{font_size},"
            f"{text_color},&H000000FF&,&H00000000&,&H00000000&,"
            f"-1,0,0,0,100,100,0,0,1,{outline_w},{shadow},5,80,80,80,1"
        ),
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        f"Dialogue: 0,0:00:00.00,{t_end},Default,,0,0,0,,{hook_text}",
    ]
    return "\n".join(lines) + "\n"


def _create_hook_segment(
    src: str, out: str, hook_text: str, duration: float, preset: dict
):
    """
    Produce hook.mp4: first `duration` seconds of src, heavily blurred + darkened,
    with hook_text centred via ASS.  Audio track is silence (voice starts in main clip).
    """
    clip_dir = Path(out).parent
    ass_path = clip_dir / "hook_text.ass"
    ass_path.write_text(_build_hook_ass(hook_text, duration, preset), encoding="utf-8")

    ass_rel   = ass_path.relative_to(BASE_DIR).as_posix()
    fonts_rel = FONTS_DIR.relative_to(BASE_DIR).as_posix()
    brightness = preset.get("bg_brightness", -0.35)

    vf = (
        f"trim=0:{duration},setpts=PTS-STARTPTS,"
        f"boxblur=luma_radius=25:luma_power=3:chroma_radius=20:chroma_power=3,"
        f"eq=brightness={brightness},"
        f"setsar=1,"   # normalise SAR so concat with main clip is seamless
        f"ass={ass_rel}:fontsdir={fonts_rel}"
    )

    # anullsrc generates the silent audio track for the hook segment.
    filter_complex = (
        f"[0:v]{vf}[hookv];"
        f"anullsrc=sample_rate=44100:channel_layout=stereo,"
        f"atrim=0:{duration}[hooka]"
    )

    cmd = [
        "ffmpeg", "-y",
        "-i", src,
        "-filter_complex", filter_complex,
        "-map", "[hookv]",
        "-map", "[hooka]",
        "-c:v", "libx264", "-crf", str(VIDEO_CRF), "-preset", VIDEO_PRESET,
        "-c:a", "aac", "-b:a", AUDIO_BITRATE,
        "-movflags", "+faststart",
        out,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(BASE_DIR))
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg hook segment failed:\n{result.stderr}")


# ── Concatenation ─────────────────────────────────────────────────────────────


def _concatenate(hook: str, main_clip: str, out: str):
    """Concatenate hook.mp4 + main_clip into hooked.mp4 using the concat filter."""
    # Normalise SAR on both inputs to 1:1 before concat — ffmpeg 8.x refuses to
    # join segments with mismatched SAR (hook is 1:1; main clip may be 404:405
    # inherited from the YouTube source).
    filter_complex = (
        "[0:v]setsar=1[hv];"
        "[1:v]setsar=1[mv];"
        "[hv][0:a][mv][1:a]concat=n=2:v=1:a=1[v][a]"
    )
    cmd = [
        "ffmpeg", "-y",
        "-i", hook,
        "-i", main_clip,
        "-filter_complex", filter_complex,
        "-map", "[v]",
        "-map", "[a]",
        "-c:v", "libx264", "-crf", str(VIDEO_CRF), "-preset", VIDEO_PRESET,
        "-c:a", "aac", "-b:a", AUDIO_BITRATE,
        "-movflags", "+faststart",
        out,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg concat failed:\n{result.stderr}")
