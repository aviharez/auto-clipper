"""
Background runner — picks up pending jobs and advances them stage by stage.
Runs as a daemon thread started by the dashboard on startup.
Each stage is independent; the runner calls them in sequence and writes
results back to the job record between stages.
"""
import json
import logging
import threading
import time
import traceback
from dataclasses import asdict
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import clipper.jobs as db
from clipper.assembly.individual import IndividualAssembler
from clipper.candidates.manual import ManualCandidateSource
from clipper.config import JOBS_DIR
from clipper.stages import caption, cut, hook, ingest
from clipper.transcribe.api import AssemblyAITranscriber

log = logging.getLogger(__name__)

_assembler = IndividualAssembler()
_recut_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="recut")


def _create_transcriber():
    try:
        return AssemblyAITranscriber()
    except Exception as e:
        log.warning("Transcription unavailable: %s", e)
        return None


_transcriber = _create_transcriber()


# ── Main job pipeline ────────────────────────────────────────────────────────


def _process_job(job: dict):
    job_id = job["id"]
    log.info("Starting job %s", job_id)

    try:
        # Stage 1: ingest
        db.update_job(job_id, status="downloading")
        updated = ingest.run(job)
        db.update_job(job_id, **updated)
        job = db.get_job(job_id)

        # Stage 2: parse candidates
        source = ManualCandidateSource(job["yaml_path"])
        candidates = source.generate(job)
        cand_ids = []
        for idx, c in enumerate(candidates):
            cid = db.insert_candidate(job_id, idx, {
                "start": c.start,
                "end": c.end,
                "title": c.title,
                "hook_text": c.hook_text,
                "hook_enabled": c.hook_enabled,
                "hook_background": c.hook_background,
                "needs_caption": c.needs_caption,
                "caption_preset": c.caption_preset,
                "hook_preset": c.hook_preset,
                "rank": c.rank,
                "origin": c.origin,
            })
            cand_ids.append(cid)

        # Stage 3: cut each candidate
        db.update_job(job_id, status="cutting")
        for cid in cand_ids:
            _cut_and_assemble(job, cid)

        db.update_job(job_id, status="ready_for_review")
        log.info("Job %s ready for review", job_id)

    except Exception:
        msg = traceback.format_exc()
        log.error("Job %s failed:\n%s", job_id, msg)
        db.update_job(job_id, status="failed", error=msg)


def _cut_and_assemble(job: dict, cand_id: str):
    """Cut + assemble one candidate. Shared by main pipeline and recut requests."""
    candidate = db.get_candidate(cand_id)
    if not candidate:
        raise ValueError(f"Candidate {cand_id} not found")

    try:
        db.update_candidate(cand_id, status="cutting", error=None)
        raw_path = cut.run(job, cand_id, candidate)

        if candidate["needs_caption"]:
            if _transcriber:
                db.update_candidate(cand_id, status="transcribing")
                _transcribe_candidate(cand_id, job["id"], raw_path)
                db.update_candidate(cand_id, status="captioning")
                caption.run(job, cand_id, candidate)
            else:
                log.warning(
                    "Candidate %s needs captions but transcription is unavailable — "
                    "set ASSEMBLYAI_API_KEY to enable it",
                    cand_id,
                )

        if candidate["hook_enabled"]:
            db.update_candidate(cand_id, status="creating_hook")
            hook.run(job, cand_id, candidate)

        final_path = _assembler.assemble(cand_id, job, candidate)
        db.update_candidate(cand_id, status="ready", output_path=final_path)
    except Exception:
        msg = traceback.format_exc()
        log.error("Candidate %s failed:\n%s", cand_id, msg)
        db.update_candidate(cand_id, status="failed", error=msg)
        raise


# ── Transcription ────────────────────────────────────────────────────────────


def _transcribe_candidate(cand_id: str, job_id: str, raw_path: str):
    """Transcribe the cut clip and write words.json into the candidate directory."""
    # raw_path is the cut clip (start=0, full duration) — timestamps are clip-relative.
    words = _transcriber.transcribe(raw_path)
    words_path = JOBS_DIR / job_id / "clips" / cand_id / "words.json"
    words_path.write_text(
        json.dumps([asdict(w) for w in words], indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    log.info("Saved %d words to %s", len(words), words_path)


# ── Re-cut (triggered from dashboard) ────────────────────────────────────────


def schedule_recut(job_id: str, cand_id: str, new_start: float, new_end: float):
    """Update boundaries and re-run cut+assembly for one candidate in the background."""
    db.update_candidate(cand_id, start=new_start, end=new_end, status="cutting", error=None)
    job = db.get_job(job_id)
    _recut_executor.submit(_cut_and_assemble, job, cand_id)


# ── Background runner loop ────────────────────────────────────────────────────


def _runner_loop():
    while True:
        try:
            jobs = db.list_jobs()
            for job in jobs:
                if job["status"] == "pending":
                    _process_job(job)
        except Exception:
            log.error("Runner loop error:\n%s", traceback.format_exc())
        time.sleep(2)


def start():
    db.init_db()
    t = threading.Thread(target=_runner_loop, daemon=True, name="clipper-runner")
    t.start()
    log.info("Clipper runner started")
