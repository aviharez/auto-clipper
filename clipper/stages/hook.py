"""
Hook opener stage — prepends a short blurred teaser to the main clip.

blur_self (default): takes the first N seconds of raw.mp4, heavily blurs +
darkens them, and burns the hook_text as a centred ASS subtitle.  The hook
segment has silent audio; voice content starts when the main clip begins.

external-asset mode is a future extension (not built here).
"""
import logging
import re
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
    if not candidate["hook_enabled"]:
        return None

    clip_dir    = JOBS_DIR / job["id"] / "clips" / cand_id
    raw         = clip_dir / "raw.mp4"
    captioned   = clip_dir / "captioned.mp4"
    hook_out    = clip_dir / "hook.mp4"
    out_path    = clip_dir / "hooked.mp4"
    external_bg = clip_dir / "hook_background.mp4"
    main_clip   = captioned if captioned.exists() else raw

    is_external = (
        candidate.get("hook_background", "blur_self") != "blur_self"
        and external_bg.exists()
    )

    if is_external:
        # External video is used as-is — no blur, no text overlay.
        # hook_text is intentionally ignored: the uploaded clip already contains it.
        _concatenate(str(external_bg), str(main_clip), str(out_path))
        log.info("Hook prepended (external) → %s", out_path)
        return str(out_path)

    # blur_self mode: hook_text is required to produce the overlay.
    if not (candidate.get("hook_text") or "").strip():
        return None

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


def _apply_bracket_highlight(text: str, normal_color: str, highlight_color: str) -> str:
    """Replace [phrase] with inline ASS color overrides. Bracket chars are stripped."""
    def replace(m: re.Match) -> str:
        phrase = m.group(1)
        return f"{{\\1c{highlight_color}}}{phrase}{{\\1c{normal_color}}}"
    return re.sub(r'\[([^\]]+)\]', replace, text)


def _strip_brackets(text: str) -> str:
    """Remove [bracket] markers without applying any highlight (e.g. box preset)."""
    return re.sub(r'\[([^\]]+)\]', r'\1', text)


def _build_hook_ass(hook_text: str, duration: float, preset: dict) -> str:
    """Generate an ASS file that shows hook_text for `duration` seconds."""
    font_size_pct = preset.get("font_size_pct", 7)
    font_size     = int(font_size_pct / 100 * CLIP_HEIGHT)
    font_family   = preset.get("font_family", "Arial")
    outline_w     = preset.get("outline_width", 6)
    shadow        = 2 if preset.get("shadow", True) else 0
    text_color    = _rgb_to_ass(preset.get("text_color", "#FFFFFF"))
    border_style  = preset.get("border_style", 1)

    # BorderStyle=3: OutlineColour fills the opaque box behind each line.
    if border_style == 3:
        outline_color = _rgb_to_ass(preset["box_color"])
    else:
        outline_color = "&H00000000&"

    # position="lower" → alignment 2 (bottom-center), MarginV ~20% from bottom.
    # Default (no position key or "center") → alignment 5 (centre of screen).
    if preset.get("position") == "lower":
        alignment = 2
        margin_v  = 400
    else:
        alignment = 5
        margin_v  = 80

    margin_h = preset.get("margin_h", 80)

    # Apply text transforms before highlight parsing.
    text = hook_text
    if preset.get("text_transform") == "upper":
        text = text.upper()

    # [bracket] highlight: if preset has highlight_color, apply inline ASS color
    # overrides; otherwise just strip the brackets (e.g. box preset).
    highlight_hex = preset.get("highlight_color")
    if highlight_hex:
        text = _apply_bracket_highlight(text, text_color, _rgb_to_ass(highlight_hex))
    else:
        text = _strip_brackets(text)

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
        (
            f"Style: Default,{font_family},{font_size},"
            f"{text_color},&H000000FF&,{outline_color},&H00000000&,"
            f"-1,0,0,0,100,100,0,0,{border_style},{outline_w},{shadow},{alignment},{margin_h},{margin_h},{margin_v},1"
        ),
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        f"Dialogue: 0,0:00:00.00,{t_end},Default,,0,0,0,,{text}",
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
