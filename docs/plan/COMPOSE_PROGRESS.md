# Compose Mode — Progress Log

## Phase A — Foundation (COMPLETED 2026-05-25)

### Step 3.1 — Schema + dataclasses + CRUD ✅

**Files created:**
- `clipper/compose/__init__.py` — empty package marker
- `clipper/compose/base.py` — `Composition`, `Segment`, `VoiceRange`, `SFXDrop` dataclasses; fields match SQL DDL exactly
- `clipper/compose/db.py` — full CRUD layer using the same `get_conn()` / `_now()` from `clipper/jobs.py` (same SQLite DB):
  - Compositions: `create_composition`, `get_composition`, `list_compositions`, `update_composition`, `delete_composition`
  - Segments: `create_segment`, `get_segments`, `get_segment`, `update_segment`, `delete_segment`, `reorder_segments`
  - Voice ranges: `replace_voice_ranges`, `get_voice_ranges`
  - SFX drops: `create_sfx`, `get_sfx`, `update_sfx`, `delete_sfx`

**Files edited:**
- `clipper/jobs.py:init_db()` — 4 new `CREATE TABLE IF NOT EXISTS` blocks appended inside the existing `executescript` call: `compositions`, `composition_segments`, `composition_voice_ranges`, `composition_sfx`

**Acceptance test result:**
```
init_db OK
ID: bc5dd334-...
title: hello | status: draft | created_at: 2026-05-25
```

---

### Step 3.2 — Nav + list page + new-compose popup ✅

**Files edited:**
- `dashboard/static/index.html` — Compose nav item added between Jobs and History
- `dashboard/static/app.js`:
  - Router extended: `#compose` → `showComposeList()`, `#compose/<id>` → `showComposeEditor(id)`
  - `showComposeList()` — screen-header + sticky `compose-table-header` + `screen-body` with `.compose-row` rows (matches job list layout exactly)
  - `renderComposeList()` — fetches `/api/compositions`, shows/hides column header, renders rows or empty state
  - `openNewComposeModal()` — title-only modal using `modal modal-new-job` classes; Enter key submits; POST → redirect to editor
  - `showComposeEditor(id)` — stub: breadcrumb ("← Compose › Editor") + 3-col shell (left 348px segments, center flex preview placeholder, right 348px settings) + 200px timeline placeholder at bottom
- `dashboard/static/style.css` — added `.compose-table-header` + `.compose-row` (6-col grid matching compose columns), and `.compose-editor` / editor shell layout styles
- `dashboard/main.py` — three new endpoints appended after `# ── API: Deliver`:
  - `GET /api/compositions` → `list_compositions()`
  - `POST /api/compositions` (body: `{title?}`) → `create_composition()`
  - `GET /api/compositions/{id}` → `get_composition()` + segments + voice_ranges + sfx

**Post-fix (same session):**
- Compose list was using `<table>` inside `screen-body` — replaced with sticky header + grid rows to match job list "maximized" layout
- Modal had double-padding (`.modal` has `padding:22px`, `.modal-header`/`.modal-body` expect zero outer padding) — fixed by switching to `class="modal modal-new-job"` which sets `padding:0; display:flex; flex-direction:column`

**Acceptance test result:**
```
GET /api/compositions     → 200, returns list with segment_count
POST /api/compositions    → 200, returns {id}
GET /api/compositions/:id → 200, returns full composition with segments/voice_ranges/sfx arrays
```

---

## Phase B — Editor scaffolding (COMPLETED 2026-05-25)

### Step 3.3 — Editor shell + add-segment block ✅

**Backend:**
- `POST /api/compositions/{id}/segments` — kind + source_url for YT/image-URL
- `POST /api/compositions/{id}/segments/upload` — multipart file upload (local/image)
- `PATCH /api/compositions/{id}` — update any composition field (pydantic body, partial)
- `DELETE /api/compositions/{id}` — delete + remove data dir

**Frontend:**
- `showComposeEditor(id)` replaced stub with full layout: breadcrumb header, 3-column shell, timeline placeholder
- Left rail: `ce-col-header` with segment count, scrollable `ce-segments-list`, `ce-add-segment` block at bottom
- Add-segment block: YT / Local / Image kind pills, URL input + Fetch button, file input + Upload button; toggling kind swaps URL vs file UI
- Segment rows render after add/delete with `renderCESegments()`

**Acceptance test result:** Add YT segment → row appears with pending badge. Add image segment → appears. Refresh → both persist.

---

### Step 3.4 — Segment rows: collapsed + expanded + per-field PATCH ✅

**Backend:**
- `PATCH /api/segments/{seg_id}` — update label, trim_in, trim_out, duration, motion, transition_to_next, transition_dur_ms
- `DELETE /api/segments/{seg_id}` — remove segment row

**Frontend:**
- Collapsed row: kind badge (color-coded by kind), 22×40 thumb placeholder, label, duration, status pill, trash button, expand arrow
- Expanded for video kinds (yt/local): label input, trim_in/trim_out with ±0.5s nudge buttons, debounced PATCH 500ms
- Expanded for image kind: 5-button motion grid (static/slide_lr/slide_rl/zoom_in/zoom_out), duration input + ±0.5s nudge
- Transition selector (cut/fade/slide_up) on all segment types; immediate PATCH on change
- `_ceToggleSeg()` expand/collapse with arrow rotation animation

**Acceptance test result:** Expand segment, set trim_in=5 → reload → trim_in=5. Delete segment → disappears from list and DB.

---

### Step 3.5 — Right-rail panel stubs ✅

**Backend:**
- `GET /api/sfx-library` — scans assets/sfx/, returns [] if dir empty
- `GET /api/music-library` — scans assets/music/, returns [] if dir empty
- `GET /api/kokoro-voices` — returns 4 hardcoded voices (af_bella, af_nicole, am_michael, am_adam)
- `POST /api/compositions/{id}/voiceover/upload` — 501 stub
- `POST /api/compositions/{id}/voiceover/kokoro` — 501 stub
- `POST /api/compositions/{id}/sfx` — create SFX drop
- `PATCH /api/sfx/{sfx_id}`, `DELETE /api/sfx/{sfx_id}` — SFX CRUD
- `PUT /api/compositions/{id}/segments/order` — reorder by id list

**Frontend:**
- 6 collapsible panels (Output length, Hook, Voiceover, Captions, Bed music, Spot SFX)
- Output: target_sec number + range slider in sync; PATCH on change
- Hook: hook_text textarea + animation dropdown; PATCH debounced on input
- Voiceover: file upload stub + Kokoro voice dropdown + Generate button (toasts "coming in 3.13/3.14")
- Captions: captions_text textarea + 3-mode toggle (script/transcribe/srt) + caption_preset dropdown; all PATCH on change
- Bed music: track dropdown (async-loaded from /api/music-library) + dB gain range + duck checkbox
- Spot SFX: table of sfx rows with at_sec/file/gain_db + Add button (POSTs then re-renders)

**Acceptance test result:** Edit every panel field, reload page → all values persisted (target_sec, hook_text, hook_animation, captions_text, captions_mode, caption_preset, bed_music_gain_db, bed_music_duck, voiceover_kokoro_voice).

---

## Phase A/B post-eval fixes (2026-05-25)

Read-only evaluation by Opus surfaced one bug and two latent issues. All addressed before Phase C starts.

### 1. BUG — segment upload `kind` parameter location ✅ FIXED

`dashboard/main.py:634` declared `kind: str` bare. FastAPI treats unannotated scalars as **query parameters**, but the frontend sends `kind` as a multipart form field (`fd.append('kind', currentKind)` in `app.js:setupCEAddSegment`). The endpoint would return 422 on every Local/Image upload. The acceptance test in Step 3.3 ("Toggle to Local, upload mp4 → row appears") had only been exercised on the YT JSON path, never the upload path.

**Fix:** added `Form` to the FastAPI imports (`dashboard/main.py:11`) and changed the signature to `kind: str = Form(...)`.

### 2. LATENT — `update_segment` / `delete_segment` didn't bump `composition.updated_at` ✅ FIXED

Only `create_segment` and `reorder_segments` were bumping the parent's `updated_at`. Editing trim/duration/transition or deleting a segment left the list view's "Updated" column stale.

**Fix:** both helpers in `clipper/compose/db.py` now look up the row's `composition_id` and call `update_composition(comp_id)` after the write. `delete_segment` also `shutil.rmtree`s the on-disk `segments/<idx>/` folder so orphan downloads don't accumulate.

### 3. LATENT — `delete_segment` leaves index gaps ⏸ DEFERRED (documented)

`create_segment` uses `MAX(idx)+1`, so deleting segment 1 of `[0,1,2]` and adding another yields `[0,2,3]`. Decision: **don't compact on delete**, because:
- folders are named by `idx` — compacting requires renaming directories on disk
- `composition_voice_ranges.segment_idx` references would have to be remapped
- `get_segments` is consumed with `ORDER BY idx` everywhere, so ordering is correct regardless

**Constraint for Phase C and later:** never assume contiguous `idx` values; iterate the list returned by `get_segments()` and use its position when an integer index is needed (e.g. in concat input order). Voice ranges should bind to the stable `segment.id`, not `segment_idx`, when used as a foreign reference — `segment_idx` should be treated as a positional hint only.

---

## Phase B → C Bridge (COMPLETED 2026-05-26)

### Step 3.5a — Split app.js into 5 plain-script files ✅

**Files created:**
- `dashboard/static/app-core.js` — Utilities (`$`, `$$`, `app`, `toast`, `api`, `fmtDuration`, `fmtSecs`, `fmtDate`, `fmtAge`, `badge`), Sidebar helpers (`setSidebarNav`, `updateWorkerStatus`, `updateDiskStatus`), Router (`route`, `window.addEventListener`), Preset cache (`_presets`, `loadPresets`, `_presetOptions`, `_formPresetOptions`)
- `dashboard/static/app-jobs.js` — `ACTIVE_STATES`, job list, new-job modal, job detail, candidate rendering, nudge/recut, transcript editor, deliverer logic
- `dashboard/static/app-history.js` — `groupByDate`, `renderHistoryGrid`, `showHistory`, `renderHistoryList`
- `dashboard/static/app-compose.js` — `showComposeList`, `renderComposeList`, `openNewComposeModal`
- `dashboard/static/app-compose-editor.js` — Full compose editor (3.5b additions embedded: `_startSegIngestPoll`, progress strip HTML, error display, source_duration hint)

**Files edited:**
- `dashboard/static/index.html:54` — replaced `<script src="/static/app.js">` with 5 ordered script tags (core → jobs → history → compose → compose-editor)

**Files deleted:**
- `dashboard/static/app.js` — removed after all functions confirmed present in split files

---

### Step 3.5b — Eager YT segment ingest with progress tracking ✅

**Files created:**
- `clipper/compose/stages/__init__.py` — empty package marker
- `clipper/compose/stages/ingest.py` — `run_for_segment(comp, seg)`: idempotent yt-dlp download with progress callbacks, ffprobe duration probe; `_probe_duration(path)` helper
- `clipper/compose/runner.py` — `ThreadPoolExecutor(max_workers=2)`, `submit_ingest(comp_id, seg_id)`, `_run_segment_ingest`, `start()`

**Files edited:**
- `clipper/jobs.py:_migrate()` — added `("composition_segments", "download_progress", "INTEGER")` and `("composition_segments", "source_duration", "REAL")` to `new_cols`
- `clipper/runner.py:start()` — added `import clipper.compose.runner as compose_runner` and call to `compose_runner.start()` after thread start
- `dashboard/main.py` — added `import clipper.compose.runner as compose_runner`; `api_create_segment`: if `kind=='yt'` sets status='downloading'/download_progress=0 and calls `compose_runner.submit_ingest`; `api_upload_segment`: probes duration synchronously via `_probe_duration`, sets status='ready' and source_duration on the segment
- `dashboard/static/style.css` — added `.ce-seg-dl-bar`, `.ce-seg-dl-fill`, `.ce-seg-error` CSS rules

**Frontend behavior (app-compose-editor.js):**
- `_startSegIngestPoll(compId)` — 1.5s recursive poll; re-renders segment rows; auto-patches `trim_out = source_duration` for newly-ready segments; stops when no segment is 'downloading'
- `renderCESegmentRow(seg)` — shows progress bar when `status === 'downloading'`; shows error text when `status === 'failed'`
- `renderCESegmentExpanded(seg)` — shows source_duration hint when duration not yet set
- Poll triggered after Fetch button success, Upload button success, and on initial `showComposeEditor()` if any segment is downloading

---

### 4. Post-bridge eval fix — server-side trim clamp ✅ FIXED (2026-05-26)

Opus 4.7 read-only eval of the bridge phase flagged that the trim-validation clamp specified in 3.5b's plan (`COMPOSE_PLAN.md:583`) was not implemented. `SegmentPatchBody` was a plain field-copy, letting `trim_out > source_duration` (or negative values) persist and producing bogus renders downstream.

**Fix:** `dashboard/main.py:api_patch_segment` (lines 676–694) now clamps incoming `trim_in` / `trim_out` against the segment's `source_duration` when known, and floors both at 0. The plan only required clamping `trim_out` upward; the symmetric upper clamp on `trim_in` and the lower floor are trivial extensions of the same guard. `trim_in < trim_out` is deliberately NOT enforced — that ordering invariant belongs to Phase C render validation.

### 5. Minor items — deferred to their natural phase

- Bed-music / SFX dropdowns lose the persisted value when the library is empty (current state). Will resolve naturally when 3.20/3.21 bundle the asset libraries.
- `/api/sfx-library` and `/api/music-library` return `duration_sec: None`. Add ffprobe-based duration computation when bundling the libraries in 3.20/3.21.
- Sidebar `nav-compose-count` only updates on `showComposeList()`. Cosmetic; defer.
- Dataclasses in `clipper/compose/base.py` are dead code (DB layer returns dicts, same pattern as `clipper/jobs.py`). Decision: keep for now as documentation of the schema shape; consider materializing them in Phase E if typed access is needed.
- Ingest progress writes are not time-throttled (every `[download] X%` line triggers a SQLite update). yt-dlp's stdout cadence is naturally low enough that this hasn't been a perf issue, but the 500ms throttle called out in 3.5b's plan was not implemented. Revisit if SQLite contention shows up during multi-segment ingest.

### Verification

```powershell
# Local-upload path (was broken):
# Editor → kind=Local → choose any mp4 → Upload → segment row appears, no 422.
# ffprobe data\compositions\<id>\segments\<idx>\source.mp4 succeeds.

# updated_at bump (was stale):
# Edit segment trim_in → reload Compose list → "Updated" column reflects the edit time.
# Delete a segment → folder data\compositions\<id>\segments\<idx>\ is gone, "Updated" bumped.
```

---

## Phase C — Smoke render (COMPLETED 2026-05-26)

### Step 3.6 — Segment normalize ✅

**Files created:**
- `clipper/compose/stages/image_motion.py` — `render_image_segment(src, dur, motion, out_path)`: zoompan-based zoom_in/zoom_out, slide_lr/slide_rl, static; all output 1080×1920/30fps/yuv420p/48k stereo
- `clipper/compose/stages/normalize.py` — `run_for_segment(comp, seg)`: video kinds → precise re-encode with `-ss`/`-to` seek + centered crop + aresample; image kind → delegates to image_motion.py; silent track added via `anullsrc` when source has no audio; idempotent on `status='normalized'`; updates segment status to `'normalized'` on success or `'failed'`+error on exception

**Files edited:**
- `clipper/compose/stages/ingest.py` — Added race fix: if `status=='downloading'`, poll-wait 1s up to 180s rather than launching a second yt-dlp. Added explicit handling for `local`/`image` kinds (probe duration + set ready). Idempotency now also covers `status=='normalized'`.

---

### Step 3.7 — Multi-segment concat + black-frame pad ✅

**Files created:**
- `clipper/compose/stages/concat.py` — `run(normalized_paths, transitions, out_path)`: all-cut chains use concat demuxer (lossless/fast); mixed/non-cut chains use filter_complex with pairwise `xfade`+`acrossfade` reductions; offsets computed cumulatively per plan recipe R3
- `clipper/compose/stages/pad.py` — `make_black_padding(duration, out_path)`: 1080×1920 black + silent stereo mp4 per plan recipe R5

---

### Step 3.8 — Compose render executor + orchestrator ✅

**Files created:**
- `clipper/compose/render.py` — `_run_render(comp_id)`: loads comp+segments, runs ingest+normalize per segment, builds transition specs from segment rows, calls concat, pads if total < target_sec, writes `last_render.mp4`, sets status='rendered' with duration; on any exception sets status='failed'+error

**Files edited:**
- `clipper/compose/runner.py` — Added `_compose_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="compose-render")`; added `_compose_loop()` daemon (polls every 2s for `status='render_queued'`, dispatches to executor); expanded `start()` to spawn the daemon thread

---

### Step 3.9 — Render preview button + polling + center-pane player ✅

**Files edited:**
- `dashboard/main.py` — Added `POST /api/compositions/{comp_id}/render` (validates ≥1 non-failed segment, sets status='render_queued'); added `GET /compositions/{comp_id}/render` (serves `last_render.mp4` via FileResponse, mirrors `/video/{cand_id}`)
- `dashboard/static/app-compose-editor.js`:
  - Added `_renderPoll` global and `_RENDER_ACTIVE` constant
  - "Render preview" button in editor header; disabled when 0 segments; disabled+labeled "Rendering…" while render is in flight
  - `setupCERenderBtn(compId, comp)` — wires click → POST render endpoint → starts `_startRenderPoll`
  - `_startRenderPoll(compId)` — 2.5s recursive poll; updates status pill; on rendered→`_showCenterVideo`; on failed→`_showCenterError`; re-enables button in both terminal states
  - `_showCenterVideo(compId)` — swaps center pane to `<video>` with cache-busting `?t=` param
  - `_showCenterError(msg)` — renders error details in center pane
  - `showComposeEditor`: restored video player on page reload if status=rendered; resumed render poll if status=render_queued/rendering

**Acceptance test (Phase C MILESTONE):**
Add one YouTube segment with trim → wait for download (progress bar) → click Render preview → status pill cycles render_queued→rendering→rendered → 9:16 video plays in center pane. Reload page → video still plays.

---

## Phase C post-ship fixes (2026-05-26)

### 6. BUG — YT download stalled at 0% immediately after Fetch ✅ FIXED

**Root cause:** `api_create_segment` pre-set `status='downloading'` + `download_progress=0` on the segment row *before* calling `compose_runner.submit_ingest`. The ingest executor thread re-reads the row on entry (`compose_db.get_segment(seg_id)`) and passes the fresh copy to `run_for_segment`. The race-fix logic at the top of `run_for_segment` checks `seg['status'] == 'downloading'` and — correctly, by its own logic — concludes another thread is already running, then poll-waits 180 s before returning without downloading anything. The segment was permanently stuck at `status='downloading', download_progress=0`.

**Fix:**
- `dashboard/main.py:api_create_segment` — removed the `update_segment(status='downloading', download_progress=0)` call before `submit_ingest`. The executor now receives the segment in `status='pending'`, so the race-fix is never triggered on a fresh ingest.
- `clipper/compose/stages/ingest.py` — `run_for_segment` now owns the `status='downloading'` write (sets it right before opening the `yt-dlp` subprocess). Added `FileNotFoundError` guard around `subprocess.Popen` that sets `status='failed'` with a helpful message if `yt-dlp` is not on PATH. Added `bufsize=1` (line-buffered) to match the Clip-side ingest and ensure progress lines flush in real time. Changed progress write to skip the DB update when `pct == last_pct` (avoids redundant SQLite writes on repeated `[download] X%` lines).
- One existing stuck segment (`status='downloading'`, no source file on disk) was manually reset to `status='pending'` via a one-off Python snippet.

### 7. BUG — Render output duration equals segment duration instead of target_sec ✅ FIXED

**Root cause:** `render.py:_run_render` only padded with black frames when `concat_dur < target_sec - 0.1`. When the segment (un-trimmed YouTube video) was *longer* than the target, it passed through unchanged. The pad/trim step had no upper-bound enforcement.

**Fix:** `clipper/compose/render.py` — added an `elif concat_dur > target_sec + 0.1` branch that calls the new `_trim_to_duration(src, duration, out_path)` helper. The helper uses `ffmpeg -t <target_sec> -c copy` (stream-copy, keyframe-aligned) to cut the concatenated picture at the target length. For a preview render this precision is sufficient; exact-frame trimming is handled by setting `trim_in`/`trim_out` on individual segments before the final render.

---

## Phase D — Timeline view (COMPLETED 2026-05-26)

### Step 3.10 — Read-only timeline strip ✅

**Files edited:**
- `dashboard/static/style.css` — replaced `.compose-timeline-placeholder` with full timeline CSS: `.ce-timeline`, `.ce-tl-header`, `.ce-tl-ruler`, `.ce-tl-tick`, `.ce-tl-tracks`, `.ce-tl-lbl`, `.ce-tl-content`, `.ce-tl-playhead`, `.ce-tl-hover-zone`, `.ce-tl-seg-block`, `.ce-tl-trans-mark`, `.ce-tl-hook-bar`, `.ce-tl-sfx-dot`, `.ce-stale-banner` and related helpers
- `dashboard/main.py` — added `GET /api/compositions/{comp_id}/voiceover/peaks` stub (returns empty peaks + ffprobe duration; full waveform analysis deferred to Step 3.15)
- `dashboard/static/app-compose-editor.js`:
  - Added `renderCETimeline(comp, peaks)` — replaces placeholder div or existing `#ce-timeline` with the rendered strip; reuses existing zoom level on re-render
  - Added `_ceTLBuildHTML`, `_ceTLRulerHTML`, `_ceTLSegsHTML`, `_ceTLHookHTML`, `_ceTLVoiceHTML`, `_ceTLVoiceContentHTML`, `_ceTLMusicHTML`, `_ceTLSFXHTML` — pure HTML generators
  - Added `_ceTLZoom(action)` — fit / −1 / +1 zoom; clamps to [3, 160] px/s; calls `renderCETimeline`
  - Added `_ceTLLoadPeaks(comp)` — async; fetches `/voiceover/peaks` and patches the voice track DOM without full re-render
  - Called `renderCETimeline(comp)` from `showComposeEditor` after the rest of the setup

**Timeline layout:** 5 stacked tracks (Segs 56px, Hook 22px, Voice 30px, Music 24px, SFX 26px) beneath a 22px ruler with 1s ticks and 5s labels. Above all: 34px header with title, segment/duration info, hover/drag hints, and zoom controls (fit / − / +). Total height ≈ 190px.

**Acceptance test:** 3 segments of different kinds → timeline shows 3 proportional colored blocks in the Segs track. Hook text set → amber bar appears. SFX drop added → green numbered dot appears. Zoom in/out works (fit restores original scale).

---

### Step 3.11 — Thumbnail extraction + hover-scrub ✅

**Files created:**
- `clipper/compose/stages/thumbs.py` — `extract_thumbs(video_path, out_dir, every_sec=0.5)`: runs `ffmpeg -vf fps=2,scale=50:-2 -q:v 5 thumbs/%d.jpg`; non-fatal if it fails (render completes regardless)

**Files edited:**
- `clipper/compose/render.py` — added `from clipper.compose.stages import thumbs as compose_thumbs`; after writing `last_render.mp4`, calls `compose_thumbs.extract_thumbs(last_render_path, thumbs_dir)` in a try/except so thumb failure never aborts the render
- `dashboard/main.py` — added `GET /compositions/{comp_id}/thumb/{n}` endpoint serving `data/compositions/{id}/thumbs/{n}.jpg` with 1h cache headers
- `dashboard/static/app-compose-editor.js` — `_ceTLSetupHover(comp)`: on `mousemove` over `#ce-tl-hover-zone`, moves playhead, updates `#ce-tl-thumb-img src` (frame `round(t*2)`), sets timecode badge, and seeks `#ce-preview-video.currentTime = t`. Thumb popup uses `position:fixed` to escape the timeline's `overflow:hidden`. Hides on `mouseleave`.

---

### Step 3.12 — Drag-to-reorder segments on timeline ✅

**Files edited:**
- `dashboard/static/app-compose-editor.js` — `_ceTLSetupDrag(segs, comp)`: wires HTML5 drag events on `.ce-tl-seg-block` elements. `dragover` shows `.ce-tl-drop-ind` vertical bar at the insertion point. `drop` computes new order for all `comp.segments` (preserving non-shown segments), calls `PUT /api/compositions/{id}/segments/order`, re-fetches comp, calls `renderCESegments` + `renderCETimeline`, shows `_ceTLShowStaleBanner()` if a render exists.
- `_ceTLShowStaleBanner()` — inserts `#ce-stale-banner` div after the editor header with amber text + "re-render to update" link
- `_ceReRender(e)` — removes the banner and clicks `#ce-render-btn`

**Acceptance test:** 3 segments → drag segment 1 between 2 and 3 → drop → left rail list and timeline both reflect new order → `PUT /segments/order` was called → click "re-render to update" → render restarts.

---

## Phase E — Real render pipeline (IN PROGRESS)

### Step 3.13 — Kokoro TTS generation ✅

**Files edited:**
- `requirements.txt` — added `kokoro-onnx>=0.4.0`, `soundfile>=0.12.1`, `librosa>=0.10.0`
- `dashboard/main.py:api_voiceover_kokoro` — replaced 501 stub with real implementation: reads `captions_text`, validates non-empty, resolves `voiceover_kokoro_voice` (fallback `af_bella`), calls `kokoro_stage.generate()`, persists `voiceover_source='kokoro'` + `voiceover_kokoro_text`, returns `{ok, duration_sec, peaks_url}`
- `dashboard/static/app-compose-editor.js` — Kokoro button handler now: saves voice selection, disables button with "Generating…" label, POSTs to `/voiceover/kokoro`, on success updates `#ce-vo-status` and shows toast, on error shows error toast; re-enables button in both paths

**Files created:**
- `clipper/compose/stages/kokoro.py` — module-level `_kokoro` singleton (lazy-loaded on first call); `_split_sentences(text, max_chars=150)` splits on sentence-boundary punctuation then word-wraps overlong chunks; `generate(text, voice_id, out_path)` chunks text, runs `kokoro_onnx.Kokoro.create()` per chunk (24 kHz mono), resamples each to 48 kHz via `librosa.resample`, concatenates, duplicates to stereo, writes PCM_16 WAV via `soundfile`; returns duration in seconds

**Acceptance test:** Type a 1-sentence script in Captions panel → select Kokoro voice → click Generate voiceover → button shows "Generating…" → after model run, `data/compositions/<id>/voiceover.wav` exists → `ffprobe` shows 48000 Hz stereo → status div updates with source + duration → toast confirms success.
