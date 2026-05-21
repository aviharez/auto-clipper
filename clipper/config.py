import os
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
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
BRANDING_LOGO_HEIGHT_FRAC = 0.019   # logo height as fraction of CLIP_HEIGHT (~65px at 1920)
BRANDING_MARGIN_PX = 42             # pixels from top-left edge
BRANDING_FONT_FILE = str(FONTS_DIR / "Montserrat-Bold.ttf")
BRANDING_FONT_FAMILY = "Montserrat"
BRANDING_FONT_SIZE_FRAC = 0.019     # channel name font size as fraction of CLIP_HEIGHT (~36px)

YOUTUBE_CREDENTIALS_FILE = BASE_DIR / "credentials" / "client_secret.json"
YOUTUBE_TOKEN_FILE = BASE_DIR / "credentials" / "token.json"
YOUTUBE_SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]

# Target clip resolution (9:16 vertical)
CLIP_WIDTH = 1080
CLIP_HEIGHT = 1920

# ffmpeg encode settings
VIDEO_CRF = 18
VIDEO_PRESET = "medium"
AUDIO_BITRATE = "192k"

# Caption presets — defined now so the Candidate schema is stable; used in Iteration 2
CAPTION_PRESETS = {
    "bold_yellow": {
        "words_on_screen": 3,
        "font_file": str(FONTS_DIR / "Montserrat-Bold.ttf"),
        "font_family": "Montserrat",
        "font_size_pct": 7,
        "color_normal": "#FFFFFF",
        "color_active": "#FFE000",
        "outline_color": "#000000",
        "outline_width": 6,
        "shadow": True,
        "position_from_bottom_pct": 30,
        "pop_animation": True,
    },
    "clean_white": {
        "words_on_screen": 2,
        "font_file": str(FONTS_DIR / "Inter-28pt-Bold.ttf"),
        "font_family": "Inter 28pt",
        "font_size_pct": 6,
        "color_normal": "#FFFFFF",
        "color_active": "#FFFFFF",
        "outline_color": "#000000",
        "outline_width": 4,
        "shadow": True,
        "position_from_bottom_pct": 28,
        "pop_animation": False,
    },
    # BorderStyle=3: opaque box behind each word (one word at a time).
    # outline_width controls box padding rather than stroke width in this mode.
    "box_highlight": {
        "words_on_screen": 1,
        "font_file": str(FONTS_DIR / "Montserrat-Bold.ttf"),
        "font_family": "Montserrat",
        "font_size_pct": 8,
        "color_normal": "#000000",
        "color_active": "#000000",
        "outline_color": "#000000",
        "outline_width": 12,
        "shadow": False,
        "border_style": 3,
        "box_color": "#FFE000",
        "position_from_bottom_pct": 28,
        "pop_animation": False,
    },
    "neon_green": {
        "words_on_screen": 3,
        "font_file": str(FONTS_DIR / "Montserrat-Bold.ttf"),
        "font_family": "Montserrat",
        "font_size_pct": 7,
        "color_normal": "#FFFFFF",
        "color_active": "#00FF7F",
        "outline_color": "#000000",
        "outline_width": 6,
        "shadow": True,
        "position_from_bottom_pct": 30,
        "pop_animation": True,
    },
    "fire_orange": {
        "words_on_screen": 2,
        "font_file": str(FONTS_DIR / "Montserrat-Bold.ttf"),
        "font_family": "Montserrat",
        "font_size_pct": 7,
        "color_normal": "#FFFFFF",
        "color_active": "#FF4500",
        "outline_color": "#000000",
        "outline_width": 8,
        "shadow": True,
        "position_from_bottom_pct": 30,
        "pop_animation": True,
    },
    "vibrant_cyan": {
        "words_on_screen": 3,
        "font_file": str(FONTS_DIR / "Inter-28pt-Bold.ttf"),
        "font_family": "Inter 28pt",
        "font_size_pct": 6,
        "color_normal": "#FFFFFF",
        "color_active": "#00CFFF",
        "outline_color": "#000000",
        "outline_width": 5,
        "shadow": True,
        "position_from_bottom_pct": 25,
        "pop_animation": False,
    },
}

DEFAULT_CAPTION_PRESET = "bold_yellow"

# Hook presets — control the blurred teaser segment's text style and bg darkness.
# bg_brightness: ffmpeg eq brightness adjustment applied to the blurred background
#   (range roughly -1.0 … 0.0; more negative = darker).
HOOK_PRESETS = {
    "blur_dark": {
        "font_family": "Montserrat",
        "font_file": str(FONTS_DIR / "Montserrat-Bold.ttf"),
        "font_size_pct": 7,
        "text_color": "#FFFFFF",
        "outline_width": 6,
        "shadow": True,
        "bg_brightness": -0.35,
    },
    "bold_punch": {
        "font_family": "Montserrat",
        "font_file": str(FONTS_DIR / "Montserrat-Bold.ttf"),
        "font_size_pct": 9,
        "text_color": "#FFE000",
        "outline_width": 8,
        "shadow": True,
        "bg_brightness": -0.50,
    },
    "dark_minimal": {
        "font_family": "Inter 28pt",
        "font_file": str(FONTS_DIR / "Inter-28pt-Bold.ttf"),
        "font_size_pct": 6,
        "text_color": "#FFFFFF",
        "outline_width": 2,
        "shadow": False,
        "bg_brightness": -0.60,
    },
    "high_contrast": {
        "font_family": "Montserrat",
        "font_file": str(FONTS_DIR / "Montserrat-Bold.ttf"),
        "font_size_pct": 8,
        "text_color": "#FFFFFF",
        "outline_width": 12,
        "shadow": False,
        "bg_brightness": -0.20,
    },
}

DEFAULT_HOOK_PRESET = "blur_dark"

DEFAULT_HOOK_ENABLED = True
DEFAULT_HOOK_DURATION = 3
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
