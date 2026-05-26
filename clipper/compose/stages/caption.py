import json
import logging
import re
import shutil

import clipper.compose.db as compose_db
from clipper.config import (
    ASSEMBLYAI_API_KEY,
    CAPTION_PRESETS,
    DEFAULT_CAPTION_PRESET,
)
from clipper.stages.caption import _build_ass, _burn_captions

log = logging.getLogger(__name__)


def run(comp: dict, picture_path: str, out_path: str) -> str:
    """
    Align captions to voiceover and burn them onto picture_path.
    Copies picture_path → out_path unchanged when captions are not configured
    or prerequisites are missing.  Returns out_path.
    """
    comp_id = comp["id"]
    comp_dir = compose_db._comp_dir(comp_id)

    mode = comp.get("captions_mode") or "script"
    captions_text = (comp.get("captions_text") or "").strip()
    voiceover_path = comp_dir / "voiceover.wav"
    words_path = comp_dir / "words.json"

    # ── Early-exit: nothing to do ────────────────────────────────────────────
    if mode in ("script", "srt") and not captions_text:
        log.info("Captions: mode=%s but captions_text is empty — skipping", mode)
        shutil.copy2(picture_path, out_path)
        return out_path

    if mode in ("transcribe", "script") and not voiceover_path.exists():
        log.warning("Captions: mode=%s but voiceover.wav not found — skipping", mode)
        shutil.copy2(picture_path, out_path)
        return out_path

    # ── Generate word list ───────────────────────────────────────────────────
    if mode == "transcribe":
        transcript = _transcribe_voiceover(str(voiceover_path))
        words = transcript

    elif mode == "script":
        transcript = _transcribe_voiceover(str(voiceover_path))
        words = _align_script_to_transcript(captions_text, transcript)

    elif mode == "srt":
        words = _parse_srt(captions_text)

    else:
        log.warning("Captions: unknown captions_mode=%r — skipping", mode)
        shutil.copy2(picture_path, out_path)
        return out_path

    if not words:
        log.warning("Captions: no words produced for comp %s — skipping burn", comp_id)
        shutil.copy2(picture_path, out_path)
        return out_path

    # Persist for debuggability
    words_path.write_text(json.dumps(words, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("Captions: %d words written to words.json (mode=%s)", len(words), mode)

    # ── Build + burn ASS ─────────────────────────────────────────────────────
    preset_name = comp.get("caption_preset") or DEFAULT_CAPTION_PRESET
    preset = CAPTION_PRESETS.get(preset_name) or CAPTION_PRESETS[DEFAULT_CAPTION_PRESET]

    ass_path = comp_dir / "captions.ass"
    ass_path.write_text(_build_ass(words, preset), encoding="utf-8")
    log.info("Captions: wrote captions.ass")

    _burn_captions(str(picture_path), str(ass_path), str(out_path))
    log.info("Captions: burn complete → %s", out_path)
    return out_path


# ── Transcription ─────────────────────────────────────────────────────────────


def _transcribe_voiceover(voiceover_path: str) -> list[dict]:
    """Transcribe via AssemblyAI. Raises RuntimeError with a helpful message when
    the API key is absent — better than crashing with an opaque import error."""
    if not ASSEMBLYAI_API_KEY:
        raise RuntimeError(
            "ASSEMBLYAI_API_KEY is not set. "
            "Set the environment variable to enable caption transcription, "
            "or switch captions mode to 'srt' and paste a subtitle file."
        )
    from clipper.transcribe.api import AssemblyAITranscriber
    transcriber = AssemblyAITranscriber()
    words = transcriber.transcribe(voiceover_path)
    return [{"text": w.text, "start": w.start, "end": w.end} for w in words]


# ── Script alignment ──────────────────────────────────────────────────────────


def _align_script_to_transcript(script_text: str, transcript: list[dict]) -> list[dict]:
    """
    Replace transcript word texts with script words while keeping transcript timings.
    Falls back to even-spacing over the voiceover span when word counts differ.
    """
    script_words = script_text.split()
    if not script_words:
        return transcript
    if not transcript:
        return []

    if len(script_words) == len(transcript):
        return [
            {"text": sw, "start": tw["start"], "end": tw["end"]}
            for sw, tw in zip(script_words, transcript)
        ]

    # Mismatch — evenly space script words across the full voiceover span
    log.info(
        "Caption align: script=%d words vs transcript=%d — using even-spacing fallback",
        len(script_words), len(transcript),
    )
    total_dur = transcript[-1]["end"]
    step = total_dur / len(script_words)
    return [
        {
            "text": word,
            "start": round(i * step, 3),
            "end": round((i + 1) * step, 3),
        }
        for i, word in enumerate(script_words)
    ]


# ── SRT parser ────────────────────────────────────────────────────────────────


def _parse_srt(srt_text: str) -> list[dict]:
    """Parse SRT content into word dicts. Cue text is split evenly across cue duration."""
    words = []
    for block in re.split(r"\n\s*\n", srt_text.strip()):
        lines = block.strip().splitlines()
        timecode_line = None
        text_lines: list[str] = []
        for i, line in enumerate(lines):
            if "-->" in line:
                timecode_line = line
                text_lines = lines[i + 1 :]
                break
        if not timecode_line:
            continue

        m = re.match(
            r"(\d+:\d+:\d+[,\.]\d+)\s*-->\s*(\d+:\d+:\d+[,\.]\d+)",
            timecode_line,
        )
        if not m:
            continue

        start = _parse_srt_time(m.group(1))
        end = _parse_srt_time(m.group(2))
        cue_words = " ".join(text_lines).split()
        if not cue_words:
            continue

        step = (end - start) / len(cue_words)
        for j, word in enumerate(cue_words):
            words.append({
                "text": word,
                "start": round(start + j * step, 3),
                "end": round(start + (j + 1) * step, 3),
            })

    return words


def _parse_srt_time(s: str) -> float:
    """Convert SRT timecode HH:MM:SS,mmm (or HH:MM:SS.mmm) to seconds."""
    s = s.replace(",", ".")
    h, m, sec = s.split(":")
    return int(h) * 3600 + int(m) * 60 + float(sec)
