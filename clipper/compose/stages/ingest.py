import re
import subprocess
import time
from pathlib import Path

from clipper.compose import db as compose_db

_PCT_RE = re.compile(r'\[download\]\s+([\d.]+)%')


def run_for_segment(comp: dict, seg: dict) -> None:
    """Ingest a segment's source file. Idempotent; handles yt/local/image kinds.

    IMPORTANT: do NOT pre-set status='downloading' in the API handler before calling
    submit_ingest. This function reads a fresh copy of the segment and sets
    'downloading' itself. Pre-setting it in the API would trigger the race-fix
    wait loop and stall the download.
    """
    seg_id = seg["id"]
    comp_id = seg["composition_id"]
    seg_idx = seg["idx"]

    seg_dir = compose_db._comp_dir(comp_id) / "segments" / str(seg_idx)
    seg_dir.mkdir(parents=True, exist_ok=True)

    # Already done — nothing to do
    if seg.get("status") in ("ready", "normalized"):
        return
    if seg.get("status") == "failed":
        return

    # Race fix: another executor thread already started this download.
    # We can tell because status='downloading' was set by a peer thread
    # (this function always sets it itself before the Popen call).
    # Wait up to 180s for the peer to finish rather than clobbering its output.
    if seg.get("status") == "downloading":
        deadline = time.time() + 180
        while time.time() < deadline:
            time.sleep(1)
            fresh = compose_db.get_segment(seg_id)
            if fresh is None:
                return
            if fresh.get("status") in ("ready", "normalized", "failed"):
                return
            if fresh.get("status") != "downloading":
                break
        return

    # local / image: source already written by the upload endpoint; just probe duration
    if seg.get("kind") in ("local", "image"):
        src = _find_source(seg, seg_dir)
        if src:
            source_duration = _probe_duration(src)
            compose_db.update_segment(
                seg_id,
                status="ready",
                source_file=str(src),
                source_duration=source_duration,
                download_progress=None,
            )
        return

    # yt: download via yt-dlp with progress reporting
    # Set 'downloading' HERE so the race fix works correctly if a second thread arrives
    compose_db.update_segment(seg_id, status="downloading", download_progress=0)

    source_url = seg["source_url"]
    out_template = str(seg_dir / "source.%(ext)s")

    try:
        proc = subprocess.Popen(
            [
                "yt-dlp", "--no-playlist",
                "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                "--merge-output-format", "mp4",
                "-o", out_template,
                source_url,
            ],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,  # line-buffered for real-time progress
        )
    except FileNotFoundError:
        compose_db.update_segment(
            seg_id, status="failed", download_progress=None,
            error="yt-dlp not found — make sure yt-dlp is on PATH",
        )
        return

    last_pct = 0
    for line in proc.stdout:
        m = _PCT_RE.search(line)
        if m:
            pct = int(float(m.group(1)))
            if pct != last_pct:
                compose_db.update_segment(seg_id, download_progress=pct)
                last_pct = pct
    proc.wait()

    source_file = next(seg_dir.glob("source.*"), None)

    if proc.returncode != 0 or not source_file:
        compose_db.update_segment(
            seg_id, status="failed", download_progress=None,
            error=f"yt-dlp exited with code {proc.returncode}",
        )
        return

    source_duration = _probe_duration(source_file)
    compose_db.update_segment(
        seg_id,
        status="ready",
        source_file=str(source_file),
        source_duration=source_duration,
        download_progress=None,
    )


def _find_source(seg: dict, seg_dir: Path):
    if seg.get("source_file"):
        p = Path(seg["source_file"])
        if p.exists():
            return p
    return next(seg_dir.glob("source.*"), None)


def _probe_duration(path) -> float:
    try:
        out = subprocess.check_output(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=nw=1:nk=1",
                str(path),
            ],
            text=True, stderr=subprocess.DEVNULL,
        )
        return float(out.strip())
    except Exception:
        return None
