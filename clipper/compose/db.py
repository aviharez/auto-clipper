import uuid
from pathlib import Path
from typing import Optional

from clipper.jobs import get_conn, _now
from clipper.config import DATA_DIR

COMPOSITIONS_DIR = DATA_DIR / "compositions"


def _comp_dir(comp_id: str) -> Path:
    return COMPOSITIONS_DIR / comp_id


# ── Compositions ──────────────────────────────────────────────────────────────


def create_composition(title: str = "Untitled draft") -> str:
    comp_id = str(uuid.uuid4())
    now = _now()
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO compositions
               (id, title, status, created_at, updated_at)
               VALUES (?, ?, 'draft', ?, ?)""",
            (comp_id, title, now, now),
        )
    _comp_dir(comp_id).mkdir(parents=True, exist_ok=True)
    ((_comp_dir(comp_id)) / "segments").mkdir(exist_ok=True)
    return comp_id


def get_composition(comp_id: str) -> Optional[dict]:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM compositions WHERE id = ?", (comp_id,)
        ).fetchone()
        return dict(row) if row else None


def list_compositions() -> list:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT c.*, (
                 SELECT COUNT(*) FROM composition_segments s WHERE s.composition_id = c.id
               ) AS segment_count
               FROM compositions c
               ORDER BY c.updated_at DESC"""
        ).fetchall()
        return [dict(r) for r in rows]


def update_composition(comp_id: str, **fields):
    fields["updated_at"] = _now()
    cols = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        conn.execute(
            f"UPDATE compositions SET {cols} WHERE id = ?",
            (*fields.values(), comp_id),
        )


def delete_composition(comp_id: str):
    import shutil
    with get_conn() as conn:
        conn.execute("DELETE FROM composition_sfx WHERE composition_id = ?", (comp_id,))
        conn.execute("DELETE FROM composition_voice_ranges WHERE composition_id = ?", (comp_id,))
        conn.execute("DELETE FROM composition_segments WHERE composition_id = ?", (comp_id,))
        conn.execute("DELETE FROM compositions WHERE id = ?", (comp_id,))
    comp_path = _comp_dir(comp_id)
    if comp_path.exists():
        shutil.rmtree(str(comp_path))


# ── Segments ──────────────────────────────────────────────────────────────────


def create_segment(comp_id: str, kind: str, source_url: str = None, label: str = None) -> dict:
    seg_id = str(uuid.uuid4())
    with get_conn() as conn:
        next_idx = (conn.execute(
            "SELECT COALESCE(MAX(idx) + 1, 0) FROM composition_segments WHERE composition_id = ?",
            (comp_id,),
        ).fetchone()[0])
        conn.execute(
            """INSERT INTO composition_segments
               (id, composition_id, idx, kind, source_url, label, status)
               VALUES (?, ?, ?, ?, ?, ?, 'pending')""",
            (seg_id, comp_id, next_idx, kind, source_url, label),
        )
    seg_dir = _comp_dir(comp_id) / "segments" / str(next_idx)
    seg_dir.mkdir(parents=True, exist_ok=True)
    update_composition(comp_id)  # bump updated_at
    return {"id": seg_id, "idx": next_idx}


def get_segments(comp_id: str) -> list:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM composition_segments WHERE composition_id = ? ORDER BY idx",
            (comp_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_segment(seg_id: str) -> Optional[dict]:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM composition_segments WHERE id = ?", (seg_id,)
        ).fetchone()
        return dict(row) if row else None


def update_segment(seg_id: str, **fields):
    cols = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        seg = conn.execute(
            "SELECT composition_id FROM composition_segments WHERE id = ?", (seg_id,)
        ).fetchone()
        conn.execute(
            f"UPDATE composition_segments SET {cols} WHERE id = ?",
            (*fields.values(), seg_id),
        )
    if seg:
        update_composition(seg["composition_id"])


def delete_segment(seg_id: str):
    import shutil
    with get_conn() as conn:
        row = conn.execute(
            "SELECT composition_id, idx FROM composition_segments WHERE id = ?", (seg_id,)
        ).fetchone()
        conn.execute("DELETE FROM composition_segments WHERE id = ?", (seg_id,))
    if row:
        seg_dir = _comp_dir(row["composition_id"]) / "segments" / str(row["idx"])
        if seg_dir.exists():
            shutil.rmtree(str(seg_dir), ignore_errors=True)
        update_composition(row["composition_id"])


def reorder_segments(comp_id: str, ordered_ids: list):
    with get_conn() as conn:
        for new_idx, seg_id in enumerate(ordered_ids):
            conn.execute(
                "UPDATE composition_segments SET idx = ? WHERE id = ? AND composition_id = ?",
                (new_idx, seg_id, comp_id),
            )
    update_composition(comp_id)


# ── Voice ranges ──────────────────────────────────────────────────────────────


def replace_voice_ranges(comp_id: str, ranges: list) -> list:
    now = _now()
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM composition_voice_ranges WHERE composition_id = ?", (comp_id,)
        )
        ids = []
        for r in ranges:
            rid = str(uuid.uuid4())
            conn.execute(
                """INSERT INTO composition_voice_ranges
                   (id, composition_id, segment_idx, start_sec, end_sec, snippet)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (rid, comp_id, r["segment_idx"], r["start_sec"], r["end_sec"], r.get("snippet")),
            )
            ids.append(rid)
    return ids


def get_voice_ranges(comp_id: str) -> list:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM composition_voice_ranges WHERE composition_id = ? ORDER BY start_sec",
            (comp_id,),
        ).fetchall()
        return [dict(r) for r in rows]


# ── SFX drops ──────────────────────────────────────────────────────────────────


def create_sfx(comp_id: str, at_sec: float, file: str, gain_db: float = -6.0) -> str:
    sfx_id = str(uuid.uuid4())
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO composition_sfx (id, composition_id, at_sec, file, gain_db)
               VALUES (?, ?, ?, ?, ?)""",
            (sfx_id, comp_id, at_sec, file, gain_db),
        )
    return sfx_id


def get_sfx(comp_id: str) -> list:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM composition_sfx WHERE composition_id = ? ORDER BY at_sec",
            (comp_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def update_sfx(sfx_id: str, **fields):
    cols = ", ".join(f"{k} = ?" for k in fields)
    with get_conn() as conn:
        conn.execute(
            f"UPDATE composition_sfx SET {cols} WHERE id = ?",
            (*fields.values(), sfx_id),
        )


def delete_sfx(sfx_id: str):
    with get_conn() as conn:
        conn.execute("DELETE FROM composition_sfx WHERE id = ?", (sfx_id,))


# ── History helper ────────────────────────────────────────────────────────────


def list_compositions_for_history() -> list:
    """Return compositions in a unified history row shape (for /api/history?pipeline=compose)."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, title, niche, status, final_path, last_render_path, "
            "delivery_status, delivery_url, created_at, updated_at "
            "FROM compositions ORDER BY updated_at DESC"
        ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["pipeline"] = "compose"
        d["job_created_at"] = d["updated_at"]
        result.append(d)
    return result
