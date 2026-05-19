"""
reframe.py — Tier 2a cut-aware multi-face "fit all" vertical reframe planning.

Real source footage is edited: one clip span usually contains several camera
shots (close-ups, wide 2-shots, ...). Tier 2a (plan §5.2) must keep every
detected face visible, but a *single* crop decision over a whole edited span
is wrong — a whole-clip split-screen also splits the close-ups, which is what
made the earlier attempt look broken. So plan() first cuts the span into
shots at hard cuts, then reframes each shot on its own:

  * tier1  — fixed centre crop  (no faces / disabled / unsupported source)
  * static — one fixed 9:16 window already contains every face: zero motion
  * pan    — one 9:16 window glides along a smoothed path within the shot
  * split  — two face subjects too far apart for any single 9:16 window:
             stacked top/bottom split-screen, each half framed on a subject

cut.py encodes each shot separately and concatenates them; the crop changing
at a cut is invisible *only* when the crop switch lands on the real cut frame,
so each boundary is refined to frame accuracy (see _refine_cut) — otherwise the
crop jumps a beat before the content does and the clip looks "dragged".

A "subject" is a face *cluster* (detections grouped by x) present in a
majority of a shot's frames — this is what distinguishes a real person from
detector noise. The split/single decision uses subjects, never raw detection
counts: within one shot the camera is fixed, so a genuine second person forms
a dense cluster while noise stays sparse. That is what makes split reliable.

Tier 2a deliberately does NOT guess who is speaking (that is Tier 2b). The
camera path is "detect -> collect positions -> smooth into a path -> crop
along the path" (plan §5.2): a raw face-following crop jitters and is unusable.

Robustness contract: plan() never raises for an expected condition (no faces,
disabled, detector missing, too fast-cut) — it returns a Tier 1 plan instead.
Only genuine bugs propagate, and cut.py catches those and falls back too.
"""
from __future__ import annotations

import logging
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from clipper.config import (
    BASE_DIR, CLIP_WIDTH, CLIP_HEIGHT,
    REFRAME_ENABLED, REFRAME_MODEL, REFRAME_SAMPLE_FPS, REFRAME_DET_WIDTH,
    REFRAME_MIN_CONFIDENCE, REFRAME_MIN_FACE_HEIGHT_FRAC, REFRAME_PAD_FRAC,
    REFRAME_SMOOTH_SIGMA_SEC, REFRAME_CUT_DIFF, REFRAME_CUT_REL,
    REFRAME_MIN_SHOT_SEC, REFRAME_MAX_SHOTS, REFRAME_CLUSTER_GAP_FRAC,
    REFRAME_SUBJECT_MIN_COVERAGE, REFRAME_CUT_REFINE_MARGIN,
)

log = logging.getLogger(__name__)

TARGET_AR = CLIP_WIDTH / CLIP_HEIGHT          # 9:16 ≈ 0.5625
HALF_H = CLIP_HEIGHT // 2                     # split-screen half height

# Every reframe filterchain starts here: setpts normalises the (per-shot) clip
# timeline to start at t=0 so the pan sendcmd schedule lines up regardless of
# how ffmpeg timestamps an input-seeked segment. cut.py applies asetpts to
# audio so the two streams stay in sync.
_HEAD = "setpts=PTS-STARTPTS"
_TAIL = f"scale={CLIP_WIDTH}:{CLIP_HEIGHT}:flags=lanczos,setsar=1[v]"


@dataclass
class ShotPlan:
    start: float          # absolute source seconds
    end: float            # absolute source seconds
    mode: str             # tier1 | static | pan | split
    filter_complex: str   # video graph: consumes [0:v], produces [v]
    description: str      # one-line human summary


@dataclass
class ReframePlan:
    mode: str             # overall mode summary (for the log)
    shots: list[ShotPlan]  # >=1 shot; cut.py encodes each and concatenates
    description: str       # one-line human summary


# ── geometry helpers ─────────────────────────────────────────────────────────


def _even(v) -> int:
    """Round down to an even integer (libx264 / 4:2:0 want even dimensions)."""
    return int(v) & ~1


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _crop_size(src_w: int, src_h: int) -> tuple[int, int]:
    """The 9:16 crop window for this source, using the full available height."""
    if src_w / src_h > TARGET_AR:        # source wider than 9:16 -> pannable in x
        return _even(src_h * TARGET_AR), int(src_h)
    return int(src_w), _even(src_w / TARGET_AR)


def center_crop_filter(src_w: int, src_h: int) -> str:
    """Tier 1 fixed centre crop — also the universal fallback graph."""
    cw, ch = _crop_size(src_w, src_h)
    cx, cy = _even((src_w - cw) / 2), _even((src_h - ch) / 2)
    return f"[0:v]{_HEAD},crop={cw}:{ch}:{cx}:{cy},{_TAIL}"


def tier1_plan(src_w: int, src_h: int, start, end, why: str = "") -> ReframePlan:
    """A single-shot Tier 1 plan — the universal fallback for cut.py."""
    desc = "Tier 1 centre crop" + (f" ({why})" if why else "")
    shot = ShotPlan(float(start), float(end), "tier1",
                    center_crop_filter(src_w, src_h), desc)
    return ReframePlan("tier1", [shot], desc)


# ── frame extraction + face detection ────────────────────────────────────────


def _extract_frames(source: Path, start, end, det_w: int, tmp: str) -> list[Path]:
    """Dump downscaled sample frames of the clip span as JPEGs (ffmpeg seeks)."""
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-ss", str(start), "-to", str(end), "-i", str(source),
        "-an", "-vf", f"fps={REFRAME_SAMPLE_FPS},scale={det_w}:-2",
        "-q:v", "3", str(Path(tmp) / "f%05d.jpg"),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"reframe frame extraction failed:\n{r.stderr[-800:]}")
    return sorted(Path(tmp).glob("f*.jpg"))


def _signature(img: np.ndarray) -> np.ndarray:
    """A coarse 9x16 grid of grayscale block means — a cheap scene fingerprint."""
    g = img[..., :3].mean(axis=2) if img.ndim == 3 else img.astype(float)
    h, w = g.shape
    gh, gw = 9, 16
    rb = np.linspace(0, h, gh + 1).astype(int)
    cb = np.linspace(0, w, gw + 1).astype(int)
    sig = np.empty(gh * gw)
    k = 0
    for r in range(gh):
        for c in range(gw):
            block = g[rb[r]:rb[r + 1], cb[c]:cb[c + 1]]
            sig[k] = block.mean() if block.size else 0.0
            k += 1
    return sig


def _analyze_frames(frames: list[Path], scale_back: float,
                    src_h: int) -> tuple[list[list[dict]], np.ndarray]:
    """
    Per sample frame: the kept faces (in *source* pixels) and a scene
    fingerprint used for cut detection. mediapipe is imported lazily so a
    missing/broken install degrades to Tier 1 rather than breaking the cut.
    """
    import mediapipe as mp
    from mediapipe.tasks.python import vision, BaseOptions

    options = vision.FaceDetectorOptions(
        base_options=BaseOptions(model_asset_path=str(REFRAME_MODEL)),
        running_mode=vision.RunningMode.IMAGE,
        min_detection_confidence=REFRAME_MIN_CONFIDENCE,
    )
    detector = vision.FaceDetector.create_from_options(options)
    min_face_h = REFRAME_MIN_FACE_HEIGHT_FRAC * src_h

    per_frame: list[list[dict]] = []
    sigs: list[np.ndarray] = []
    try:
        for fp in frames:
            faces: list[dict] = []
            try:
                image = mp.Image.create_from_file(str(fp))
            except Exception:                       # corrupt frame — carry forward
                per_frame.append(faces)
                sigs.append(sigs[-1] if sigs else np.zeros(144))
                continue
            sigs.append(_signature(image.numpy_view()))
            try:
                result = detector.detect(image)
            except Exception:
                per_frame.append(faces)
                continue
            for d in result.detections or []:
                bb = d.bounding_box
                score = d.categories[0].score if d.categories else 1.0
                left = bb.origin_x * scale_back
                right = (bb.origin_x + bb.width) * scale_back
                height = bb.height * scale_back
                # Drop weak detections and small background bystanders so they
                # cannot drag the camera or wrongly trigger a split.
                if score < REFRAME_MIN_CONFIDENCE or height < min_face_h:
                    continue
                faces.append({
                    "cx": (left + right) / 2, "left": left, "right": right,
                    "w": right - left, "score": score,
                })
            per_frame.append(faces)
    finally:
        detector.close()
    return per_frame, np.asarray(sigs)


# ── cut detection + shot segmentation ────────────────────────────────────────


def _detect_cuts(sigs: np.ndarray) -> list[int]:
    """Sample-frame indices that begin a new shot (a hard cut precedes them)."""
    if len(sigs) < 2:
        return []
    diffs = np.abs(np.diff(sigs, axis=0)).mean(axis=1)      # one per frame gap
    if diffs.size == 0:
        return []
    med = float(np.median(diffs))
    thr = max(REFRAME_CUT_DIFF, REFRAME_CUT_REL * med)
    return [i + 1 for i, d in enumerate(diffs) if d > thr]


def _build_shots(cuts: list[int], n: int) -> list[tuple[int, int]]:
    """Cut indices -> contiguous [a, b) sample ranges; sub-minimal shots merged."""
    bounds = sorted({0, n, *(c for c in cuts if 0 < c < n)})
    shots = [(bounds[k], bounds[k + 1]) for k in range(len(bounds) - 1)]
    min_frames = max(2, round(REFRAME_MIN_SHOT_SEC * REFRAME_SAMPLE_FPS))
    changed = True
    while changed and len(shots) > 1:
        changed = False
        for k, (a, b) in enumerate(shots):
            if b - a >= min_frames:
                continue
            if k == 0:                              # merge into the next shot
                shots[1] = (a, shots[1][1])
                shots.pop(0)
            else:                                   # merge into the previous shot
                shots[k - 1] = (shots[k - 1][0], b)
                shots.pop(k)
            changed = True
            break
    return shots


def _refine_cut(source: Path, win_start: float, win_end: float,
                src_fps: float) -> float | None:
    """
    Find the frame-accurate hard cut inside an absolute-seconds window.

    The 5 fps shot scan only resolves a cut to its ~0.2 s sampling interval,
    so encoding the crop switch at that coarse time leaves the crop changing
    up to ~0.15 s away from the real cut — the crop jumps, then a beat later
    the content cuts, which reads as a "drag". This re-scans the window at the
    source frame rate and returns the absolute time of the first frame after
    the cut. Returns None when no cut clearly stands out (a false coarse cut
    from heavy motion), so the caller keeps its coarse estimate.
    """
    import mediapipe as mp

    win_start = round(win_start * src_fps) / src_fps        # align seek to a frame
    with tempfile.TemporaryDirectory(prefix="refinecut_") as tmp:
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-ss", f"{win_start:.3f}", "-to", f"{win_end:.3f}", "-i", str(source),
            "-an", "-vf", f"fps={src_fps:g},scale=256:-2", "-q:v", "5",
            str(Path(tmp) / "c%04d.jpg"),
        ]
        if subprocess.run(cmd, capture_output=True, text=True).returncode != 0:
            return None
        frames = sorted(Path(tmp).glob("c*.jpg"))
        if len(frames) < 3:
            return None
        sigs: list[np.ndarray] = []
        for fp in frames:
            try:
                sigs.append(_signature(mp.Image.create_from_file(str(fp)).numpy_view()))
            except Exception:                           # corrupt frame — carry forward
                sigs.append(sigs[-1] if sigs else np.zeros(144))

    diffs = np.abs(np.diff(np.asarray(sigs), axis=0)).mean(axis=1)
    if diffs.size == 0:
        return None
    j = int(np.argmax(diffs))
    others = np.delete(diffs, j)
    med = float(np.median(others)) if others.size else 0.0
    if diffs[j] < max(REFRAME_CUT_DIFF, REFRAME_CUT_REL * med):
        return None                                     # no clear cut in this window
    # The cut sits between window frame j and j+1; the new shot starts at j+1.
    # win_start is frame-aligned, so this lands on the source frame grid.
    return win_start + (j + 1) / src_fps


# ── camera-path math ─────────────────────────────────────────────────────────


def _gaussian(arr: np.ndarray, sigma: float) -> np.ndarray:
    """Edge-padded 1-D Gaussian smoothing — turns raw targets into a camera path."""
    arr = np.asarray(arr, dtype=float)
    if sigma <= 0 or arr.size < 3:
        return arr
    radius = max(1, int(round(sigma * 3)))
    k = np.exp(-(np.arange(-radius, radius + 1) ** 2) / (2 * sigma * sigma))
    k /= k.sum()
    return np.convolve(np.pad(arr, radius, mode="edge"), k, mode="valid")


def _write_sendcmd(path: Path, times: np.ndarray, xs: np.ndarray) -> None:
    """Write an ffmpeg sendcmd schedule that drives `crop`'s x per output frame."""
    lines: list[str] = []
    last: int | None = None
    for t, x in zip(times, xs):
        xv = _even(x)
        if xv != last:                              # only emit on change
            lines.append(f"{t:.3f} crop x {xv};")
            last = xv
    if not lines:
        lines.append(f"0.000 crop x {_even(xs[0])};")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ── face clustering: real subjects vs detector noise ─────────────────────────


def _cluster_cx(detections: list[tuple[int, dict]], gap: float) -> list[list[tuple[int, dict]]]:
    """1-D agglomerative clustering of detections by face centre x."""
    if not detections:
        return []
    items = sorted(detections, key=lambda t: t[1]["cx"])
    clusters = [[items[0]]]
    for prev, cur in zip(items, items[1:]):
        if cur[1]["cx"] - prev[1]["cx"] > gap:
            clusters.append([cur])
        else:
            clusters[-1].append(cur)
    return clusters


# ── per-shot reframing ───────────────────────────────────────────────────────


def _shot_split(subjects: list[list[tuple[int, dict]]], src_w: int, src_h: int,
                pad: float) -> tuple[str, str, str] | None:
    """
    Two+ subjects too far apart for one 9:16 window -> stacked top/bottom.
    Each half is a static 9:8 region of the source (full height) framed on its
    subject group, scaled to 1080x960, vstacked. Static by design: Tier 2a does
    not track speakers, and a fixed split cannot flicker. Returns None if the
    source is too narrow to split (caller falls back to a single window).
    """
    scw = _even(src_h * CLIP_WIDTH / HALF_H)        # 9:8 region (1080:960)
    if scw > src_w:
        return None
    sch = int(src_h)
    x_max = float(src_w - scw)

    # Group subjects into two halves at the widest gap between their centroids.
    cents = sorted(
        (float(np.mean([f["cx"] for _, f in cl])), cl) for cl in subjects
    )
    gaps = [cents[k + 1][0] - cents[k][0] for k in range(len(cents) - 1)]
    gi = int(np.argmax(gaps))
    left_groups = [cl for _, cl in cents[:gi + 1]]
    right_groups = [cl for _, cl in cents[gi + 1:]]

    def region_x(groups: list[list[tuple[int, dict]]]) -> int:
        faces = [f for cl in groups for _, f in cl]
        lo = min(f["left"] for f in faces) - pad
        hi = max(f["right"] for f in faces) + pad
        return _even(_clamp((lo + hi) / 2 - scw / 2, 0.0, x_max))

    tx, bx = region_x(left_groups), region_x(right_groups)   # leftmost on top

    # Explicit split + setsar=1 on each half: vstack refuses mismatched SAR,
    # which is the classic reason a hand-built split-screen graph fails.
    half_tail = f"scale={CLIP_WIDTH}:{HALF_H}:flags=lanczos,setsar=1"
    filter_complex = (
        f"[0:v]{_HEAD},split=2[s0][s1];"
        f"[s0]crop={scw}:{sch}:{tx}:0,{half_tail}[top];"
        f"[s1]crop={scw}:{sch}:{bx}:0,{half_tail}[bot];"
        f"[top][bot]vstack=inputs=2[v]"
    )
    desc = (f"split-screen — {len(left_groups)}+{len(right_groups)} subjects "
            f"too far apart for one 9:16 window")
    return ("split", filter_complex, desc)


def _shot_single(sub_faces: list[list[dict]], src_w: int, src_h: int,
                 cw: int, ch: int, pad: float, x_max: float, fps: float,
                 duration: float, cmd_path: Path) -> tuple[str, str, str]:
    """One 9:16 window for the shot — static if every face fits it, else a pan."""
    m = len(sub_faces)
    have = [i for i, f in enumerate(sub_faces) if f]

    desired = np.full(m, np.nan)        # window x that centres this frame's faces
    left_need = np.full(m, np.nan)      # left edge that must stay visible
    right_need = np.full(m, np.nan)     # right edge that must stay visible
    for i in have:
        faces = sub_faces[i]
        lo = min(f["left"] for f in faces) - pad
        hi = max(f["right"] for f in faces) + pad
        left_need[i], right_need[i] = lo, hi
        desired[i] = (lo + hi) / 2 - cw / 2

    idx = np.arange(m)
    known = ~np.isnan(desired)
    desired = np.interp(idx, idx[known], desired[known])    # fill faceless frames

    env_lo = float(np.nanmin(left_need))
    env_hi = float(np.nanmax(right_need))
    if env_hi - env_lo <= cw:
        # Everything across the whole shot fits one fixed window -> no motion.
        x = _even(_clamp((env_lo + env_hi) / 2 - cw / 2, 0.0, x_max))
        return ("static",
                f"[0:v]{_HEAD},crop={cw}:{ch}:{x}:0,{_TAIL}",
                f"static window — every face ({len(have)}/{m} frames) fits one crop")

    # pan: smooth into a camera path, then clamp so faces never leave the window.
    smoothed = _gaussian(desired, REFRAME_SMOOTH_SIGMA_SEC * REFRAME_SAMPLE_FPS)
    xs = np.empty(m)
    for i in range(m):
        lo, hi = 0.0, x_max
        if not np.isnan(left_need[i]):
            # Window must contain [left_need, right_need]: x in [right-cw, left].
            lo = max(lo, right_need[i] - cw)
            hi = min(hi, left_need[i])
        if lo <= hi:
            xs[i] = _clamp(smoothed[i], lo, hi)
        else:                                       # faces wider than cw — best effort
            xs[i] = _clamp((left_need[i] + right_need[i]) / 2 - cw / 2, 0.0, x_max)

    # Resample the per-sample path onto every output frame for a smooth pan.
    sample_t = idx / (m - 1) * duration if m > 1 else np.zeros(1)
    n_frames = max(2, int(round(duration * fps)))
    frame_t = np.arange(n_frames) / fps
    frame_x = np.interp(frame_t, sample_t, xs)
    _write_sendcmd(cmd_path, frame_t, frame_x)
    cmds_rel = cmd_path.relative_to(BASE_DIR).as_posix()    # ffmpeg run cwd=BASE_DIR

    return ("pan",
            f"[0:v]{_HEAD},sendcmd=f={cmds_rel},"
            f"crop={cw}:{ch}:{_even(frame_x[0])}:0,{_TAIL}",
            f"panning window — smoothed path follows faces ({len(have)}/{m} frames)")


def _plan_shot(sub: list[list[dict]], geom: tuple, fps: float,
               duration: float, cmd_path: Path) -> tuple[str, str, str]:
    """Reframe one shot: tier1 / static / pan / split. Returns (mode, fc, desc)."""
    src_w, src_h, cw, ch, pad, x_max = geom
    m = len(sub)
    if not any(sub):
        return ("tier1", center_crop_filter(src_w, src_h),
                f"centre crop — no faces in {m} frames")

    # Cluster every detection by x, then keep clusters dense enough to be a real
    # person. Within one shot the camera is fixed, so a genuine subject is a
    # cluster present in most frames; detector noise stays sparse.
    detections = [(i, f) for i in range(m) for f in sub[i]]
    clusters = _cluster_cx(detections, REFRAME_CLUSTER_GAP_FRAC * src_w)
    scored = [(len({i for i, _ in cl}) / m, cl) for cl in clusters]
    subjects = [cl for cov, cl in scored if cov >= REFRAME_SUBJECT_MIN_COVERAGE]
    if not subjects:                                # detection too spotty —
        subjects = [max(scored, key=lambda t: t[0])[1]]   # follow the best cluster

    # Cleaned per-frame faces: subject detections only (noise removed).
    sub_faces: list[list[dict]] = [[] for _ in range(m)]
    for cl in subjects:
        for i, f in cl:
            sub_faces[i].append(f)

    every = [f for frame in sub_faces for f in frame]
    env_lo = min(f["left"] for f in every) - pad
    env_hi = max(f["right"] for f in every) + pad
    if len(subjects) >= 2 and (env_hi - env_lo) > cw:
        split = _shot_split(subjects, src_w, src_h, pad)
        if split is not None:
            return split
        # source too narrow to split -> fall through to a single window

    return _shot_single(sub_faces, src_w, src_h, cw, ch, pad, x_max,
                        fps, duration, cmd_path)


# ── public entry point ───────────────────────────────────────────────────────


def plan(source: Path, start: float, end: float, src_w: int, src_h: int,
         fps: float, out_dir: Path) -> ReframePlan:
    """Decide how to reframe one candidate; return a ReframePlan for cut.py."""
    start, end = float(start), float(end)
    if not REFRAME_ENABLED:
        return tier1_plan(src_w, src_h, start, end, "reframe disabled")
    if not Path(REFRAME_MODEL).exists():
        return tier1_plan(src_w, src_h, start, end, "face model missing")

    cw, ch = _crop_size(src_w, src_h)
    if cw >= src_w:                                 # not wider than 9:16 — no pan room
        return tier1_plan(src_w, src_h, start, end, "source not wider than 9:16")

    duration = end - start
    if duration <= 0.5:
        return tier1_plan(src_w, src_h, start, end, "clip too short")

    det_w = min(int(src_w), REFRAME_DET_WIDTH)
    scale_back = src_w / det_w

    with tempfile.TemporaryDirectory(prefix="reframe_") as tmp:
        frames = _extract_frames(source, start, end, det_w, tmp)
        if len(frames) < 3:
            return tier1_plan(src_w, src_h, start, end, "too few detection frames")
        try:
            samples, sigs = _analyze_frames(frames, scale_back, src_h)
        except Exception as e:
            log.warning("reframe: face detection unavailable (%s)", e)
            return tier1_plan(src_w, src_h, start, end, "face detection unavailable")

    n = len(samples)
    if not any(samples):
        return tier1_plan(src_w, src_h, start, end, "no faces detected")

    # ── segment the span into camera shots ───────────────────────────────────
    shot_ranges = _build_shots(_detect_cuts(sigs), n)
    if len(shot_ranges) > REFRAME_MAX_SHOTS:        # too fast-cut for per-shot reframing
        return tier1_plan(src_w, src_h, start, end,
                          f"too fast-cut ({len(shot_ranges)} shots)")

    # Clip-relative shot boundaries. The 5 fps scan only knows a cut happened
    # between samples a-1 and a; the (a-0.5)/fps midpoint can sit ~0.15 s off
    # the real cut, so the crop switches a beat before the content does (a
    # visible "drag"). _refine_cut re-scans each boundary at the source frame
    # rate to land it exactly; on any failure the coarse midpoint is kept.
    n_shots = len(shot_ranges)
    bounds_t = [0.0]
    for k in range(1, n_shots):
        a = shot_ranges[k][0]
        coarse = _clamp((a - 0.5) / REFRAME_SAMPLE_FPS, 0.0, duration)
        precise = coarse
        lo = _clamp(coarse - REFRAME_CUT_REFINE_MARGIN, 0.0, duration)
        hi = _clamp(coarse + REFRAME_CUT_REFINE_MARGIN, 0.0, duration)
        if hi - lo > 2.0 / max(fps, 1.0):
            try:
                hit = _refine_cut(source, start + lo, start + hi, fps)
            except Exception:
                log.warning("reframe: cut refinement failed near %.2fs", coarse,
                            exc_info=True)
                hit = None
            if hit is not None:
                precise = _clamp(hit - start, 0.0, duration)
        bounds_t.append(precise)
    bounds_t.append(duration)
    for k in range(1, len(bounds_t)):               # keep boundaries monotonic
        if bounds_t[k] <= bounds_t[k - 1]:
            bounds_t[k] = min(duration, bounds_t[k - 1] + 2.0 / max(fps, 1.0))

    geom = (src_w, src_h, cw, ch, REFRAME_PAD_FRAC * cw, float(src_w - cw))

    shots: list[ShotPlan] = []
    for k, (a, b) in enumerate(shot_ranges):
        t0, t1 = bounds_t[k], bounds_t[k + 1]
        cmd_path = out_dir / f"reframe_s{k:02d}.txt"
        mode, fc, desc = _plan_shot(samples[a:b], geom, fps, t1 - t0, cmd_path)
        shots.append(ShotPlan(start + t0, start + t1, mode, fc,
                              f"shot {k + 1}/{n_shots} ({t1 - t0:.1f}s): {desc}"))

    if n_shots == 1:
        return ReframePlan(shots[0].mode, shots, shots[0].description)
    overall = f"{n_shots} shots ({'+'.join(s.mode for s in shots)})"
    detail = " | ".join(f"[{i + 1}]{s.mode}" for i, s in enumerate(shots))
    return ReframePlan(overall, shots, f"{n_shots} edited shots: {detail}")
