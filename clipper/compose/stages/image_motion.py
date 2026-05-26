import subprocess


def render_image_segment(src: str, dur: float, motion: str, out_path: str) -> None:
    """Render a static image with optional motion into a 1080x1920 normalized.mp4."""
    frames = int(dur * 30)

    if motion == "zoom_in":
        vf = (
            f"scale=2160:3840,"
            f"zoompan=z='min(zoom+0.0008,1.3)':d={frames}:s=1080x1920:fps=30,"
            f"format=yuv420p"
        )
    elif motion == "zoom_out":
        # Start at 1.3x zoom, gradually return to 1.0
        vf = (
            f"scale=2160:3840,"
            f"zoompan=z='max(1.3-on*0.0008,1.0)':d={frames}:s=1080x1920:fps=30,"
            f"format=yuv420p"
        )
    elif motion == "slide_lr":
        # Wider canvas; crop window moves left → right
        vf = (
            f"scale=2160:1920,"
            f"crop=1080:1920:x='(iw-ow)*t/{dur}':y=0,"
            f"fps=30,format=yuv420p"
        )
    elif motion == "slide_rl":
        # Wider canvas; crop window moves right → left
        vf = (
            f"scale=2160:1920,"
            f"crop=1080:1920:x='(iw-ow)*(1-t/{dur})':y=0,"
            f"fps=30,format=yuv420p"
        )
    else:
        # static (default)
        vf = (
            "scale=1080:1920:force_original_aspect_ratio=increase,"
            "crop=1080:1920,setsar=1,format=yuv420p"
        )

    cmd = [
        "ffmpeg", "-y",
        "-loop", "1", "-framerate", "30", "-i", src,
        "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
        "-vf", vf,
        "-t", str(dur),
        "-c:v", "libx264", "-crf", "18", "-preset", "medium",
        "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        "-movflags", "+faststart",
        out_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"image_motion ffmpeg failed ({motion}):\n{result.stderr[-2000:]}")
