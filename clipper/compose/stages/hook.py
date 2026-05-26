"""
Compose hook stage — prepends a blurred teaser with hook text to the composition body.

Always uses blur_self mode (darkened first N seconds of the body video).
Outputs 48k stereo audio to match the rest of the Compose pipeline (unlike the Clip
hook stage which emits 44.1k).  Explicit aresample=48000 in the concat filter_complex
guards against any mismatch if the body audio rate ever drifts.

hook_animation maps to HOOK_PRESETS keys: 'none' skips the hook entirely;
'slide_in_top', 'fade_in', 'pop' are Compose-specific presets in config.py.
"""
import logging
import shutil
import subprocess
from pathlib import Path

import clipper.compose.db as compose_db
from clipper.config import (
    BASE_DIR, FONTS_DIR,
    HOOK_PRESETS, DEFAULT_HOOK_PRESET,
    VIDEO_CRF, VIDEO_PRESET, AUDIO_BITRATE,
)
from clipper.stages.hook import _build_hook_ass

log = logging.getLogger(__name__)

DEFAULT_COMPOSE_HOOK_DURATION = 2.0

_TRANSITION_SPECS: dict[str, dict] = {
    "fade":     {"effect": "fade",    "duration": 0.125},
    "slide_up": {"effect": "slideup", "duration": 0.30},
}


def run(comp: dict, picture_path: str, out_path: str) -> float:
    """Prepend hook segment to picture_path, write result to out_path.

    Returns the hook duration in seconds (0.0 if no hook was prepended).
    The caller uses this offset to delay the body audio track so voice/music
    stay in sync with the composition body content that follows the hook.
    """
    hook_text = (comp.get("hook_text") or "").strip()
    animation = comp.get("hook_animation") or ""

    if not hook_text or animation == "none":
        shutil.copy2(picture_path, out_path)
        return 0.0

    comp_id = comp["id"]
    comp_dir = compose_db._comp_dir(comp_id)

    preset_name = animation if animation in HOOK_PRESETS else DEFAULT_HOOK_PRESET
    preset = HOOK_PRESETS[preset_name]
    hook_duration = DEFAULT_COMPOSE_HOOK_DURATION

    hook_mp4 = str(comp_dir / "hook.mp4")

    ass_path = comp_dir / "hook_text.ass"
    ass_path.write_text(_build_hook_ass(hook_text, hook_duration, preset), encoding="utf-8")
    ass_rel   = ass_path.relative_to(BASE_DIR).as_posix()
    fonts_rel = FONTS_DIR.relative_to(BASE_DIR).as_posix()

    _make_compose_hook(picture_path, hook_mp4, ass_rel, fonts_rel, hook_duration, preset)

    transition = preset.get("transition", "cut")
    _concat_hook_body(hook_mp4, picture_path, out_path, transition, hook_duration)

    log.info(
        "Compose hook prepended (preset=%s, transition=%s, dur=%.2fs) → %s",
        preset_name, transition, hook_duration, out_path,
    )
    return hook_duration


# ── Hook segment creation ─────────────────────────────────────────────────────


def _make_compose_hook(
    src: str,
    out: str,
    ass_rel: str,
    fonts_rel: str,
    duration: float,
    preset: dict,
) -> None:
    """Create hook.mp4: first `duration` s of src, darkened + text overlay, 48k stereo."""
    darkness = preset.get("gradient_darkness", 0.75)
    factor = f"if(lt(Y/H,0.1),1,1-min(1,(Y/H-0.1)/0.9)*{darkness:.3f})"
    vf = (
        f"trim=0:{duration:.3f},setpts=PTS-STARTPTS,"
        f"geq=r='r(X,Y)*({factor})':g='g(X,Y)*({factor})':b='b(X,Y)*({factor})',"
        f"setsar=1,"
        f"ass={ass_rel}:fontsdir={fonts_rel}"
    )
    filter_complex = (
        f"[0:v]{vf}[hookv];"
        f"anullsrc=r=48000:cl=stereo,"
        f"atrim=0:{duration:.3f}[hooka]"
    )
    cmd = [
        "ffmpeg", "-y",
        "-i", src,
        "-filter_complex", filter_complex,
        "-map", "[hookv]", "-map", "[hooka]",
        "-c:v", "libx264", "-crf", str(VIDEO_CRF), "-preset", VIDEO_PRESET,
        "-c:a", "aac", "-b:a", AUDIO_BITRATE,
        "-movflags", "+faststart",
        out,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(BASE_DIR))
    if result.returncode != 0:
        raise RuntimeError(f"Compose hook segment failed:\n{result.stderr[-2000:]}")


# ── Concatenation ─────────────────────────────────────────────────────────────


def _concat_hook_body(
    hook: str,
    body: str,
    out: str,
    transition: str,
    hook_duration: float,
) -> None:
    """Concatenate hook.mp4 + body with explicit aresample=48000 on both audio streams."""
    spec = _TRANSITION_SPECS.get(transition)

    if spec is None:
        # Hard cut
        filter_complex = (
            "[0:v]setsar=1[hv];"
            "[1:v]setsar=1[mv];"
            "[0:a]aresample=48000[ha];"
            "[1:a]aresample=48000[ma];"
            "[hv][ha][mv][ma]concat=n=2:v=1:a=1[v][a]"
        )
    else:
        effect = spec["effect"]
        t_dur  = spec["duration"]
        offset = max(0.0, hook_duration - t_dur)

        if effect == "fade":
            filter_complex = (
                f"[0:v]setsar=1,fade=t=out:st={offset:.3f}:d={t_dur:.3f}[hv];"
                f"[1:v]setsar=1,fade=t=in:st=0:d={t_dur:.3f}[mv];"
                f"[hv][mv]concat=n=2:v=1:a=0[v];"
                f"[0:a]aresample=48000,afade=t=out:st={offset:.3f}:d={t_dur:.3f}[ha];"
                f"[1:a]aresample=48000,afade=t=in:st=0:d={t_dur:.3f}[ma];"
                f"[ha][ma]concat=n=2:v=0:a=1[a]"
            )
        else:
            # xfade (slide_up)
            filter_complex = (
                f"[0:v]setsar=1[hv];"
                f"[1:v]setsar=1[mv];"
                f"[hv][mv]xfade=transition={effect}:duration={t_dur:.3f}:offset={offset:.3f}[v];"
                f"[0:a]aresample=48000[ha];"
                f"[1:a]aresample=48000[ma];"
                f"[ha][ma]acrossfade=d={t_dur:.3f}[a]"
            )

    cmd = [
        "ffmpeg", "-y",
        "-i", hook,
        "-i", body,
        "-filter_complex", filter_complex,
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-crf", str(VIDEO_CRF), "-preset", VIDEO_PRESET,
        "-c:a", "aac", "-b:a", AUDIO_BITRATE,
        "-movflags", "+faststart",
        out,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Compose hook concat failed:\n{result.stderr[-2000:]}")
