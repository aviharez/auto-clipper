# Clip Automation App — Implementation Plan

> **Purpose of this document.** This is an execution-ready specification for building a
> YouTube clip-automation tool. It is written to be handed to an AI coding agent
> (Claude Sonnet 4.6) as authoritative context. Every architectural decision below was
> deliberated and locked; the rationale is included so the implementing agent does not
> "optimize" away decisions that look suboptimal in isolation but are correct in context.
>
> **How to use this document.** Build in the iteration order given in §9. Do not skip
> ahead. Prove the end-to-end loop before adding polish. When a decision says "locked
> rationale," treat the rationale as a constraint, not a suggestion.

---

## 1. What this product is

A tool that turns long-form source videos into short, vertical, captioned clips for a
YouTube clips channel, with two modes:

- **Manual mode** — the user supplies a list of timestamps (and per-clip metadata) in an
  input file. The tool executes them.
- **Auto mode** — the tool reads the source transcript and an LLM proposes
  clip-worthy segments. (Built last; see §8.)

Both modes converge to the **same internal data shape** (a list of candidate segments)
after which the entire downstream pipeline is identical and mode-agnostic.

### Application form (locked)

**A local web app.** A Python backend (FastAPI) plus a minimal browser frontend, all
running on the user's own laptop; the user opens `localhost` to review and approve clips.
Not an Electron/Tauri desktop app (the wrapper adds complexity with no benefit for
single-user personal use, since a Python backend is required either way for ffmpeg/video
work). Not CLI-only (the boundary-refine control in §8 needs a visual nudge UI; doing it
via text commands cripples the single most valuable manual-mode feature).

**Only the `dashboard/` component is affected by this choice.** Every other stage
(ingest, transcribe, cut, hook, caption, publish) is headless background processing and
is identical regardless of application form.

### Designed-in extensibility (seam now, build later)

The product must extend beyond individual clips to other output types — notably
**ranked compilation videos** (e.g. "Top 5 Funny Moments"): multiple segments stitched
into ONE video with inter-segment number cards, instead of multiple separate clips.

This is **not** a "make it do anything" mandate (that leads to over-abstraction that
slows the first feature). The observation is narrower and exact: a ranked compilation
starts from the *same* `Candidate` list as normal clipping. The only difference is what
happens *after* the candidate list exists — normal clipping renders each candidate as a
separate video; ranked compilation renders all candidates and stitches them into one
with number cards. Ingest, transcription, the convergence contract, and the detector are
all untouched.

Therefore the extension point is a single new swappable seam — **assembly** (the final
render step) — following the same "seam now, implementations added over time" pattern
already used for `Transcriber`, `CandidateSource`, and scoring signals. See §2 and §10.
`assembly/ranked.py` is a **future extension, not initial scope** (same status as auto
mode).

### Constraints that shaped this design

- **Content source: licensed/permitted creators.** Even with creator permission, source
  content may contain third-party music/footage that YouTube Content ID matches against
  regardless of private agreements. Therefore a human review gate exists before publish.
  Fully hands-off auto-posting on borrowed content is explicitly out of scope.
- **Hardware: AMD Ryzen 7 8845HS, integrated Radeon 780M, no NVIDIA GPU.** For this
  workload the iGPU is effectively not a GPU (the ML tooling ecosystem is CUDA-bound;
  ROCm on integrated graphics is not worth pursuing). Implication: transcription runs as
  a hosted API; everything else runs on CPU locally.
- **Volume: a few clips per week.** Background processing latency is irrelevant. This
  justifies "precision over speed" everywhere and makes per-clip API cost negligible.
- **Priorities, ranked:** (1) fully automated end-to-end, (2) best clip quality,
  (3) cheap to run, (4) fast to get working. "Fast to get working" is lowest — build it
  properly modular from the start.

---

## 2. Architecture overview

A job flows through stages. Each stage is a standalone module that reads and writes a
single shared job record. **No stage calls the next stage directly** — a runner advances
the job. This is what allows rebuilding any single stage (especially the detector and
the boundary-refine logic) without touching the rest.

```
clipper/
  jobs.py            # job record: status, paths, metadata, results. SQLite to start.
  runner.py          # picks up jobs, advances them stage by stage; reads CandidateSource
                     #   properties to decide transcription scope + review strictness
  config.py          # caption style, hook defaults, model choice, clip-length bounds
  transcribe/
    base.py          # Transcriber interface: audio -> words[] (word-level + speaker)
    api.py           # hosted-API implementation (default)
    local.py         # optional future local impl (only if NVIDIA hardware appears)
  candidates/
    base.py          # CandidateSource: .generate(job) -> [Candidate]
                     #   also declares .needs_full_transcription, .review_strictness
    manual.py        # parses the YAML clip spec  (BUILD FIRST)
    auto.py          # wraps detect + scoring/    (BUILD LAST)
  stages/
    ingest.py        # yt-dlp -> source.mp4 + metadata.json
    cut.py           # ffmpeg -> per-candidate clip, PRECISE (re-encode), 9:16 reframe
    hook.py          # build 2-4s opener segment, prepend to main clip
    caption.py       # burn word-level "viral style" captions (ASS-based)
  delivery/          # swappable seam — moves finished clip to its destination
    base.py          # Deliverer interface: .deliver(clip_file, job) -> status
    local.py         # copy to user-configured output folder (BUILD FIRST; default)
    gdrive.py        # rclone-based upload to Google Drive (added in 2.7.2)
    # NOTE: pre-2.7 there was a stages/publish.py (YouTube Data API). Retired in 2.7.
  assembly/          # final render step — swappable; runs AFTER candidates are cut/styled
    base.py          # Assembler interface: .assemble(styled_clips, job) -> output(s)
    individual.py    # each candidate -> its own video  (BUILD FIRST; default)
    ranked.py        # all candidates -> ONE video + number cards  (FUTURE EXTENSION)
  scoring/           # used ONLY by candidates/auto.py; not invoked in manual mode
    base.py          # Signal interface: .score(candidate, context) -> 0..1
    llm.py           # "is this a complete, engaging thought" pass
    audio.py         # loudness / laughter peaks (librosa)
    pacing.py        # words-per-second spikes
    combine.py       # weighted sum -> final ranking; weights live in config.py
  dashboard/         # FastAPI + minimal frontend: preview, refine boundaries, approve
```

**Locked rationale (modularity).** The boundary-refine review step (§7) and cheap
detector iteration both depend on each stage being independently re-runnable against an
existing job record. If the pipeline were one script, nudging a clip boundary by one
second would force re-ingest and re-transcription (the expensive stage). Keep stages
independent and job-record-driven. This is non-negotiable.

---

## 3. The convergence contract

Both modes produce the same object. Everything after this point is mode-agnostic.

### 3.1 Candidate object

```
Candidate {
  start: float            # SECONDS, not "12:34". Precision for ffmpeg.
  end: float              # SECONDS
  title: string
  source_job_id: string
  hook_text: string|null  # opener text; user-written in manual, LLM-written in auto
  hook_enabled: bool
  hook_background: string # "blur_self" (default) or path to an external asset
  needs_caption: bool
  caption_preset: string|null  # null -> use config default preset
  hook_preset: string|null     # null -> use config default preset
  rank: int|null          # null for normal clips; set for ranked compilation ordering
  origin: "manual"|"auto"
}
```

**Locked rationale (seconds, not timecodes).** Timecode strings ("12:34") are converted
to seconds exactly once, at input-parse time. The rest of the system only knows seconds.
This prevents time-conversion bugs from being scattered across stages.

**Locked rationale (`rank` field reserved now).** Normal clipping ignores `rank` (null).
Ranked compilation (`assembly/ranked.py`, future) needs an ordering across candidates.
Reserving the optional field now means the convergence contract does not get reworked
when ranked assembly is added — same reasoning as keeping `hook_text` before auto mode
existed. Do not remove this field because it is unused in the initial build.

### 3.2 How each mode declares its needs

`CandidateSource` exposes two properties the runner reads:

- `needs_full_transcription: bool`
- `review_strictness: "full" | "preview_only"`

| Mode   | needs_full_transcription | review_strictness | Reasoning |
|--------|--------------------------|-------------------|-----------|
| manual | `false`                  | `preview_only`    | User already exercised editorial judgment at input time. Only span transcription (for captions) is needed, lazily, and only if captions are on. |
| auto   | `true`                   | `full`            | LLM must read the whole transcript to find moments; machine-chosen moments need a real keep/reject review. |

**Locked rationale (mode-aware, not global).** Transcription scope and review strictness
differ by mode. The runner reads these two properties instead of branching on a global
"mode" flag, so adding a future mode does not require touching the runner or any
downstream stage.

### 3.3 Manual-mode input schema (YAML)

```yaml
source: https://youtube.com/watch?v=xxxx
default_captions: true

hook:
  enabled: true            # default for all clips
  duration: 3              # seconds
  background: blur_self    # default: blurred frames from the clip itself

clips:
  - start: "12:30"         # human writes timecodes; converted to seconds on parse
    end: "13:45"
    title: "his take on X"
    hook_text: "Why would he say this on record?"

  - start: "47:02"
    end: "48:10"
    title: "the funny bit about Y"
    hook_text: "Didn't expect him to say this 😂"
    hook_background: intro_brand.mp4   # per-clip override (external asset)

  - start: "55:10"
    end: "56:00"
    title: "the serious part"
    hook_text: "Listen to this one slowly."
    hook: false                        # per-clip: no hook at all
```

**Locked rationale (defaults + per-clip override).** Top-level `hook` / `default_captions`
set defaults set once; per-clip keys override only when a clip differs. `hook_text` is
the one field that must be written per clip (each clip's hook line is unique). This keeps
the file terse even with many clips. Same pattern used consistently across the design.

---

## 4. Ingestion & transcription

- **Ingest** (`stages/ingest.py`): `yt-dlp` pulls the source video + metadata into the
  job's working directory.
- **Transcription** (`transcribe/`): provider-swappable behind a `Transcriber` interface
  returning a standard `words[]` shape with **word-level timestamps and speaker labels**.
  Default implementation is a **hosted API** (cost is cents per source-hour; far better
  than grinding CPU). If the chosen API does not return word-level timestamps, run cheap
  base transcription via API and do the lightweight alignment step locally.

**Locked rationale (word-level is mandatory, not optional).** Word-level timing is
required twice downstream: (a) the "viral style" caption highlight of the currently
spoken word (§6), and (b) the auto "snap to sentence boundary" review suggestion (§7).
Sentence-level timing makes both impossible. This is why transcription provider choice
is a foundational decision, not a detail.

**Transcription scope is mode-driven.** Auto mode requests full-source transcription up
front. Manual mode requests transcription of clipped spans only, lazily, after candidates
exist, and skips it entirely if captions are off. The runner decides this from
`needs_full_transcription` — stages do not hardcode it.

---

## 5. Cutting & vertical reframe (`stages/cut.py`)

### 5.1 Cutting — precision is mandatory

ffmpeg can cut two ways:

- **Stream copy** — fast, no re-encode, but cuts snap to keyframes: clip start can freeze
  briefly or be off by 1–2 seconds.
- **Re-encode** — slower, but the cut lands exactly on the requested second, clean, no
  freeze.

**Locked decision: always re-encode. Never stream-copy for clip cuts.** At this volume,
speed is irrelevant (background job). A 2-second drift or a frozen first frame instantly
reads as amateur. Do not let a future optimization pass swap this to stream copy.

### 5.2 Vertical reframe (16:9 → 9:16)

Never stretch (squished faces). Never default to letterbox bars (lazy look). Crop so the
relevant person stays visible.

Multi-tier build. **Each tier must be proven before the next; a later tier is a layer on
top of the earlier, never a replacement — so the system can always fall back.**

1. **Tier 1 (Iteration 1, DONE): fixed center crop.** Crop a 9:16 window centered, set
   once. Proven. Known limitation (by design): blind to who is on screen — with 2+ people
   the speaker can fall outside the crop. This is the expected trigger to move to Tier 2,
   not a bug.

2. **Tier 2a (Iteration 2, build first): multi-face "fit all", NO speaker guessing.**
   Detect all faces in a segment (every 5–10 frames; CPU-friendly). One face → crop to
   it (Tier 1 behavior, refined). Two+ faces → choose the 9:16 crop that **contains all
   faces** if they fit; if they cannot fit in 9:16, fall to a stacked top/bottom
   split-screen. This does NOT guess who is speaking — it only guarantees everyone is
   visible. It already resolves the concrete complaint ("speaker not visible") in most
   cases, because if all faces are in frame the speaker necessarily is too. Must run and
   be proven before Tier 2b.

3. **Tier 2b (Iteration 2, build on top of proven 2a): active speaker detection.**
   Add lip-motion-to-audio matching to determine the active speaker per time segment;
   the crop moves smoothly to follow the active speaker, and split-screen is used ONLY
   when two people genuinely speak in rapid alternation in the same window. Built as a
   layer above 2a so a 2b failure always falls back to 2a's reliable "show everyone"
   behavior. This is a quality upgrade (more dynamic, pro-tool feel), NOT a bug fix —
   2a already fixes the bug.

**Locked rationale (smoothing is the hard part).** A crop that snaps directly to raw
position jitters and is nauseating. The reframe is "detect → collect positions over the
clip → smooth into a camera path → crop along the path," not "detect → crop." Most DIY
tools fail here.

**Locked rationale (speaker decision is per-segment, not per-frame).** In Tier 2b the
active-speaker choice must hold for a minimum of several seconds before it may switch,
even if instantaneous detection wobbles. Switching the crop per frame produces violent
person-to-person jumps — far worse than the §5.2 jitter problem. The crop must "stick"
to one person, then transition smoothly. This is the single biggest cause of
cheap-looking DIY clips.

**Locked rationale (split-screen is explicit, not the confusion fallback).** Split is
permitted ONLY when two people genuinely alternate speaking within the same tight window.
Uncertainty must NOT trigger split (that yields a flickering split). When unsure, the
safe behavior is to stay on the last clearly-speaking person, never to split.

**Locked rationale (best accuracy on this CPU costs large processing time).** Accurate
active-speaker detection relies on lip-motion/audio matching, which is inherently heavy
and ecosystem-built for GPU. On the no-NVIDIA machine (ledger #5), Tier 2b can mean a
60s clip taking very long to process — acceptable only because volume is a few
clips/week and processing is background/unattended. This cost is accepted deliberately;
do not "optimize" Tier 2b by silently dropping to a less accurate method without surfacing
the choice.

---

## 6. Captions — "viral style" (`stages/caption.py`)

Target style (content-agnostic; works for podcast, education, comedy alike):

1. Only 1–3 words on screen at once, changing fast with speech.
2. The currently spoken word is highlighted (distinct color or colored box).
3. Bold, large sans-serif; ~8–12% of screen height per glyph.
4. Thick black outline + shadow — **mandatory for legibility over any background**, not
   decoration.
5. Position centered, ~25–35% up from the bottom (the very bottom is covered by
   TikTok/Shorts UI).
6. Subtle "pop" on word appearance (assertive, not a soft fade).

**Implementation: ASS/SSA subtitles burned via ffmpeg.** ASS supports rich styling
(color, outline, bold, per-word highlight via timing tricks) and is far lighter on CPU
than per-frame image rendering. Start with ASS. Only consider per-frame rendering if a
future animation genuinely cannot be done in ASS.

**Locked rationale (CPU reality).** Burning captions re-encodes the video and is the
slowest stage on a GPU-less machine. At this volume that is acceptable, but it is an
additional reason to prefer lightweight ASS over per-frame rendering.

Caption style is defined as **named presets** in `config.py`. The user does not edit
individual properties; they pick one whole preset. A preset is the default for all clips
and can be overridden **per clip at review time** (Tier A — preset selection only, NOT a
free-form editor).

```yaml
caption_presets:
  default: bold_yellow          # which preset applies if a clip specifies none

  bold_yellow:
    words_on_screen: 3
    font_file: "assets/fonts/Montserrat-Bold.ttf"   # BUNDLED file, not a system name
    font_size_pct: 9
    color_normal: "#FFFFFF"
    color_active: "#FFE000"
    outline_color: "#000000"
    outline_width: 6
    shadow: true
    position_from_bottom_pct: 30
    pop_animation: true

  clean_white:
    words_on_screen: 2
    font_file: "assets/fonts/Inter-Bold.ttf"
    font_size_pct: 8
    color_normal: "#FFFFFF"
    color_active: "#FFFFFF"
    outline_color: "#000000"
    outline_width: 4
    shadow: true
    position_from_bottom_pct: 28
    pop_animation: false
```

`Candidate` gains an optional `caption_preset: string|null` (null → use the default).
Hook presets follow the same structure (`hook_presets` block + optional
`hook_preset` on `Candidate`).

**Locked rationale (presets, not a free-form editor).** Per-clip style is preset
*selection*, not per-property editing. A full visual editor (drag text, live preview) is
a separate project the size of the rest of the app and is explicitly out of scope —
building it would violate the "prove the loop first" principle for speculative gain on a
single-user tool. Tier A gives ~80% of the value at ~10% of the cost. If preset
selection later proves insufficient, per-property editing (Tier B) is a clear additive
step — but do not start there.

**Locked rationale (fonts are bundled files, not system names).** ffmpeg/ASS can only
render a font whose file actually exists in the environment. A preset naming a font that
is not installed does NOT error loudly — ffmpeg silently substitutes an ugly default and
the mistake is only caught by eyeballing the output. Therefore every preset references a
font **file bundled in the project** (`assets/fonts/*.ttf|otf`), never a system font
name. Consequence: each font offered in a preset must have its file committed to the
project. This guarantees identical output wherever the app runs and eliminates the
silent-substitution bug.

**Locked rationale (style override changes §earlier global assumption).** Caption style
was originally specified as a single global value. Allowing per-clip preset override
changes that: style is now "global default preset + optional per-clip preset". This is a
deliberate amended decision, not a free addition. The per-clip selected preset is part
of the `Candidate` object so it survives into the assembly/publish stages. Regenerating
after a preset change re-runs ONLY `caption.py`/`hook.py` for that clip (not
ingest/transcribe) — this is cheap precisely because of the §2 modular design.

---

## 7. Hook opener (`stages/hook.py`)

The hook is a short **2–4 second opener segment** prepended to the main clip. It is two
layers: a **background** (default: blurred frames from the clip itself; optional: an
external asset) and **overlay text** (`hook_text`) centered and large.

Pipeline order: `cut.py` → **`hook.py`** → `caption.py` → review → publish.

Background options:

- **`blur_self` (default):** take a few seconds / a still frame from the main clip, blur
  heavily, place text over it. No external asset needed — works automatically for every
  clip. This is the default behavior.
- **External asset (per-clip override):** a branding intro clip or image, supplied via
  `hook_background`. Built last within Iteration 2 (needs asset-file handling).

Three locked technical requirements for `hook.py`:

1. **The hook segment must match the main clip's spec exactly** (same 9:16 resolution,
   framerate, codec). `hook.py` therefore runs *after* the main clip is already vertical,
   so it can mirror the spec. Mismatched specs cause concat errors or a visible jump.
2. **Text legibility is guaranteed, not optional.** Add a thin semi-dark layer between
   background and text, or white text with a strong outline/shadow. Unreadable hook text
   = failed hook.
3. **The hook→main-clip join must be seamless.** Identical specs (req. 1) are what
   prevent a freeze/glitch at the join — same principle as the precise-cut decision.

**Locked rationale (auto-mode seam).** In manual mode `hook_text` is user-written. In
auto mode the LLM writes `hook_text` while selecting the clip. The schema already
anticipates this; no rework needed when auto mode is added.

---

## 8. Review + boundary refinement (`dashboard/`)

This is the **most valuable feature in manual mode**. User-estimated timestamps almost
always drift at the edges; the worst tell is a clip ending mid-sentence. This stage
closes that gap.

Two cooperating layers:

- **Layer 1 — auto "snap to sentence boundary" suggestion.** Using word-level timestamps
  (already available from transcription), detect when `start`/`end` falls mid-word and
  compute the nearest sentence boundary as `suggested_start`/`suggested_end`. **Present
  it as a suggestion, never auto-apply** — the user may be cutting mid-sentence
  deliberately (cliffhanger).
- **Layer 2 — manual ± nudge.** In the review UI, shift start/end forward/back by a few
  seconds and regenerate. Handles taste ("intro too long, trim 2s"), not just sentence
  boundaries.

Data flow: clip built with initial `start`/`end` → check boundaries against word
timestamps → review UI shows preview + suggestion + nudge control → user accepts /
accepts-suggestion / nudges → if boundaries change, **only cut → caption re-run for that
clip** (not ingest/transcribe). This cheap re-run is a direct payoff of the §2 modular
design.

`review_strictness` (from §3.2) drives UI behavior:

- `preview_only` (manual): preview + boundary suggestion + nudge. No keep/reject.
- `full` (auto): the above **plus** keep/reject of machine-chosen candidates.

**Locked rationale (review is core, not polish).** Caption/hook/tracking are polish and
are deferred. Review is part of proving the end-to-end loop (cut → *review* → publish)
and ships in Iteration 1 — but in Iteration 1 only Layer 2 (manual nudge), because
Layer 1 depends on transcription, which arrives in Iteration 2. One transcription, two
payoffs: captions and boundary suggestions.

---

## 8c. Dashboard surfaces & daily-use flow

The dashboard is **only a place to inspect and approve** — not a control center. Most
configuration lives in the YAML input and `config.py`. The dashboard grows per iteration;
specified below per iteration.

### Daily-use flow (manual mode)

1. User watches the source video elsewhere, notes timestamps.
2. User writes the YAML spec (§3.3).
3. User submits the YAML to the app (upload field or watched folder) and clicks Process.
4. App works headless in the background (download → cut → reframe). User does not wait.
5. User opens the dashboard at `localhost`.
6. User reviews each finished clip (preview; nudge boundaries if needed; regenerate).
7. User approves the good clips.
8. User triggers upload of approved clips to YouTube.

The user only "works" at steps 1–2 and 6–8. Step 4 (the heavy part) is unattended.

### Surfaces — Iteration 1 (minimal)

- **Job list.** Landing page: batches with status (downloading / cutting / ready for
  review / done-uploaded), plus the YAML submission entry point.
- **Clip review page.** Per clip: vertical video preview (playable in-browser), title +
  duration + start–end, **Layer 2 manual nudge** control + regenerate, Approve/Reject.
  A single "Upload approved" button per batch triggers publish.

No caption-style controls, no hook preview (neither exists in Iteration 1).

### Surfaces — added in Iteration 2

- Preview now shows the **fully styled** clip (captions + hook), not the raw cut.
- **Layer 1 auto sentence-boundary suggestion** appears beside the manual nudge
  ("shift end 13:49 → 13:51 to avoid cutting a sentence"; accept/reject).
- **Per-clip preset selection** (Tier A): a caption-preset dropdown and a hook-preset
  dropdown on each clip; changing one re-runs only `caption.py`/`hook.py` for that clip.
- **History page** (see below).

### Surfaces — Iteration 3 (when auto mode exists)

- For auto-origin batches, `review_strictness="full"`: the review page additionally
  shows keep/reject of machine-chosen candidates (not just boundary refinement). This is
  exactly why `review_strictness` (§3.2) was reserved early — one review page serves both
  modes at different strictness, read from one property.

### Surfaces — Iteration 4 (when ranked compilation exists)

- A way to set `Candidate.rank` (e.g. drag-to-order #5…#1) before ranked assembly runs.

### History page (Iteration 2)

**No new data is stored** — every job is already a job record in SQLite (§2). The history
page is purely a read view over existing job records.

- List of all clips ever produced, newest first.
- Per clip: thumbnail/preview, title, source video, date, status
  (uploaded / rejected / built-not-uploaded).
- Filterable by source video and by status.

**Locked rationale (history is a read, not a feature).** History adds no storage and no
upstream change; it only renders job records that already exist. Its real value is
preventing accidental re-clipping of the same moment from the same source — a genuine
problem when regularly processing the same creators. It does not gate the core loop, so
it is Iteration 2, not Iteration 1.

---

## 8b. Assembly — the extensibility seam (`assembly/`)

The assembly step runs **after** candidates are cut, hooked, and captioned. It decides
how the finished, styled segments become deliverable output(s). It is swappable behind
an `Assembler` interface, exactly like `Transcriber` / `CandidateSource` / scoring
signals.

- **`assembly/individual.py` (default, built first).** Each styled candidate becomes its
  own standalone video. This is the normal clipping behavior and the only assembler in
  the initial build. What the pipeline did implicitly before now has an explicit name.
- **`assembly/ranked.py` (future extension, NOT initial scope).** All styled candidates,
  ordered by `Candidate.rank`, stitched into ONE video with inter-segment number cards
  (e.g. "#5 … #1"). Plugs into the same point `individual.py` occupies; touches nothing
  upstream.

**Locked rationale (why a seam, not a rewrite).** A ranked compilation and normal
clipping share everything up to and including styled segments — same ingest, same
transcription, same convergence contract, same cut/hook/caption. They diverge only at
final render (N separate files vs. 1 stitched file). Isolating that divergence to one
swappable module means the extension is additive, like auto mode. Do **not** attempt to
generalize beyond this (arbitrary output types) up front — that over-abstraction would
slow the initial build for speculative gain. Add concrete assemblers when concretely
needed.

**Locked rationale (which stages are assembler-aware).** Only `runner.py` selects the
assembler and only `assembly/*` differs. `cut.py`, `hook.py`, `caption.py` produce the
same styled segments regardless of assembler — they must not branch on output type.
Number cards in ranked mode are the assembler's concern, not the caption/hook stages'.

---

## 9. Build order (do not reorder)

**Iteration 1 — prove the loop works.**
- `jobs.py`, `runner.py`, `config.py` skeleton
- `stages/ingest.py`
- `candidates/manual.py` + the YAML schema (§3.3)
- `stages/cut.py` with **precise re-encode** + **Tier 1 fixed center crop**
- `assembly/individual.py` (the only assembler in initial scope)
- `dashboard/` as a **local FastAPI web app** + preview + **Layer 2 manual nudge only**
- `stages/publish.py` (manual trigger acceptable here) — NOTE: this was the
  Iteration-1 build; refactored to `delivery/local.py` in Iteration 2.7
- Goal: a real clip goes in as a timestamp and comes out delivered. No captions, no hook,
  no tracking yet.

**Iteration 2 — make it look professional.**

> **Execute as ORDERED STEPS, one at a time, each tested before the next.** "Iteration 2"
> is a label for a sequence, NOT a single batch request. Asking an agent to "do
> Iteration 2" all at once stacks four heavy components on a foundation only proven on a
> narrow path (1 face, center crop) — if output is wrong you cannot tell which component
> failed. The "prove the simple thing before stacking the next" discipline that carried
> Iteration 1 cleanly applies *within* Iteration 2, not only between iterations.

- **Step 2.1 — Transcription alone.** Wire `transcribe/` (API impl). Verify word-level
  timing + speaker labels are correct on test clips. Build NO captions yet. Rationale:
  captions and Review Layer 1 both depend on this; if transcription drifts, both fail and
  you will wrongly blame captions. Prove transcription clean in isolation first.
- **Step 2.2 — Caption (ASS)** on top of proven transcription. Named presets + bundled
  fonts. Verify on one clip: words appear, active word highlights, legible over
  light/dark backgrounds.
- **Step 2.3 — Hook** (`blur_self` first; external-asset override last).
- **Step 2.4 — Reframe Tier 2a only** (multi-face "fit all"). Prove "everyone always
  visible" on a 2-person clip and a many-person clip. Do NOT touch Tier 2b yet.
- **Step 2.5 — Reframe Tier 2b** (active speaker detection) layered on proven 2a.
  Hardest component in the app — never stack it before 2a is solid.
- **Step 2.6 — Review Layer 1** (auto sentence-boundary suggestion; reuses 2.1
  transcription).
- **Step 2.7 — Dashboard additions** (per-clip preset dropdowns, styled preview,
  History page). Last because lightest and lowest-risk.

**Locked rationale (test each step before the next).** When using an AI agent to
execute, supply this plan as context and request **only the current step**. Never
request "Iteration 2". Test the step's output before requesting the next — the same
discipline applied when Iteration 1 was tested before proceeding.

**Iteration 2.5 — refinements after first real use.**

> Added after Iteration 2 shipped and was used in production for real clips. These are
> not in the original plan — they are concrete improvements identified from actual use.
> Same execution discipline as Iteration 2: ordered steps, one at a time, each tested
> before the next. Build in this order — earliest steps are lowest risk and unblock
> nothing downstream, so failures there don't poison later steps.

- **Step 2.5.1 — Visual uplift + dark mode (executed together).** A frontend-only
  pass that does TWO things in one step: (a) port the layout/UX direction from the
  Claude-Design mockups already generated during Iteration 2 (sidebar with worker +
  disk status, consistent status pills, inline mini progress bars on running jobs,
  per-date grouped history grid with 9:16 cards, filter chips, near-duplicate
  warning, clearer typographic hierarchy), and (b) apply a dark VSCode-like palette
  (deep charcoal background, muted accents) on top of the new layout. Touches no
  backend, no pipeline. Done first because it is isolated, immediately improves
  daily comfort, and the new layout is where every subsequent Iteration-2.5 feature
  attaches. **When porting, do not port blindly** — the existing mockups were
  generated before Iteration 2.5 was scoped, so they do not anticipate the new
  preset variety, transcript edit, hook upload, form input, or channel overlay.
  Make space in the layout for these as you port: e.g. the clip review page needs
  room for a richer preset gallery and an inline transcript editor; the job-submit
  entry point becomes a form view, not just a file picker.

  **How the mockup files are used (CRITICAL — read carefully).** The mockup
  `.jsx` files (`job-list.jsx`, `clip-review.jsx`, `history.jsx`) are **visual
  design references, NOT code to be pasted into the project**. They were generated
  by Claude Design in a sandbox with helpers (`T` palette, `Icon` library,
  `StatusPill`, `VideoPreview`, `MiniTile`, CSS classes like `row-btn`) that do
  not exist in the production codebase. They also contain hardcoded mock data
  (`CLIPS`, `HISTORY`) with no real backend wiring. Pasting them as-is will not
  work and is not the goal.

  Correct usage: keep them in a non-build directory (e.g. `/design-references/`)
  or attach them only as input to the implementing agent. The agent must:
  (1) read them as guidance for layout, hierarchy, component structure, and
  spacing; (2) re-implement the equivalents using the project's actual UI
  library/component patterns; (3) preserve all existing data-fetching, state
  management, and event handlers from the current production frontend — the
  mockups have none of these and the production code is the source of truth for
  logic; (4) leave explicit room in the clip review page for three components
  arriving in later 2.5 steps: inline transcript editor (2.5.6), hook video
  upload selector (2.5.5), and channel logo + name overlay on the video preview
  (2.5.3). After 2.5.1 ships, the reference files can be archived or deleted —
  this plan document is the only durable source of truth.
- **Step 2.5.2 — Expand caption & hook preset library.** Pure additions to
  `caption_presets` and `hook_presets` in `config.py`. Critically, presets must include
  **structural variants** beyond color (e.g. captions with **box-highlight** on the
  active word using ASS `BorderStyle=3`, not just color swaps; hook presets with
  colored backgrounds, gradient overlays, large-stroke type — not just white text).
  Aim for 4–6 caption presets and 3–4 hook presets covering distinct visual moods.
- **Step 2.5.3 — Channel branding overlay (YouTube logo + channel name).** New small
  stage (or extension of `caption.py`) that overlays a bundled YouTube logo PNG +
  channel-name text in the top-left of every clip. Logo file lives at
  `assets/logos/youtube.png` (bundled, same pattern as fonts — ledger #18). Channel
  name is a **batch-level** input field (one channel per batch), NOT per-clip. No UI
  to upload a custom logo — out of scope; YouTube logo is the only brand mark.
- **Step 2.5.4 — Form input as primary, YAML retained as option.** The dashboard's
  submit-job entry point becomes a form: source URL field, channel name field, and a
  dynamic list of clips (start, end, title, hook_text) with add/remove rows. **The
  form generates the same internal structure the YAML produces** — the pipeline does
  not care which input path was used. YAML upload remains available as a secondary
  option (better for 10+ clip batches where typing in a form is slow). Do NOT remove
  YAML.
- **Step 2.5.5 — Upload custom hook video (Background B finalization).** This is
  finishing what §7 already specified as Background B / external asset. Both the
  input form and the per-clip detail view in the dashboard gain a hook source
  selector: "generated (blur_self)" or "upload video". Uploaded hook video stored in
  the job's working directory and referenced via the existing `hook_background`
  field. No new field on `Candidate` needed — `hook_background` was reserved exactly
  for this.
- **Step 2.5.6 — Transcript correction (one-to-one word replacement only).** The
  clip review page gains an editable transcript view. **Edits are strictly one-to-one
  word replacement** (fixing typos / wrong-word recognitions). Adding or removing
  words is NOT supported, because that would invalidate the
  one-word-one-timing-slot assumption and break caption sync. UI must enforce this:
  each word is its own editable cell, no free-form text area that allows
  inserting/deleting words. The corrected transcript is stored as a **user-edited
  version SEPARATE from the original machine transcript** (both retained in the job
  record). `caption.py` reads the user-edited version; Layer 1 boundary suggestion
  can read either, but the original is the source of truth for re-running anything
  that depends on raw machine output. Regenerate after edit re-runs ONLY
  `caption.py` for that clip — cheap, per ledger #1.

**Locked rationale (Iteration 2.5 ordering).** Steps 2.5.1–2.5.3 are pure additions
with no architectural impact and ship first to deliver immediate value. Step 2.5.4
changes the input UX but not the internal structure (form → same shape as YAML →
unchanged pipeline). Step 2.5.5 completes a feature already designed in §7. Step
2.5.6 is last because it is the only step that changes the data model (transcript
gains an edited version distinct from the original); doing it last means everything
before it remains stable while this is added.

**Locked rationale (visual uplift and dark mode are one step, not two).** Splitting
them would mean porting the new layout twice (once to a neutral palette, once again
to dark). The mockups exist; the palette change is mechanical on top of the new
layout. Doing both in one pass is the efficient path for a solo builder. The earlier
instinct to split (build layout first, palette second) is conservative practice for
larger teams; it is overkill here.

**Locked rationale (transcript edit is one-to-one only).** AssemblyAI returns
`[word, start_ms, end_ms]`. Replacing a word in place keeps the timing slot intact
and caption sync remains valid. Adding/removing words breaks the slot count and
desyncs caption highlighting. Restricting to one-to-one is not a limitation to lift
later — it is a deliberate scope that preserves caption quality. If richer edits are
ever needed, the right answer is to re-run AssemblyAI for that span, not to fake
timings.

**Locked rationale (machine transcript retained alongside edits).** User edits must
win over machine output for rendering (re-transcribing would overwrite user
corrections). But the original machine transcript must remain stored, so
re-running anything dependent on raw machine output (boundary suggestion, future
features) does not lose ground truth. Transcript is now a two-version document, not
a single mutable field.

**Iteration 2.6 — Visual polish.**

> Added after Iteration 2.5 shipped and was used in production. These are NOT new
> structural features — they are quality tuning of the final clip's visual output,
> attaching to existing components (`hook.py`, `caption.py`, `config.py`). Same
> execution discipline as before: ordered steps, one at a time, each tested. Named
> "2.6" not "3" because it is a polish layer over 2.5, not a structural new mode.
> (Iteration 3 remains skipped — see below.)

- **Step 2.6.1 — TikTok-style hook presets (3 new presets).** Add three new
  `hook_presets` entries to `config.py` characterized by: text positioned in the
  **lower half** of the frame (not center-dominant); bold all-caps; a single
  **highlighted keyword or phrase** per line (bright color background or colored
  text — green-neon, yellow, red); strong outline for legibility over any
  background. Variation across the three presets is by **font choice + highlight
  color + box-vs-no-box** (one preset uses a white box behind text as an
  alternative to per-word highlight). The renderer is extended to support
  lower-half positioning and per-word/per-phrase highlight (ASS supports both via
  per-line styling). No architecture change — the preset system was designed for
  this since ledger #32. Reference: the user's TikTok-screenshot example
  (lower-half text, bright-green keyword highlight, video visible above).

  **Highlight mechanism — inline `[...]` syntax in `hook_text`.** What gets
  highlighted is editorial judgment, so the user marks it directly in the text.
  Words or phrases wrapped in square brackets render with the preset's highlight
  treatment (color, box, etc); everything outside brackets renders as the
  preset's normal text style. Examples:

  ```yaml
  hook_text: "TIKTOKERS FOLLOWERS [20JT] JALAN DI MALL [GAK ADA YANG MINTA FOTO]"
  hook_text: "PERCAYA [NGGAK]?"
  hook_text: "BIASA AJA, NGGAK ADA YANG SPESIAL"   # zero highlights = valid
  ```

  Rules: any number of `[...]` segments allowed (no cap); brackets may contain a
  single word or a multi-word phrase; hook text with zero brackets renders as
  plain styled text (valid case — not every hook needs highlight). The renderer
  strips the bracket characters before rendering; they exist only as markers in
  source text. Bracket characters themselves never appear in the rendered output.

- **Step 2.6.2 — Reverse 2.5.5 + image background + max-duration field.**
  THREE related sub-changes to hook handling, all in `hook.py`:
  (a) **Reverse the 2.5.5 user-modification** in which uploaded hook video
  suppressed generated text. Now: uploaded video/image is ALWAYS used as
  background only; hook text is ALWAYS generated using the chosen preset (2.6.1
  presets or `blur_self`-paired presets). Behavior is uniform regardless of
  background source — no more "if uploaded then skip text" branch.
  (b) **Add image-file support** alongside video. The hook renderer now has three
  background paths: `blur_self` (default, frames from the main clip blurred);
  uploaded video (clipped to hook duration); uploaded image (displayed static for
  hook duration). Detection by file extension. No new `Candidate` field — the
  existing `hook_background` field accepts any of the three.
  (c) **Add `hook_duration` field at batch level** in `config.py` and the input
  form, plus optional per-clip `hook_duration` override on `Candidate`. When the
  uploaded asset is a video longer than `hook_duration`, it is trimmed to fit.
  When shorter, behavior is to loop the asset OR freeze the last frame — pick
  one and document it as the locked behavior (recommendation: freeze last frame;
  looping short video can look glitchy at the seam).

- **Step 2.6.3 — Hook→content transition.** Add a transition layer in `hook.py`
  between the hook segment and the main clip. Strictly **2–3 transition options
  only** (e.g. `cut` (no transition, default), `fade` (0.25s cross-fade), and
  `slide_up` (hook slides off the top while main clip enters from bottom,
  ~0.3s)). Transition choice is a field on the hook preset (`transition: fade`),
  not a free parameter on every clip. Duration is fixed per transition type, not
  user-tunable. The pre-2.6 hard requirement from §7 (hook and main clip have
  identical spec) still applies — transitions ride on top of that, they do not
  replace it.

- **Step 2.6.4 — Channel watermark.** New overlay step (extend `caption.py` or
  add a tiny `watermark.py` — implementer's choice based on code organization).
  Renders a small text watermark at the bottom-center of the frame, dark-gray
  color, small font, **starting at `hook_duration` and continuing until end of
  clip** (not visible during the hook segment). For now, the watermark text is
  the string `"Daily Clip"` stored as a config value (`watermark_text` in
  `config.py`), not a per-batch input field. Hardcoded-as-config because the user
  currently has one channel; if multi-channel support is ever needed, the config
  value is trivially promoted to a batch-level input — but not before that need
  is real.

**Locked rationale (Iteration 2.6 ordering).** 2.6.1 first because it produces
the most visible quality jump and gives a concrete reference for subsequent steps.
2.6.2 second because it unifies hook behavior (uniform code path is cleaner than
branching). 2.6.3 third because transition design benefits from already having
finalized hook visuals. 2.6.4 last because it is the simplest and blocks nothing.

**Locked rationale (highlight syntax is inline `[...]`, not a separate field).**
Marking the highlight inline keeps the highlighted text *literally identical* to
the text in the hook line — impossible to desync. A separate `hook_highlight`
field would require the user to keep two strings in sync; any mismatch (typo,
case, punctuation) silently fails (no highlight rendered, no error). Inline
syntax also requires no extra typing decision: while writing the hook, the user
just wraps the word they're already typing. The choice of `[...]` over `*...*`
or `(...)` is because square brackets rarely appear naturally in Indonesian or
English hook text and have no Markdown-emphasis collision.

**Locked rationale (no cap on highlight count).** The earlier instinct to cap at
2 highlights per hook was protection against users diluting visual focus by
highlighting everything. That protection is unnecessary here: the tool is
single-user (the user IS the editor and exercises judgment), and the review page
gives an immediate visual feedback loop — if a hook looks too busy, the user
edits the brackets and regenerates. Imposing a cap would also force renderer
logic ("take first 2, log warning for rest") that is pure complexity for no
real-world payoff. Trust the user; remove the limit.

**Locked rationale (reversing 2.5.5).** The 2.5.5 user-modification (uploaded hook
video → suppress generated text) was a reasonable judgment at the time: it assumed
the uploaded video would self-contain its own text. Real use showed this loses the
ability to restyle text via presets (presets only apply to generated text). The
reversal restores preset coverage to all hook variants, which is the more useful
default given the rich 2.6.1 preset library. The user-modification is not "wrong"
— it is replaced by a better-informed decision after seeing the system in use.
This kind of revision based on real usage is the intended development pattern, not
an exception to it.

**Locked rationale (transition library kept tiny).** DIY clip tools most often look
amateur precisely because they offer 20+ flashy transitions (zoom, rotate, swipe,
flash, glitch). Two or three subtle transitions are enough and look more
professional. Resist requests to add more — the constraint is the point. If a
specific transition is ever needed beyond the three, add it deliberately to the
preset library, do not expose a generic "transition picker" to users.

**Locked rationale (watermark hardcoded-as-config, not input field).** With one
channel, a per-batch input field would be friction without value. Storing as a
config value gives the same flexibility for the user (one place to change it) with
none of the UI clutter. Promoting to an input field is a one-line change when
multi-channel actually exists — premature flexibility is not free.

**Iteration 2.7 — Delivery refactor (publish → delivery seam).**

> Added after the user realized their actual workflow uploads to multiple social
> platforms (not only YouTube), and they need the finished clip available for
> manual upload from devices other than the laptop. The existing `publish.py`
> (YouTube Data API) is replaced by a swappable `delivery/` seam — same pattern
> as `Transcriber`, `CandidateSource`, `Assembler`, and scoring signals. Two
> implementations are built; YouTube auto-publish is retired (was never the
> actual delivery target in practice).

> **Terminology note.** Earlier sections of this document (§1, §2, §8, build
> order, ledger) still mention `publish` / `publish.py` / `uploaded` in their
> original Iteration-1 wording. Those references are preserved as historical
> context — they describe the system as it was when those decisions were made.
> From Iteration 2.7 forward, the current vocabulary is `delivery` / `delivered`
> (with per-deliverer suffixes like `delivered_local`, `delivered_gdrive`). When
> reading the document, treat any `publish` reference outside of §2.7 as
> historical; the active stage name is `delivery`.

- **Step 2.7.1 — Refactor `publish.py` into `delivery/` seam with `local.py`
  only.** Create `delivery/base.py` defining a `Deliverer` interface
  (`.deliver(clip_file, job) -> status`). Create `delivery/local.py` that copies
  the finished clip file from the job working directory to a user-configured
  output folder (e.g. `~/clipper-output/`). Folder path lives in `config.py`.
  Remove `stages/publish.py` and remove the YouTube Data API dependency entirely
  — it is not used. Update the runner to call `delivery/` instead of `publish`.
  Update history status vocabulary: `uploaded` → `delivered` (and consider a
  per-deliverer suffix like `delivered_local`, future-proof for `delivered_gdrive`).
  The dashboard "Upload approved" button becomes "Deliver approved." Build and
  test this alone first — the seam must work end-to-end with the simplest
  possible deliverer before adding any cloud target.

- **Step 2.7.2 — Add `delivery/gdrive.py` for multi-device access.** Implement a
  Google Drive deliverer using **rclone** as the transport layer
  (`rclone copy <clip_file> gdrive:<folder>`). The user installs and configures
  rclone once outside the app (`rclone config`); the app shells out to rclone
  commands. Configuration in `config.py`: which rclone remote to use, which
  destination folder. Per-batch (or eventually per-clip) selector in the
  dashboard for which deliverer to use; default selectable in `config.py`.
  History gains `delivered_gdrive` status.

**Locked rationale (delivery seam, not just renaming `publish`).** The existing
`publish.py` name is wrong for the new behavior — the clip is not being
published anywhere, it is being moved to a location for the user to upload
manually. Beyond naming, the future-likely need (auto-upload to TikTok,
Instagram Reels, etc.) is a list of additional targets, each with its own auth
and upload semantics. A swappable seam is the right shape for "N delivery
targets, each independent." Same architecture pattern as the rest of the system
— consistency matters for the next person (or future-you) reading the code.

**Locked rationale (`local.py` first, not `gdrive.py` directly).** Building
`local.py` first proves the seam contract works end-to-end with the simplest
possible implementation — copy a file. If something is wrong with the
runner-to-deliverer wiring, status updates, or interface design, debug it once
in a deliverer where the only thing that can fail is `shutil.copy`. Then
`gdrive.py` only has to debug rclone-specific issues, not seam-design issues
plus rclone issues simultaneously. Same "prove the simple thing before stacking
the next" discipline that carried every prior iteration.

**Locked rationale (rclone over Google Drive API direct).** Drive API direct
integration requires Google Cloud Console setup, OAuth credentials, refresh
token handling, and periodic re-auth — significant ongoing maintenance for a
personal tool. rclone handles all of that with a one-time `rclone config`
outside the app; the app just shells out to commands. Bonus: changing
destination later (Dropbox, S3, OneDrive) is a config change in rclone, not
new code in the app. Trade: one external dependency (rclone) the user must
install. For a single-user tool this trade is correct; for a product shipped
to many users it would not be.

**Locked rationale (retire YouTube auto-publish entirely).** Keeping the
YouTube API integration "just in case" would be cargo code — currently
unused, requiring maintenance (API client, auth) for hypothetical future use.
If YouTube direct upload is ever genuinely wanted, it returns as
`delivery/youtube.py` with the same shape as other deliverers. Removing it
now is cheap; carrying it forever is not.

**Iteration 3 — SKIPPED by user decision (no LLM budget).**

> User chose not to build auto mode due to ongoing LLM API cost. This is an
> anticipated and supported outcome: §1 always marked auto mode as "only if pursued,"
> and the architecture was deliberately built so that auto mode plugs into an existing
> seam (`candidates/auto.py` + `scoring/`) without affecting any other stage. The
> manual-mode tool is fully functional and useful without it. The `scoring/` seam and
> the `CandidateSource` interface remain in place — auto mode can be added later if
> circumstances change, with no rework required of anything currently built.

(Original Iteration 3 scope for reference, in case it is ever revisited: `scoring/`
signals with `llm.py` weighted 1.0 first then heuristics tuned; `candidates/auto.py`
plugged into the convergence point; iterate weights in `config.py` against clips
judged good/bad.)

**Iteration 4 — ranked compilation (future extension, only if pursued).**
- `assembly/ranked.py`: order styled segments by `Candidate.rank`, stitch into one
  video with inter-segment number cards
- A way to populate `rank` (manual: a `rank:` key in the YAML / form; auto: LLM
  assigns it — but auto is currently skipped)
- Plugs into the existing assembly seam; touches no upstream stage

**Locked rationale (order de-risks itself).** Building the reliable deterministic half
(manual) first validates ~80% of the system — the entire shared downstream pipeline and
the convergence contract — before the unreliable detector is introduced. Building auto
first means debugging an unproven pipeline and an unreliable detector simultaneously.
Ranked assembly is last because it is a pure additive payoff of the assembly seam and
must not compete with proving the core loop.

---

## 10. Decision ledger (quick reference — all locked)

| # | Decision | Why it must not be reversed |
|---|----------|------------------------------|
| 1 | Stages are independent, job-record-driven | Cheap re-run on boundary nudge; detector iteration |
| 2 | Both modes converge to one `Candidate` shape | Downstream pipeline stays 100% mode-agnostic |
| 3 | Seconds internally; timecodes only at parse | Prevents scattered time-conversion bugs |
| 4 | Mode declares needs via 2 properties | New modes don't touch runner/downstream |
| 5 | Transcription = hosted API, word-level | No usable GPU; word timing needed for captions + boundary snap |
| 6 | Cut = precise re-encode, never stream copy | Drift/freeze reads as amateur |
| 7 | Reframe = smoothed camera path, not raw face | Raw tracking jitters; this is the hard 20% || 8 | Captions = ASS, style in config | CPU-light; tunable without code changes |
| 9 | Hook segment matches main-clip spec exactly | Seamless concat; mismatch = glitch |
| 10 | Review is Iteration 1 (Layer 2); Layer 1 in Iter 2 | Review is core not polish; Layer 1 needs transcription |
| 11 | Build manual fully before auto | Validate pipeline with the reliable half first |
| 12 | Human review gate before publish | Content ID risk on licensed content |
| 13 | Application form = local FastAPI web app | Lightest for vibe-coding/personal use; visual nudge UI needs it |
| 14 | Assembly is a swappable seam; `individual.py` only at first | Ranked compilation is additive, not a rewrite |
| 15 | `rank` field reserved in `Candidate` now | Contract not reworked when ranked assembly is added |
| 16 | cut/hook/caption never branch on output type | Keeps assembler the only output-aware module |
| 17 | Per-clip style = preset selection only (Tier A) | Full visual editor is out of scope; presets give 80% at 10% cost |
| 18 | Fonts are bundled project files, not system names | ffmpeg silently substitutes missing fonts — silent bug |
| 19 | Style is global-default-preset + per-clip override | Amended from §6 single-global; preset lives on `Candidate` |
| 20 | History is a read view over existing job records | No new storage; prevents duplicate clipping |
| 21 | Dashboard is inspect/approve only, grows per iteration | Not a control center; not built fully up front |
| 22 | Reframe Tier 2a (fit-all) before Tier 2b (speaker detect) | 2a fixes the bug; 2b is a layer on top, always falls back to 2a |
| 23 | Speaker decision per-segment, sticks several seconds | Per-frame switching = violent jumps, cheap look |
| 24 | Split-screen only on genuine alternation, never on doubt | Uncertainty → stay on last speaker, not flicker-split |
| 25 | Tier 2b accuracy on this CPU costs large process time | Accepted (low volume, background); don't silently downgrade |
| 26 | Iteration 2 executed as ordered steps, each tested | Stacking 4 heavy components blind = undiagnosable failure |
| 27 | Transcript edit is strictly word-by-word, no insert/delete | Preserves AssemblyAI's one-word-one-timing-slot; sync stays valid |
| 28 | Machine transcript and user-edited transcript both retained | User edits win for render; original preserved for re-runs |
| 29 | Form input is primary; YAML retained as secondary | Form for ergonomics, YAML for batches > 10 clips; same internal shape |
| 30 | YouTube logo is bundled, no custom-logo upload UI | One brand mark; consistent with bundled-fonts pattern (#18) |
| 31 | Channel name is batch-level, not per-clip | One channel per batch matches actual use; simplifies overlay |
| 32 | Presets must vary structure, not only color | Box-highlight via ASS `BorderStyle=3`; visually distinct moods |
| 33 | Iteration 3 (auto mode) skipped by user; seam preserved | Architecture supports skipping; auto can be added later if needed |
| 34 | Step 2.5.1 combines visual uplift + dark mode in one pass | Splitting means porting layout twice; mockups already exist |
| 35 | Mockup porting is layout-aware, not literal | Mockups predate 2.5 scope; must leave room for new features as ported |
| 36 | Design mockup `.jsx` files are reference, not code | Have sandbox helpers + mock data; production frontend remains source of truth for logic |
| 37 | Hook text always generated; uploaded asset is background only | Reverses 2.5.5; uniform code path + presets apply to all variants |
| 38 | Hook background = blur_self / video / image (3 paths) | One field `hook_background`, behavior by file type |
| 39 | Hook asset shorter than duration → freeze last frame, not loop | Looping short asset glitches at seam |
| 40 | Transition library kept to 2-3 options, fixed durations | DIY tools look amateur when offering 20+ transitions |
| 41 | Watermark hardcoded as config value, not input field | One channel = no flexibility needed yet; trivial to promote later |
| 42 | Watermark visible from `hook_duration` to end, not during hook | Hook is its own visual segment; watermark belongs to content body |
| 43 | Hook highlight uses inline `[...]` syntax in hook_text | Inline = no desync risk; literal text always matches |
| 44 | No cap on highlight count per hook | Single-user tool; review loop self-corrects; cap adds complexity for no payoff |
| 45 | `publish.py` retired; replaced by `delivery/` swappable seam | Multi-platform reality + manual upload workflow; seam matches other system patterns |
| 46 | `delivery/local.py` built before `delivery/gdrive.py` | Proves seam contract with simplest impl before adding cloud transport |
| 47 | Google Drive via rclone shell-out, not Drive API direct | Personal tool: OAuth/refresh maintenance avoided; bonus = portable to other clouds |
| 48 | YouTube Data API integration removed entirely, not kept "just in case" | Cargo code; if needed later, returns as `delivery/youtube.py` |

---

*End of plan. Build in §9 order. Treat §10 as constraints.*