import json
from pathlib import Path

from clipper.config import YOUTUBE_CREDENTIALS_FILE, YOUTUBE_TOKEN_FILE, YOUTUBE_SCOPES


def _get_youtube_service():
    from googleapiclient.discovery import build
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request

    creds = None
    if YOUTUBE_TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(YOUTUBE_TOKEN_FILE), YOUTUBE_SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            raise RuntimeError(
                "YouTube credentials not found. "
                "Run setup_youtube_auth.py once to authenticate."
            )
        with open(YOUTUBE_TOKEN_FILE, "w") as f:
            f.write(creds.to_json())

    return build("youtube", "v3", credentials=creds)


def upload_video(video_path: str, title: str, description: str = "", tags: list = None) -> str:
    """Upload a video to YouTube as private. Returns the watch URL."""
    from googleapiclient.http import MediaFileUpload

    youtube = _get_youtube_service()
    body = {
        "snippet": {
            "title": title,
            "description": description,
            "tags": tags or [],
            "categoryId": "22",
        },
        "status": {"privacyStatus": "private"},
    }
    media = MediaFileUpload(str(video_path), chunksize=-1, resumable=True, mimetype="video/mp4")
    request = youtube.videos().insert(part=",".join(body.keys()), body=body, media_body=media)
    response = None
    while response is None:
        _, response = request.next_chunk()
    video_id = response["id"]
    return f"https://youtube.com/watch?v={video_id}"


def run(candidate: dict) -> str:
    """Upload a single approved candidate. Returns the YouTube URL."""
    if not candidate.get("output_path"):
        raise ValueError(f"Candidate {candidate['id']} has no output_path")
    title = candidate["title"]
    return upload_video(candidate["output_path"], title)
