"""
One-time YouTube OAuth2 setup. Run this script once before using the publish feature.

Prerequisites:
  1. Create a project at https://console.cloud.google.com/
  2. Enable the YouTube Data API v3
  3. Create an OAuth 2.0 client (Desktop app) and download the JSON
  4. Save it as credentials/client_secret.json

Then run:
  python setup_youtube_auth.py
"""
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]
CREDS_FILE = Path(__file__).parent / "credentials" / "client_secret.json"
TOKEN_FILE  = Path(__file__).parent / "credentials" / "token.json"


def main():
    if not CREDS_FILE.exists():
        print(f"ERROR: {CREDS_FILE} not found.")
        print("Download your OAuth2 client secret from Google Cloud Console and save it there.")
        return

    flow = InstalledAppFlow.from_client_secrets_file(str(CREDS_FILE), SCOPES)
    creds = flow.run_local_server(port=0)
    TOKEN_FILE.write_text(creds.to_json())
    print(f"Authentication successful. Token saved to {TOKEN_FILE}")


if __name__ == "__main__":
    main()
