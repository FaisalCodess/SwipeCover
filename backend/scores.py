import sqlite3
import time
from pathlib import Path
from threading import Lock

NAME_MIN_LENGTH = 3
NAME_MAX_LENGTH = 16
TOP_LIMIT = 10


def clean_name(name: str) -> str | None:
    """Collapses spaces and checks the name; letters in any script, digits, space, _ and -.

    Mirrored by NAME_PATTERN in frontend/src/api.js.
    """
    cleaned = " ".join(name.split())
    if not NAME_MIN_LENGTH <= len(cleaned) <= NAME_MAX_LENGTH:
        return None
    if not all(char.isalnum() or char in " _-" for char in cleaned):
        return None
    return cleaned


class ScoreStore:
    """Each player's best time per level per day. One row per (day, level, player)."""

    def __init__(self, path: Path | str):
        self._lock = Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.execute(
            """
            CREATE TABLE IF NOT EXISTS scores (
                day TEXT NOT NULL,
                level INTEGER NOT NULL,
                player_id TEXT NOT NULL,
                name TEXT NOT NULL,
                time_ms INTEGER NOT NULL,
                moves INTEGER NOT NULL,
                submitted_at REAL NOT NULL,
                PRIMARY KEY (day, level, player_id)
            )
            """
        )
        self._db.execute("CREATE INDEX IF NOT EXISTS scores_ranking ON scores (day, level, time_ms, submitted_at)")
        self._db.commit()

    def submit(self, day: str, level: int, player_id: str, name: str, time_ms: int, moves: int) -> dict:
        """Keeps the faster of the new and stored time, and returns the player's standing."""
        with self._lock:
            self._db.execute(
                """
                INSERT INTO scores (day, level, player_id, name, time_ms, moves, submitted_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (day, level, player_id) DO UPDATE SET
                    name = excluded.name,
                    time_ms = CASE WHEN excluded.time_ms < scores.time_ms THEN excluded.time_ms ELSE scores.time_ms END,
                    moves = CASE WHEN excluded.time_ms < scores.time_ms THEN excluded.moves ELSE scores.moves END,
                    submitted_at = CASE WHEN excluded.time_ms < scores.time_ms THEN excluded.submitted_at ELSE scores.submitted_at END
                """,
                (day, level, player_id, name, time_ms, moves, time.time()),
            )
            self._db.commit()
            return self._standing(day, level, player_id)

    def top(self, day: str, level: int, player_id: str | None = None) -> dict:
        with self._lock:
            rows = self._db.execute(
                """
                SELECT player_id, name, time_ms, moves FROM scores
                WHERE day = ? AND level = ?
                ORDER BY time_ms, submitted_at
                LIMIT ?
                """,
                (day, level, TOP_LIMIT),
            ).fetchall()
            entries = [
                {"rank": index + 1, "name": name, "time_ms": time_ms, "moves": moves, "you": row_player == player_id}
                for index, (row_player, name, time_ms, moves) in enumerate(rows)
            ]
            you = None
            if player_id and not any(entry["you"] for entry in entries):
                you = self._standing(day, level, player_id)
            total = self._db.execute("SELECT COUNT(*) FROM scores WHERE day = ? AND level = ?", (day, level)).fetchone()[0]
            return {"entries": entries, "you": you, "total": total}

    def _standing(self, day: str, level: int, player_id: str) -> dict | None:
        row = self._db.execute(
            "SELECT name, time_ms, moves, submitted_at FROM scores WHERE day = ? AND level = ? AND player_id = ?",
            (day, level, player_id),
        ).fetchone()
        if row is None:
            return None
        name, time_ms, moves, submitted_at = row
        ahead = self._db.execute(
            """
            SELECT COUNT(*) FROM scores
            WHERE day = ? AND level = ? AND (time_ms < ? OR (time_ms = ? AND submitted_at < ?))
            """,
            (day, level, time_ms, time_ms, submitted_at),
        ).fetchone()[0]
        return {"rank": ahead + 1, "name": name, "time_ms": time_ms, "moves": moves, "you": True}
