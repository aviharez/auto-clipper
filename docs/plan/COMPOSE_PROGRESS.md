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
