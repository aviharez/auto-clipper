import json
import re
import subprocess
from pathlib import Path

_VIDEO_EXTS = {".mp4", ".mkv", ".webm", ".m4v"}
_AUDIO_EXTS = {".m4a", ".ogg", ".opus", ".webm"}


def _find_source_files(job_dir: Path):
    """Return (video_path, audio_path) of any yt-dlp intermediate files."""
    video, audio = None, None
    for p in job_dir.iterdir():
        if not p.stem.startswith("source"):
            continue
        if p.suffix in _VIDEO_EXTS:
            # Prefer the largest video file
            if video is None or p.stat().st_size > video.stat().st_size:
                video = p
        elif p.suffix in _AUDIO_EXTS:
            audio = p
    return video, audio


_PCT_RE = re.compile(r'\[download\]\s+([\d.]+)%')


def run(job: dict) -> dict:
    """Download source video + metadata. Returns updated job fields."""
    from clipper.config import JOBS_DIR
    import clipper.jobs as _db

    job_id  = job["id"]
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    def _on_progress(pct: int):
        _db.update_job(job_id, download_progress=pct)

    merged_path = job_dir / "source.mp4"
    metadata_path = job_dir / "metadata.json"

    # Skip download if the merged file already exists (e.g. retrying after a cut failure)
    if not merged_path.exists():
        video, audio = _find_source_files(job_dir)

        if video and audio and video != merged_path:
            # yt-dlp left separate files (ffmpeg was missing during yt-dlp run).
            # Merge them now that ffmpeg is available.
            _ffmpeg_merge(video, audio, merged_path)
            video.unlink(missing_ok=True)
            audio.unlink(missing_ok=True)
        elif video and not audio and video != merged_path:
            # Single stream (audio already muxed in) — just rename.
            video.rename(merged_path)
        else:
            # Nothing useful on disk — run yt-dlp.
            _yt_dlp_download(job["source_url"], job_dir, on_progress=_on_progress)

            # Rename .info.json written by yt-dlp
            for f in job_dir.glob("source.info.json"):
                f.rename(metadata_path)

            if not merged_path.exists():
                # yt-dlp left separate files again (ffmpeg still missing?).
                video, audio = _find_source_files(job_dir)
                if video and audio:
                    _ffmpeg_merge(video, audio, merged_path)
                    video.unlink(missing_ok=True)
                    audio.unlink(missing_ok=True)
                elif video:
                    video.rename(merged_path)
                else:
                    raise FileNotFoundError(
                        f"Downloaded video not found in {job_dir}. "
                        "Make sure ffmpeg is installed and in PATH."
                    )

    # Rename any leftover .info.json from yt-dlp if metadata not yet written
    if not metadata_path.exists():
        for f in job_dir.glob("source.info.json"):
            f.rename(metadata_path)

    metadata = {}
    if metadata_path.exists():
        with open(metadata_path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        metadata = {"title": raw.get("title", ""), "uploader": raw.get("uploader", "")}

    return {
        "source_video_path": str(merged_path),
        "metadata_json": json.dumps(metadata),
    }


def _yt_dlp_download(source_url: str, job_dir: Path, on_progress=None):
    proc = subprocess.Popen(
        [
            "yt-dlp",
            "--format",
            "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]"
            "/bestvideo[ext=mp4]+bestaudio"
            "/best[ext=mp4]/best",
            "--merge-output-format", "mp4",
            "--write-info-json",
            "--no-playlist",
            "--output", str(job_dir / "source.%(ext)s"),
            source_url,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    for line in proc.stdout:
        if on_progress:
            m = _PCT_RE.search(line)
            if m:
                on_progress(int(float(m.group(1))))

    proc.wait()
    if proc.returncode != 0:
        raise subprocess.CalledProcessError(proc.returncode, "yt-dlp")


def _ffmpeg_merge(video: Path, audio: Path, out: Path):
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", str(video),
            "-i", str(audio),
            "-c:v", "copy",
            "-c:a", "aac",
            "-movflags", "+faststart",
            str(out),
        ],
        check=True,
    )
