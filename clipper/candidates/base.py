from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Literal, Optional


@dataclass
class Candidate:
    start: float
    end: float
    title: str
    source_job_id: str
    hook_text: Optional[str] = None
    hook_enabled: bool = True
    hook_background: str = "blur_self"
    needs_caption: bool = True
    caption_preset: Optional[str] = None
    hook_preset: Optional[str] = None
    rank: Optional[int] = None          # reserved for ranked compilation (§8b)
    origin: Literal["manual", "auto"] = "manual"

    @property
    def duration(self) -> float:
        return self.end - self.start


class CandidateSource(ABC):
    needs_full_transcription: bool
    review_strictness: Literal["preview_only", "full"]

    @abstractmethod
    def generate(self, job: dict) -> list[Candidate]:
        """Return candidates for a job. Timecodes already converted to seconds."""
        ...
