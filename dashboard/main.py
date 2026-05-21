"""
FastAPI dashboard — serves the web UI and REST API for job/candidate management.
"""
import json
import logging
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
from clipper.config import CAPTION_PRESETS, DEFAULT_CAPTION_PRESET, HOOK_PRESETS, DEFAULT_HOOK_PRESET, JOBS_DIR
from clipper.stages import publish as publish_stage

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
    import uuid, os
    tmp_id = str(uuid.uuid4())
    from clipper.config import JOBS_DIR, DATA_DIR
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


# ── API: History ──────────────────────────────────────────────────────────────


@app.get("/api/history")
def api_history(source_url: Optional[str] = None, status: Optional[str] = None):
    return db.list_candidates_all(source_url=source_url, status=status)


@app.get("/api/history/sources")
def api_history_sources():
    return db.list_unique_sources()


# ── API: Publish ──────────────────────────────────────────────────────────────


@app.post("/api/jobs/{job_id}/publish")
def api_publish(job_id: str):
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found")

    candidates = db.get_candidates(job_id)
    approved = [c for c in candidates if c["approved"] and c["status"] == "ready"]
    if not approved:
        raise HTTPException(400, "No approved clips ready to upload")

    results = []
    db.update_job(job_id, status="uploading")
    for c in approved:
        try:
            db.update_candidate(c["id"], status="uploading")
            url = publish_stage.run(c)
            db.update_candidate(c["id"], status="uploaded", youtube_url=url)
            results.append({"id": c["id"], "title": c["title"], "url": url})
        except Exception as e:
            db.update_candidate(c["id"], status="failed", error=str(e))
            results.append({"id": c["id"], "title": c["title"], "error": str(e)})

    all_uploaded = all("url" in r for r in results)
    db.update_job(job_id, status="done" if all_uploaded else "ready_for_review")
    return {"results": results}
