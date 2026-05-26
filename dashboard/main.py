"""
FastAPI dashboard — serves the web UI and REST API for job/candidate management.
"""
import json
import logging
import shutil
import traceback
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import clipper.jobs as db
from clipper import runner
import clipper.compose.runner as compose_runner
from clipper.config import (
    CAPTION_PRESETS, DEFAULT_CAPTION_PRESET,
    HOOK_PRESETS, DEFAULT_HOOK_PRESET,
    JOBS_DIR, DATA_DIR,
    DEFAULT_DELIVERER,
)
from clipper.delivery.local import LocalDeliverer
from clipper.delivery.gdrive import GDriveDeliverer

_DELIVERERS = {
    "local": LocalDeliverer(),
    "gdrive": GDriveDeliverer(),
}

log = logging.getLogger(__name__)

app = FastAPI(title="Clip Automation")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_static_dir = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(_static_dir)), name="static")


@app.on_event("startup")
def on_startup():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    runner.start()


# ── HTML pages ───────────────────────────────────────────────────────────────


@app.get("/")
def root():
    return RedirectResponse("/static/index.html")


# ── Video streaming ───────────────────────────────────────────────────────────


@app.get("/video/{cand_id}")
def serve_video(cand_id: str):
    candidate = db.get_candidate(cand_id)
    if not candidate or not candidate.get("output_path"):
        raise HTTPException(404, "Video not available yet")
    path = Path(candidate["output_path"])
    if not path.exists():
        raise HTTPException(404, "Video file not found on disk")
    return FileResponse(str(path), media_type="video/mp4", headers={"Cache-Control": "no-cache"})


# ── API: Jobs ─────────────────────────────────────────────────────────────────


@app.get("/api/jobs")
def api_list_jobs():
    jobs = db.list_jobs()
    for job in jobs:
        candidates = db.get_candidates(job["id"])
        job["clip_count"] = len(candidates)
        job["approved_count"] = sum(1 for c in candidates if c["approved"])
    return jobs


_ACCEPTED_BG_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".mov", ".avi", ".mkv", ".webm"}


class ClipFormItem(BaseModel):
    start: str
    end: str
    title: str
    hook_text: Optional[str] = None
    hook_enabled: Optional[bool] = None
    needs_caption: Optional[bool] = None
    caption_preset: Optional[str] = None
    hook_preset: Optional[str] = None
    hook_duration: Optional[float] = None
    hook_broll_start: Optional[str] = None  # timecode string; parsed by ManualCandidateSource
    hook_broll_end: Optional[str] = None


class JobFormBody(BaseModel):
    source_url: str
    channel_name: Optional[str] = None
    default_captions: bool = True
    hook_enabled: bool = True
    hook_duration: float = 3
    default_caption_preset: Optional[str] = None
    default_hook_preset: Optional[str] = None
    clips: list[ClipFormItem]


@app.post("/api/jobs/from-form")
async def api_create_job_from_form(body: JobFormBody):
    import yaml as yaml_lib
    import uuid

    if not body.clips:
        raise HTTPException(400, "At least one clip is required")

    if body.default_caption_preset and body.default_caption_preset not in CAPTION_PRESETS:
        raise HTTPException(400, f"Unknown caption preset: {body.default_caption_preset!r}")
    if body.default_hook_preset and body.default_hook_preset not in HOOK_PRESETS:
        raise HTTPException(400, f"Unknown hook preset: {body.default_hook_preset!r}")

    spec: dict = {
        "source": body.source_url,
        "default_captions": body.default_captions,
        "hook": {
            "enabled": body.hook_enabled,
            "duration": body.hook_duration,
            "background": "blur_self",
        },
    }
    if body.channel_name:
        spec["channel_name"] = body.channel_name

    clips = []
    for clip in body.clips:
        c: dict = {"start": clip.start, "end": clip.end, "title": clip.title}
        if clip.hook_text:
            c["hook_text"] = clip.hook_text
        if clip.hook_enabled is not None and clip.hook_enabled != body.hook_enabled:
            c["hook"] = clip.hook_enabled
        if clip.needs_caption is not None and clip.needs_caption != body.default_captions:
            c["needs_caption"] = clip.needs_caption
        # Per-clip preset wins; fall back to batch default if set.
        caption_preset = clip.caption_preset or body.default_caption_preset
        if caption_preset:
            c["caption_preset"] = caption_preset
        hook_preset = clip.hook_preset or body.default_hook_preset
        if hook_preset:
            c["hook_preset"] = hook_preset
        if clip.hook_duration is not None:
            c["hook_duration"] = clip.hook_duration
        if clip.hook_broll_start:
            c["hook_broll_start"] = clip.hook_broll_start
        if clip.hook_broll_end:
            c["hook_broll_end"] = clip.hook_broll_end
        clips.append(c)
    spec["clips"] = clips

    yaml_bytes = yaml_lib.dump(spec, allow_unicode=True, sort_keys=False).encode("utf-8")

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp_id = str(uuid.uuid4())
    tmp_yaml = DATA_DIR / f"tmp_{tmp_id}.yaml"
    tmp_yaml.write_bytes(yaml_bytes)

    job_id = db.create_job(body.source_url, str(tmp_yaml), channel_name=body.channel_name or None)
    final_yaml = JOBS_DIR / job_id / "input.yaml"
    tmp_yaml.rename(final_yaml)
    db.update_job(job_id, yaml_path=str(final_yaml))

    return {"job_id": job_id}


@app.post("/api/jobs")
async def api_create_job(yaml_file: UploadFile = File(...)):
    import yaml as yaml_lib

    content = await yaml_file.read()
    try:
        spec = yaml_lib.safe_load(content)
    except Exception as e:
        raise HTTPException(400, f"Invalid YAML: {e}")

    source_url = spec.get("source")
    if not source_url:
        raise HTTPException(400, "YAML must contain a 'source' key with the YouTube URL")

    channel_name = (spec.get("channel_name") or "").strip() or None

    # Save the YAML to a temp location; will be moved after job_id is known
    import uuid
    tmp_id = str(uuid.uuid4())
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp_yaml = DATA_DIR / f"tmp_{tmp_id}.yaml"
    tmp_yaml.write_bytes(content)

    job_id = db.create_job(source_url, str(tmp_yaml), channel_name=channel_name)

    # Move YAML into the job directory
    final_yaml = JOBS_DIR / job_id / "input.yaml"
    tmp_yaml.rename(final_yaml)
    db.update_job(job_id, yaml_path=str(final_yaml))

    return {"job_id": job_id}


@app.get("/api/jobs/{job_id}")
def api_get_job(job_id: str):
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    job["candidates"] = db.get_candidates(job_id)
    return job


@app.post("/api/jobs/{job_id}/retry")
def api_retry_job(job_id: str):
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job["status"] not in ("failed",):
        raise HTTPException(400, f"Job is in '{job['status']}' state — only failed jobs can be retried")
    db.update_job(job_id, status="pending", error=None)
    return {"status": "pending"}


# ── API: Candidates ───────────────────────────────────────────────────────────


class BoundaryUpdate(BaseModel):
    start: float
    end: float


@app.put("/api/candidates/{cand_id}/boundaries")
def api_update_boundaries(cand_id: str, body: BoundaryUpdate):
    candidate = db.get_candidate(cand_id)
    if not candidate:
        raise HTTPException(404, "Candidate not found")
    if body.start >= body.end:
        raise HTTPException(400, "start must be less than end")
    runner.schedule_recut(candidate["job_id"], cand_id, body.start, body.end)
    return {"status": "recut_queued", "start": body.start, "end": body.end}


@app.post("/api/candidates/{cand_id}/approve")
def api_approve(cand_id: str):
    candidate = db.get_candidate(cand_id)
    if not candidate:
        raise HTTPException(404, "Candidate not found")
    db.update_candidate(cand_id, approved=1)
    return {"approved": True}


@app.post("/api/candidates/{cand_id}/reject")
def api_reject(cand_id: str):
    candidate = db.get_candidate(cand_id)
    if not candidate:
        raise HTTPException(404, "Candidate not found")
    db.update_candidate(cand_id, approved=0)
    return {"approved": False}


@app.get("/api/candidates/{cand_id}")
def api_get_candidate(cand_id: str):
    candidate = db.get_candidate(cand_id)
    if not candidate:
        raise HTTPException(404, "Candidate not found")
    return candidate


@app.get("/api/candidates/{cand_id}/boundary-suggestion")
def api_boundary_suggestion(cand_id: str):
    candidate = db.get_candidate(cand_id)
    if not candidate:
        raise HTTPException(404, "Candidate not found")
    from clipper.stages.boundary import suggest
    return suggest(cand_id, candidate, JOBS_DIR)


class StyleUpdate(BaseModel):
    caption_preset: Optional[str] = None
    hook_preset: Optional[str] = None


class HookTextUpdate(BaseModel):
    hook_text: str


@app.put("/api/candidates/{cand_id}/hook-text")
def api_update_hook_text(cand_id: str, body: HookTextUpdate):
    candidate = db.get_candidate(cand_id)
    if not candidate:
        raise HTTPException(404, "Candidate not found")
    db.update_candidate(cand_id, hook_text=body.hook_text.strip())
    return {"ok": True}


@app.put("/api/candidates/{cand_id}/style")
def api_update_style(cand_id: str, body: StyleUpdate):
    candidate = db.get_candidate(cand_id)
    if not candidate:
        raise HTTPException(404, "Candidate not found")

    updates = {}
    changed_stage = None

    if body.caption_preset is not None:
        if body.caption_preset not in CAPTION_PRESETS:
            raise HTTPException(400, f"Unknown caption preset: {body.caption_preset!r}")
        updates["caption_preset"] = body.caption_preset
        changed_stage = "caption"

    if body.hook_preset is not None:
        if body.hook_preset not in HOOK_PRESETS:
            raise HTTPException(400, f"Unknown hook preset: {body.hook_preset!r}")
        updates["hook_preset"] = body.hook_preset
        if changed_stage is None:
            changed_stage = "hook"
        # if caption also changed, "caption" stage already re-runs hook

    if updates:
        db.update_candidate(cand_id, **updates)

    return {"status": "updated", **updates}


@app.post("/api/candidates/{cand_id}/hook-video")
async def api_upload_hook_video(cand_id: str, file: UploadFile = File(...)):
    candidate = db.get_candidate(cand_id)
    if not candidate:
        raise HTTPException(404, "Candidate not found")

    original_ext = Path(file.filename or "").suffix.lower() or ".mp4"
    if original_ext not in _ACCEPTED_BG_EXTS:
        raise HTTPException(400, f"Unsupported file type: {original_ext!r}. Use jpg/png/gif/webp or mp4/mov/etc.")

    clip_dir = JOBS_DIR / candidate["job_id"] / "clips" / cand_id
    for old in clip_dir.glob("hook_background.*"):
        old.unlink()
    dest = clip_dir / f"hook_background{original_ext}"
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    db.update_candidate(cand_id, hook_background="external")
    return {"ok": True}


@app.delete("/api/candidates/{cand_id}/hook-video")
def api_remove_hook_video(cand_id: str):
    candidate = db.get_candidate(cand_id)
    if not candidate:
        raise HTTPException(404, "Candidate not found")
    clip_dir = JOBS_DIR / candidate["job_id"] / "clips" / cand_id
    dest = clip_dir / "hook_background.mp4"
    if dest.exists():
        dest.unlink()
    db.update_candidate(cand_id, hook_background="blur_self")
    return {"ok": True}


@app.post("/api/jobs/{job_id}/hook-videos/{clip_index}")
async def api_stage_hook_video(job_id: str, clip_index: int, file: UploadFile = File(...)):
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    original_ext = Path(file.filename or "").suffix.lower() or ".mp4"
    if original_ext not in _ACCEPTED_BG_EXTS:
        raise HTTPException(400, f"Unsupported file type: {original_ext!r}. Use jpg/png/gif/webp or mp4/mov/etc.")

    staged_dir = JOBS_DIR / job_id / "staged_hooks"
    staged_dir.mkdir(exist_ok=True)
    for old in staged_dir.glob(f"{clip_index}.*"):
        old.unlink()
    dest = staged_dir / f"{clip_index}{original_ext}"
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"ok": True}


@app.get("/api/candidates/{cand_id}/transcript")
def api_get_transcript(cand_id: str):
    candidate = db.get_candidate(cand_id)
    if not candidate:
        raise HTTPException(404, "Candidate not found")
    clip_dir = JOBS_DIR / candidate["job_id"] / "clips" / cand_id
    edited_path = clip_dir / "words_edited.json"
    words_path  = clip_dir / "words.json"
    if edited_path.exists():
        return {"words": json.loads(edited_path.read_text(encoding="utf-8")), "has_edits": True}
    elif words_path.exists():
        return {"words": json.loads(words_path.read_text(encoding="utf-8")), "has_edits": False}
    return {"words": [], "has_edits": False}


class TranscriptWordEdit(BaseModel):
    text: str


class TranscriptUpdate(BaseModel):
    words: list[TranscriptWordEdit]


@app.put("/api/candidates/{cand_id}/transcript")
def api_update_transcript(cand_id: str, body: TranscriptUpdate):
    candidate = db.get_candidate(cand_id)
    if not candidate:
        raise HTTPException(404, "Candidate not found")
    clip_dir = JOBS_DIR / candidate["job_id"] / "clips" / cand_id
    words_path = clip_dir / "words.json"
    if not words_path.exists():
        raise HTTPException(400, "No machine transcript exists for this clip")
    original = json.loads(words_path.read_text(encoding="utf-8"))
    if len(body.words) != len(original):
        raise HTTPException(400, f"Word count mismatch: expected {len(original)}, got {len(body.words)}")
    # Preserve original timing and speaker; only update text.
    merged = [
        {**orig, "text": edit.text.strip() or orig["text"]}
        for orig, edit in zip(original, body.words)
    ]
    edited_path = clip_dir / "words_edited.json"
    edited_path.write_text(json.dumps(merged, indent=2, ensure_ascii=False), encoding="utf-8")
    return {"ok": True, "word_count": len(merged)}



@app.post("/api/candidates/{cand_id}/restyle")
def api_restyle(cand_id: str):
    candidate = db.get_candidate(cand_id)
    if not candidate:
        raise HTTPException(404, "Candidate not found")
    if candidate["status"] != "ready":
        raise HTTPException(400, f"Clip is not ready (status: {candidate['status']})")
    runner.schedule_restyle(candidate["job_id"], cand_id, "caption")
    return {"status": "restyle_queued"}


# ── API: Presets ──────────────────────────────────────────────────────────────


@app.get("/api/presets")
def api_get_presets():
    return {
        "caption": {
            name: {
                "label": name.replace("_", " ").title(),
                "is_default": name == DEFAULT_CAPTION_PRESET,
            }
            for name in CAPTION_PRESETS
        },
        "hook": {
            name: {
                "label": name.replace("_", " ").title(),
                "is_default": name == DEFAULT_HOOK_PRESET,
            }
            for name in HOOK_PRESETS
        },
    }


# ── API: System ──────────────────────────────────────────────────────────────


@app.get("/api/system")
def api_system():
    usage = shutil.disk_usage("C:/")
    return {
        "disk_free_gb": round(usage.free / (1024 ** 3), 1),
        "disk_total_gb": round(usage.total / (1024 ** 3), 1),
    }


# ── API: History ──────────────────────────────────────────────────────────────


@app.get("/api/history")
def api_history(source_url: Optional[str] = None, status: Optional[str] = None):
    return db.list_candidates_all(source_url=source_url, status=status)


@app.get("/api/history/sources")
def api_history_sources():
    return db.list_unique_sources()


# ── API: Deliverers ───────────────────────────────────────────────────────────


@app.get("/api/deliverers")
def api_list_deliverers():
    return {
        "deliverers": [
            {"id": "local",  "label": "Local folder"},
            {"id": "gdrive", "label": "Google Drive (rclone)"},
        ],
        "default": DEFAULT_DELIVERER,
    }


# ── API: Deliver ──────────────────────────────────────────────────────────────


class DeliverBody(BaseModel):
    deliverer: Optional[str] = None  # null → use DEFAULT_DELIVERER


@app.post("/api/jobs/{job_id}/deliver")
def api_deliver(job_id: str, body: DeliverBody = DeliverBody()):
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    deliverer_id = body.deliverer or DEFAULT_DELIVERER
    deliverer = _DELIVERERS.get(deliverer_id)
    if not deliverer:
        raise HTTPException(400, f"Unknown deliverer: {deliverer_id!r}. Choose 'local' or 'gdrive'.")

    candidates = db.get_candidates(job_id)
    approved = [c for c in candidates if c["approved"] and c["status"] == "ready"]
    if not approved:
        raise HTTPException(400, "No approved clips ready to deliver")

    results = []
    db.update_job(job_id, status="delivering")
    for c in approved:
        try:
            db.update_candidate(c["id"], status="delivering")
            clip_path = Path(c["output_path"])
            status = deliverer.deliver(clip_path, job, c)
            db.update_candidate(c["id"], status=status, delivery_url=str(clip_path))
            results.append({"id": c["id"], "title": c["title"], "status": status})
        except Exception as e:
            db.update_candidate(c["id"], status="failed", error=str(e))
            results.append({"id": c["id"], "title": c["title"], "error": str(e)})

    all_delivered = all("error" not in r for r in results)
    db.update_job(job_id, status="done" if all_delivered else "ready_for_review")
    return {"results": results}


# ── API: Compose ──────────────────────────────────────────────────────────────

import clipper.compose.db as compose_db


class ComposeCreateBody(BaseModel):
    title: Optional[str] = None


@app.get("/api/compositions")
def api_list_compositions():
    return compose_db.list_compositions()


@app.post("/api/compositions")
def api_create_composition(body: ComposeCreateBody = ComposeCreateBody()):
    comp_id = compose_db.create_composition(body.title or "Untitled draft")
    return {"id": comp_id}


@app.get("/api/compositions/{comp_id}")
def api_get_composition(comp_id: str):
    comp = compose_db.get_composition(comp_id)
    if not comp:
        raise HTTPException(404, "Composition not found")
    comp["segments"] = compose_db.get_segments(comp_id)
    comp["voice_ranges"] = compose_db.get_voice_ranges(comp_id)
    comp["sfx"] = compose_db.get_sfx(comp_id)
    return comp


class ComposePatchBody(BaseModel):
    title: Optional[str] = None
    niche: Optional[str] = None
    target_sec: Optional[float] = None
    hook_text: Optional[str] = None
    hook_animation: Optional[str] = None
    voiceover_source: Optional[str] = None
    voiceover_kokoro_voice: Optional[str] = None
    voiceover_kokoro_text: Optional[str] = None
    captions_mode: Optional[str] = None
    captions_text: Optional[str] = None
    caption_preset: Optional[str] = None
    bed_music_file: Optional[str] = None
    bed_music_gain_db: Optional[float] = None
    bed_music_duck: Optional[int] = None
    watermark_text: Optional[str] = None


@app.patch("/api/compositions/{comp_id}")
def api_patch_composition(comp_id: str, body: ComposePatchBody):
    comp = compose_db.get_composition(comp_id)
    if not comp:
        raise HTTPException(404, "Composition not found")
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if fields:
        compose_db.update_composition(comp_id, **fields)
    return {"ok": True}


@app.delete("/api/compositions/{comp_id}")
def api_delete_composition(comp_id: str):
    comp = compose_db.get_composition(comp_id)
    if not comp:
        raise HTTPException(404, "Composition not found")
    compose_db.delete_composition(comp_id)
    return {"ok": True}


class SegmentCreateBody(BaseModel):
    kind: str
    source_url: Optional[str] = None
    label: Optional[str] = None


@app.post("/api/compositions/{comp_id}/segments")
def api_create_segment(comp_id: str, body: SegmentCreateBody):
    comp = compose_db.get_composition(comp_id)
    if not comp:
        raise HTTPException(404, "Composition not found")
    result = compose_db.create_segment(comp_id, body.kind, body.source_url, body.label)
    if body.kind == "yt" and body.source_url:
        # submit_ingest will set status='downloading' itself before starting yt-dlp.
        # Do NOT set it here — the ingest thread reads a fresh copy on entry, so
        # pre-setting 'downloading' would trigger the race-fix wait loop and stall the download.
        compose_runner.submit_ingest(comp_id, result["id"])
    return result


@app.post("/api/compositions/{comp_id}/segments/upload")
async def api_upload_segment(
    comp_id: str,
    kind: str = Form(...),
    file: UploadFile = File(...),
):
    comp = compose_db.get_composition(comp_id)
    if not comp:
        raise HTTPException(404, "Composition not found")
    result = compose_db.create_segment(comp_id, kind, label=file.filename)
    seg_idx = result["idx"]
    seg_dir = compose_db._comp_dir(comp_id) / "segments" / str(seg_idx)
    seg_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename).suffix or ".mp4"
    dest = seg_dir / f"source{suffix}"
    content = await file.read()
    dest.write_bytes(content)
    from clipper.compose.stages.ingest import _probe_duration
    source_duration = _probe_duration(dest)
    compose_db.update_segment(
        result["id"],
        source_file=str(dest),
        status="ready",
        source_duration=source_duration,
    )
    return result


class SegmentPatchBody(BaseModel):
    label: Optional[str] = None
    trim_in: Optional[float] = None
    trim_out: Optional[float] = None
    duration: Optional[float] = None
    motion: Optional[str] = None
    transition_to_next: Optional[str] = None
    transition_dur_ms: Optional[int] = None
    transition_sfx_file: Optional[str] = None


@app.patch("/api/segments/{seg_id}")
def api_patch_segment(seg_id: str, body: SegmentPatchBody):
    seg = compose_db.get_segment(seg_id)
    if not seg:
        raise HTTPException(404, "Segment not found")
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    src_dur = seg.get("source_duration")
    if src_dur is not None:
        if "trim_out" in fields and fields["trim_out"] > src_dur:
            fields["trim_out"] = src_dur
        if "trim_in" in fields and fields["trim_in"] > src_dur:
            fields["trim_in"] = src_dur
    if "trim_in" in fields and fields["trim_in"] < 0:
        fields["trim_in"] = 0.0
    if "trim_out" in fields and fields["trim_out"] < 0:
        fields["trim_out"] = 0.0
    if fields:
        compose_db.update_segment(seg_id, **fields)
    return {"ok": True}


@app.delete("/api/segments/{seg_id}")
def api_delete_segment(seg_id: str):
    seg = compose_db.get_segment(seg_id)
    if not seg:
        raise HTTPException(404, "Segment not found")
    compose_db.delete_segment(seg_id)
    return {"ok": True}


class SegmentOrderBody(BaseModel):
    order: list


@app.put("/api/compositions/{comp_id}/segments/order")
def api_reorder_segments(comp_id: str, body: SegmentOrderBody):
    comp = compose_db.get_composition(comp_id)
    if not comp:
        raise HTTPException(404, "Composition not found")
    compose_db.reorder_segments(comp_id, body.order)
    return {"ok": True}


class SFXCreateBody(BaseModel):
    at_sec: float
    file: str
    gain_db: Optional[float] = -6.0


@app.post("/api/compositions/{comp_id}/sfx")
def api_create_sfx(comp_id: str, body: SFXCreateBody):
    comp = compose_db.get_composition(comp_id)
    if not comp:
        raise HTTPException(404, "Composition not found")
    sfx_id = compose_db.create_sfx(comp_id, body.at_sec, body.file, body.gain_db)
    return {"id": sfx_id}


class SFXPatchBody(BaseModel):
    at_sec: Optional[float] = None
    file: Optional[str] = None
    gain_db: Optional[float] = None


@app.patch("/api/sfx/{sfx_id}")
def api_patch_sfx(sfx_id: str, body: SFXPatchBody):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if fields:
        compose_db.update_sfx(sfx_id, **fields)
    return {"ok": True}


@app.delete("/api/sfx/{sfx_id}")
def api_delete_sfx(sfx_id: str):
    compose_db.delete_sfx(sfx_id)
    return {"ok": True}


@app.get("/api/sfx-library")
def api_sfx_library():
    sfx_dir = Path(__file__).parent.parent / "assets" / "sfx"
    if not sfx_dir.exists():
        return []
    items = []
    for f in sorted(sfx_dir.iterdir()):
        if f.suffix.lower() in (".wav", ".mp3", ".ogg"):
            items.append({"name": f.stem, "path": str(f), "duration_sec": None})
    return items


@app.get("/api/music-library")
def api_music_library():
    music_dir = Path(__file__).parent.parent / "assets" / "music"
    if not music_dir.exists():
        return []
    items = []
    for f in sorted(music_dir.iterdir()):
        if f.suffix.lower() in (".wav", ".mp3", ".ogg"):
            items.append({"name": f.stem, "path": str(f), "duration_sec": None})
    return items


@app.get("/api/kokoro-voices")
def api_kokoro_voices():
    return [
        {"id": "af_bella",   "label": "Bella (F)"},
        {"id": "af_nicole",  "label": "Nicole (F)"},
        {"id": "am_michael", "label": "Michael (M)"},
        {"id": "am_adam",    "label": "Adam (M)"},
    ]


@app.post("/api/compositions/{comp_id}/voiceover/upload")
async def api_voiceover_upload(comp_id: str, file: UploadFile = File(...)):
    comp = compose_db.get_composition(comp_id)
    if not comp:
        raise HTTPException(404, "Composition not found")
    suffix = Path(file.filename or "audio.wav").suffix.lower()
    if suffix not in {".wav", ".mp3", ".m4a"}:
        raise HTTPException(400, f"Unsupported format {suffix!r}; use WAV, MP3, or M4A")
    comp_dir = Path("data") / "compositions" / comp_id
    comp_dir.mkdir(parents=True, exist_ok=True)
    tmp_path = comp_dir / f"voiceover_in{suffix}"
    tmp_path.write_bytes(await file.read())
    out_path = comp_dir / "voiceover.wav"
    import subprocess as _sp
    r = _sp.run(
        ["ffmpeg", "-y", "-i", str(tmp_path), "-ar", "48000", "-ac", "2", str(out_path)],
        capture_output=True,
    )
    tmp_path.unlink(missing_ok=True)
    if r.returncode != 0:
        raise HTTPException(500, f"ffmpeg resample failed: {r.stderr.decode()[-500:]}")
    from clipper.compose.stages.ingest import _probe_duration
    duration = _probe_duration(out_path) or 0.0
    compose_db.update_composition(comp_id, voiceover_source="upload")
    return {
        "ok": True,
        "duration_sec": duration,
        "peaks_url": f"/api/compositions/{comp_id}/voiceover/peaks",
    }


@app.post("/api/compositions/{comp_id}/voiceover/kokoro")
def api_voiceover_kokoro(comp_id: str):
    comp = compose_db.get_composition(comp_id)
    if not comp:
        raise HTTPException(404, "Composition not found")
    text = (comp.get("captions_text") or "").strip()
    if not text:
        raise HTTPException(400, "No script text — add text in the Captions panel before generating voiceover")
    voice_id = comp.get("voiceover_kokoro_voice") or "af_bella"
    comp_dir = Path("data") / "compositions" / comp_id
    comp_dir.mkdir(parents=True, exist_ok=True)
    out_path = str(comp_dir / "voiceover.wav")
    try:
        from clipper.compose.stages import kokoro as kokoro_stage
        duration = kokoro_stage.generate(text, voice_id, out_path)
    except Exception as exc:
        log.error("Kokoro TTS failed: %s", exc)
        raise HTTPException(500, f"TTS generation failed: {exc}")
    compose_db.update_composition(comp_id, voiceover_source="kokoro", voiceover_kokoro_text=text)
    return {
        "ok": True,
        "duration_sec": duration,
        "peaks_url": f"/api/compositions/{comp_id}/voiceover/peaks",
    }


@app.post("/api/compositions/{comp_id}/render")
def api_render_composition(comp_id: str):
    comp = compose_db.get_composition(comp_id)
    if not comp:
        raise HTTPException(404, "Composition not found")
    segments = compose_db.get_segments(comp_id)
    active = [s for s in segments if s.get("status") != "failed"]
    if not active:
        raise HTTPException(400, "No valid segments to render (add at least one segment)")
    compose_db.update_composition(comp_id, status="render_queued")
    return {"status": "render_queued"}


@app.get("/compositions/{comp_id}/render")
def serve_composition_render(comp_id: str):
    comp = compose_db.get_composition(comp_id)
    if not comp or not comp.get("last_render_path"):
        raise HTTPException(404, "No render available yet")
    path = Path(comp["last_render_path"])
    if not path.exists():
        raise HTTPException(404, "Render file not found on disk")
    return FileResponse(str(path), media_type="video/mp4", headers={"Cache-Control": "no-cache"})


@app.get("/api/compositions/{comp_id}/voiceover/peaks")
def api_voiceover_peaks(comp_id: str):
    comp = compose_db.get_composition(comp_id)
    if not comp:
        raise HTTPException(404, "Composition not found")
    vo_path = Path("data") / "compositions" / comp_id / "voiceover.wav"
    if not vo_path.exists():
        return {"peaks": [], "duration_sec": 0}
    try:
        import librosa, numpy as np
        y, sr = librosa.load(str(vo_path), sr=None, mono=True)
        dur = float(len(y) / sr)
        n_samples = 1000
        frame_len = max(1, len(y) // n_samples)
        frames = [y[i * frame_len:(i + 1) * frame_len] for i in range(n_samples)]
        peaks = [float(np.max(np.abs(f))) if len(f) else 0.0 for f in frames]
        max_peak = max(peaks) or 1.0
        peaks = [round(p / max_peak, 4) for p in peaks]
    except Exception:
        return {"peaks": [], "duration_sec": 0}
    return {"peaks": peaks, "duration_sec": round(dur, 3)}


@app.post("/api/compositions/{comp_id}/voice-ranges/auto")
def api_voice_ranges_auto(comp_id: str):
    comp = compose_db.get_composition(comp_id)
    if not comp:
        raise HTTPException(404, "Composition not found")
    vo_path = Path("data") / "compositions" / comp_id / "voiceover.wav"
    if not vo_path.exists():
        raise HTTPException(400, "No voiceover — upload or generate one first")
    try:
        import librosa, numpy as np
        y, sr = librosa.load(str(vo_path), sr=None, mono=True)
        intervals = librosa.effects.split(y, top_db=30)
    except Exception as exc:
        raise HTTPException(500, f"librosa error: {exc}")
    segs = compose_db.get_segments(comp_id)
    n_segs = max(len(segs), 1)
    # Merge close intervals and assign to segments
    merged: list[tuple[float, float]] = []
    for start_sample, end_sample in intervals:
        s = float(start_sample) / sr
        e = float(end_sample) / sr
        if merged and s - merged[-1][1] < 0.15:
            merged[-1] = (merged[-1][0], e)
        else:
            merged.append((s, e))
    # Build one range per segment (split merged regions evenly across segments)
    ranges = []
    for i, (s, e) in enumerate(merged[:n_segs]):
        seg_idx = segs[i]["idx"] if i < len(segs) else i
        ranges.append({"segment_idx": seg_idx, "start_sec": round(s, 3), "end_sec": round(e, 3)})
    compose_db.replace_voice_ranges(comp_id, ranges)
    return {"ranges": compose_db.get_voice_ranges(comp_id)}


@app.put("/api/compositions/{comp_id}/voice-ranges")
def api_voice_ranges_put(comp_id: str, body: dict):
    comp = compose_db.get_composition(comp_id)
    if not comp:
        raise HTTPException(404, "Composition not found")
    ranges = body.get("ranges", [])
    compose_db.replace_voice_ranges(comp_id, ranges)
    return {"ok": True}


@app.get("/api/compositions/{comp_id}/voice-ranges/snap")
def api_voice_range_snap(comp_id: str, range_id: str, side: str):
    """Snap start_sec or end_sec of a range to the nearest silence boundary within ±0.5s."""
    comp = compose_db.get_composition(comp_id)
    if not comp:
        raise HTTPException(404, "Composition not found")
    ranges = compose_db.get_voice_ranges(comp_id)
    target = next((r for r in ranges if r["id"] == range_id), None)
    if not target:
        raise HTTPException(404, "Range not found")
    vo_path = Path("data") / "compositions" / comp_id / "voiceover.wav"
    if not vo_path.exists():
        raise HTTPException(400, "No voiceover on disk")
    current_t = target["start_sec"] if side == "start" else target["end_sec"]
    try:
        import librosa, numpy as np
        y, sr = librosa.load(str(vo_path), sr=None, mono=True)
        intervals = librosa.effects.split(y, top_db=30)
        # Collect all silence boundaries
        boundaries = []
        for s, e in intervals:
            boundaries.extend([float(s) / sr, float(e) / sr])
        if not boundaries:
            return {"snapped": current_t}
        closest = min(boundaries, key=lambda b: abs(b - current_t))
        snapped = closest if abs(closest - current_t) <= 0.5 else current_t
    except Exception:
        snapped = current_t
    # Persist the snapped value
    updated = {k: v for k, v in target.items()}
    if side == "start":
        updated["start_sec"] = round(snapped, 3)
    else:
        updated["end_sec"] = round(snapped, 3)
    new_ranges = [updated if r["id"] == range_id else r for r in ranges]
    compose_db.replace_voice_ranges(comp_id, new_ranges)
    return {"snapped": round(snapped, 3), "ranges": compose_db.get_voice_ranges(comp_id)}


@app.get("/compositions/{comp_id}/thumb/{n}")
def serve_composition_thumb(comp_id: str, n: int):
    comp = compose_db.get_composition(comp_id)
    if not comp:
        raise HTTPException(404, "Composition not found")
    thumb_path = Path("data") / "compositions" / comp_id / "thumbs" / f"{n}.jpg"
    if not thumb_path.exists():
        raise HTTPException(404, "Thumbnail not found")
    return FileResponse(str(thumb_path), media_type="image/jpeg",
                        headers={"Cache-Control": "public, max-age=3600"})
