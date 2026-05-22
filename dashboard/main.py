"""
FastAPI dashboard — serves the web UI and REST API for job/candidate management.
"""
import json
import logging
import shutil
import traceback
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import clipper.jobs as db
from clipper import runner
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
    return FileResponse(str(path), media_type="video/mp4")


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


@app.post("/api/candidates/{cand_id}/recaption")
def api_recaption(cand_id: str):
    candidate = db.get_candidate(cand_id)
    if not candidate:
        raise HTTPException(404, "Candidate not found")
    if candidate["status"] != "ready":
        raise HTTPException(400, f"Clip is not ready (status: {candidate['status']})")
    clip_dir = JOBS_DIR / candidate["job_id"] / "clips" / cand_id
    if not (clip_dir / "words_edited.json").exists():
        raise HTTPException(400, "No transcript edits saved — save edits first")
    runner.schedule_restyle(candidate["job_id"], cand_id, "caption")
    return {"status": "recaption_queued"}


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
