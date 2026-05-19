from abc import ABC, abstractmethod


class Assembler(ABC):
    @abstractmethod
    def assemble(self, candidate_id: str, job: dict, candidate: dict) -> str:
        """
        Receive a cut (and in future iterations: hooked + captioned) clip and produce
        the deliverable output. Returns the path to the final video file.
        """
        ...
