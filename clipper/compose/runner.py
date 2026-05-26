import logging
import traceback
from concurrent.futures import ThreadPoolExecutor

import clipper.compose.db as compose_db
from clipper.compose.stages import ingest as compose_ingest

log = logging.getLogger(__name__)

_ingest_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="compose-ingest")


def submit_ingest(comp_id: str, seg_id: str):
    """Enqueue a segment for background yt-dlp ingest."""
    _ingest_executor.submit(_run_segment_ingest, comp_id, seg_id)


def _run_segment_ingest(comp_id: str, seg_id: str):
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


def start():
    log.info("Compose runner ready (executor pool size=2)")
