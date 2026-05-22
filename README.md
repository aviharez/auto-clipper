# Clip Automation

A local tool that turns long-form YouTube videos into short, vertical, captioned clips — ready for YouTube Shorts, TikTok, or Instagram Reels. You supply timestamps and hook lines; the tool handles download, reframe, captions, hook segment, branding, and delivery.

## How it works

1. Write a YAML spec with source URL, clip timestamps, and hook lines
2. Submit to the dashboard — the pipeline runs headlessly in the background
3. Review each clip in the browser (preview, nudge boundaries if needed)
4. Approve and deliver to your output folder or Google Drive

The pipeline: `ingest → cut → transcribe → caption → hook → assemble → deliver`

---

## Requirements

- Python 3.13
- [`ffmpeg`](https://ffmpeg.org/download.html) on PATH
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) on PATH
- [`rclone`](https://rclone.org/) on PATH (only if using Google Drive delivery)
- An [AssemblyAI](https://www.assemblyai.com/) API key (only if captions are enabled)

---

## Setup

```powershell
pip install -r requirements.txt
```

Set your AssemblyAI key:

```powershell
$env:ASSEMBLYAI_API_KEY = "your_key_here"
```

Start the dashboard:

```powershell
uvicorn dashboard.main:app --reload --port 8000
```

Open `http://localhost:8000`.

---

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ASSEMBLYAI_API_KEY` | — | Required for captions and boundary suggestions |
| `DELIVERY_LOCAL_OUTPUT_DIR` | `~/Documents/clipper-output` | Where delivered clips are copied |
| `GDRIVE_RCLONE_REMOTE` | `gdrive` | rclone remote name for Google Drive |
| `GDRIVE_DESTINATION_FOLDER` | `clipper-output` | Destination folder inside the Drive remote |
| `DEFAULT_DELIVERER` | `local` | Pre-selected deliverer in the UI: `local` or `gdrive` |

---

## Input YAML

```yaml
source: https://www.youtube.com/watch?v=xxxx
channel_name: "My Channel"   # shown as branding overlay; omit to skip
default_captions: true

hook:
  enabled: true
  duration: 3
  background: blur_self      # default: blurred frames from the clip

clips:
  - start: "12:30"           # human-readable timecodes — converted to seconds on parse
    end: "13:45"
    title: "His take on the topic"
    hook_text: "Why would he say this on record?"

  - start: "47:02"
    end: "48:10"
    title: "The funny bit"
    hook_text: "Didn't expect him to say [THIS] 😂"   # [brackets] = highlighted keyword
    hook_background: intro_brand.mp4                  # per-clip override: custom background

  - start: "55:10"
    end: "56:00"
    title: "The serious part"
    hook_text: "Listen to this one slowly."
    hook: false                                       # no hook for this clip
    caption_preset: clean_white                       # per-clip caption style override
```

### Hook text highlight syntax

Wrap words or phrases in `[brackets]` to apply the preset's highlight treatment (color swatch, box, etc.). Any number of highlights per line; zero brackets is valid.

```yaml
hook_text: "PERCAYA [NGGAK]?"
hook_text: "TIKTOKERS [20JT] JALAN DI MALL [GAK ADA YANG MINTA FOTO]"
hook_text: "Biasa aja, nggak ada yang spesial"   # no highlight, plain styled text
```

---

## Caption presets

Presets are defined in `clipper/config.py`. Pick one per clip; changing it re-runs only the caption stage.

| Preset | Style |
|---|---|
| `bold_yellow` | White text, yellow active-word highlight, pop animation (default) |
| `clean_white` | White text, minimal, 2 words at a time |
| `box_highlight` | Yellow opaque box behind each active word, black text |
| `neon_green` | Neon green active-word highlight |
| `fire_orange` | Orange active-word highlight, thick outline |
| `vibrant_cyan` | Cyan active-word highlight, Inter font |

---

## Hook presets

| Preset | Style |
|---|---|
| `blur_dark` | Centered text, dark gradient overlay, Anton font (default) |
| `bold_punch` | Yellow text, heavy outline, very dark overlay |
| `dark_minimal` | Small white text, fade transition, near-black overlay |
| `high_contrast` | White text, thick outline, lighter background |
| `tiktok_green` | Lower-half text, neon green keyword highlight, all-caps |
| `tiktok_yellow` | Lower-half text, yellow keyword highlight, all-caps |
| `tiktok_box` | Lower-half text on white box, dark text, slide-up transition |

---

## Delivery

Two deliverers are available. Select per job in the dashboard or set a default via `DEFAULT_DELIVERER`.

**Local** — copies the finished clip to `DELIVERY_LOCAL_OUTPUT_DIR` (default: `~/Documents/clipper-output`).

**Google Drive** — uploads via rclone. Set up once:

```powershell
rclone config   # name your remote "gdrive" (or set GDRIVE_RCLONE_REMOTE)
```

---

## Project structure

```
clipper/
  jobs.py              # SQLite job + candidate records
  runner.py            # background daemon; drives the pipeline stage by stage
  config.py            # all tunables: presets, paths, encode settings, reframe params
  stages/
    ingest.py          # yt-dlp download
    cut.py             # precise re-encode + vertical reframe (Tier 2a face-aware)
    reframe.py         # face detection → smoothed camera-path planner
    caption.py         # ASS subtitle generation + ffmpeg burn
    hook.py            # blurred teaser segment + styled hook text
    branding.py        # YouTube logo + channel name overlay
    watermark.py       # bottom-center channel watermark
    boundary.py        # sentence-boundary snap suggestions
  candidates/
    manual.py          # YAML spec parser → Candidate list
  transcribe/
    api.py             # AssemblyAI word-level transcription
  assembly/
    individual.py      # each candidate → its own video file
  delivery/
    local.py           # copy to output folder
    gdrive.py          # rclone upload to Google Drive
dashboard/
  main.py              # FastAPI app: REST API + static file serving
  static/              # browser frontend (HTML + JS + CSS)
assets/
  fonts/               # bundled font files (Montserrat, Inter, Anton)
  logos/               # youtube.png branding asset
  models/              # BlazeFace TFLite models for face detection
data/
  jobs.db              # SQLite database
  jobs/<job_id>/       # per-job working directory
    source.mp4
    clips/<cand_id>/
      raw.mp4          # precise cut
      words.json       # word-level transcript (clip-relative)
      captioned.mp4
      hooked.mp4       # final output
```

---

## Reframe (vertical crop)

Videos are cropped from 16:9 to 9:16 without stretching or letterboxing.

- **Tier 1** — fixed center crop (fallback, always available)
- **Tier 2a** — face-aware "fit all": detects all faces in each camera shot, chooses a crop that keeps everyone visible; falls back to Tier 1 on any error

The reframer is cut-aware: it splits the clip at scene boundaries, reframes each shot independently (avoiding a close-up crop being applied to a wide shot), and smooths the camera path to prevent jitter.

---

## Watermark

A small channel name (`"Seporsi Obrolan"` by default) is rendered at the bottom-center of every clip, starting after the hook segment. Change `WATERMARK_TEXT` in `config.py`.
