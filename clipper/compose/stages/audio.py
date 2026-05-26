"""
Compose two-stage audio mix.

Stage 1: bed music (sidechain-ducked under voice when duck=True) + voice → mix1.wav
Stage 2: mix1 + spot SFX (additive, normalize=0) → body_audio.wav
Finally:  prepend hook_offset seconds of silence → final_audio.wav

All intermediates stay on disk for debuggability.
All outputs are 48k stereo PCM/WAV; the mux step re-encodes audio to AAC.

Voice track: slice voiceover.wav by voice_ranges (sorted by start_sec), concat,
pad/trim to body_duration.  If no voice_ranges, use the full voiceover.wav.

Bed music: stream_loop -1 then atrim to body_duration; sidechain-compressed under
voice when duck=True.  If bed file is absent, bed stage is skipped.

SFX: each drop delayed by at_sec, scaled by gain_db, amix normalize=0 (additive).

If no audio sources exist (no voiceover, no bed, no valid SFX), returns False.
The caller should skip the mux step and copy the picture track unchanged.
"""
import logging
import shutil
import subprocess
from pathlib import Path
from typing import Optional

import clipper.compose.db as compose_db
from clipper.config import BASE_DIR

log = logging.getLogger(__name__)

ASSETS_DIR = BASE_DIR / "assets"


# ── Public entry point ────────────────────────────────────────────────────────


def mix(
    comp: dict,
    voice_ranges: list,
    body_duration: float,
    hook_offset: float,
    out_path: str,
) -> bool:
    """Build final audio track (48k stereo WAV) for the composition.

    body_duration: duration of the composition body EXCLUDING the hook.
    hook_offset:   seconds of silence to prepend (= hook duration, 0 if no hook).

    Returns True if audio was written, False if no audio sources are available.
    """
    comp_id = comp["id"]
    comp_dir = compose_db._comp_dir(comp_id)
    voiceover_path = comp_dir / "voiceover.wav"

    has_voice = voiceover_path.exists()

    bed_path = _resolve_abs_path(comp.get("bed_music_file"))
    has_bed  = bed_path is not None

    sfx_rows   = compose_db.get_sfx(comp_id)
    valid_sfx  = [
        {
            "path":    str(_resolve_abs_path(d.get("file"))),
            "at_sec":  float(d["at_sec"]),
            "gain_db": float(d.get("gain_db") or -6),
        }
        for d in sfx_rows
        if _resolve_abs_path(d.get("file"))
    ]

    if not has_voice and not has_bed and not valid_sfx:
        log.info("Audio mix: no audio sources for comp %s — skipping", comp_id)
        return False

    # ── Build voice track ────────────────────────────────────────────────────
    voice_track: Optional[str] = None
    if has_voice:
        voice_track = str(comp_dir / "voice_track.wav")
        log.info("Audio mix: building voice track (ranges=%d, body_dur=%.2fs)",
                 len(voice_ranges), body_duration)
        _build_voice_track(str(voiceover_path), voice_ranges, body_duration, voice_track)

    # ── Stage 1: bed + voice → mix1.wav ─────────────────────────────────────
    mix1_path = str(comp_dir / "mix1.wav")

    if has_voice and has_bed:
        duck     = bool(comp.get("bed_music_duck", True))
        gain_db  = float(comp.get("bed_music_gain_db") or -14)
        log.info("Audio mix: stage 1 — bed+voice (duck=%s, gain=%.1fdB)", duck, gain_db)
        _stage1_duck(str(bed_path), voice_track, gain_db, duck, body_duration, mix1_path)

    elif has_voice:
        shutil.copy2(voice_track, mix1_path)

    elif has_bed:
        gain_db = float(comp.get("bed_music_gain_db") or -14)
        log.info("Audio mix: stage 1 — bed only (gain=%.1fdB)", gain_db)
        _trim_bed(str(bed_path), gain_db, body_duration, mix1_path)

    else:
        # No voice, no bed — valid_sfx must be non-empty (else we returned False above)
        # Create a silent base track for SFX to be mixed onto
        _make_silence(body_duration, mix1_path)

    # ── Stage 2: mix1 + SFX → body_audio.wav ────────────────────────────────
    body_audio = str(comp_dir / "body_audio.wav")
    if valid_sfx:
        log.info("Audio mix: stage 2 — adding %d SFX drop(s)", len(valid_sfx))
        _stage2_sfx(mix1_path, valid_sfx, body_audio)
    else:
        shutil.copy2(mix1_path, body_audio)

    # ── Prepend hook silence → final_audio.wav ───────────────────────────────
    if hook_offset > 0.01:
        log.info("Audio mix: prepending %.2fs hook silence", hook_offset)
        _prepend_silence(body_audio, hook_offset, out_path)
    else:
        shutil.copy2(body_audio, out_path)

    log.info(
        "Audio mix complete: voice=%s bed=%s sfx=%d hook_offset=%.2fs → %s",
        has_voice, has_bed, len(valid_sfx), hook_offset, out_path,
    )
    return True


# ── Voice track assembly ──────────────────────────────────────────────────────


def _build_voice_track(
    voiceover_path: str,
    voice_ranges: list,
    body_duration: float,
    out_path: str,
) -> None:
    """Slice voiceover.wav by voice_ranges, concat, pad/trim to body_duration."""
    ranges = sorted(voice_ranges, key=lambda r: r["start_sec"])

    if not ranges:
        # No ranges set: use the full voiceover, pad/trim to body_duration
        cmd = [
            "ffmpeg", "-y",
            "-i", voiceover_path,
            "-af", (
                f"apad=whole_dur={body_duration:.3f},"
                f"atrim=0:{body_duration:.3f},"
                "asetpts=PTS-STARTPTS"
            ),
            "-ar", "48000", "-ac", "2",
            out_path,
        ]
    else:
        n = len(ranges)
        filter_parts: list[str] = []

        if n == 1:
            r = ranges[0]
            filter_parts.append(
                f"[0:a]atrim={r['start_sec']:.3f}:{r['end_sec']:.3f},"
                f"asetpts=PTS-STARTPTS[cat]"
            )
        else:
            split_outs = "".join(f"[a{i}]" for i in range(n))
            filter_parts.append(f"[0:a]asplit={n}{split_outs}")
            for i, r in enumerate(ranges):
                filter_parts.append(
                    f"[a{i}]atrim={r['start_sec']:.3f}:{r['end_sec']:.3f},"
                    f"asetpts=PTS-STARTPTS[r{i}]"
                )
            concat_ins = "".join(f"[r{i}]" for i in range(n))
            filter_parts.append(f"{concat_ins}concat=n={n}:v=0:a=1[cat]")

        filter_parts.append(
            f"[cat]apad=whole_dur={body_duration:.3f},"
            f"atrim=0:{body_duration:.3f},"
            f"asetpts=PTS-STARTPTS[voice]"
        )
        cmd = [
            "ffmpeg", "-y",
            "-i", voiceover_path,
            "-filter_complex", ";".join(filter_parts),
            "-map", "[voice]",
            "-ar", "48000", "-ac", "2",
            out_path,
        ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Voice track build failed:\n{result.stderr[-2000:]}")


# ── Stage 1: bed + voice mix ─────────────────────────────────────────────────


def _stage1_duck(
    bed_path: str,
    voice_path: str,
    gain_db: float,
    duck: bool,
    body_duration: float,
    out_path: str,
) -> None:
    """Mix bed (optionally sidechain-ducked under voice) + voice → mix1.wav."""
    if duck:
        filter_complex = (
            f"[1:a]apad=whole_dur={body_duration:.3f}[v1];"
            f"[0:a]volume={gain_db:.1f}dB[b];"
            f"[b][v1]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400:makeup=0[ducked];"
            f"[ducked][v1]amix=inputs=2:duration=longest:normalize=0[mix1_raw];"
            f"[mix1_raw]atrim=0:{body_duration:.3f},asetpts=PTS-STARTPTS[mix1]"
        )
    else:
        filter_complex = (
            f"[1:a]apad=whole_dur={body_duration:.3f}[v1];"
            f"[0:a]volume={gain_db:.1f}dB[b];"
            f"[b][v1]amix=inputs=2:duration=longest:normalize=0[mix1_raw];"
            f"[mix1_raw]atrim=0:{body_duration:.3f},asetpts=PTS-STARTPTS[mix1]"
        )
    cmd = [
        "ffmpeg", "-y",
        "-stream_loop", "-1", "-i", bed_path,
        "-i", voice_path,
        "-filter_complex", filter_complex,
        "-map", "[mix1]",
        "-ar", "48000", "-ac", "2",
        out_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Audio stage 1 (bed+voice) failed:\n{result.stderr[-2000:]}")


def _trim_bed(bed_path: str, gain_db: float, body_duration: float, out_path: str) -> None:
    """Bed only (no voice): loop/trim to body_duration with gain scaling."""
    cmd = [
        "ffmpeg", "-y",
        "-stream_loop", "-1", "-i", bed_path,
        "-af", (
            f"volume={gain_db:.1f}dB,"
            f"atrim=0:{body_duration:.3f},"
            "asetpts=PTS-STARTPTS"
        ),
        "-ar", "48000", "-ac", "2",
        out_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Bed trim failed:\n{result.stderr[-2000:]}")


def _make_silence(duration: float, out_path: str) -> None:
    """Generate silent 48k stereo WAV of given duration (SFX-only base track)."""
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"anullsrc=r=48000:cl=stereo",
        "-t", str(duration),
        "-ar", "48000", "-ac", "2",
        out_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Silence generation failed:\n{result.stderr[-2000:]}")


# ── Stage 2: SFX additive mix ────────────────────────────────────────────────


def _stage2_sfx(mix1_path: str, sfx_drops: list, out_path: str) -> None:
    """Add SFX drops additively (amix normalize=0) → body_audio.wav."""
    n_sfx = len(sfx_drops)
    inputs_cmd: list[str] = ["-i", mix1_path]
    filter_parts: list[str] = []

    for i, drop in enumerate(sfx_drops):
        inputs_cmd += ["-i", drop["path"]]
        at_ms = int(drop["at_sec"] * 1000)
        gain  = drop["gain_db"]
        idx   = i + 1
        filter_parts.append(
            f"[{idx}:a]adelay={at_ms}|{at_ms}:all=1,volume={gain:.1f}dB[s{i}]"
        )

    mix_inputs = "[0:a]" + "".join(f"[s{i}]" for i in range(n_sfx))
    filter_parts.append(
        f"{mix_inputs}amix=inputs={n_sfx + 1}:duration=longest:normalize=0[out]"
    )

    cmd = ["ffmpeg", "-y"] + inputs_cmd + [
        "-filter_complex", ";".join(filter_parts),
        "-map", "[out]",
        "-ar", "48000", "-ac", "2",
        out_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Audio stage 2 (SFX) failed:\n{result.stderr[-2000:]}")


# ── Hook silence prepend ──────────────────────────────────────────────────────


def _prepend_silence(src: str, silence_dur: float, out_path: str) -> None:
    """Prepend silence_dur seconds of silence so body audio starts after the hook."""
    delay_ms = int(silence_dur * 1000)
    cmd = [
        "ffmpeg", "-y",
        "-i", src,
        "-af", f"adelay={delay_ms}|{delay_ms}:all=1",
        "-ar", "48000", "-ac", "2",
        out_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Hook silence prepend failed:\n{result.stderr[-2000:]}")


# ── Helpers ───────────────────────────────────────────────────────────────────


def _resolve_abs_path(value: Optional[str]) -> Optional[Path]:
    """Accept an absolute path or a bare filename under assets/.

    The music/sfx library endpoints store absolute paths (str(f)), so the
    abs branch is the common case.  Bare filenames are a fallback for hand-
    crafted rows.
    """
    if not value:
        return None
    p = Path(value)
    if p.is_absolute():
        return p if p.exists() else None
    for subdir in ("music", "sfx"):
        candidate = ASSETS_DIR / subdir / value
        if candidate.exists():
            return candidate
    return None
