"""Sentence-boundary suggestion for Review Layer 1 (Step 2.6).

Reads words.json (clip-relative timestamps) and returns suggested source-absolute
boundary adjustments when the clip appears to start or end mid-sentence.
Returns {} when no words.json exists or no suggestion can be made.
"""

import json
from pathlib import Path


def _sentence_end(text: str) -> bool:
    """True if the word text closes a sentence."""
    t = text.strip().rstrip('"\'”’)')
    return bool(t) and t[-1] in '.?!'


def _fmt(secs: float) -> str:
    s = round(secs)
    return f"{s // 60:02d}:{s % 60:02d}"


def suggest(cand_id: str, candidate: dict, jobs_dir: Path) -> dict:
    """
    Return boundary suggestions derived from words.json.

    Returned dict may contain any subset of:
      suggested_start: float  (source-absolute seconds)
      suggested_end:   float  (source-absolute seconds)
      reason_start:    str
      reason_end:      str
    """
    words_path = jobs_dir / candidate["job_id"] / "clips" / cand_id / "words.json"
    if not words_path.exists():
        return {}

    words = json.loads(words_path.read_text(encoding="utf-8"))
    if not words:
        return {}

    cand_start: float = candidate["start"]
    cand_end: float = candidate["end"]
    clip_dur = cand_end - cand_start

    # Collect sentence-end positions (clip-relative .end time, word index)
    sent_ends = [
        (w["end"], i)
        for i, w in enumerate(words)
        if _sentence_end(w.get("text", ""))
    ]

    result = {}

    # ── Start boundary ────────────────────────────────────────────────────────
    # If the first sentence end appears within the first 4 s, a sentence fragment
    # precedes it → the clip likely starts mid-sentence.
    if sent_ends:
        first_end_rel, first_end_idx = sent_ends[0]
        next_idx = first_end_idx + 1
        if first_end_rel < 4.0 and next_idx < len(words):
            next_start_rel = words[next_idx]["start"]
            sugg_start = round(cand_start + next_start_rel, 2)
            if sugg_start < cand_end - 3.0:   # leave at least 3 s of content
                result["suggested_start"] = sugg_start
                result["reason_start"] = (
                    f"Clip may start mid-sentence — shift start "
                    f"{_fmt(cand_start)} → {_fmt(sugg_start)} "
                    f"to begin at a sentence start"
                )

    # ── End boundary ──────────────────────────────────────────────────────────
    # If the last word does not close a sentence, find the most-recent sentence end
    # and suggest snapping to it.
    last_word = words[-1]
    if not _sentence_end(last_word.get("text", "")) and sent_ends:
        last_end_rel, _ = sent_ends[-1]
        if clip_dur - last_end_rel > 0.5:     # gap must be meaningful
            sugg_end = round(cand_start + last_end_rel, 2)
            result["suggested_end"] = sugg_end
            result["reason_end"] = (
                f"Clip ends mid-sentence — shift end "
                f"{_fmt(cand_end)} → {_fmt(sugg_end)} "
                f"to end at a sentence boundary"
            )

    return result
