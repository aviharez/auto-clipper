from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class Word:
    text: str
    start: float
    end: float
    speaker: Optional[str] = None


class Transcriber(ABC):
    @abstractmethod
    def transcribe(self, audio_path: str, start: float = 0.0, end: Optional[float] = None) -> list[Word]:
        """
        Transcribe audio and return word-level timestamps.
        start/end allow transcribing a sub-span (for manual mode lazy transcription).
        """
        ...
