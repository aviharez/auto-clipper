import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from clipper.config import DB_PATH, JOBS_DIR


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_dirs():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    JOBS_DIR.mkdir(parents=True, exist_ok=True)


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    _ensure_dirs()
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS jobs (
                id          TEXT PRIMARY KEY,
                source_url  TEXT NOT NULL,
                status      TEXT NOT NULL DEFAULT 'pending',
                error       TEXT,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL,
                yaml_path   TEXT,
                source_video_path TEXT,
                metadata_json     TEXT
            );
            CREATE TABLE IF NOT EXISTS candidates (
                id              TEXT PRIMARY KEY,
                job_id          TEXT NOT NULL,
                idx             INTEGER NOT NULL,
                start           REAL NOT NULL,
                end             REAL NOT NULL,
                title           TEXT NOT NULL,
                hook_text       TEXT,
                hook_enabled    INTEGER NOT NULL DEFAULT 1,
                hook_background TEXT NOT NULL DEFAULT 'blur_self',
                needs_caption   INTEGER NOT NULL DEFAULT 1,
                caption_preset  TEXT,
                hook_preset     TEXT,
                rank            INTEGER,
                origin          TEXT NOT NULL DEFAULT 'manual',
                status          TEXT NOT NULL DEFAULT 'pending',
                error           TEXT,
                output_path     TEXT,
                approved        INTEGER NOT NULL DEFAULT 0,
                youtube_url     TEXT,
                FOREIGN KEY (job_id) REFERENCES jobs(id)
            );
        """)


# ── Jobs ────────────────────────────────────────────────────────────────────


def create_job(source_url: str, yaml_path: str) -> str:
    job_id = str(uuid.uuid4())
    now = _now()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO jobs (id, source_url, status, created_at, updated_at, yaml_path)"
            " VALUES (?, ?, 'pending', ?, ?, ?)",
            (job_id, source_url, now, now, yaml_path),
        )
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    (job_dir / "clips").mkdir(exist_ok=True)
    return job_id


def get_job(job_id: str) -> Optional[dict]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return dict(row) if row else None


def list_jobs() -> list:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM jobs ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]


def update_job(job_id: str, **fields):
    fields["updated_at"] = _now()
    cols = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        conn.execute(
            f"UPDATE jobs SET {cols} WHERE id = ?", (*fields.values(), job_id)
        )


# ── Candidates ───────────────────────────────────────────────────────────────


def insert_candidate(job_id: str, idx: int, cand: dict) -> str:
    cand_id = str(uuid.uuid4())
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO candidates
                 (id, job_id, idx, start, end, title, hook_text, hook_enabled,
                  hook_background, needs_caption, caption_preset, hook_preset, rank, origin)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                cand_id, job_id, idx,
                cand["start"], cand["end"], cand["title"],
                cand.get("hook_text"),
                int(cand.get("hook_enabled", True)),
                cand.get("hook_background", "blur_self"),
                int(cand.get("needs_caption", True)),
                cand.get("caption_preset"),
                cand.get("hook_preset"),
                cand.get("rank"),
                cand.get("origin", "manual"),
            ),
        )
    clip_dir = JOBS_DIR / job_id / "clips" / cand_id
    clip_dir.mkdir(parents=True, exist_ok=True)
    return cand_id


def get_candidates(job_id: str) -> list:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM candidates WHERE job_id = ? ORDER BY idx", (job_id,)
        ).fetchall()
        return [dict(r) for r in rows]


def get_candidate(cand_id: str) -> Optional[dict]:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM candidates WHERE id = ?", (cand_id,)
        ).fetchone()
        return dict(row) if row else None


def update_candidate(cand_id: str, **fields):
    cols = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        conn.execute(
            f"UPDATE candidates SET {cols} WHERE id = ?", (*fields.values(), cand_id)
        )


def list_candidates_all(source_url: str = None, status: str = None) -> list:
    with get_conn() as conn:
        q = (
            "SELECT c.*, j.source_url, j.created_at as job_created_at"
            " FROM candidates c JOIN jobs j ON j.id = c.job_id"
        )
        params: list = []
        where: list = []
        if source_url:
            where.append("j.source_url = ?")
            params.append(source_url)
        if status == "approved":
            where.append("c.approved = 1")
        elif status:
            where.append("c.status = ?")
            params.append(status)
        if where:
            q += " WHERE " + " AND ".join(where)
        q += " ORDER BY j.created_at DESC, c.idx"
        rows = conn.execute(q, params).fetchall()
        return [dict(r) for r in rows]


def list_unique_sources() -> list:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT DISTINCT j.source_url FROM candidates c"
            " JOIN jobs j ON j.id = c.job_id ORDER BY j.source_url"
        ).fetchall()
        return [r[0] for r in rows]
