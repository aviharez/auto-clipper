import json
import logging
import subprocess
from pathlib import Path

from clipper.config import (
    BASE_DIR,
    CAPTION_PRESETS, DEFAULT_CAPTION_PRESET,
    CLIP_WIDTH, CLIP_HEIGHT,
    VIDEO_CRF, VIDEO_PRESET,
    FONTS_DIR, JOBS_DIR,
)

log = logging.getLogger(__name__)


def run(job: dict, cand_id: str, candidate: dict) -> str:
    """Burn viral-style ASS captions into raw.mp4. Returns path to captioned.mp4."""
    clip_dir = JOBS_DIR / job["id"] / "clips" / cand_id
    words_path = clip_dir / "words.json"
    raw_path = clip_dir / "raw.mp4"
    ass_path = clip_dir / "captions.ass"
    out_path = clip_dir / "captioned.mp4"

    words = json.loads(words_path.read_text(encoding="utf-8"))
    if not words:
        log.warning("No words found for candidate %s — skipping captions", cand_id)
        import shutil
        shutil.copy2(str(raw_path), str(out_path))
        return str(out_path)

    preset_name = candidate.get("caption_preset") or DEFAULT_CAPTION_PRESET
    preset = CAPTION_PRESETS.get(preset_name) or CAPTION_PRESETS[DEFAULT_CAPTION_PRESET]

    font_file = Path(preset["font_file"])
    if not font_file.exists():
        log.warning(
            "Font file %s not found — libass will use a system fallback. "
            "Place the font in assets/fonts/ for consistent output.",
            font_file.name,
        )

    ass_content = _build_ass(words, preset)
    ass_path.write_text(ass_content, encoding="utf-8")
    log.info("Wrote %s", ass_path)

    _burn_captions(str(raw_path), str(ass_path), str(out_path))
    log.info("Captioned clip written to %s", out_path)
    return str(out_path)


# ── ASS generation ────────────────────────────────────────────────────────────


def _format_ass_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    full_s = int(s)
    cs = int(s * 100) % 100
    return f"{h}:{m:02d}:{full_s:02d}.{cs:02d}"


def _rgb_to_ass(hex_color: str) -> str:
    """Convert #RRGGBB to ASS &H00BBGGRR& (little-endian BGR)."""
    r = int(hex_color[1:3], 16)
    g = int(hex_color[3:5], 16)
    b = int(hex_color[5:7], 16)
    return f"&H00{b:02X}{g:02X}{r:02X}&"


def _build_ass(words: list[dict], preset: dict) -> str:
    n = preset["words_on_screen"]
    font_size = int(preset["font_size_pct"] / 100 * CLIP_HEIGHT)
    font_family = preset.get("font_family", "Arial")

    # Bottom-center position; pos_y is where the bottom of the text lands.
    pos_x = CLIP_WIDTH // 2
    pos_y = int(CLIP_HEIGHT * (1 - preset["position_from_bottom_pct"] / 100))

    c_normal = _rgb_to_ass(preset["color_normal"])
    c_active = _rgb_to_ass(preset["color_active"])
    c_outline = _rgb_to_ass(preset["outline_color"])
    outline_w = preset["outline_width"]
    shadow = 2 if preset["shadow"] else 0
    pop = preset.get("pop_animation", False)

    header = "\n".join([
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {CLIP_WIDTH}",
        f"PlayResY: {CLIP_HEIGHT}",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour,"
        " BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle,"
        " BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        (
            f"Style: Default,{font_family},{font_size},"
            f"{c_normal},&H000000FF&,{c_outline},&H00000000&,"
            f"-1,0,0,0,100,100,0,0,1,{outline_w},{shadow},2,10,10,10,1"
        ),
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ])

    events: list[str] = []
    chunks = [words[i:i + n] for i in range(0, len(words), n)]

    for chunk in chunks:
        last_end = chunk[-1]["end"]

        for i, word in enumerate(chunk):
            state_start = word["start"]
            state_end = chunk[i + 1]["start"] if i + 1 < len(chunk) else last_end

            if state_end <= state_start:
                state_end = state_start + 0.05  # guard against zero-duration events

            # Build text: each word with colour override for the active one.
            parts = []
            for j, w in enumerate(chunk):
                display = w["text"].rstrip(".,!?;:\"'”。")
                if j == i:
                    # Active word: switch to highlight colour, then reset.
                    parts.append(f"{{\\1c{c_active}}}{display}{{\\1c{c_normal}}}")
                else:
                    parts.append(display)
            text_body = " ".join(parts)

            # Positioning + optional pop scale animation on the first word of each chunk.
            if i == 0 and pop:
                pos_tag = (
                    f"{{\\an2\\pos({pos_x},{pos_y})"
                    r"\t(0,100,\fscx115\fscy115)\t(100,200,\fscx100\fscy100)"
                    "}"
                )
            else:
                pos_tag = f"{{\\an2\\pos({pos_x},{pos_y})}}"

            t_start = _format_ass_time(state_start)
            t_end = _format_ass_time(state_end)
            events.append(
                f"Dialogue: 0,{t_start},{t_end},Default,,0,0,0,,{pos_tag}{text_body}"
            )

    return header + "\n" + "\n".join(events) + "\n"


# ── ffmpeg burn ───────────────────────────────────────────────────────────────


def _filter_path(path) -> str:
    """Make a path relative to BASE_DIR for use in an ffmpeg -vf filter expression.

    ffmpeg's filter parser treats ':' as an option separator; Windows drive-letter
    colons (C:) cannot be reliably escaped in filter strings on ffmpeg 8.x.
    Using paths relative to BASE_DIR (passed as cwd to subprocess) avoids the
    drive letter entirely.
    """
    return Path(path).relative_to(BASE_DIR).as_posix()


def _burn_captions(src: str, ass_path: str, out_path: str):
    # Relative paths in the filter string avoid the Windows drive-letter colon
    # problem; absolute paths are fine for -i and the output argument.
    vf = f"ass={_filter_path(ass_path)}:fontsdir={_filter_path(FONTS_DIR)}"
    cmd = [
        "ffmpeg", "-y",
        "-i", src,
        "-vf", vf,
        "-c:v", "libx264",
        "-crf", str(VIDEO_CRF),
        "-preset", VIDEO_PRESET,
        "-c:a", "copy",          # audio already encoded by cut.py
        "-movflags", "+faststart",
        out_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(BASE_DIR))
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg caption burn failed:\n{result.stderr}")
