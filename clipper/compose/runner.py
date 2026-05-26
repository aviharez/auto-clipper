import logging
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor

import clipper.compose.db as compose_db
from clipper.compose.stages import ingest as compose_ingest

log = logging.getLogger(__name__)

_ingest_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="compose-ingest")
_compose_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="compose-render")


def submit_ingest(comp_id: str, seg_id: str) -> None:
    """Enqueue a segment for background yt-dlp ingest."""
    _ingest_executor.submit(_run_segment_ingest, comp_id, seg_id)


def _run_segment_ingest(comp_id: str, seg_id: str) -> None:
    try:
        comp = compose_db.get_composition(comp_id)
        seg = compose_db.get_segment(seg_id)
        if not comp or not seg:
            return
        compose_ingest.run_for_segment(comp, seg)
    except Exception:
        log.error("Compose ingest error for seg %s:\n%s", seg_id, traceback.format_exc())
        try:
            compose_db.update_segment(seg_id, status="failed", download_progress=None)
        except Exception:
            pass


def _compose_loop() -> None:
    log.info("Compose render loop started")
    while True:
        try:
            from clipper.jobs import get_conn
            with get_conn() as conn:
                row = conn.execute(
                    "SELECT id, status FROM compositions "
                    "WHERE status IN ('render_queued', 'finalize_queued') "
                    "ORDER BY updated_at LIMIT 1"
                ).fetchone()
            if row:
                comp_id = row["id"]
                from clipper.compose import render as compose_render
                if row["status"] == "render_queued":
                    compose_db.update_composition(comp_id, status="rendering")
                    log.info("Compose: dispatching render for %s", comp_id)
                    _compose_executor.submit(compose_render._run_render, comp_id)
                elif row["status"] == "finalize_queued":
                    compose_db.update_composition(comp_id, status="finalizing")
                    log.info("Compose: dispatching finalize for %s", comp_id)
                    _compose_executor.submit(compose_render._run_finalize, comp_id)
        except Exception:
            log.error("Compose loop error:\n%s", traceback.format_exc())
        time.sleep(2)


def start() -> None:
    t = threading.Thread(target=_compose_loop, daemon=True, name="compose-loop")
    t.start()
    log.info("Compose runner ready (ingest pool=2, render pool=1)")
