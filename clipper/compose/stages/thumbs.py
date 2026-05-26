import subprocess
from pathlib import Path


def extract_thumbs(video_path: str, out_dir: str, every_sec: float = 0.5) -> None:
    """Extract frames every `every_sec` seconds into out_dir/1.jpg, 2.jpg, ..."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    fps = 1.0 / every_sec  # e.g. 2 fps for every 0.5s
    cmd = [
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-vf", f"fps={fps},scale=50:-2",
        "-q:v", "5",
        str(out / "%d.jpg"),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"thumb extraction failed:\n{result.stderr[-1000:]}")
