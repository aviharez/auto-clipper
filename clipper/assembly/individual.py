import shutil
from pathlib import Path

from clipper.assembly.base import Assembler
from clipper.config import JOBS_DIR


class IndividualAssembler(Assembler):
    """Each candidate becomes its own standalone video. Default assembler."""

    def assemble(self, candidate_id: str, job: dict, candidate: dict) -> str:
        clip_dir = JOBS_DIR / job["id"] / "clips" / candidate_id
        final = clip_dir / "final.mp4"

        for name in ("watermarked.mp4", "branded.mp4", "hooked.mp4", "captioned.mp4", "raw.mp4"):
            src = clip_dir / name
            if src.exists():
                break
        else:
            raise FileNotFoundError(f"No source clip found for candidate {candidate_id}")

        shutil.copy2(str(src), str(final))
        return str(final)
