import re
import subprocess
from pathlib import Path

from clipper.compose import db as compose_db

_PCT_RE = re.compile(r'\[download\]\s+([\d.]+)%')


def run_for_segment(comp: dict, seg: dict):
    """Download a YT segment source file. Updates DB status throughout."""
    seg_id = seg["id"]
    comp_id = seg["composition_id"]
    seg_idx = seg["idx"]

    seg_dir = compose_db._comp_dir(comp_id) / "segments" / str(seg_idx)
    seg_dir.mkdir(parents=True, exist_ok=True)

    # Idempotent: skip if already ready with a source file
    if seg.get("status") == "ready":
        existing = next(seg_dir.glob("source.*"), None)
        if existing and existing.exists():
            return

    compose_db.update_segment(seg_id, status="downloading", download_progress=0)

    source_url = seg["source_url"]
    out_template = str(seg_dir / "source.%(ext)s")

    proc = subprocess.Popen(
        [
            "yt-dlp", "--no-playlist",
            "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            "--merge-output-format", "mp4",
            "-o", out_template,
            source_url,
        ],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    for line in proc.stdout:
        m = _PCT_RE.search(line)
        if m:
            compose_db.update_segment(seg_id, download_progress=int(float(m.group(1))))
    proc.wait()

    source_file = next(seg_dir.glob("source.*"), None)

    if proc.returncode != 0 or not source_file:
        compose_db.update_segment(seg_id, status="failed", download_progress=None)
        return

    source_duration = _probe_duration(source_file)
    compose_db.update_segment(
        seg_id,
        status="ready",
        source_file=str(source_file),
        source_duration=source_duration,
        download_progress=None,
    )


def _probe_duration(path: Path):
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
