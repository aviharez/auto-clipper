import re
import shutil
import subprocess
from pathlib import Path

from clipper.config import GDRIVE_RCLONE_REMOTE, GDRIVE_DESTINATION_FOLDER
from clipper.delivery.base import Deliverer


def _safe_filename(title: str, cand_id: str) -> str:
    slug = re.sub(r"[^\w\s-]", "", title).strip()
    slug = re.sub(r"[\s]+", "_", slug)[:60]
    return f"{slug}_{cand_id[:8]}.mp4"


class GDriveDeliverer(Deliverer):
    """Uploads the finished clip to Google Drive via rclone."""

    def deliver(self, clip_file: Path, job: dict, candidate: dict) -> str:
        if shutil.which("rclone") is None:
            raise RuntimeError(
                "rclone not found on PATH. Install rclone and run 'rclone config' once to set up your Google Drive remote."
            )

        dest_name = _safe_filename(candidate.get("title", "clip"), candidate["id"])
        # rclone destination: remote:folder/filename
        dest = f"{GDRIVE_RCLONE_REMOTE}:{GDRIVE_DESTINATION_FOLDER}/{dest_name}"

        result = subprocess.run(
            ["rclone", "copyto", str(clip_file), dest, "--progress"],
            capture_output=True,
            text=True,
            timeout=600,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"rclone failed (exit {result.returncode}):\n{result.stderr.strip()}"
            )

        return "delivered_gdrive"
