from abc import ABC, abstractmethod
from pathlib import Path


class Deliverer(ABC):
    @abstractmethod
    def deliver(self, clip_file: Path, job: dict, candidate: dict) -> str:
        """Move or copy a finished clip to its destination. Returns a status string."""
