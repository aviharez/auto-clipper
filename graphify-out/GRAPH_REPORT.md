# Graph Report - .  (2026-05-23)

## Corpus Check
- Corpus is ~31,472 words - fits in a single context window. You may not need a graph.

## Summary
- 377 nodes · 643 edges · 25 communities (21 shown, 4 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 32 edges (avg confidence: 0.69)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Dashboard Frontend|Dashboard Frontend]]
- [[_COMMUNITY_Project Docs & Architecture|Project Docs & Architecture]]
- [[_COMMUNITY_Assembly & Base Interfaces|Assembly & Base Interfaces]]
- [[_COMMUNITY_Delivery & API Layer|Delivery & API Layer]]
- [[_COMMUNITY_Video Reframe Engine|Video Reframe Engine]]
- [[_COMMUNITY_Hook Segment Composer|Hook Segment Composer]]
- [[_COMMUNITY_Job Store (SQLite CRUD)|Job Store (SQLite CRUD)]]
- [[_COMMUNITY_Caption Generator|Caption Generator]]
- [[_COMMUNITY_Clip Cutter & Encoder|Clip Cutter & Encoder]]
- [[_COMMUNITY_Boundary Refinement|Boundary Refinement]]
- [[_COMMUNITY_Channel Branding Overlay|Channel Branding Overlay]]
- [[_COMMUNITY_Ingest (yt-dlp)|Ingest (yt-dlp)]]
- [[_COMMUNITY_Watermark Stage|Watermark Stage]]
- [[_COMMUNITY_Assembly Rationale|Assembly Rationale]]
- [[_COMMUNITY_Candidates Rationale|Candidates Rationale]]
- [[_COMMUNITY_Delivery Rationale|Delivery Rationale]]
- [[_COMMUNITY_Transcriber Rationale|Transcriber Rationale]]

## God Nodes (most connected - your core abstractions)
1. `Clip Automation Implementation Plan` - 27 edges
2. `api()` - 21 edges
3. `renderJobDetail()` - 20 edges
4. `toast()` - 14 edges
5. `GDriveDeliverer` - 13 edges
6. `LocalDeliverer` - 13 edges
7. `plan()` - 13 edges
8. `get_conn()` - 12 edges
9. `README (Clip Automation)` - 11 edges
10. `Clip Automation Project (CLAUDE.md)` - 10 edges

## Surprising Connections (you probably didn't know these)
- `YouTube Logo PNG (assets/logos/youtube.png)` --rationale_for--> `Channel Branding Overlay (YouTube logo + channel name)`  [INFERRED]
  assets/logos/youtube.png → CLIP_AUTOMATION_PLAN.md
- `PyYAML (YAML parsing)` --conceptually_related_to--> `Input YAML Schema`  [INFERRED]
  requirements.txt → CLAUDE.md
- `Reframe Tier 2a (Multi-face Fit-All)` --references--> `mediapipe (face detection / BlazeFace)`  [INFERRED]
  CLIP_AUTOMATION_PLAN.md → requirements.txt
- `ClipFormItem` --uses--> `GDriveDeliverer`  [INFERRED]
  dashboard/main.py → clipper/delivery/gdrive.py
- `JobFormBody` --uses--> `GDriveDeliverer`  [INFERRED]
  dashboard/main.py → clipper/delivery/gdrive.py

## Hyperedges (group relationships)
- **Stage Pipeline Orchestration (runner drives stages via job record)** — claudemd_stage_pipeline, claudemd_job_record, plan_stage_independent_rerun [EXTRACTED 0.95]
- **Swappable Seam Pattern (Transcriber, CandidateSource, Assembler, Deliverer)** — plan_transcriber_interface, plan_candidate_source, plan_assembly_seam, plan_delivery_seam [EXTRACTED 0.95]
- **Reframe Tiered Fallback System (Tier1 → Tier2a → Tier2b)** — plan_reframe_tier1, plan_reframe_tier2a, plan_reframe_tier2b [EXTRACTED 0.95]

## Communities (25 total, 4 thin omitted)

### Community 0 - "Dashboard Frontend"
Cohesion: 0.06
Nodes (73): $(), acceptBsuggEnd(), acceptBsuggStart(), ACTIVE_STATES, api(), app, attachTxHandlers(), badge() (+65 more)

### Community 1 - "Project Docs & Architecture"
Cohesion: 0.07
Nodes (55): YouTube Logo PNG (assets/logos/youtube.png), ASS Subtitle File (captions.ass / hook_text.ass), Candidate Object, Clip Automation Project (CLAUDE.md), Input YAML Schema, Job File Layout (data/jobs/<job_id>/), Job Record (SQLite), ReframePlan (Tier 2a Face-Aware Crop Planner) (+47 more)

### Community 2 - "Assembly & Base Interfaces"
Cohesion: 0.06
Nodes (28): ABC, Assembler, IndividualAssembler, Each candidate becomes its own standalone video. Default assembler., Candidate, CandidateSource, ManualCandidateSource, _parse_timecode() (+20 more)

### Community 3 - "Delivery & API Layer"
Cohesion: 0.06
Nodes (17): BaseModel, BoundaryUpdate, ClipFormItem, DeliverBody, HookTextUpdate, JobFormBody, FastAPI dashboard — serves the web UI and REST API for job/candidate management., StyleUpdate (+9 more)

### Community 4 - "Video Reframe Engine"
Cohesion: 0.09
Nodes (38): _analyze_frames(), _build_shots(), center_crop_filter(), _clamp(), _cluster_cx(), _crop_size(), _detect_cuts(), _even() (+30 more)

### Community 5 - "Hook Segment Composer"
Cohesion: 0.12
Nodes (28): _build_hook_ass(), _concatenate(), _create_hook_segment(), _font_bbox_to_em(), _format_ass_time(), _format_hook_line(), _make_hook_blur_self(), _make_hook_image_bg() (+20 more)

### Community 6 - "Job Store (SQLite CRUD)"
Cohesion: 0.23
Nodes (16): create_job(), _ensure_dirs(), get_candidate(), get_candidates(), get_conn(), get_job(), init_db(), insert_candidate() (+8 more)

### Community 7 - "Caption Generator"
Cohesion: 0.31
Nodes (9): _build_ass(), _burn_captions(), _filter_path(), _format_ass_time(), Make a path relative to BASE_DIR for use in an ffmpeg -vf filter expression., Burn viral-style ASS captions into raw.mp4. Returns path to captioned.mp4., Convert #RRGGBB to ASS &H00BBGGRR& (little-endian BGR)., _rgb_to_ass() (+1 more)

### Community 8 - "Clip Cutter & Encoder"
Cohesion: 0.27
Nodes (9): _concat(), _encode_shot(), _probe_video(), cut.py — Stage: precise re-encode + 9:16 vertical reframe.  Always re-encodes (n, Precisely re-encode + reframe a clip segment. Returns path to raw.mp4., Returns (width, height, fps, has_audio)., Precisely re-encode + reframe one shot ([shot.start, shot.end])., Losslessly join shot clips (identical encode params) via the concat demuxer. (+1 more)

### Community 9 - "Boundary Refinement"
Cohesion: 0.32
Nodes (7): api_boundary_suggestion(), _fmt(), Sentence-boundary suggestion for Review Layer 1 (Step 2.6).  Reads words.json (c, True if the word text closes a sentence., Return boundary suggestions derived from words.json.      Returned dict may cont, _sentence_end(), suggest()

### Community 10 - "Channel Branding Overlay"
Cohesion: 0.36
Nodes (7): _apply_branding(), _escape_drawtext(), _filter_path(), Branding overlay stage — burns a YouTube logo + channel name into the top-left, Overlay YouTube logo + channel name. Returns branded.mp4 path or None., Escape special characters for ffmpeg drawtext filter., run()

### Community 11 - "Ingest (yt-dlp)"
Cohesion: 0.43
Nodes (6): _ffmpeg_merge(), _find_source_files(), Return (video_path, audio_path) of any yt-dlp intermediate files., Download source video + metadata. Returns updated job fields., run(), _yt_dlp_download()

### Community 12 - "Watermark Stage"
Cohesion: 0.43
Nodes (6): _apply_watermark(), _escape_drawtext(), _filter_path(), Watermark stage — burns a small bottom-center text watermark onto the finished c, Burn bottom-center watermark. Returns watermarked.mp4 path or None., run()

## Knowledge Gaps
- **17 isolated node(s):** `app`, `ACTIVE_STATES`, `_formClips`, `_formHookFiles`, `_bsugg` (+12 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Deliverer` connect `Assembly & Base Interfaces` to `Delivery & API Layer`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Why does `LocalDeliverer` connect `Delivery & API Layer` to `Assembly & Base Interfaces`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Why does `GDriveDeliverer` connect `Delivery & API Layer` to `Assembly & Base Interfaces`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `Clip Automation Implementation Plan` (e.g. with `Clip Automation Project (CLAUDE.md)` and `Hook B-Roll Data Field (hook_broll_start / hook_broll_end)`) actually correct?**
  _`Clip Automation Implementation Plan` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `GDriveDeliverer` (e.g. with `ClipFormItem` and `JobFormBody`) actually correct?**
  _`GDriveDeliverer` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Add columns that were introduced after the initial schema without dropping data.`, `Background runner — picks up pending jobs and advances them stage by stage. Run`, `Cut + assemble one candidate. Shared by main pipeline and recut requests.` to the rest of the system?**
  _86 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Dashboard Frontend` be split into smaller, more focused modules?**
  _Cohesion score 0.06185919343814081 - nodes in this community are weakly interconnected._