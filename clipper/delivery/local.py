import json
import re
import shutil
from pathlib import Path

from clipper.config import DELIVERY_LOCAL_OUTPUT_DIR
from clipper.delivery.base import Deliverer


def _safe_dirname(title: str) -> str:
    slug = re.sub(r'[<>:"/\\|?*]', "", title).strip()
    slug = re.sub(r"\s+", " ", slug)[:100]
    return slug or "untitled"


def _safe_filename(title: str, cand_id: str) -> str:
    slug = re.sub(r"[^\w\s-]", "", title).strip()
    slug = re.sub(r"[\s]+", "_", slug)[:60]
    return f"{slug}_{cand_id[:8]}.mp4"


class LocalDeliverer(Deliverer):
    """Copies the finished clip to the user-configured local output folder."""

    def deliver(self, clip_file: Path, job: dict, candidate: dict) -> str:
        try:
            meta = json.loads(job.get("metadata_json") or "{}")
        except Exception:
            meta = {}
        video_title = meta.get("title") or job.get("channel_name") or "untitled"
        output_dir = DELIVERY_LOCAL_OUTPUT_DIR / _safe_dirname(video_title)
        output_dir.mkdir(parents=True, exist_ok=True)
        dest = output_dir / _safe_filename(candidate.get("title", "clip"), candidate["id"])
        shutil.copy2(str(clip_file), str(dest))
        return "delivered_local"
