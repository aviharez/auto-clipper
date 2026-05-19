# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

```powershell
# Install dependencies (Python 3.13)
pip install -r requirements.txt

# Start the dashboard (also launches the background runner thread)
uvicorn dashboard.main:app --reload --port 8000
```

Open `http://localhost:8000` in the browser. The runner starts automatically on `@app.on_event("startup")`.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `ASSEMBLYAI_API_KEY` | Yes (for captions) | Transcription via AssemblyAI |

## External tools required

`ffmpeg` and `yt-dlp` must be on `PATH`. ffmpeg must be installed separately — yt-dlp will leave un-merged video/audio files if ffmpeg is missing (ingest.py handles this gracefully on retry).

## YouTube authentication

Run once before first publish:
```powershell
python setup_youtube_auth.py
```
Credentials are stored in `credentials/token.json`. The `credentials/client_secret.json` OAuth app file must be present first.

---

## Architecture

A **job** flows through stages driven by a background runner thread. Each stage is independent and reads/writes only the job record (SQLite). The runner never calls stages directly in a chain — it advances stage by stage with DB writes between each, so any single stage can be re-run cheaply (e.g. boundary nudge re-runs only `cut → caption`, not ingest).

### Stage pipeline

```
ingest → [parse candidates] → cut → transcribe → caption → hook → assemble → (review) → publish
```

- **`clipper/jobs.py`** — SQLite schema + CRUD. Two tables: `jobs` and `candidates`.
- **`clipper/runner.py`** — Background daemon thread; picks up `pending` jobs, drives stages. `schedule_recut()` re-queues a single candidate for boundary changes.
- **`clipper/config.py`** — All tunables: paths, ffmpeg settings, caption presets, reframe parameters.
- **`clipper/stages/ingest.py`** — `yt-dlp` download → `source.mp4` + `metadata.json`.
- **`clipper/stages/cut.py`** — Re-encode precise cut (never stream copy) + vertical reframe. Calls `reframe.plan()`.
- **`clipper/stages/reframe.py`** — Tier 2a face-aware crop planner. Returns a `ReframePlan` with per-shot `ShotPlan` objects (`tier1`/`static`/`pan`/`split`). Always falls back to Tier 1 centre crop on any error; never raises for expected conditions.
- **`clipper/stages/caption.py`** — Generates ASS subtitle file from `words.json`, burns via ffmpeg. Reads preset from `config.CAPTION_PRESETS`.
- **`clipper/stages/hook.py`** — Prepends a blurred teaser segment with centered hook text. Hook background is taken from `raw.mp4`; main clip appended is `captioned.mp4` (if it exists) or `raw.mp4`.
- **`clipper/stages/publish.py`** — YouTube Data API v3 upload (private by default).
- **`clipper/assembly/individual.py`** — Assembler: picks the best finished file (`hooked.mp4` > `captioned.mp4` > `raw.mp4`) and returns it as the final output path.
- **`clipper/transcribe/api.py`** — AssemblyAI implementation of `Transcriber`. Transcription is per-clip (span only), triggered lazily after cutting.
- **`dashboard/main.py`** — FastAPI app. REST endpoints for jobs, candidates, boundary updates, approve/reject, and publish. Serves static files from `dashboard/static/`.

### Candidate object

`Candidate` (defined in `clipper/candidates/base.py`) flows from input parse through to assembly. Key fields: `start`/`end` (seconds, never timecodes), `hook_text`, `hook_enabled`, `hook_background`, `caption_preset`, `hook_preset`, `rank` (reserved for future ranked-compilation assembler), `origin`.

### Job file layout

```
data/jobs/<job_id>/
  input.yaml          # copy of the submitted YAML spec
  source.mp4          # downloaded source video
  metadata.json       # yt-dlp metadata
  clips/<cand_id>/
    raw.mp4           # precise re-encoded cut
    words.json        # word-level transcription (clip-relative timestamps)
    captions.ass      # generated ASS subtitle file
    captioned.mp4     # captions burned in
    hook_text.ass     # hook ASS subtitle file
    hook.mp4          # hook segment only
    hooked.mp4        # hook + main clip concatenated (final output)
    reframe_s00.txt   # ffmpeg sendcmd pan schedule (one file per shot, if pan mode)
```

### Input YAML schema

```yaml
source: https://youtube.com/watch?v=...
default_captions: true
hook:
  enabled: true
  duration: 3
  background: blur_self

clips:
  - start: "12:30"       # timecodes converted to seconds at parse time
    end: "13:45"
    title: "clip title"
    hook_text: "hook line"
    # optional per-clip overrides: hook_background, hook: false, caption_preset
```

### Reframe architecture

`reframe.plan()` is the heavy entry point. It:
1. Extracts downscaled sample frames at `REFRAME_SAMPLE_FPS` (default 5 fps).
2. Detects hard cuts via scene-fingerprint diff → splits span into `ShotPlan`s.
3. Refines each cut boundary to frame accuracy (`_refine_cut`) to avoid "drag" artefact.
4. For each shot: clusters face detections → identifies real subjects (coverage ≥ `REFRAME_SUBJECT_MIN_COVERAGE`) → chooses `static` / `pan` / `split` mode.
5. For `pan` mode: writes an ffmpeg `sendcmd` schedule file used by `cut.py`.

`cut.py` encodes each shot separately with its `filter_complex` and concatenates them.

### Adding a new stage or assembler

- New assembler: implement `Assembler` from `clipper/assembly/base.py`, swap it in `runner.py`.
- New candidate source: implement `CandidateSource` from `clipper/candidates/base.py`, wire it in `runner.py`.
- New transcription provider: implement `Transcriber` from `clipper/transcribe/base.py`.

### Windows / ffmpeg path note

`caption.py` and `hook.py` pass ASS filter paths to ffmpeg as **relative** paths (relative to `BASE_DIR`, passed as `cwd`) to avoid the Windows drive-letter colon problem in ffmpeg filter strings. Do not switch these to absolute paths.
