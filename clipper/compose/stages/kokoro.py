"""
Kokoro TTS stage — synthesises voiceover.wav from text using the local ONNX model.
Model files expected at: <project-root>/kokoro-model/kokoro-v1.0.onnx + voices-v1.0.bin
"""
import re
import logging
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

# Module-level singleton — first call loads the model (~3s), subsequent calls reuse it.
_kokoro = None
_MODEL_DIR = Path(__file__).parents[3] / "kokoro-model"
_NATIVE_SR = 24000
_TARGET_SR = 48000


def _get_model():
    global _kokoro
    if _kokoro is None:
        from kokoro_onnx import Kokoro
        onnx_path = str(_MODEL_DIR / "kokoro-v1.0.onnx")
        voices_path = str(_MODEL_DIR / "voices-v1.0.bin")
        log.info("Loading Kokoro model from %s", onnx_path)
        _kokoro = Kokoro(onnx_path, voices_path)
    return _kokoro


def _split_sentences(text: str, max_chars: int = 150) -> list:
    """Split text into chunks at sentence boundaries, each ≤ max_chars."""
    raw = re.split(r'(?<=[.!?])\s+', text.strip())
    chunks = []
    current = ""
    for sentence in raw:
        if not sentence:
            continue
        candidate = (current + " " + sentence).strip() if current else sentence
        if current and len(candidate) > max_chars:
            chunks.append(current.strip())
            current = sentence
        else:
            current = candidate
    if current:
        chunks.append(current.strip())

    # Further split any chunk still > max_chars at word boundaries
    result = []
    for chunk in chunks:
        if len(chunk) <= max_chars:
            result.append(chunk)
        else:
            words = chunk.split()
            sub = ""
            for word in words:
                candidate = (sub + " " + word).strip() if sub else word
                if sub and len(candidate) > max_chars:
                    result.append(sub)
                    sub = word
                else:
                    sub = candidate
            if sub:
                result.append(sub)

    return result or [text.strip()]


def generate(text: str, voice_id: str, out_path: str) -> float:
    """
    Synthesise text to voiceover.wav at 48 kHz stereo PCM_16.
    Returns duration in seconds.
    """
    import soundfile as sf
    import librosa

    model = _get_model()
    chunks = _split_sentences(text)
    log.info("Kokoro: %d chunk(s) for voice '%s'", len(chunks), voice_id)

    resampled = []
    for chunk in chunks:
        if not chunk.strip():
            continue
        samples, sr = model.create(chunk, voice=voice_id, speed=1.0, lang="en-us")
        samples = np.asarray(samples, dtype=np.float32)
        if sr != _TARGET_SR:
            samples = librosa.resample(samples, orig_sr=int(sr), target_sr=_TARGET_SR)
        resampled.append(samples)

    if not resampled:
        raise ValueError("No audio generated — text was empty after chunking")

    audio = np.concatenate(resampled)
    stereo = np.stack([audio, audio], axis=1)

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    sf.write(out_path, stereo, samplerate=_TARGET_SR, subtype="PCM_16")

    duration = len(audio) / _TARGET_SR
    log.info("Kokoro: wrote %s (%.2fs)", out_path, duration)
    return duration
