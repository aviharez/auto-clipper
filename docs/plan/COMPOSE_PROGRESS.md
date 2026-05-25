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
