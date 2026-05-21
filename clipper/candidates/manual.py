from typing import Literal
import yaml

from clipper.candidates.base import Candidate, CandidateSource


def _parse_timecode(tc: str) -> float:
    """Convert "MM:SS", "H:MM:SS", or bare-seconds string to float seconds."""
    if isinstance(tc, (int, float)):
        return float(tc)
    parts = str(tc).strip().split(":")
    if len(parts) == 2:
        return int(parts[0]) * 60 + float(parts[1])
    if len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    raise ValueError(f"Unrecognised timecode format: {tc!r}")


class ManualCandidateSource(CandidateSource):
    needs_full_transcription = False
    review_strictness: Literal["preview_only"] = "preview_only"

    def __init__(self, yaml_path: str):
        self._yaml_path = yaml_path

    def generate(self, job: dict) -> list[Candidate]:
        with open(self._yaml_path, "r", encoding="utf-8") as f:
            spec = yaml.safe_load(f)

        default_hook = spec.get("hook", {})
        default_hook_enabled = default_hook.get("enabled", True)
        default_hook_background = default_hook.get("background", "blur_self")
        default_hook_duration = default_hook.get("duration")  # None → hook.py uses DEFAULT_HOOK_DURATION
        default_captions = spec.get("default_captions", True)

        candidates = []
        for clip in spec.get("clips", []):
            hook_override = clip.get("hook")
            if hook_override is False:
                hook_enabled = False
            elif isinstance(hook_override, dict):
                hook_enabled = hook_override.get("enabled", default_hook_enabled)
            else:
                hook_enabled = default_hook_enabled

            candidates.append(
                Candidate(
                    start=_parse_timecode(clip["start"]),
                    end=_parse_timecode(clip["end"]),
                    title=clip["title"],
                    source_job_id=job["id"],
                    hook_text=clip.get("hook_text"),
                    hook_enabled=hook_enabled,
                    hook_background=clip.get("hook_background", default_hook_background),
                    needs_caption=clip.get("needs_caption", default_captions),
                    caption_preset=clip.get("caption_preset"),
                    hook_preset=clip.get("hook_preset"),
                    rank=clip.get("rank"),
                    origin="manual",
                    hook_duration=clip.get("hook_duration") if "hook_duration" in clip else default_hook_duration,
                )
            )
        return candidates
