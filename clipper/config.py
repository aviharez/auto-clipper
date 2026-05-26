import os
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent

# Ensure ffmpeg/ffprobe are on PATH for all subprocess calls in this process.
_FFMPEG_BIN = Path(r"C:\ffmpeg\bin")
if _FFMPEG_BIN.exists() and str(_FFMPEG_BIN) not in os.environ.get("PATH", ""):
    os.environ["PATH"] = str(_FFMPEG_BIN) + os.pathsep + os.environ.get("PATH", "")
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "jobs.db"
JOBS_DIR = DATA_DIR / "jobs"
ASSETS_DIR = BASE_DIR / "assets"
FONTS_DIR = ASSETS_DIR / "fonts"
LOGOS_DIR = ASSETS_DIR / "logos"
YOUTUBE_LOGO_PATH = LOGOS_DIR / "youtube.png"
# Logo natural dimensions (180×127) — used in branding.py to compute scaled width.
YOUTUBE_LOGO_ASPECT = 180 / 127  # width / height

# Branding overlay — logo + channel name in top-left corner of every clip.
BRANDING_LOGO_HEIGHT_FRAC = 0.015   # logo height as fraction of CLIP_HEIGHT (~65px at 1920)
BRANDING_MARGIN_PX = 42             # pixels from top-left edge
BRANDING_FONT_FILE = str(FONTS_DIR / "Montserrat-Bold.ttf")
BRANDING_FONT_FAMILY = "Montserrat"
BRANDING_FONT_SIZE_FRAC = 0.015     # channel name font size as fraction of CLIP_HEIGHT (~36px)

# Delivery (§2.7).
# User-configurable via environment variables or by editing the values below.
import os as _os

# Local deliverer — target folder on this machine.
DELIVERY_LOCAL_OUTPUT_DIR = (
    Path(_os.environ["DELIVERY_LOCAL_OUTPUT_DIR"])
    if _os.environ.get("DELIVERY_LOCAL_OUTPUT_DIR")
    else Path.home() / "Documents" / "clipper-output"
)

# Google Drive deliverer — rclone remote name and destination folder.
# Run 'rclone config' once to set up the remote, then set these values.
GDRIVE_RCLONE_REMOTE = _os.environ.get("GDRIVE_RCLONE_REMOTE", "gdrive")
GDRIVE_DESTINATION_FOLDER = _os.environ.get("GDRIVE_DESTINATION_FOLDER", "clipper-output")

# Which deliverer to use by default: "local" or "gdrive".
DEFAULT_DELIVERER = _os.environ.get("DEFAULT_DELIVERER", "local")

# Target clip resolution (9:16 vertical)
CLIP_WIDTH = 1080
CLIP_HEIGHT = 1920

# ffmpeg encode settings
VIDEO_CRF = 18
VIDEO_PRESET = "medium"
AUDIO_BITRATE = "192k"

# Caption presets — defined now so the Candidate schema is stable; used in Iteration 2
CAPTION_PRESETS = {
    "warm_yellow": {
        "words_on_screen": 3,
        "font_file": str(FONTS_DIR / "Montserrat-Bold.ttf"),
        "font_family": "Montserrat",
        "font_size_pct": 4,
        "color_normal": "#FFFFFF",
        "color_active": "#FFD166",
        "outline_color": "#000000",
        "outline_width": 4,
        "shadow": True,
        "position_from_bottom_pct": 30,
        "pop_animation": False,
    },
    "emotional_red": {
        "words_on_screen": 3,
        "font_file": str(FONTS_DIR / "Montserrat-Bold.ttf"),
        "font_family": "Montserrat",
        "font_size_pct": 4,
        "color_normal": "#FFFFFF",
        "color_active": "#FF4D6D",
        "outline_color": "#000000",
        "outline_width": 4,
        "shadow": True,
        "position_from_bottom_pct": 30,
        "pop_animation": False,
    },
    "debate_orange": {
        "words_on_screen": 3,
        "font_file": str(FONTS_DIR / "Montserrat-Bold.ttf"),
        "font_family": "Montserrat",
        "font_size_pct": 4,
        "color_normal": "#FFFFFF",
        "color_active": "#FF8C42",
        "outline_color": "#000000",
        "outline_width": 4,
        "shadow": True,
        "position_from_bottom_pct": 30,
        "pop_animation": False,
    },
    "insight_blue": {
        "words_on_screen": 3,
        "font_file": str(FONTS_DIR / "Montserrat-Bold.ttf"),
        "font_family": "Montserrat",
        "font_size_pct": 4,
        "color_normal": "#FFFFFF",
        "color_active": "#4EA8DE",
        "outline_color": "#000000",
        "outline_width": 4,
        "shadow": True,
        "position_from_bottom_pct": 30,
        "pop_animation": False,
    },
    "neon_green": {
        "words_on_screen": 3,
        "font_file": str(FONTS_DIR / "Montserrat-Bold.ttf"),
        "font_family": "Montserrat",
        "font_size_pct": 4,
        "color_normal": "#FFFFFF",
        "color_active": "#00FF7F",
        "outline_color": "#000000",
        "outline_width": 4,
        "shadow": True,
        "position_from_bottom_pct": 30,
        "pop_animation": False,
    },

    # "bold_yellow": {
    #     "words_on_screen": 3,
    #     "font_file": str(FONTS_DIR / "Montserrat-Bold.ttf"),
    #     "font_family": "Montserrat",
    #     "font_size_pct": 7,
    #     "color_normal": "#FFFFFF",
    #     "color_active": "#FFE000",
    #     "outline_color": "#000000",
    #     "outline_width": 6,
    #     "shadow": True,
    #     "position_from_bottom_pct": 30,
    #     "pop_animation": True,
    # },
    # "clean_white": {
    #     "words_on_screen": 2,
    #     "font_file": str(FONTS_DIR / "Inter-28pt-Bold.ttf"),
    #     "font_family": "Inter 28pt",
    #     "font_size_pct": 6,
    #     "color_normal": "#FFFFFF",
    #     "color_active": "#FFFFFF",
    #     "outline_color": "#000000",
    #     "outline_width": 4,
    #     "shadow": True,
    #     "position_from_bottom_pct": 28,
    #     "pop_animation": False,
    # },
    # BorderStyle=3: opaque box behind each word (one word at a time).
    # outline_width controls box padding rather than stroke width in this mode.
    # "box_highlight": {
    #     "words_on_screen": 1,
    #     "font_file": str(FONTS_DIR / "Montserrat-Bold.ttf"),
    #     "font_family": "Montserrat",
    #     "font_size_pct": 8,
    #     "color_normal": "#000000",
    #     "color_active": "#000000",
    #     "outline_color": "#000000",
    #     "outline_width": 12,
    #     "shadow": False,
    #     "border_style": 3,
    #     "box_color": "#FFE000",
    #     "position_from_bottom_pct": 28,
    #     "pop_animation": False,
    # },
    # "neon_green": {
    #     "words_on_screen": 3,
    #     "font_file": str(FONTS_DIR / "Montserrat-Bold.ttf"),
    #     "font_family": "Montserrat",
    #     "font_size_pct": 4,
    #     "color_normal": "#FFFFFF",
    #     "color_active": "#00FF7F",
    #     "outline_color": "#000000",
    #     "outline_width": 4,
    #     "shadow": True,
    #     "position_from_bottom_pct": 30,
    #     "pop_animation": False,
    # },
    # "fire_orange": {
    #     "words_on_screen": 2,
    #     "font_file": str(FONTS_DIR / "Montserrat-Bold.ttf"),
    #     "font_family": "Montserrat",
    #     "font_size_pct": 7,
    #     "color_normal": "#FFFFFF",
    #     "color_active": "#FF4500",
    #     "outline_color": "#000000",
    #     "outline_width": 8,
    #     "shadow": True,
    #     "position_from_bottom_pct": 30,
    #     "pop_animation": True,
    # },
    # "vibrant_cyan": {
    #     "words_on_screen": 3,
    #     "font_file": str(FONTS_DIR / "Inter-28pt-Bold.ttf"),
    #     "font_family": "Inter 28pt",
    #     "font_size_pct": 6,
    #     "color_normal": "#FFFFFF",
    #     "color_active": "#00CFFF",
    #     "outline_color": "#000000",
    #     "outline_width": 5,
    #     "shadow": True,
    #     "position_from_bottom_pct": 25,
    #     "pop_animation": False,
    # },
}

DEFAULT_CAPTION_PRESET = "warm_yellow"

# Hook presets — control the teaser segment's text style and gradient darkness.
# gradient_darkness: how much the bottom 90% of the frame is darkened.
#   0.0 = no darkening; 1.0 = fully black at the very bottom.
#   Top 10% of the frame is always left untouched (transparent).
#   The gradient starts at 10% from the top and reaches (1 - gradient_darkness)
#   brightness at the bottom edge.
HOOK_PRESETS = {
    "warm_yellow": {
        "font_file": str(FONTS_DIR / "Montserrat-Black.ttf"),
        "font_family": "Montserrat Black",
        "font_size_pct": 5,
        "text_color": "#FFFFFF",
        "highlight_color": "#FFD166",
        "outline_width": 6,
        "shadow": False,
        "gradient_darkness": 1.00,
        "position": "lower",
        "text_transform": "upper",
        "margin_h": 30,
        "line_spacing": 0.85,
        "transition": "fade",
    },
    "emotional_red": {
        "font_file": str(FONTS_DIR / "Montserrat-Black.ttf"),
        "font_family": "Montserrat Black",
        "font_size_pct": 5,
        "text_color": "#FFFFFF",
        "highlight_color": "#FF4D6D",
        "outline_width": 6,
        "shadow": False,
        "gradient_darkness": 1.00,
        "position": "lower",
        "text_transform": "upper",
        "margin_h": 30,
        "line_spacing": 0.85,
        "transition": "fade",
    },
    "debate_orange": {
        "font_file": str(FONTS_DIR / "Montserrat-Black.ttf"),
        "font_family": "Montserrat Black",
        "font_size_pct": 5,
        "text_color": "#FFFFFF",
        "highlight_color": "#FF8C42",
        "outline_width": 6,
        "shadow": False,
        "gradient_darkness": 1.00,
        "position": "lower",
        "text_transform": "upper",
        "margin_h": 30,
        "line_spacing": 0.85,
        "transition": "fade",
    },
    "insight_blue": {
        "font_file": str(FONTS_DIR / "Montserrat-Black.ttf"),
        "font_family": "Montserrat Black",
        "font_size_pct": 5,
        "text_color": "#FFFFFF",
        "highlight_color": "#4EA8DE",
        "outline_width": 6,
        "shadow": False,
        "gradient_darkness": 1.00,
        "position": "lower",
        "text_transform": "upper",
        "margin_h": 30,
        "line_spacing": 0.85,
        "transition": "fade",
    },
    "tiktok_green": {
        "font_file": str(FONTS_DIR / "Montserrat-Black.ttf"),
        "font_family": "Montserrat Black",
        "font_size_pct": 5,
        "text_color": "#FFFFFF",
        "highlight_color": "#00FF7F",
        "outline_width": 6,
        "shadow": False,
        "gradient_darkness": 1.00,
        "position": "lower",
        "text_transform": "upper",
        "margin_h": 30,
        "line_spacing": 0.85,
        "transition": "fade",
    },
    # ── Compose-specific animation presets (hook_animation dropdown values) ───
    "slide_in_top": {
        "font_file": str(FONTS_DIR / "Montserrat-Black.ttf"),
        "font_family": "Montserrat Black",
        "font_size_pct": 5,
        "text_color": "#FFFFFF",
        "highlight_color": "#FFD166",
        "outline_width": 6,
        "shadow": False,
        "gradient_darkness": 1.00,
        "position": "lower",
        "text_transform": "upper",
        "margin_h": 30,
        "line_spacing": 0.85,
        "transition": "slide_up",
    },
    "fade_in": {
        "font_file": str(FONTS_DIR / "Montserrat-Black.ttf"),
        "font_family": "Montserrat Black",
        "font_size_pct": 5,
        "text_color": "#FFFFFF",
        "highlight_color": "#FFD166",
        "outline_width": 6,
        "shadow": False,
        "gradient_darkness": 1.00,
        "position": "lower",
        "text_transform": "upper",
        "margin_h": 30,
        "line_spacing": 0.85,
        "transition": "fade",
    },
    "pop": {
        "font_file": str(FONTS_DIR / "Montserrat-Black.ttf"),
        "font_family": "Montserrat Black",
        "font_size_pct": 5,
        "text_color": "#FFFFFF",
        "highlight_color": "#FF4D6D",
        "outline_width": 6,
        "shadow": False,
        "gradient_darkness": 1.00,
        "position": "lower",
        "text_transform": "upper",
        "margin_h": 30,
        "line_spacing": 0.85,
        "transition": "cut",
    },
    # "blur_dark": {
    #     "font_family": "Anton",
    #     "font_file": str(FONTS_DIR / "Anton-Regular.ttf"),
    #     "font_size_pct": 7,
    #     "text_color": "#FFFFFF",
    #     "outline_width": 6,
    #     "shadow": True,
    #     "gradient_darkness": 0.75,
    #     "transition": "fade",
    # },
    # "bold_punch": {
    #     "font_family": "Anton",
    #     "font_file": str(FONTS_DIR / "Anton-Regular.ttf"),
    #     "font_size_pct": 9,
    #     "text_color": "#FFE000",
    #     "outline_width": 8,
    #     "shadow": True,
    #     "gradient_darkness": 0.85,
    #     "transition": "fade",
    # },
    # dark_minimal favours a smooth lead-in → fade suits the polished aesthetic.
    # "dark_minimal": {
    #     "font_family": "Anton",
    #     "font_file": str(FONTS_DIR / "Anton-Regular.ttf"),
    #     "font_size_pct": 6,
    #     "text_color": "#FFFFFF",
    #     "outline_width": 2,
    #     "shadow": False,
    #     "gradient_darkness": 0.88,
    #     "transition": "fade",
    # },
    # "high_contrast": {
    #     "font_family": "Anton",
    #     "font_file": str(FONTS_DIR / "Anton-Regular.ttf"),
    #     "font_size_pct": 8,
    #     "text_color": "#FFFFFF",
    #     "outline_width": 12,
    #     "shadow": False,
    #     "gradient_darkness": 0.60,
    #     "transition": "fade",
    # },
    # TikTok-style: text in lower half, bold all-caps.
    # Mark highlighted words/phrases in hook_text with [brackets]: "PERCAYA [NGGAK]?"
    # position="lower" anchors text ~20% from bottom (above UI chrome).
    # Zero brackets is valid — plain styled text, no highlight applied.
    # "tiktok_green": {
    #     "font_file": str(FONTS_DIR / "Montserrat-Black.ttf"),
    #     "font_family": "Montserrat Black",
    #     "font_size_pct": 5,
    #     "text_color": "#FFFFFF",
    #     "highlight_color": "#00FF7F",
    #     "outline_width": 6,
    #     "shadow": False,
    #     "gradient_darkness": 1.00,
    #     "position": "lower",
    #     "text_transform": "upper",
    #     "margin_h": 30,
    #     "line_spacing": 0.85,
    #     "transition": "fade",
    # },
    # "tiktok_yellow": {
    #     "font_family": "Anton",
    #     "font_file": str(FONTS_DIR / "Anton-Regular.ttf"),
    #     "font_size_pct": 5,
    #     "text_color": "#FFFFFF",
    #     "highlight_color": "#FFE000",
    #     "outline_width": 6,
    #     "shadow": False,
    #     "gradient_darkness": 0.80,
    #     "position": "lower",
    #     "text_transform": "upper",
    #     "margin_h": 20,
    #     "transition": "fade",
    # },
    # tiktok_box: entire line on a white box (BorderStyle=3), dark text.
    # No per-keyword syntax needed — the box frames the whole hook line.
    # slide_up matches the card/reveal motif of the box style.
    # "tiktok_box": {
    #     "font_family": "Anton",
    #     "font_file": str(FONTS_DIR / "Anton-Regular.ttf"),
    #     "font_size_pct": 5,
    #     "text_color": "#111111",
    #     "outline_width": 14,
    #     "shadow": False,
    #     "border_style": 3,
    #     "box_color": "#FFFFFF",
    #     "gradient_darkness": 0.82,
    #     "position": "lower",
    #     "text_transform": "upper",
    #     "margin_h": 20,
    #     "transition": "fade",
    # },
}

DEFAULT_HOOK_PRESET = "warm_yellow"

DEFAULT_HOOK_ENABLED = True
DEFAULT_HOOK_DURATION = 1
DEFAULT_HOOK_BACKGROUND = "blur_self"

# Transcription
TRANSCRIPTION_PROVIDER = "assemblyai"
ASSEMBLYAI_API_KEY = os.environ.get("ASSEMBLYAI_API_KEY", "")

# ── Reframe — Tier 2a cut-aware multi-face "fit all" vertical crop ────────────
# Tunable here (decision-ledger #8: behaviour adjustable without code changes).
REFRAME_ENABLED = True
REFRAME_MODEL = ASSETS_DIR / "models" / "blaze_face_full_range.tflite"
REFRAME_SAMPLE_FPS = 5               # face-detection samples per second of clip
REFRAME_DET_WIDTH = 1280             # downscale width used for detection (speed)
REFRAME_MIN_CONFIDENCE = 0.5         # drop detections below this score
REFRAME_MIN_FACE_HEIGHT_FRAC = 0.05  # drop faces shorter than this frac of frame height
REFRAME_PAD_FRAC = 0.08              # breathing room each side of a face, frac of window width
REFRAME_SMOOTH_SIGMA_SEC = 0.8       # Gaussian smoothing of the pan camera path (seconds)

# Cut-aware shot splitting — an edited clip span is cut into camera shots and
# each shot is reframed on its own (a whole-clip decision splits close-ups too).
REFRAME_CUT_DIFF = 9.0               # scene-fingerprint mean-abs-diff above this = a cut
REFRAME_CUT_REL = 3.0                # ...or this multiple of the median diff, whichever higher
REFRAME_MIN_SHOT_SEC = 0.7           # shots shorter than this are merged into a neighbour
REFRAME_MAX_SHOTS = 40               # more cuts than this -> too fast-cut, fall back to Tier 1
REFRAME_CUT_REFINE_MARGIN = 0.20     # the 5fps scan locates a cut only to its ~0.2s sampling
                                     # interval; re-scan +/- this many seconds around each
                                     # boundary at full frame rate so the crop switch lands
                                     # exactly on the real cut (else the crop changes a beat
                                     # before the content does -> a visible "drag")

# Subject vs noise — within one shot a real person forms a dense face cluster;
# detector noise stays sparse. The split/single decision uses subjects only.
REFRAME_CLUSTER_GAP_FRAC = 0.12      # cx gap > this frac of width separates face clusters
REFRAME_SUBJECT_MIN_COVERAGE = 0.55  # a cluster present in >= this frac of a shot's frames
                                     # is a real subject (else: detector noise)

# ── Watermark (§2.6.4) ────────────────────────────────────────────────────────
# Small bottom-center text on every clip, starting after the hook segment.
# Single-channel tool: text lives here. Promote to a batch input if multi-channel
# support is ever needed.
WATERMARK_TEXT = "Seporsi Obrolan"
WATERMARK_FONT_FILE = str(FONTS_DIR / "Montserrat-Bold.ttf")
WATERMARK_FONT_SIZE_FRAC = 0.020    # ~30 px at 1920 height — unobtrusive
WATERMARK_COLOR = "#888888"         # dark-gray, subtle against any background
WATERMARK_MARGIN_BOTTOM_PX = 160   # gap between text baseline and frame bottom
