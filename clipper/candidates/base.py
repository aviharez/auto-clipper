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
    hook_duration: Optional[float] = None      # per-clip override; None → DEFAULT_HOOK_DURATION
    hook_broll_start: Optional[float] = None  # source-video seconds; must be within [start, end]
    hook_broll_end: Optional[float] = None    # source-video seconds; must be within [start, end]

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
