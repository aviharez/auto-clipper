"""
Hook opener stage — prepends a short teaser segment to the main clip.

Three background paths (detected at runtime by file extension):
  blur_self   — default; first N seconds of raw.mp4, heavily blurred + darkened.
  video       — uploaded video clipped to hook_duration; if shorter, last frame frozen.
  image       — uploaded image displayed static for hook_duration seconds.

In ALL three modes hook_text is ALWAYS rendered with the chosen preset overlay.
The 2.5.5 "external video → suppress text" branch has been removed (2.6.2).

Locked behavior: when an uploaded video is shorter than hook_duration, freeze the
last frame to fill the remaining time (do NOT loop — looping glitches at the seam).
"""
import json as _json
import logging
import re
import subprocess
from pathlib import Path
from typing import Optional

from clipper.config import (
    BASE_DIR,
    HOOK_PRESETS, DEFAULT_HOOK_PRESET,
    CLIP_WIDTH, CLIP_HEIGHT,
    VIDEO_CRF, VIDEO_PRESET, AUDIO_BITRATE,
    DEFAULT_HOOK_DURATION,
    FONTS_DIR, JOBS_DIR,
)

log = logging.getLogger(__name__)

_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
_VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}


def run(job: dict, cand_id: str, candidate: dict) -> Optional[str]:
    """Prepend hook segment to the (captioned) clip. Returns hooked.mp4 path or None."""
    if not candidate["hook_enabled"]:
        return None
    if not (candidate.get("hook_text") or "").strip():
        return None

    clip_dir  = JOBS_DIR / job["id"] / "clips" / cand_id
    raw       = clip_dir / "raw.mp4"
    captioned = clip_dir / "captioned.mp4"
    hook_out  = clip_dir / "hook.mp4"
    out_path  = clip_dir / "hooked.mp4"
    main_clip = captioned if captioned.exists() else raw

    hook_preset_name = candidate.get("hook_preset") or DEFAULT_HOOK_PRESET
    preset = HOOK_PRESETS.get(hook_preset_name) or HOOK_PRESETS[DEFAULT_HOOK_PRESET]
    hook_duration = float(candidate.get("hook_duration") or DEFAULT_HOOK_DURATION)

    bg_mode, bg_file = _resolve_background(
        candidate.get("hook_background", "blur_self"), clip_dir
    )

    _create_hook_segment(
        raw=str(raw),
        bg_mode=bg_mode,
        bg_file=bg_file,
        out=str(hook_out),
        hook_text=candidate["hook_text"],
        duration=hook_duration,
        preset=preset,
    )
    transition = preset.get("transition", "cut")
    _concatenate(str(hook_out), str(main_clip), str(out_path), transition=transition, hook_duration=hook_duration)
    log.info("Hook prepended (%s, transition=%s) → %s", bg_mode, transition, out_path)
    return str(out_path)


# ── Background resolution ─────────────────────────────────────────────────────


def _resolve_background(
    hook_background: str, clip_dir: Path
) -> tuple[str, Optional[Path]]:
    """Return (mode, file_or_None). mode: 'blur_self' | 'video' | 'image'.

    Searches for any hook_background.* file and classifies by extension.
    Falls back to blur_self if declared external but no file is found.
    """
    if hook_background == "blur_self":
        return "blur_self", None

    for f in sorted(clip_dir.glob("hook_background.*")):
        ext = f.suffix.lower()
        if ext in _IMAGE_EXTS:
            return "image", f
        if ext in _VIDEO_EXTS:
            return "video", f

    log.warning(
        "hook_background=%r declared but no file found in %s; falling back to blur_self",
        hook_background, clip_dir,
    )
    return "blur_self", None


# ── Hook segment creation ─────────────────────────────────────────────────────


def _create_hook_segment(
    raw: str,
    bg_mode: str,
    bg_file: Optional[Path],
    out: str,
    hook_text: str,
    duration: float,
    preset: dict,
):
    clip_dir = Path(out).parent
    ass_path = clip_dir / "hook_text.ass"
    ass_path.write_text(_build_hook_ass(hook_text, duration, preset), encoding="utf-8")

    ass_rel   = ass_path.relative_to(BASE_DIR).as_posix()
    fonts_rel = FONTS_DIR.relative_to(BASE_DIR).as_posix()

    if bg_mode == "image":
        _make_hook_image_bg(str(bg_file), out, ass_rel, fonts_rel, duration, preset)
    elif bg_mode == "video":
        _make_hook_video_bg(str(bg_file), out, ass_rel, fonts_rel, duration, preset)
    else:
        _make_hook_blur_self(raw, out, ass_rel, fonts_rel, duration, preset)


def _make_hook_blur_self(
    src: str, out: str, ass_rel: str, fonts_rel: str, duration: float, preset: dict
):
    darkness = preset.get("gradient_darkness", 0.75)
    # Gradient overlay: top 10% untouched; below 10% darkens linearly to darkness at bottom.
    # factor = 1.0 at y=10%, (1 - darkness) at y=100%.
    factor = f"if(lt(Y/H,0.1),1,1-min(1,(Y/H-0.1)/0.9)*{darkness:.3f})"
    vf = (
        f"trim=0:{duration},setpts=PTS-STARTPTS,"
        f"geq=r='r(X,Y)*({factor})':g='g(X,Y)*({factor})':b='b(X,Y)*({factor})',"
        f"setsar=1,"
        f"ass={ass_rel}:fontsdir={fonts_rel}"
    )
    filter_complex = (
        f"[0:v]{vf}[hookv];"
        f"anullsrc=sample_rate=44100:channel_layout=stereo,"
        f"atrim=0:{duration}[hooka]"
    )
    cmd = [
        "ffmpeg", "-y",
        "-i", src,
        "-filter_complex", filter_complex,
        "-map", "[hookv]", "-map", "[hooka]",
        "-c:v", "libx264", "-crf", str(VIDEO_CRF), "-preset", VIDEO_PRESET,
        "-c:a", "aac", "-b:a", AUDIO_BITRATE,
        "-movflags", "+faststart",
        out,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(BASE_DIR))
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg hook (blur_self) failed:\n{result.stderr}")


def _probe_duration(path: str) -> float:
    res = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", path],
        capture_output=True, text=True,
    )
    if res.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {res.stderr}")
    return float(_json.loads(res.stdout)["format"]["duration"])


def _make_hook_video_bg(
    bg_file: str, out: str, ass_rel: str, fonts_rel: str, duration: float, preset: dict
):
    """Video background: trim to hook_duration; if shorter, freeze last frame."""
    vid_dur = _probe_duration(bg_file)
    if vid_dur >= duration:
        vf_trim = f"trim=0:{duration},setpts=PTS-STARTPTS"
    else:
        # Freeze the last frame to fill the remaining time (locked: no looping).
        freeze = duration - vid_dur
        vf_trim = f"setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration={freeze:.3f}"

    vf = (
        f"{vf_trim},"
        f"scale={CLIP_WIDTH}:{CLIP_HEIGHT}:force_original_aspect_ratio=increase,"
        f"crop={CLIP_WIDTH}:{CLIP_HEIGHT},"
        f"setsar=1,"
        f"ass={ass_rel}:fontsdir={fonts_rel}"
    )
    filter_complex = (
        f"[0:v]{vf}[hookv];"
        f"anullsrc=sample_rate=44100:channel_layout=stereo,"
        f"atrim=0:{duration}[hooka]"
    )
    cmd = [
        "ffmpeg", "-y",
        "-i", bg_file,
        "-filter_complex", filter_complex,
        "-map", "[hookv]", "-map", "[hooka]",
        "-c:v", "libx264", "-crf", str(VIDEO_CRF), "-preset", VIDEO_PRESET,
        "-c:a", "aac", "-b:a", AUDIO_BITRATE,
        "-movflags", "+faststart",
        out,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(BASE_DIR))
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg hook (video bg) failed:\n{result.stderr}")


def _make_hook_image_bg(
    bg_file: str, out: str, ass_rel: str, fonts_rel: str, duration: float, preset: dict
):
    """-loop 1 treats the image as an infinite stream; trim=0:duration caps it."""
    vf = (
        f"trim=0:{duration},setpts=PTS-STARTPTS,"
        f"scale={CLIP_WIDTH}:{CLIP_HEIGHT}:force_original_aspect_ratio=increase,"
        f"crop={CLIP_WIDTH}:{CLIP_HEIGHT},"
        f"setsar=1,"
        f"ass={ass_rel}:fontsdir={fonts_rel}"
    )
    filter_complex = (
        f"[0:v]{vf}[hookv];"
        f"anullsrc=sample_rate=44100:channel_layout=stereo,"
        f"atrim=0:{duration}[hooka]"
    )
    cmd = [
        "ffmpeg", "-y",
        "-loop", "1", "-framerate", "25", "-i", bg_file,
        "-filter_complex", filter_complex,
        "-map", "[hookv]", "-map", "[hooka]",
        "-c:v", "libx264", "-crf", str(VIDEO_CRF), "-preset", VIDEO_PRESET,
        "-c:a", "aac", "-b:a", AUDIO_BITRATE,
        "-movflags", "+faststart",
        out,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(BASE_DIR))
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg hook (image bg) failed:\n{result.stderr}")


# ── ASS subtitle helpers ──────────────────────────────────────────────────────


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


def _strip_brackets(text: str) -> str:
    """Remove [bracket] markers without applying any highlight (e.g. box preset)."""
    return re.sub(r'\[([^\]]+)\]', r'\1', text)


# libass renders glyphs a touch wider than the calibrated Pillow measurement
# (faux-bold + kerning) — wrap against a slightly reduced width as a guard.
_HOOK_WRAP_SAFETY = 0.96


def _font_bbox_to_em(font_file: str) -> float:
    """Ratio unitsPerEm / global-bbox-height, read from the font's `head` table.

    libass sizes a font by its global bbox height (FT_SIZE_REQUEST_TYPE_REAL_DIM),
    so ASS Fontsize N renders the em at N * this-ratio pixels — well below N.
    """
    data = Path(font_file).read_bytes()
    num_tables = int.from_bytes(data[4:6], "big")
    for i in range(num_tables):
        rec = 12 + i * 16
        if data[rec:rec + 4] == b"head":
            off = int.from_bytes(data[rec + 8:rec + 12], "big")
            upm = int.from_bytes(data[off + 18:off + 20], "big")
            y_min = int.from_bytes(data[off + 38:off + 40], "big", signed=True)
            y_max = int.from_bytes(data[off + 42:off + 44], "big", signed=True)
            return upm / (y_max - y_min)
    raise ValueError("font has no 'head' table")


def _text_measurer(font_file: Optional[str], font_size: int):
    """Return a callable visible_text -> libass-rendered pixel width.

    Pillow is measured at the libass-equivalent em size (see _font_bbox_to_em):
    measuring at the raw ASS Fontsize over-reports width by ~1.5x for a display
    face like Montserrat Black and wraps the text far too early. Falls back to a
    rough per-character estimate if Pillow or the font file is unavailable.
    """
    try:
        from PIL import ImageFont
        em_px = font_size * _font_bbox_to_em(font_file)
        return ImageFont.truetype(font_file, em_px).getlength
    except Exception as exc:  # noqa: BLE001 — any failure → estimate, never raise
        log.warning("hook text wrap: font measurement unavailable (%s); estimating", exc)
        return lambda s: len(s) * font_size * 0.3


def _wrap_hook_text(text: str, measure, max_width: float) -> list[str]:
    """Greedy word-wrap. `text` may carry [ ] highlight markers, which are
    stripped before measuring since brackets are never rendered."""
    words = text.split()
    if not words:
        return [""]
    lines: list[str] = []
    cur = ""
    for w in words:
        cand = f"{cur} {w}" if cur else w
        if cur and measure(_strip_brackets(cand)) > max_width:
            lines.append(cur)
            cur = w
        else:
            cur = cand
    lines.append(cur)
    return lines


def _format_hook_line(
    raw: str, in_highlight: bool, normal_color: str, highlight_color: Optional[str]
) -> tuple[str, bool]:
    """Convert one raw line (with [ ] markers) to ASS event text.

    Each wrapped line is its own Dialogue event, so colour overrides do not
    persist across lines: when a [highlight] spans a wrap, the next line must
    re-open it. `in_highlight` carries that state across the boundary.
    """
    parts: list[str] = []
    if in_highlight and highlight_color:
        parts.append(f"{{\\1c{highlight_color}}}")
    for ch in raw:
        if ch == "[":
            in_highlight = True
            if highlight_color:
                parts.append(f"{{\\1c{highlight_color}}}")
        elif ch == "]":
            in_highlight = False
            if highlight_color:
                parts.append(f"{{\\1c{normal_color}}}")
        else:
            parts.append(ch)
    return "".join(parts), in_highlight


def _build_hook_ass(hook_text: str, duration: float, preset: dict) -> str:
    """Generate an ASS file that shows hook_text for `duration` seconds.

    The text is word-wrapped here (not by libass) and each line is emitted as
    its own \\pos-positioned event, so the inter-line gap is controlled directly
    via the preset's `line_spacing` (× font size) rather than left to the font's
    natural line height. A [highlight] phrase may straddle a wrap boundary.
    """
    font_size_pct = preset.get("font_size_pct", 7)
    font_size     = int(font_size_pct / 100 * CLIP_HEIGHT)
    font_family   = preset.get("font_family", "Arial")
    outline_w     = preset.get("outline_width", 6)
    shadow        = 2 if preset.get("shadow", True) else 0
    text_color    = _rgb_to_ass(preset.get("text_color", "#FFFFFF"))
    border_style  = preset.get("border_style", 1)
    margin_h      = preset.get("margin_h", 80)
    line_spacing  = preset.get("line_spacing", 1.05)

    if border_style == 3:
        outline_color = _rgb_to_ass(preset["box_color"])
    else:
        outline_color = "&H00000000&"

    highlight_hex   = preset.get("highlight_color")
    highlight_color = _rgb_to_ass(highlight_hex) if highlight_hex else None

    text = hook_text
    if preset.get("text_transform") == "upper":
        text = text.upper()

    measure   = _text_measurer(preset.get("font_file"), font_size)
    max_width = (CLIP_WIDTH - 2 * margin_h) * _HOOK_WRAP_SAFETY
    raw_lines = _wrap_hook_text(text, measure, max_width)

    ass_lines: list[str] = []
    in_highlight = False
    for raw in raw_lines:
        formatted, in_highlight = _format_hook_line(
            raw, in_highlight, text_color, highlight_color
        )
        ass_lines.append(formatted)

    # Stack the lines at a fixed `line_spacing` × font_size pitch. "lower"
    # presets anchor the block 400px above the frame bottom; otherwise centre it.
    n         = len(ass_lines)
    line_h    = font_size * line_spacing
    cx        = CLIP_WIDTH / 2
    if preset.get("position") == "lower":
        block_top = (CLIP_HEIGHT - 400) - n * line_h
    else:
        block_top = (CLIP_HEIGHT - n * line_h) / 2
    centers = [block_top + line_h * (i + 0.5) for i in range(n)]

    t_end = _format_ass_time(duration)

    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {CLIP_WIDTH}",
        f"PlayResY: {CLIP_HEIGHT}",
        "ScaledBorderAndShadow: yes",
        "WrapStyle: 2",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour,"
        " BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle,"
        " BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        (
            f"Style: Default,{font_family},{font_size},"
            f"{text_color},&H000000FF&,{outline_color},&H00000000&,"
            f"-1,0,0,0,100,100,0,0,{border_style},{outline_w},{shadow},5,0,0,0,1"
        ),
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    for txt, cy in zip(ass_lines, centers):
        lines.append(
            f"Dialogue: 0,0:00:00.00,{t_end},Default,,0,0,0,,"
            f"{{\\an5\\pos({cx:.0f},{cy:.1f})}}{txt}"
        )
    return "\n".join(lines) + "\n"


# ── Concatenation ─────────────────────────────────────────────────────────────

# Fixed durations per transition type (locked — not user-tunable per §2.6.3).
_TRANSITION_SPECS: dict[str, dict] = {
    "fade":     {"effect": "fade",    "duration": 0.125},
    "slide_up": {"effect": "slideup", "duration": 0.30},
}


def _concatenate(
    hook: str,
    main_clip: str,
    out: str,
    transition: str = "cut",
    hook_duration: float = 3.0,
):
    """Concatenate hook.mp4 + main_clip into hooked.mp4.

    transition: "cut" (hard join), "fade" (hook fades to black → main fades in),
                or "slide_up" (hook slides off top while main enters from bottom).
    Durations are fixed per type and not exposed as parameters.

    "fade" uses individual fade+concat rather than xfade cross-dissolve.
    xfade cross-dissolve is invisible when hook and main clip share the same
    opening frames (hook is a darkened version of the clip start). The individual
    approach — hook fades to black, then main clip fades in from black — produces
    an unambiguous visible dip regardless of content similarity.
    """
    spec = _TRANSITION_SPECS.get(transition)

    if spec is None:
        # Hard cut — original concat filter behaviour.
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
    else:
        effect = spec["effect"]
        t_dur = spec["duration"]
        offset = max(0.0, hook_duration - t_dur)

        if effect == "fade":
            # Individual fade: hook fades to black over last t_dur seconds,
            # main clip fades in from black over first t_dur seconds, hard concat.
            # Output duration = hook_duration + main_clip_duration (no frame overlap).
            filter_complex = (
                f"[0:v]setsar=1,fade=t=out:st={offset:.3f}:d={t_dur:.3f}[hv];"
                f"[1:v]setsar=1,fade=t=in:st=0:d={t_dur:.3f}[mv];"
                f"[hv][mv]concat=n=2:v=1:a=0[v];"
                f"[0:a]afade=t=out:st={offset:.3f}:d={t_dur:.3f}[ha];"
                f"[1:a]afade=t=in:st=0:d={t_dur:.3f}[ma];"
                f"[ha][ma]concat=n=2:v=0:a=1[a]"
            )
        else:
            # xfade for slide_up (hook exits top, main enters from bottom).
            filter_complex = (
                f"[0:v]setsar=1[hv];"
                f"[1:v]setsar=1[mv];"
                f"[hv][mv]xfade=transition={effect}:duration={t_dur:.3f}:offset={offset:.3f}[v];"
                f"[0:a][1:a]acrossfade=d={t_dur:.3f}[a]"
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
        raise RuntimeError(f"ffmpeg concat (transition={transition!r}) failed:\n{result.stderr}")
    if result.stderr:
        log.debug("ffmpeg concat stderr:\n%s", result.stderr)
