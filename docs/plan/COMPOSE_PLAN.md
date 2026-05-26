# Compose Mode — Implementation Plan (Iteration 3)

> Progress-tracking document. Tick steps as they're completed.
> Companion to `COMPOSE.md` (concept) and `COMPOSE_TIMELINE.md` (target form).
> Same discipline as `CLIP_AUTOMATION_PLAN.md`: ordered steps, each tested before the next.

---

## Context

The clip-automation app has shipped through Iteration 2.7. The user wants a sibling
pipeline called **Compose**: assemble a short vertical video (~38s) by stitching
user-picked materials (YouTube clips, local videos, images) with voiceover, hook,
captions, bed music, transitions, and spot SFX. Designed for "digital curiosity" shorts.

This is **purely additive**. The existing Clip pipeline + History page must remain
unchanged.

**Target form** is the timeline variant (`COMPOSE_TIMELINE.md` /
`design-references/compose-timeline.jsx`): rails + read-only timeline strip at the
bottom with hover-scrub + drag-to-reorder. The rails-only `compose.jsx` is a design
reference only — NOT shipped as a separate view.

**Extra requirements from the user beyond the markdown docs:**
- Voiceover generation via local Kokoro TTS ONNX model (files at `kokoro-model/`); WAV
  upload also supported.
- Render preview enabled iff ≥1 segment exists.
- SFX is additive — never ducks/interrupts voice or bed.
- If total segment duration < output target, pad with black frames to fill.
- Video preview area is height-maximized.

---

## Architecture decisions (locked)

1. **New SQLite tables, not new columns on `candidates`.** A composition is not a
   candidate. Polluting `candidates` would force every Clip query to filter by pipeline
   and risks regressions. Add 4 new tables in `clipper/jobs.py:init_db()` via the same
   `CREATE TABLE IF NOT EXISTS` + idempotent `_migrate` pattern already in use
   (`clipper/jobs.py:27-41` for migrations; `:46-84` for initial schema).

2. **Dedicated executor for Compose renders.** A Compose render can take 5–15 minutes
   (yt-dlp + N segment encodes + audio mix + caption burn). The existing
   `_runner_loop` (`clipper/runner.py:211-220`) polls only `jobs.status='pending'` and
   processes them serially — adding Compose work there would block Clip jobs. Mirror
   the `_recut_executor` pattern (`clipper/runner.py:28`) with a new
   `_compose_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="compose")`
   and a parallel poll loop that picks up `compositions.status='render_queued'`. Clip
   pipeline untouched.

3. **Reuse, don't reinvent (with corrections from actual code reads):**
   - **Reusable as-is** from `clipper/stages/hook.py`: `_format_ass_time` (line 267),
     `_rgb_to_ass` (line 275), `_build_hook_ass` (line 373), `_probe_duration`
     (line 184), `_make_hook_blur_self` audio pattern (`anullsrc=…,atrim=0:N`).
   - **Reusable from `clipper/stages/caption.py`**: `_build_ass`, `_burn_captions`,
     `_format_ass_time`, `_rgb_to_ass` — call unchanged on Compose's `words.json`.
   - **Reusable as-is**: `clipper/transcribe/api.py:AssemblyAITranscriber` (for
     captions-mode='transcribe' on the voiceover), `clipper/delivery/local.py` +
     `gdrive.py` (Compose's `final.mp4` is just another mp4).
   - **NOT directly reusable, needs new code:**
     - `hook.py:_make_hook_image_bg` (line 233) — does scale + crop only, NO zoompan
       motion. Compose's image motion (slide/zoom-in/zoom-out) needs a new ffmpeg
       function using `zoompan` filter, not a generalization of this one.
     - `hook.py:_concatenate` (line 466) — hardcoded to exactly 2 inputs (hook +
       main_clip) with a 2-input concat filter. Compose's N-segment chain needs new
       multi-input concat logic (`xfade` paired reduction, or `filter_complex` with N
       inputs).

4. **Two-stage audio mix, all sources normalized to 48k stereo at ingest.** ffmpeg
   `amix` normalizes to the loudest input; SFX peaks would dip the whole mix. Build:
   `(bed sidechain-ducked by voice) + voice → mix1`, then `mix1 + SFX (amix
   normalize=0, additive) → final`. Pre-scale each input with `volume=` so amix
   doesn't re-normalize. Resample everything (Kokoro 24k mono, uploaded WAV at any
   rate, bed music, SFX) to 48k stereo on ingest. See ffmpeg recipe §R4 below.

5. **Caption burn on the picture track, BEFORE final mux.** Order:
   picture-concat → caption ASS burn (on concatenated video) → hook prepend →
   muxer joins captioned-hooked picture with mixed audio. Captions depend on word
   timings from the voiceover, not on the audio mix.

6. **Build timeline view EARLY (Phase D), not as polish.** Timeline is the target
   layout. Putting it last means the right rails get tuned against the wrong layout.
   Smoke render (Phase C) lights up the loop, then timeline (Phase D) lands the target
   layout, then richening (Phases E–F) layers on top of a stable visual frame.

7. **Hover-scrub uses pre-extracted thumbnails, not on-the-fly extraction.** At
   render-complete time, ffmpeg samples frames every 0.5s into
   `data/compositions/<id>/thumbs/<n>.jpg`. UI maps hover-x → `thumbs/<round(t*2)>.jpg`.
   38s render → ~76 files × ~15KB ≈ 1MB.

8. **Compose is a sibling top-level menu**, not nested. Sidebar:
   Clip | Compose | History. History gains tabs filtering Clip / Compose / All.

---

## Pre-execution checklist (Sonnet 4.6 — read these before starting any step)

These are the existing files and the specific things to look at. Don't reinvent;
re-use. **Read each file at least once before touching it.**

| File | What to look for / line refs |
|---|---|
| `clipper/jobs.py` | `init_db()` uses `CREATE TABLE IF NOT EXISTS` (lines 44–84). `_migrate()` ALTER pattern (lines 27–41). CRUD helper style (`create_job`, `get_job`, `update_job`, `list_jobs`, `insert_candidate`, etc.). Compose CRUD must follow this style. |
| `clipper/runner.py` | `_runner_loop` daemon (lines 211–220). `_recut_executor` (line 28). `runner.start()` called from dashboard `on_startup` (line 51 of `dashboard/main.py`). Compose loop runs as a SECOND daemon thread started from the same `start()`. |
| `clipper/stages/hook.py` | `_format_ass_time` (267), `_rgb_to_ass` (275), `_build_hook_ass` (373), `_probe_duration` (184), `_make_hook_blur_self` audio pattern (143). `_concatenate` (466) is 2-input only — don't try to reuse for N segments. `_make_hook_image_bg` (233) has no zoompan — don't try to reuse for image motion. |
| `clipper/stages/caption.py` | `_build_ass`, `_burn_captions`, `_format_ass_time`, `_rgb_to_ass`. Same `words.json` shape works for Compose. |
| `clipper/stages/reframe.py` | `plan()` returns a `ReframePlan`; `cut.py` consumes it. For Compose, can either (a) call `reframe.plan()` per segment and apply the same crop/pan chain or (b) for the smoke render, use a simpler centered crop. Start with (b), upgrade in Phase E if needed. |
| `clipper/transcribe/api.py` | `AssemblyAITranscriber.transcribe(audio_path, start=0.0, end=None)` returns `list[Word]`. Use unchanged on `voiceover.wav`. |
| `clipper/delivery/base.py` + `local.py` + `gdrive.py` | `Deliverer.deliver(clip_file, job, candidate) -> status`. For Compose, pass a fake "candidate-shaped" dict with `id`, `title`, `output_path`. |
| `dashboard/main.py` | `_DELIVERERS` registry (line 28). Endpoint patterns: pydantic BaseModel for body, dict return, `HTTPException(404, "…")` for errors. `/api/jobs/from-form` (line 117) and `/api/jobs` upload (line 182) show input patterns. `/api/jobs/{id}/deliver` (line 515) shows delivery wiring. |
| `dashboard/static/index.html` + `app.js` + `style.css` | Sidebar nav structure (index.html lines 12–40). Hash router (`app.js` `route()`, line ~92). Polling pattern (3s for list, 2.5s for detail). Status pill `badge(status)` (line 59). Modal pattern in "New Job" modal (`app.js` lines 146–239). |

**One-time tooling checks before Phase E:**
- `pip install kokoro-onnx librosa` (add to `requirements.txt`).
- Verify `ffmpeg -filters | grep -E "zoompan|sidechaincompress|xfade|amix"` returns
  all four (the bundled Windows ffmpeg includes them in recent builds).

---

## Module layout

```
clipper/
  compose/
    base.py            # Composition, Segment, VoiceRange, SFXDrop dataclasses
    db.py              # 4 new tables + CRUD; mirrors clipper/jobs.py style
    runner.py          # _compose_executor + render-queue dispatch (daemon thread)
    render.py          # orchestrates render pipeline; sets status
    stages/
      ingest.py        # per-segment: yt-dlp / accept upload / accept image
      normalize.py     # per-segment: precise cut + reframe to 1080×1920, audio→48k stereo
      image_motion.py  # NEW: zoompan-based slide/zoom for image segments
      concat.py        # NEW: multi-input concat with per-pair transitions
      audio.py         # two-stage mix: bed+voice (ducked) + SFX (additive)
      caption.py       # align script to VO word timings → reuse caption.py burn
      hook.py          # prepend hook segment (calls clipper/stages/hook.py helpers)
      kokoro.py        # TTS generation via kokoro-onnx
      pad.py           # NEW: black-frame video generator (output length filler)
      thumbs.py        # NEW: ffmpeg frame-sampling at 0.5s into thumbs/<n>.jpg
    assembly.py        # final mux + spec-finalize (move last_render → final)
assets/
  sfx/                 # bundled starter library (3–5 one-shots)
  music/               # bundled starter library (3–5 bed tracks)
data/
  compositions/<comp_id>/
    segments/<seg_idx>/
      source.<ext>     # downloaded YT mp4 / uploaded video / uploaded image
      normalized.mp4   # 1080×1920, 30fps, yuv420p, 48k stereo (or silent stereo)
    voiceover.wav      # 48k stereo, regardless of source
    bed.wav            # picked from library, resampled to 48k stereo
    sfx/<n>.wav        # picked from library, resampled to 48k stereo
    last_render.mp4    # most recent preview render
    thumbs/<n>.jpg     # 0.5s-spaced frames for hover-scrub
    final.mp4          # finalized 1080×1920 (after Finalize Video)
```

---

## Data model — SQL DDL for `init_db()`

Append these to `init_db()` in `clipper/jobs.py` (the existing `executescript` block,
inside the same `with get_conn() as conn:`). All are `CREATE TABLE IF NOT EXISTS` —
safe to re-run.

```sql
CREATE TABLE IF NOT EXISTS compositions (
    id                        TEXT PRIMARY KEY,
    title                     TEXT NOT NULL DEFAULT 'Untitled draft',
    niche                     TEXT,
    target_sec                REAL NOT NULL DEFAULT 38,
    hook_text                 TEXT,
    hook_animation            TEXT,
    voiceover_source          TEXT,                              -- 'upload' | 'kokoro' | null
    voiceover_kokoro_voice    TEXT,
    voiceover_kokoro_text     TEXT,
    captions_mode             TEXT NOT NULL DEFAULT 'script',    -- 'script'|'transcribe'|'srt'
    captions_text             TEXT,
    caption_preset            TEXT,
    bed_music_file            TEXT,
    bed_music_gain_db         REAL DEFAULT -14,
    bed_music_duck            INTEGER NOT NULL DEFAULT 1,
    watermark_text            TEXT,
    status                    TEXT NOT NULL DEFAULT 'draft',
    error                     TEXT,
    last_render_path          TEXT,
    last_render_duration      REAL,
    final_path                TEXT,
    delivery_status           TEXT,
    delivery_url              TEXT,
    created_at                TEXT NOT NULL,
    updated_at                TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS composition_segments (
    id                       TEXT PRIMARY KEY,
    composition_id           TEXT NOT NULL,
    idx                      INTEGER NOT NULL,
    kind                     TEXT NOT NULL,                     -- 'yt' | 'local' | 'image'
    source_url               TEXT,
    source_file              TEXT,
    label                    TEXT,
    trim_in                  REAL,
    trim_out                 REAL,
    duration                 REAL,
    motion                   TEXT,                              -- 'static'|'slide_lr'|'slide_rl'|'zoom_in'|'zoom_out'
    transition_to_next       TEXT NOT NULL DEFAULT 'cut',
    transition_dur_ms        INTEGER,
    transition_sfx_file      TEXT,
    status                   TEXT NOT NULL DEFAULT 'pending',
    error                    TEXT,
    FOREIGN KEY (composition_id) REFERENCES compositions(id)
);

CREATE TABLE IF NOT EXISTS composition_voice_ranges (
    id                       TEXT PRIMARY KEY,
    composition_id           TEXT NOT NULL,
    segment_idx              INTEGER NOT NULL,
    start_sec                REAL NOT NULL,
    end_sec                  REAL NOT NULL,
    snippet                  TEXT,
    FOREIGN KEY (composition_id) REFERENCES compositions(id)
);

CREATE TABLE IF NOT EXISTS composition_sfx (
    id                       TEXT PRIMARY KEY,
    composition_id           TEXT NOT NULL,
    at_sec                   REAL NOT NULL,
    file                     TEXT NOT NULL,
    gain_db                  REAL DEFAULT -6,
    FOREIGN KEY (composition_id) REFERENCES compositions(id)
);
```

Composition status values (full state machine):
`draft → render_queued → rendering → rendered → (finalize_queued → finalizing →
finalized → delivering → delivered_local | delivered_gdrive) | failed`.

---

## REST API endpoints (canonical — implement exactly these signatures)

All under `dashboard/main.py`, following existing patterns (pydantic body, dict
response, `HTTPException(404, "…")` for errors).

### Compositions

| Method | Path | Body | Response |
|---|---|---|---|
| GET    | `/api/compositions` | — | `[{id,title,niche,status,target_sec,segment_count,last_render_path,updated_at}, …]` |
| POST   | `/api/compositions` | `{title?: str}` (empty → "Untitled draft") | `{id}` |
| GET    | `/api/compositions/{id}` | — | `{...row, segments:[…], voice_ranges:[…], sfx:[…]}` |
| PATCH  | `/api/compositions/{id}` | partial composition fields | `{ok:true}` |
| DELETE | `/api/compositions/{id}` | — | `{ok:true}` (also removes data dir) |
| POST   | `/api/compositions/{id}/render` | — | `{status:"render_queued"}` |
| POST   | `/api/compositions/{id}/finalize` | — | `{status:"finalize_queued"}` |
| POST   | `/api/compositions/{id}/deliver` | `{deliverer?: "local"\|"gdrive"}` | `{status, delivery_url}` |

### Segments

| Method | Path | Body | Response |
|---|---|---|---|
| POST   | `/api/compositions/{id}/segments` | `{kind, source_url?, label?}` (YT/image-url) | `{id, idx}` |
| POST   | `/api/compositions/{id}/segments/upload` | multipart: kind, file | `{id, idx}` |
| PATCH  | `/api/segments/{seg_id}` | partial segment fields | `{ok:true}` |
| DELETE | `/api/segments/{seg_id}` | — | `{ok:true}` |
| PUT    | `/api/compositions/{id}/segments/order` | `{order: [seg_id, …]}` | `{ok:true}` (timeline drag-reorder) |

### Voiceover / voice ranges

| Method | Path | Body | Response |
|---|---|---|---|
| POST   | `/api/compositions/{id}/voiceover/upload` | multipart: file | `{ok, duration_sec, peaks_url}` |
| POST   | `/api/compositions/{id}/voiceover/kokoro` | `{voice: str}` (uses composition.captions_text) | `{ok, duration_sec, peaks_url}` |
| GET    | `/api/compositions/{id}/voiceover/peaks` | — | `{peaks: [float, …], duration_sec}` (downsampled waveform) |
| POST   | `/api/compositions/{id}/voice-ranges/auto` | — | `{ranges:[…]}` (librosa silence-split, replaces existing) |
| PUT    | `/api/compositions/{id}/voice-ranges` | `{ranges: [{segment_idx, start_sec, end_sec}, …]}` | `{ok:true}` |

### SFX

| Method | Path | Body | Response |
|---|---|---|---|
| GET    | `/api/sfx-library` | — | `[{name, path, duration_sec}, …]` (scans `assets/sfx/`) |
| POST   | `/api/compositions/{id}/sfx` | `{at_sec, file, gain_db?}` | `{id}` |
| PATCH  | `/api/sfx/{sfx_id}` | partial | `{ok:true}` |
| DELETE | `/api/sfx/{sfx_id}` | — | `{ok:true}` |

### Music library / kokoro voices / preview assets

| Method | Path | Response |
|---|---|---|
| GET    | `/api/music-library` | `[{name, path, duration_sec}, …]` (scans `assets/music/`) |
| GET    | `/api/kokoro-voices` | `[{id, label}, …]` (static list from kokoro voices.bin) |
| GET    | `/compositions/{id}/render` | streams `last_render.mp4` (mirrors `/video/{cand_id}` pattern) |
| GET    | `/compositions/{id}/thumb/{n}` | streams `thumbs/{n}.jpg` for hover-scrub |

### History extension

Reuse `/api/history` with a new optional query param:
`GET /api/history?pipeline=clip|compose|all` (default `all`). Backend returns
unified rows with a `pipeline` field.

---

## Iteration 3 — phases & ordered steps

> One step at a time. Each has Deliverables (what gets written) and Acceptance test
> (how to verify before moving on). Don't batch steps. Don't skip the test.

### Phase A — Foundation (zero-render scaffolding)

- [x] **Step 3.1 — Schema + dataclasses + CRUD**

  **Deliverables:**
  - `clipper/compose/__init__.py` (empty).
  - `clipper/compose/base.py` with `Composition`, `Segment`, `VoiceRange`, `SFXDrop`
    dataclasses (fields match the SQL DDL above).
  - `clipper/compose/db.py` with CRUD: `create_composition(title) -> id`,
    `get_composition(id) -> dict|None`, `list_compositions() -> list`,
    `update_composition(id, **fields)`, `delete_composition(id)`, plus per-segment /
    per-voice-range / per-sfx CRUD mirroring the candidate-CRUD style in
    `clipper/jobs.py`.
  - Append the 4 `CREATE TABLE IF NOT EXISTS` blocks (see DDL above) to
    `clipper/jobs.py:init_db()` inside the existing `executescript` call.
  - No UI, no endpoints yet.

  **Acceptance test:**
  ```powershell
  python -c "from clipper.jobs import init_db; init_db()"
  python -c "from clipper.compose import db; cid = db.create_composition('hello'); print(cid); print(db.get_composition(cid))"
  ```
  Expected: prints UUID, then a dict with `title='hello'`, `status='draft'`, timestamps.

- [x] **Step 3.2 — Nav + list page + new-compose popup**

  **Deliverables:**
  - Add `<a class="nav-item" id="nav-compose" data-nav="compose" href="#compose">Compose</a>`
    to `dashboard/static/index.html` between the existing Job List and History nav items.
  - Extend `app.js` `route()` with `else if (hash === 'compose') showComposeList(); else
    if (hash.startsWith('compose/')) showComposeEditor(hash.slice(8));`.
  - Implement `showComposeList()` mirroring `showJobList()`: fetch `/api/compositions`,
    render rows (title, status pill, segment count, target/current duration, updated_at),
    "New compose" button opens a modal asking only for title.
  - Implement `showComposeEditor(id)` as a stub: breadcrumb + empty 3-column shell.
  - Backend: add `GET /api/compositions`, `POST /api/compositions`, `GET
    /api/compositions/{id}` endpoints in `dashboard/main.py` (new section, after
    `# ── API: History ──`).

  **Acceptance test:** Open `http://localhost:8000`. Click Compose in sidebar → empty
  list page renders. Click New compose → modal opens → type "Test" → Proceed → row
  appears in list. Click the row → editor stub opens with breadcrumb "← Compose ›
  Editor". Reload page → row still there.

### Phase B — Editor scaffolding (UI only, no render)

- [x] **Step 3.3 — Editor shell + add-segment block**

  **Deliverables:**
  - Editor layout: breadcrumb header (back arrow → `#compose`), 3 columns (left 348px
    segments, center flex preview placeholder showing "Render preview to see your video"
    message, right 348px scrollable rail), bottom 200px placeholder strip "Timeline (TBD)".
  - Add-segment block at bottom of left rail: kind toggle pills (YT / Local / Image),
    URL/file input, Fetch button.
  - Endpoints: `POST /api/compositions/{id}/segments` (kind + source_url for YT/image-URL
    case), `POST /api/compositions/{id}/segments/upload` (multipart for local file +
    image file). Persists row with `status='pending'`, computes next `idx`.
  - Render an empty segment row in the left rail after add.

  **Acceptance test:** Open the editor. Toggle to YouTube, paste any youtube URL, click
  Fetch → row appears in left rail with `pending` status pill. Refresh page → row still
  there. Toggle to Image, upload a PNG → image segment row appears. Toggle to Local,
  upload mp4 → local segment row appears.

- [x] **Step 3.4 — Segment rows: collapsed + expanded + per-field PATCH**

  **Deliverables:**
  - Collapsed segment row: kind badge (color from kind), 24×42 thumbnail placeholder,
    label, duration, drag handle (visual only — drag wired in Phase D), expand arrow.
  - Expanded for video kinds: trim in/out inputs (HH:MM:SS or seconds — accept both),
    ±0.5s buttons, source duration shown read-only. Expanded for image kind: motion
    picker (4-grid: static / slide_lr / slide_rl / zoom_in / zoom_out), duration input
    + ±0.5s. Below: transition-to-next selector (cut / fade / slide_up) + transition SFX
    picker (from library — empty until 3.20).
  - `PATCH /api/segments/{seg_id}` endpoint, debounced 500ms from frontend.
  - `DELETE /api/segments/{seg_id}` endpoint + trash button.

  **Acceptance test:** Expand a segment, change trim_in from 0 to 5 → reload page →
  trim_in is 5. Delete a segment → it disappears from the list and the DB.

- [x] **Step 3.5 — Right-rail panel stubs (all persist; no rendering yet)**

  **Deliverables:** Right rail with 6 collapsible panels, each PATCHing
  `/api/compositions/{id}` on edit:
  1. **Output length** — number input + slider (5–90s); shows current sum of segment
     durations alongside.
  2. **Hook** — textarea (hook_text) + animation preset dropdown (hardcoded list:
     `slide_in_top`, `fade_in`, `pop`, `none`).
  3. **Voiceover** — file-upload field + "Generate with Kokoro" button + voice
     dropdown. Both still no-op (return 501 or "coming soon").
  4. **Captions** — textarea (captions_text) + mode toggle (script / transcribe / srt)
     + caption_preset dropdown populated from `/api/presets`.
  5. **Bed music** — dropdown from `/api/music-library` (returns starter set, empty for
     now until 3.21) + gain slider (−30..0 dB) + duck toggle.
  6. **Spot SFX** — table with rows (at_sec, file dropdown, gain), Add Row button.
     File dropdown from `/api/sfx-library` (empty until 3.20).

  Endpoints stubbed: `/api/sfx-library` returns `[]`, `/api/music-library` returns
  `[]`, `/api/kokoro-voices` returns a hardcoded list of 4 voice IDs.

  **Acceptance test:** Edit every panel field. Reload page. All values persisted.

### Phase B → C bridge — refactor + eager ingest

> Two pre-Phase-C tasks. Refactor lands first so the download-on-fetch UI changes
> land in the smaller `app-compose-editor.js` instead of bloating the 2.4k-line
> `app.js`. Eager ingest then makes the source available before Render preview is
> clicked, so the smoke render in Phase C is a real "click-and-watch" experience.
>
> **Constraint reminder from Phase A/B post-eval** (`docs/plan/COMPOSE_PROGRESS.md`):
> never assume contiguous `segment.idx` values after delete. Iterate
> `db.get_segments(comp_id)` and use position in that ordered list whenever an
> integer index is needed; bind FK-style references to `segment.id`, not `idx`.

- [x] **Step 3.5a — Refactor `dashboard/static/app.js` into 5 files (plain script tags)**

  **Motivation:** `app.js` is 2,381 lines and growing. Pure code-motion split into
  feature-aligned files, no behavior change. Plain `<script>` tags so the implicit-
  global model used today (every top-level `function` and `let` is a window global)
  continues to work — no ESM migration, no bundler.

  **Deliverables:**
  - Split `dashboard/static/app.js` into five files. The current file's `// ── …`
    section comments already mark natural seams; use those as the cut lines.

    | New file | Source line range (current `app.js`) | Contents |
    |---|---|---|
    | `app-core.js` | 1–108, 1151–1173 (preset cache) | Utilities (`toast`, `api`, `fmt*`, `badge`, `escAttr`, `escHtml`), sidebar helpers, router (`route` + `hashchange`/`load` listeners), preset cache (`loadPresets`, `_presetOptions`, `_formPresetOptions`). |
    | `app-jobs.js` | 110–1349 (excluding the preset cache block) | Job list, New Job modal, form-based job creation, upload setup, job detail, clip rendering, hook editor (text + video), transcript editor, boundary suggestion, nudge state, deliverer selector, recut/approval/retry helpers. |
    | `app-history.js` | 1462–1632 | `showHistory`, `renderHistoryList`, `renderHistoryGrid`, `groupByDate`. |
    | `app-compose.js` | 1633–1753 | `showComposeList`, `renderComposeList`, `openNewComposeModal`, the `_composePoll` / `_newComposeModalEl` globals it owns. |
    | `app-compose-editor.js` | 1754–2381 | `showComposeEditor`, `renderCESegments*`, `setupCEAddSegment`, `renderCERightRail`, all `renderCEPanel*`, `_ce*` helpers. |

  - Update `dashboard/static/index.html:54` from the single `<script src="/static/app.js">`
    to five tags in dependency order:
    ```html
    <script src="/static/app-core.js"></script>
    <script src="/static/app-jobs.js"></script>
    <script src="/static/app-history.js"></script>
    <script src="/static/app-compose.js"></script>
    <script src="/static/app-compose-editor.js"></script>
    ```
  - Delete `dashboard/static/app.js` only after every function it contained is in
    one of the new files. Don't leave a re-export shim — implicit globals work
    across `<script>` boundaries as long as load order is correct.
  - No code changes other than moving lines. Same function names, same globals,
    same behavior. Don't "improve" anything during the move — that's a separate
    task and will hide regressions in the diff.

  **Two collisions to watch for during the cut:**
  - `let _composePoll;` is declared at the top of the current compose section
    (line 1635). It belongs in `app-compose.js`. `app-compose-editor.js`
    references it (`clearTimeout(_composePoll)` at line 1761) — that still works
    as a window global across script files.
  - `loadPresets()` is called from `showComposeEditor` (line 1832). Keep the
    preset cache in `app-core.js` and ensure `app-core.js` loads before
    `app-compose-editor.js` (the order above already does this).

  **Acceptance test:**
  1. After the split, open `http://localhost:8000` → Jobs list loads, click a job
     → detail renders. Hook editor, transcript editor, boundary suggestion,
     deliverer selector all still work.
  2. Navigate to `#compose` → list loads, create a new comp → editor opens,
     add a YT segment, edit trim, expand/collapse panels, toggle captions mode →
     everything persists on reload.
  3. `git diff --stat` shows only file moves (deletions in `app.js`, additions
     in the 5 new files) and the one-line `index.html` change. No net change in
     code content.
  4. Browser console: no `ReferenceError: <fn> is not defined` while navigating
     between Jobs, History, Compose list, Compose editor.

- [x] **Step 3.5b — Eager YT ingest on Fetch (with per-segment progress)**

  **Motivation:** Today, clicking Fetch on a YT segment only inserts a `pending`
  DB row with the URL. The actual download runs inside Render preview (Phase C
  Step 3.8), which means a 5–15 min render becomes 30–60 min of opaque waiting.
  Eager ingest decouples download from render and gives the user a visible
  progress bar in the segment row, so by the time they click Render the source
  is already cached.

  **Why this is safe to land before Phase C:** the render path described in
  Step 3.8 already calls `ingest.run_for_segment` per segment. The
  implementation of that function (in `clipper/compose/stages/ingest.py`, to be
  written in Step 3.6) only needs a guard: if `segments/<idx>/source.<ext>`
  already exists and `segment.status='ready'`, skip the download. So eager
  ingest in 3.5b becomes a transparent prefetch from Phase C's perspective.

  **Deliverables:**

  - **Schema migration** in `clipper/jobs.py:_migrate()` — append two idempotent
    `ALTER` entries to the existing `new_cols` list, following the exact pattern
    already used at lines 29–41:
    ```python
    ("composition_segments", "download_progress", "INTEGER"),
    ("composition_segments", "source_duration",   "REAL"),
    ```
    `download_progress` is 0–100 while downloading, NULL otherwise.
    `source_duration` is populated via `ffprobe` after download completes; it
    lets the editor default `trim_out` to the full source length.

  - **Ingest stage** at `clipper/compose/stages/ingest.py` (this file is also
    Step 3.6's deliverable — write the structure here in 3.5b, fill the
    normalize/cut piece in 3.6). The yt-dlp invocation must mirror the existing
    Clip-side ingest at `clipper/stages/ingest.py`: same `yt-dlp` binary, same
    progress-hook pattern. Key function:
    ```python
    def run_for_segment(comp: dict, seg: dict) -> None:
        """For kind='yt': download to segments/<idx>/source.<ext>, write
        download_progress 0..100 throughout, set source_duration via ffprobe
        on completion, flip seg.status='ready'. For kind='local'|'image':
        no-op (source already on disk from upload endpoint), just probe
        duration. Idempotent: if source file exists and status='ready',
        returns immediately."""
    ```
    Errors → `seg.status='failed'`, `seg.error=<traceback summary>`,
    `download_progress=NULL`.

  - **Ingest executor** in a new `clipper/compose/runner.py` (this file is also
    Step 3.8's deliverable — create the file here for the ingest executor;
    the render executor and `_compose_loop` come in 3.8):
    ```python
    _ingest_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="seg-ingest")

    def submit_ingest(comp_id: str, seg_id: str) -> None:
        _ingest_executor.submit(_run_segment_ingest, comp_id, seg_id)

    def _run_segment_ingest(comp_id, seg_id):
        # load comp + seg, run ingest.run_for_segment, persist status
    ```
    `start()` (defined here for Step 3.8's daemon thread later) doesn't need
    to do anything for ingest yet — the executor accepts work via
    `submit_ingest` directly from the API handler.

  - **API wiring** in `dashboard/main.py`:
    - In `api_create_segment` (line 624): after `create_segment(...)`, if
      `body.kind == 'yt'`, set `status='downloading'`, `download_progress=0` on
      the new row, then call `compose_runner.submit_ingest(comp_id, result["id"])`.
    - In `api_upload_segment` (line 633, post-Form-fix): after writing the
      uploaded file, call `compose_runner.submit_ingest(comp_id, result["id"])`
      to populate `source_duration` for `local`/`image` kinds. Status flips
      straight from `pending` to `ready` (no download phase).
    - Import: add `import clipper.compose.runner as compose_runner` near
      `import clipper.compose.db as compose_db` (line 551).

  - **Progress hook** inside `run_for_segment` — yt-dlp accepts a Python hook
    via `--newline` plus stdout parsing, OR via the Python API
    (`yt_dlp.YoutubeDL(..., progress_hooks=[fn])`). The existing Clip-side
    ingest uses the subprocess approach; reuse it. Parse `downloaded_bytes` /
    `total_bytes` from each progress event, compute pct, call
    `compose_db.update_segment(seg_id, download_progress=pct)`. Throttle to one
    write per ~500 ms to avoid hammering SQLite.

  - **Frontend — segment-row progress strip** in `app-compose-editor.js`
    (the file created in 3.5a):
    - In `renderCESegmentRow(seg)`: when `seg.status === 'downloading'`,
      render a thin progress strip below the collapsed row using
      `seg.download_progress` (0–100). Mirror the visual pattern in
      `renderDownloadProgress(pct)` at the current `app.js:1025`.
    - When `seg.status === 'failed'`, show `seg.error` as a small red caption.
    - When `seg.status === 'ready'`, hide the strip; if `seg.duration == null`
      and `seg.source_duration != null`, show the full source duration as
      a hint next to the trim_out input.

  - **Frontend — polling** in `app-compose-editor.js`:
    - After `renderCESegments`, if any segment has `status='downloading'`,
      start a 1.5 s `setTimeout` loop that re-fetches `GET /api/compositions/{id}`
      and re-renders the segments list. Stop polling when no segment is in
      `downloading` state. Reuse the `_compEditorPoll` global already declared
      at the top of the editor section.

  - **Frontend — auto-fill trim_out on ready** in `app-compose-editor.js`:
    - When a segment transitions to `ready` with `source_duration` populated
      and `trim_out` is null, PATCH `trim_out=source_duration` so the segment
      shows a sensible default range. (User can still nudge with ±0.5s.)

  - **Trim validation** in the existing `SegmentPatchBody` handler
    (`dashboard/main.py:661`): clamp `trim_out` to `source_duration` if both
    are known. Wrong-trim is a Phase C problem, but a server-side clamp here
    prevents bogus renders later.

  **Acceptance test:**
  1. Open editor, paste a 30 s YouTube URL, click Fetch.
  2. Segment row appears immediately with `downloading` status pill and a
     0% progress strip.
  3. The strip animates upward as bytes arrive (polling every 1.5 s).
  4. On completion, status flips to `ready`, strip disappears, `trim_out`
     auto-fills to the source duration.
  5. Click Fetch on a 404 URL → status flips to `failed`, error text appears,
     row is keepable (user can delete + retry).
  6. Reload page mid-download → progress resumes from current
     `download_progress` value (no double-download — the running executor
     thread is what's persisting progress, not the page).
  7. **Regression:** Local/Image upload still works (Step 3.3 acceptance);
     after upload, `source_duration` is populated via ffprobe.
  8. **Render-time check (light, no Phase C work):** manually run
     `python -c "from clipper.compose.stages.ingest import run_for_segment; …"`
     on a segment whose source already exists → function returns immediately,
     no re-download.

  **Known gotchas:**
  - yt-dlp emits progress on stderr in some configurations and stdout in
     others. Match whatever the Clip-side ingest uses; don't switch streams.
  - SQLite `WRITE` from the ingest executor thread + the runner thread + the
     FastAPI request handler all happen concurrently. WAL mode is already on
     (`clipper/jobs.py:22`), so concurrent writes are fine, but each helper
     must use its own `get_conn()` — never share a connection across threads.
  - Don't block FastAPI: `submit_ingest` returns immediately. The HTTP
     response is the segment row; the download runs after the response is
     sent.
  - `composition_segments.download_progress` must be reset to NULL on the
     `pending → downloading` transition AND on terminal states (`ready` /
     `failed`), so the UI can use `status` as the source of truth and only
     read `download_progress` while `status='downloading'`.

### Phase C — Smoke render (prove the loop)

> **Phase C goal: a YouTube segment with a 5s trim becomes a playable 9:16 mp4 in the
> preview pane.** No audio, no captions, no hook, no timeline yet. This is proof of
> life for the entire render plumbing.

- [ ] **Step 3.6 — Segment normalize (ingest + cut + reframe in one pass)**

  **Deliverables:**
  - `clipper/compose/stages/ingest.py`:
    - For `kind='yt'`: run `yt-dlp` to download into `segments/<idx>/source.<ext>`
      (use the existing `clipper/stages/ingest.py` invocation pattern; cache the full
      source so re-trim doesn't re-download).
    - For `kind='local'` / `kind='image'`: file is already in
      `segments/<idx>/source.<ext>` from the upload endpoint.
  - `clipper/compose/stages/normalize.py`:
    - Video segments: precise re-encode (re-encode, never stream-copy — same locked
      rationale as Clip §5.1) from `trim_in` to `trim_out`. Reframe to 1080×1920 using
      a simple centered crop (use ffmpeg recipe §R1 below). Force 30fps, yuv420p, 48k
      stereo (silent stereo track via `anullsrc` if source has no audio). Output
      `segments/<idx>/normalized.mp4`.
    - Image segments: call new `image_motion.py:render_image_segment(src, dur, motion,
      out_path)` (ffmpeg recipe §R2).
  - Updates `composition_segments.status='normalized'` per segment on success.

  **Acceptance test:**
  ```powershell
  # After creating a composition with 1 YT segment trim_in=0, trim_out=5:
  python -c "from clipper.compose.stages import ingest, normalize; from clipper.compose import db; comp = db.get_composition('<id>'); segs = db.get_segments('<id>'); ingest.run_for_segment(comp, segs[0]); normalize.run_for_segment(comp, segs[0])"
  ffprobe data\compositions\<id>\segments\0\normalized.mp4
  ```
  Expected: ffprobe shows 1080×1920, 30fps, ~5s duration, 48000 Hz stereo audio.

- [ ] **Step 3.7 — Multi-segment picture-only concat with transitions**

  **Deliverables:**
  - `clipper/compose/stages/concat.py`:
    - Accepts list of normalized.mp4 paths + per-pair transition specs
      (`[(transition_to_next, dur_ms), …]`, len = N-1).
    - For all-`cut` chain: simple `concat` demuxer (lossless, fastest).
    - For any non-cut transitions: build `filter_complex` with `xfade` reductions
      pairwise (ffmpeg recipe §R3). Use the same fixed durations as Clip's hook
      (`fade`: 0.125s, `slide_up`: 0.30s). Audio uses `acrossfade`.
    - Output: `last_render.mp4` (no audio mix yet — passes through whatever audio each
      `normalized.mp4` has).
  - `clipper/compose/stages/pad.py`:
    - `make_black_padding(duration, out_path)` — ffmpeg recipe §R5. If total normalized
      duration < `composition.target_sec`, append black-frame mp4 to reach target.

  **Acceptance test:** Manually invoke for 2 segments with a fade transition → output
  plays in VLC, transitions visible at the seam.

- [ ] **Step 3.8 — Compose runner + dedicated executor + render orchestrator**

  **Deliverables:**
  - `clipper/compose/runner.py`:
    - `_compose_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="compose")`.
    - `_compose_loop()` daemon thread: every 2s, queries
      `compositions WHERE status='render_queued'`, picks the oldest, sets status to
      `'rendering'`, submits to `_compose_executor.submit(_run_render, comp_id)`.
    - `start()` is called from existing `clipper/runner.py:start()` so the dashboard's
      `on_startup` boots both loops with one call.
  - `clipper/compose/render.py`:
    - `_run_render(comp_id)`:
      1. Load composition + segments.
      2. For each segment: `ingest.run_for_segment` then `normalize.run_for_segment`.
      3. Build transition specs from segment rows.
      4. Call `concat.run(normalized_paths, transitions, intermediate_path)`.
      5. If total dur < target, call `pad.make_black_padding(diff, pad_path)` and
         concat `[intermediate_path, pad_path] → last_render.mp4`.
      6. Set `compositions.status='rendered'`, `last_render_path=…`,
         `last_render_duration=…`.
      7. On any exception: status='failed', error=traceback.

  **Acceptance test:** Manually flip a composition to status='render_queued' in DB or
  via UI. Watch the runner log — picks it up, status flips
  `render_queued → rendering → rendered`. `data/compositions/<id>/last_render.mp4`
  exists and plays.

- [ ] **Step 3.9 — Render preview button + polling + center-pane player**

  **Deliverables:**
  - `POST /api/compositions/{id}/render` endpoint: validates ≥1 segment with status≠
    'failed'; sets composition status='render_queued'; returns
    `{status:"render_queued"}`.
  - `GET /compositions/{id}/render` endpoint (route, not under /api): serves
    `last_render.mp4` via `FileResponse` (mirror `/video/{cand_id}` at
    `dashboard/main.py:65`).
  - Frontend: "Render preview" button in editor header. **Disabled iff 0 segments.**
    Click → POST endpoint → start polling `/api/compositions/{id}` every 2.5s; show a
    small "Rendering…" spinner. When status flips to `rendered`, swap center pane to
    `<video src="/compositions/{id}/render?t=<now>" controls>` (cache-buster). On
    `failed`, show error banner.

  **Acceptance test (Phase C MILESTONE):** Add one YouTube segment with a 5s trim →
  click Render preview → status pill cycles → after ~30s, a 9:16 video plays in the
  center pane. Reload page after success → video still plays. **This is proof-of-life
  for the whole render plumbing.**

### Phase D — Timeline view (target layout)

- [ ] **Step 3.10 — Read-only timeline strip**

  **Deliverables:**
  - Replace the Phase B "Timeline (TBD)" placeholder with the real strip. 5 stacked
    tracks (top to bottom): Segments (50px), Hook (22px), Voice (30px), Music (24px),
    SFX (26px). Above tracks: 1-second ruler with major ticks every 5s, zoom controls
    `fit / − / +`.
  - Segments track: colored blocks proportional to `duration`, color per `kind` (yt =
    `#3b82f6`, local = `#a855f7`, image = `#0891b2`), label = first 18 chars + duration.
  - Hook track: amber bar from 0 to `hook_duration_sec` (use `composition.hook_text`
    presence to decide if rendered).
  - Voice track: SVG waveform from `/api/compositions/{id}/voiceover/peaks` (return `[]`
    if no voiceover yet); dashed vertical lines at each voice-range boundary.
  - Music track: gray waveform from `bed.wav` peaks (return `[]` if unset).
  - SFX track: numbered green dots at each `at_sec`.

  **Acceptance test:** Add 3 segments of different kinds + durations → timeline strip
  shows 3 proportional colored blocks. Zoom in/out works.

- [ ] **Step 3.11 — Thumbnail extraction + hover-scrub**

  **Deliverables:**
  - `clipper/compose/stages/thumbs.py`:
    `extract_thumbs(video_path, out_dir, every_sec=0.5)`. Uses
    `ffmpeg -i <v> -vf "fps=2" -q:v 5 <out_dir>/%d.jpg`. Wired into `render.py` as the
    final step after `last_render.mp4` write.
  - `GET /compositions/{id}/thumb/{n}` endpoint serving `thumbs/<n>.jpg`.
  - Frontend: hover anywhere on the timeline tracks → compute `t = mouseX → seconds`
    (using current zoom), display vertical playhead line + `<img src="/compositions/
    {id}/thumb/<round(t*2)>">` thumbnail above the playhead + timecode badge. Update
    the center preview's `<video>` `currentTime = t` (cheaper than swapping `src`).

  **Acceptance test:** After a render, hover anywhere on the timeline → vertical line +
  thumbnail appears + center pane jumps to the same frame.

- [ ] **Step 3.12 — Drag-to-reorder segments on timeline**

  **Deliverables:**
  - Make segment blocks `draggable=true`. On drag: lift block (translateY + shadow per
    `compose-timeline.jsx`); other blocks slide; drop indicator (vertical bar) shows
    insertion point. Release → call `PUT /api/compositions/{id}/segments/order` with
    the new ordering.
  - Backend endpoint updates `composition_segments.idx` in a single transaction.
  - Center pane's `last_render.mp4` is now stale — show a small "Reorder pending —
    re-render to see new order" banner with a "Render preview" shortcut.

  **Acceptance test:** With 4 segments → drag segment 2 between 3 and 4 → release →
  left-rail list and timeline both reflect the new order. Click Render preview → new
  order plays.

### Phase E — Real render pipeline (richen the smoke)

- [ ] **Step 3.13 — Kokoro TTS generation**

  **Deliverables:**
  - Add to `requirements.txt`: `kokoro-onnx`, `soundfile`, `librosa`.
  - `clipper/compose/stages/kokoro.py`:
    - On first call, lazy-load model from `kokoro-model/kokoro-v1.0.onnx` +
      `voices-v1.0.bin` (module-level singleton).
    - `generate(text, voice_id, out_path)`:
      1. Chunk text by sentence boundary, max ~150 chars per chunk.
      2. For each chunk: run model → 24kHz mono float32 buffer.
      3. Concatenate buffers.
      4. Resample to 48kHz stereo via `librosa.resample` + duplicate channel.
      5. Write `voiceover.wav` via `soundfile.write(..., samplerate=48000,
         subtype='PCM_16')`.
  - `POST /api/compositions/{id}/voiceover/kokoro` endpoint: reads
    `composition.captions_text`, calls `generate(...)`, sets
    `voiceover_source='kokoro'`, returns `{ok, duration_sec, peaks_url}`.
  - `GET /api/kokoro-voices` returns the static voice list (hardcode `['af_bella',
    'af_nicole', 'am_michael', 'am_adam']` — verify ids exist in voices.bin first).

  **Acceptance test:** Type a 1-sentence script in captions panel → click Generate
  voiceover → wait → `data/compositions/<id>/voiceover.wav` exists, plays the
  expected speech.
  ```powershell
  ffprobe data\compositions\<id>\voiceover.wav  # should show 48000 Hz stereo
  ```

- [ ] **Step 3.14 — Voiceover upload (alternate path)**

  **Deliverables:**
  - `POST /api/compositions/{id}/voiceover/upload`: accept multipart WAV/MP3/M4A;
    resample to 48k stereo with ffmpeg (`ffmpeg -i in -ar 48000 -ac 2 voiceover.wav`);
    set `voiceover_source='upload'`.

  **Acceptance test:** Upload any audio → `voiceover.wav` is 48k stereo (ffprobe).

- [ ] **Step 3.15 — Voiceover waveform editor + ranges**

  **Deliverables:**
  - `GET /api/compositions/{id}/voiceover/peaks`: load `voiceover.wav` via librosa,
    downsample to 1000 peak samples, return `{peaks: [...], duration_sec}`.
  - `POST /api/compositions/{id}/voice-ranges/auto`: use `librosa.effects.split` with
    `top_db=30` to find non-silent ranges; one range per segment up to N segments;
    REPLACE existing rows.
  - `PUT /api/compositions/{id}/voice-ranges`: replace with given array.
  - Frontend voiceover panel: render waveform as SVG bars; auto-split button calls
    /auto endpoint; per-segment colored overlay rectangles with draggable handles
    (drag updates `start_sec`/`end_sec` then PUTs); per-segment editor shows snippet
    (cached on the row) + ±0.1s buttons + "snap to silence" (calls a tiny
    /voice-ranges/snap?range_id endpoint).

  **Acceptance test:** Upload a 30s WAV → auto-split → N ranges appear → drag a handle
  → value persists → reload page → handle position preserved.

- [ ] **Step 3.16 — Caption alignment + ASS burn**

  **Deliverables:**
  - `clipper/compose/stages/caption.py`:
    - Mode `'transcribe'`: run AssemblyAI on `voiceover.wav` (reuse
      `AssemblyAITranscriber`), save `words.json`, use that for captions verbatim.
    - Mode `'script'`: transcribe voiceover first (same as above), then ALIGN the
      captions_text tokens to the transcript by position-based matching (simple
      word-by-word; if counts mismatch, fall back to even-spacing of script words over
      voiceover duration). Output adjusted `words.json` where text is from script and
      timings are from transcript.
    - Mode `'srt'`: parse uploaded srt → words.json (timings per cue, text split by
      word with even subdivision).
    - Then call existing `clipper/stages/caption.py` ASS-build + burn helpers on the
      concatenated picture.

  **Acceptance test:** Render with mode=script and a 1-sentence script → captions
  appear and are word-aligned to the voiceover.

- [ ] **Step 3.17 — Hook prepend**

  **Deliverables:**
  - `clipper/compose/stages/hook.py`:
    - Build a Clip-shaped fake candidate dict (hook_text, hook_enabled, hook_preset,
      hook_duration, hook_background='blur_self'). The "raw.mp4" passed to the
      underlying hook code is `last_render.mp4`-before-hook (or the captioned chain
      output).
    - Call into `clipper/stages/hook.py:_create_hook_segment` + `_concatenate` (the
      existing 2-input concat is fine here: hook + composition body = 2 inputs).
    - Output overwrites `last_render.mp4`.
  - New animation presets specific to Compose (e.g. `slide_in_top`) registered in
    `clipper/config.py:HOOK_PRESETS` (extend the existing dict).

  **Acceptance test:** Set hook_text → render → first ~1.5s shows the hook overlay, then
  the composition body plays.

- [ ] **Step 3.18 — Two-stage audio mix**

  **Deliverables:**
  - `clipper/compose/stages/audio.py`:
    - Build voiceover track: for each voice range, `atrim=start:end`; concat in order;
      pad with silence to match composition body duration.
    - Stage 1 (`sidechaincompress` ducking — recipe §R4a): bed music + voiceover →
      `mix1.wav`. Bed gain pre-scaled, voice gain 0dB.
    - Stage 2 (`amix normalize=0` additive — recipe §R4b): `mix1.wav` + each spot SFX
      (delayed via `adelay=at*1000|at*1000`, pre-scaled by `gain_db`) → `final_audio.wav`.
    - Final mux step in `render.py`: `ffmpeg -i picture_with_captions.mp4 -i
      final_audio.wav -c:v copy -c:a aac -shortest last_render.mp4`.

  **Acceptance test:** Render with a voiceover + bed music + 1 SFX placed at 2s → audio
  plays: bed ducks under voice, SFX plays at 2s without dipping anything.

- [ ] **Step 3.19 — Final render orchestrator wiring**

  **Deliverables:** Update `clipper/compose/render.py:_run_render` to call the full
  sequence:
  1. Per-segment: ingest → normalize.
  2. Concat (3.7) → `picture_raw.mp4`.
  3. Pad if short → `picture.mp4`.
  4. Caption alignment + burn (3.16) → `picture_captioned.mp4`.
  5. Hook prepend (3.17) → `picture_hooked.mp4`.
  6. Voiceover ensured present (Kokoro or upload); audio mix (3.18) → `final_audio.wav`.
  7. Mux picture + audio → `last_render.mp4`.
  8. Thumb extraction (3.11) → `thumbs/*.jpg`.
  9. Status='rendered'.

  Each intermediate file is kept on disk for debuggability.

  **Acceptance test:** End-to-end: 3 segments + Kokoro voiceover + bed music + 1 SFX +
  script captions + hook text. Render → final mp4 is target-length, has all elements
  visible/audible, captions sync, hook prepends cleanly, transitions visible, black
  padding fills the tail if short.

### Phase F — Asset libraries + finalize + delivery + history

- [ ] **Step 3.20 — SFX library**

  **Deliverables:** Bundle 5 royalty-free SFX in `assets/sfx/` (e.g. `whoosh.wav`,
  `click.wav`, `chime.wav`, `pop.wav`, `swoosh.wav`). `GET /api/sfx-library` scans the
  folder and returns `[{name, path, duration_sec}]`. Spot SFX dropdown populated from
  this.

  **Acceptance test:** Spot SFX dropdown shows 5 entries. Add a row, pick one, set at_sec
  = 3, render → SFX audible at 3s.

- [ ] **Step 3.21 — Bed music library**

  **Deliverables:** Bundle 3–5 royalty-free instrumentals in `assets/music/`.
  `GET /api/music-library` scans the folder. Bed music dropdown populated.

  **Acceptance test:** Pick a bed track, render → music plays under composition; ducks
  under voice if duck=true.

- [ ] **Step 3.22 — Save draft vs Finalize Video split button**

  **Deliverables:**
  - Editor header: split button "Save draft (⌘S)" + dropdown "Finalize video (⇧⌘S)".
  - Save draft: no-op except a toast (everything auto-persists already).
  - Finalize: `POST /api/compositions/{id}/finalize` → status='finalize_queued' →
    runner re-renders at final spec (same 1080×1920 today, so mostly a status
    transition + copy `last_render.mp4 → final.mp4`) → status='finalized'.
  - After finalize: composition moves from "Drafts" filter to "Uploaded" filter in the
    list page (use status).

  **Acceptance test:** Finalize → composition appears under Uploaded filter; `final.mp4`
  exists on disk.

- [ ] **Step 3.23 — Delivery plug-in**

  **Deliverables:** `POST /api/compositions/{id}/deliver` (body: `{deliverer?:
  "local"|"gdrive"}`) — build a fake `candidate`-shaped dict (`id`, `title`,
  `output_path=final_path`), pass to `_DELIVERERS[deliverer].deliver(...)`, persist
  returned status to `composition.delivery_status`. Add "Deliver" button on a
  finalized composition row.

  **Acceptance test:** Finalize → click Deliver (local) → mp4 lands in
  `DELIVERY_LOCAL_OUTPUT_DIR/<title-slug>/<id>.mp4`. Then click Deliver (gdrive) →
  ends up in the configured rclone destination.

- [ ] **Step 3.24 — History tabs**

  **Deliverables:** Extend `GET /api/history` with `?pipeline=clip|compose|all`
  (default `all`); return unified rows with a `pipeline` field. Add Clip / Compose /
  All tab strip at the top of the history page. Compose rows show
  `thumbs/0.jpg` + title + niche + finalized date + delivery status.

  **Acceptance test:** Existing Clip rows still appear in Clip tab. Composed shorts
  appear in Compose tab. All tab interleaves by date. **Regression: every Clip flow
  (upload YAML, review, deliver) still works identically.**

---

## ffmpeg recipes (reference)

### R1 — Precise vertical re-encode (centered crop) for a video segment

```
ffmpeg -y -ss <trim_in> -to <trim_out> -i <source> \
  -vf "scale=-2:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p" \
  -af "aresample=48000,aformat=channel_layouts=stereo" \
  -c:v libx264 -crf 18 -preset medium \
  -c:a aac -b:a 192k \
  -movflags +faststart \
  <out>/normalized.mp4
```

If source has no audio: add `-f lavfi -i anullsrc=r=48000:cl=stereo -shortest` before
the `-vf` and drop `-af`.

### R2 — Image segment with motion (zoompan / pan)

Static (no motion):
```
ffmpeg -y -loop 1 -framerate 30 -i <img> \
  -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,format=yuv420p" \
  -t <dur> -f lavfi -i anullsrc=r=48000:cl=stereo -shortest \
  -c:v libx264 -crf 18 -preset medium -c:a aac -b:a 192k \
  <out>
```

Zoom in (Ken Burns):
```
-vf "scale=2160:3840,zoompan=z='min(zoom+0.0008,1.3)':d=<frames>:s=1080x1920:fps=30,format=yuv420p"
```
where `<frames> = dur * 30`.

Slide L→R: pre-scale to a wider canvas, then crop with a moving x:
```
-vf "scale=2160:1920,crop=1080:1920:x='(iw-ow)*t/<dur>':y=0,fps=30,format=yuv420p"
```

### R3 — N-segment xfade reduction

For 3 segments with `fade` between each (0.125s):
```
filter_complex:
  [0:v]setsar=1[v0];
  [1:v]setsar=1[v1];
  [2:v]setsar=1[v2];
  [v0][v1]xfade=transition=fade:duration=0.125:offset=<dur0-0.125>[vx01];
  [vx01][v2]xfade=transition=fade:duration=0.125:offset=<dur0+dur1-0.25>[v];
  [0:a][1:a]acrossfade=d=0.125[ax01];
  [ax01][2:a]acrossfade=d=0.125[a]
```
Offsets are cumulative (`offset_n = sum(dur_0..dur_n) - total_transition_dur_so_far -
transition_dur`). For all-`cut` chains use concat demuxer (no filter_complex needed),
much faster.

### R4 — Two-stage audio mix

**R4a — Bed ducked under voice:**
```
ffmpeg -y -i bed.wav -i voice.wav \
  -filter_complex \
  "[1:a]apad[v1]; \
   [0:a]volume=<bed_gain_db>dB[b]; \
   [b][v1]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400:makeup=0[ducked]; \
   [ducked][v1]amix=inputs=2:duration=longest:normalize=0[mix1]" \
  -map "[mix1]" -ar 48000 -ac 2 mix1.wav
```

**R4b — Add SFX additively without re-normalizing:**
```
# For each SFX i with at_sec=ti, gain_db=gi:
#  -i sfx_i.wav  → in filter: [n:a]adelay=ti*1000|ti*1000,volume=<gi>dB[sn]
# Then: [mix1][s1][s2]…amix=inputs=N+1:duration=longest:normalize=0[out]
```

### R5 — Black-frame padding video

```
ffmpeg -y -f lavfi -i color=c=black:s=1080x1920:r=30 -t <pad_sec> \
  -f lavfi -i anullsrc=r=48000:cl=stereo \
  -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p \
  -c:a aac -b:a 192k -shortest \
  pad.mp4
```

### R6 — Concat demuxer (lossless, for all-`cut` chains)

`list.txt`:
```
file '/abs/path/segments/0/normalized.mp4'
file '/abs/path/segments/1/normalized.mp4'
file '/abs/path/pad.mp4'
```
Command:
```
ffmpeg -y -f concat -safe 0 -i list.txt -c copy concat.mp4
```
Works ONLY because every `normalized.mp4` was forced to identical spec (1080×1920,
yuv420p, 30fps, 48k stereo).

---

## Known gotchas (verified)

1. **Windows ffmpeg + ASS subtitle path** — `caption.py` already handles this by
   passing `cwd=BASE_DIR` and using relative ASS paths (`hook.py:179`). Compose's
   caption stage MUST follow the same pattern; do not pass absolute paths to `ass=`
   filter on Windows (the drive-letter colon parses as a filter-arg separator).

2. **`anullsrc` channel_layout name** — newer ffmpeg uses `cl=stereo`; some helpers
   in `hook.py` use the older `channel_layout=stereo`. Both work but stick to the
   style already in the file you're editing.

3. **AssemblyAI cost / rate-limit** — `_transcriber` may be `None` at runtime if
   `ASSEMBLYAI_API_KEY` is unset. Compose's caption stage must check and produce a
   helpful error rather than crashing.

4. **kokoro-onnx model load is slow (~3s)** — keep the model as a module-level
   singleton in `clipper/compose/stages/kokoro.py`, not per-call.

5. **`sidechaincompress` requires matching sample rate + channels on both inputs**
   — that's why everything is normalized to 48k stereo at ingest. If you skip the
   normalize, ducking silently does nothing.

6. **Concat demuxer fails if specs differ by even one frame rate or pixel format**
   — when in doubt, use `filter_complex` concat instead of concat demuxer.

7. **`runner.start()` is called once from `dashboard/main.py:on_startup`** — Compose's
   start function should be called from inside `clipper/runner.py:start()` so the
   dashboard doesn't need to know about it. Single startup hook.

8. **Don't run `cd <dir>` before `git` commands** — per project guidance; not relevant
   to render code but relevant if Sonnet uses Bash for git operations.

---

## Critical files (canonical reference)

**Read first (no edits):**
- `clipper/jobs.py`, `clipper/runner.py`,
  `clipper/stages/{hook.py,caption.py,reframe.py}`, `clipper/transcribe/api.py`,
  `clipper/delivery/{base.py,local.py,gdrive.py}`, `dashboard/main.py`,
  `dashboard/static/{index.html,app.js,style.css}`, `COMPOSE.md`,
  `COMPOSE_TIMELINE.md`, `design-references/compose-timeline.jsx`.

**New (create):**
- Full `clipper/compose/` package per Module layout above.
- `assets/sfx/`, `assets/music/` with starter files.

**Edit (additive only):**
- `clipper/jobs.py:init_db()` — append 4 new CREATE TABLE statements.
- `clipper/runner.py:start()` — call `compose.runner.start()` after the existing
  thread starts.
- `clipper/config.py:HOOK_PRESETS` — add compose-specific animation presets if needed.
- `dashboard/main.py` — append new "Compose" API section after the existing
  "History" / "Deliver" sections. Add `_COMPOSE_DELIVERERS = _DELIVERERS` (same
  registry).
- `dashboard/static/index.html` — add one `<a class="nav-item">` for Compose.
- `dashboard/static/app.js` — add route handlers for `#compose` and `#compose/<id>`.
- `dashboard/static/style.css` — add styles for editor 3-column + timeline strip +
  waveform editor.
- `requirements.txt` — add `kokoro-onnx`, `soundfile`, `librosa`.

---

## Verification milestones

| After step | Verification |
|---|---|
| 3.2 | Compose nav item visible; clicking creates a draft row that persists across reload. |
| 3.5 | Add 1 YT segment + edit every right-rail field + reload → everything persisted. |
| **3.9 — PROOF-OF-LIFE** | Add 1 YT segment with 5s trim → click Render preview → 9:16 video plays in center pane after ~30s. |
| 3.12 | Timeline strip shows segments as proportional blocks; hover shows thumbnail + center jumps to frame; drag-reorder updates DB + plays in new order on next render. |
| 3.13 | Type a script + click Generate voiceover → `voiceover.wav` is 48k stereo (ffprobe) and plays the expected speech. |
| 3.19 | End-to-end compose: 3 segments + Kokoro voiceover + bed music + 1 SFX + script captions + hook text + black-padding tail → final mp4 plays with everything aligned. |
| 3.23 | Finalize + Deliver lands the mp4 in local folder or gdrive (same path Clip uses). |
| 3.24 | **Regression check:** all existing Clip flows (upload YAML, review boundaries, approve, deliver) still work identically. History tabs show Clip rows in Clip tab and Compose rows in Compose tab. |
