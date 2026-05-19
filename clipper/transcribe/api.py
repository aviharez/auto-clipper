import logging
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

from clipper.transcribe.base import Transcriber, Word

log = logging.getLogger(__name__)


class AssemblyAITranscriber(Transcriber):
    """Hosted transcription via AssemblyAI — word-level timestamps + speaker labels."""

    def __init__(self, api_key: Optional[str] = None):
        try:
            import assemblyai as aai
        except ImportError:
            raise RuntimeError(
                "assemblyai package not installed. Run: pip install assemblyai"
            )
        from clipper.config import ASSEMBLYAI_API_KEY
        aai.settings.api_key = api_key or ASSEMBLYAI_API_KEY
        if not aai.settings.api_key:
            raise ValueError(
                "No AssemblyAI API key. Set ASSEMBLYAI_API_KEY environment variable."
            )
        self._aai = aai

    def transcribe(
        self, audio_path: str, start: float = 0.0, end: Optional[float] = None
    ) -> list[Word]:
        needs_extraction = start > 0.01 or end is not None
        if needs_extraction:
            with tempfile.NamedTemporaryFile(suffix=".m4a", delete=False) as tmp:
                tmp_path = Path(tmp.name)
            try:
                self._extract_span(audio_path, str(tmp_path), start, end)
                return self._transcribe_file(str(tmp_path))
            finally:
                tmp_path.unlink(missing_ok=True)
        return self._transcribe_file(audio_path)

    def _transcribe_file(self, path: str) -> list[Word]:
        aai = self._aai
        config = aai.TranscriptionConfig(
            speaker_labels=True,
            speech_models=["universal-3-pro", "universal-2"],
        )
        transcriber = aai.Transcriber(config=config)
        transcript = transcriber.transcribe(path)

        if transcript.status == aai.TranscriptStatus.error:
            raise RuntimeError(f"AssemblyAI error: {transcript.error}")

        words: list[Word] = []
        if transcript.utterances:
            # Utterances carry speaker attribution; their words have per-word timing.
            for utt in transcript.utterances:
                for w in utt.words:
                    words.append(Word(
                        text=w.text,
                        start=round(w.start / 1000.0, 3),
                        end=round(w.end / 1000.0, 3),
                        speaker=utt.speaker,
                    ))
        else:
            # Speaker diarization unavailable — fall back to word list without speaker.
            for w in (transcript.words or []):
                words.append(Word(
                    text=w.text,
                    start=round(w.start / 1000.0, 3),
                    end=round(w.end / 1000.0, 3),
                    speaker=None,
                ))

        log.info("Transcribed %d words from %s", len(words), path)
        return words

    def _extract_span(
        self, source: str, out_path: str, start: float, end: Optional[float]
    ):
        cmd = ["ffmpeg", "-y", "-ss", str(start)]
        if end is not None:
            cmd += ["-to", str(end)]
        cmd += ["-i", source, "-vn", "-c:a", "aac", "-b:a", "64k", out_path]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg audio extraction failed:\n{result.stderr}")
