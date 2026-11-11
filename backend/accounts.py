"""Player accounts: the users table, login sessions and 1v1 ratings.

Passwords are hashed with scrypt (standard library, no extra dependency) and sessions are random
tokens of which only a SHA-256 hash is stored, so a copy of the database can neither reveal a
password nor be used to log in.
"""
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import time
from collections import defaultdict, deque
from pathlib import Path
from threading import Lock
from uuid import uuid4

SESSION_SECONDS = 30 * 24 * 60 * 60
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128
START_RATING = 1000
RATING_K = 32
EMAIL_PATTERN = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$")
SCRYPT = {"n": 2**14, "r": 8, "p": 1, "maxmem": 64 * 1024 * 1024}


# Names that are rude, or that pretend to be the game's staff. Matched after turning look-alike
# characters back into letters (f u c k, f*ck, $h1t...). A starting point, not a complete filter:
# add to it as players report names.
BLOCKED_PARTS = (
    "fuck", "shit", "bitch", "cunt", "nigg", "fagg", "whore", "slut", "pussy", "asshole", "bastard",
    "porn", "penis", "vagina", "retard", "nazi", "hitler", "rapist", "admin", "moderator", "swipecover", "official",
)
LOOKALIKES = str.maketrans("013457@$!|", "oieastasii")


def name_is_blocked(username: str) -> bool:
    squashed = "".join(char for char in username.lower().translate(LOOKALIKES) if char.isalnum())
    return any(part in squashed for part in BLOCKED_PARTS)


class AccountError(Exception):
    """Something the player can fix; the message is shown to them."""


def clean_email(email: str) -> str | None:
    email = email.strip().lower()
    return email if len(email) <= 254 and EMAIL_PATTERN.match(email) else None


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        return False
    try:
        _, salt, digest = stored.split("$")
        expected = bytes.fromhex(digest)
        actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), **SCRYPT)
    except ValueError:
        return False
    return hmac.compare_digest(actual, expected)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def expected_score(rating: float, other: float) -> float:
    return 1 / (1 + 10 ** ((other - rating) / 400))


class RateLimiter:
    """Allows `limit` hits per `window` seconds for each key. In memory, so per server process."""

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str, limit: int, window: float) -> bool:
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] > window:
                hits.popleft()
            if len(hits) >= limit:
                return False
            hits.append(now)
            if len(self._hits) > 10000:  # drop idle keys so a flood of addresses cannot grow this forever
                for stale in [name for name, queue in self._hits.items() if not queue or now - queue[-1] > window]:
                    del self._hits[stale]
            return True


class UserStore:
    def __init__(self, path: Path | str):
        self._lock = Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA busy_timeout=5000")
        self._db.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                username TEXT NOT NULL,
                username_lower TEXT NOT NULL,
                password_hash TEXT,
                google_sub TEXT,
                email_verified INTEGER NOT NULL DEFAULT 0,
                created_at REAL NOT NULL,
                rating INTEGER NOT NULL DEFAULT 1000,
                wins INTEGER NOT NULL DEFAULT 0,
                losses INTEGER NOT NULL DEFAULT 0,
                draws INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        self._db.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (email)")
        self._db.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users (username_lower)")
        self._db.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_google ON users (google_sub) WHERE google_sub IS NOT NULL")
        self._db.execute("CREATE INDEX IF NOT EXISTS users_rating ON users (rating DESC, wins DESC)")
        self._db.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users (id),
                expires_at REAL NOT NULL
            )
            """
        )
        self._db.execute(
            """
            CREATE TABLE IF NOT EXISTS matches (
                id TEXT PRIMARY KEY,
                seed TEXT NOT NULL,
                player_a TEXT NOT NULL,
                player_b TEXT NOT NULL,
                score_a INTEGER NOT NULL,
                score_b INTEGER NOT NULL,
                winner TEXT,
                ranked INTEGER NOT NULL,
                finished_at REAL NOT NULL
            )
            """
        )
        self._db.commit()

    # ---- accounts ----

    @staticmethod
    def _row(row) -> dict | None:
        if row is None:
            return None
        keys = ("id", "email", "username", "password_hash", "google_sub", "email_verified", "rating", "wins", "losses", "draws")
        return dict(zip(keys, row))

    _COLUMNS = "id, email, username, password_hash, google_sub, email_verified, rating, wins, losses, draws"

    def _one(self, where: str, *args) -> dict | None:
        with self._lock:
            return self._row(self._db.execute(f"SELECT {self._COLUMNS} FROM users WHERE {where}", args).fetchone())

    def by_id(self, user_id: str) -> dict | None:
        return self._one("id = ?", user_id)

    def by_email(self, email: str) -> dict | None:
        return self._one("email = ?", email)

    def by_username(self, username: str) -> dict | None:
        return self._one("username_lower = ?", username.lower())

    def by_google(self, sub: str) -> dict | None:
        return self._one("google_sub = ?", sub)

    def create(self, email: str, username: str, *, password_hash: str | None = None, google_sub: str | None = None) -> dict:
        user_id = str(uuid4())
        with self._lock:
            try:
                self._db.execute(
                    """
                    INSERT INTO users (id, email, username, username_lower, password_hash, google_sub, email_verified, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (user_id, email, username, username.lower(), password_hash, google_sub, int(google_sub is not None), time.time()),
                )
                self._db.commit()
            except sqlite3.IntegrityError as error:
                self._db.rollback()
                taken = "email" if "email" in str(error) else "username" if "username" in str(error) else "account"
                raise AccountError(
                    {"email": "That email already has an account. Try logging in.",
                     "username": "That username is taken."}.get(taken, "That account already exists.")
                ) from error
        return self.by_id(user_id)

    def rename(self, user_id: str, username: str) -> dict:
        with self._lock:
            try:
                self._db.execute("UPDATE users SET username = ?, username_lower = ? WHERE id = ?", (username, username.lower(), user_id))
                self._db.commit()
            except sqlite3.IntegrityError as error:
                self._db.rollback()
                raise AccountError("That username is taken.") from error
        return self.by_id(user_id)

    def delete(self, user_id: str) -> None:
        """Removes the account and its logins. Past matches stay (the other player's history), but
        no longer name this player."""
        with self._lock:
            self._db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            self._db.execute("UPDATE matches SET player_a = 'deleted' WHERE player_a = ?", (user_id,))
            self._db.execute("UPDATE matches SET player_b = 'deleted' WHERE player_b = ?", (user_id,))
            self._db.execute("UPDATE matches SET winner = 'deleted' WHERE winner = ?", (user_id,))
            self._db.execute("DELETE FROM users WHERE id = ?", (user_id,))
            self._db.commit()

    def link_google(self, user_id: str, sub: str) -> dict:
        """A verified Google login proves the email is theirs. Any password set before then is
        dropped, because without email verification someone else could have registered it."""
        with self._lock:
            self._db.execute(
                "UPDATE users SET google_sub = ?, email_verified = 1, password_hash = CASE WHEN email_verified = 0 THEN NULL ELSE password_hash END WHERE id = ?",
                (sub, user_id),
            )
            self._db.commit()
        return self.by_id(user_id)

    # ---- sessions ----

    def new_session(self, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        now = time.time()
        with self._lock:
            self._db.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
            self._db.execute("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", (_hash_token(token), user_id, now + SESSION_SECONDS))
            self._db.commit()
        return token

    def user_for_token(self, token: str | None) -> dict | None:
        if not token or len(token) > 200:
            return None
        with self._lock:
            row = self._db.execute(
                f"SELECT {', '.join('u.' + c.strip() for c in self._COLUMNS.split(','))} FROM sessions s JOIN users u ON u.id = s.user_id "
                "WHERE s.token_hash = ? AND s.expires_at > ?",
                (_hash_token(token), time.time()),
            ).fetchone()
        return self._row(row)

    def end_session(self, token: str) -> None:
        with self._lock:
            self._db.execute("DELETE FROM sessions WHERE token_hash = ?", (_hash_token(token),))
            self._db.commit()

    # ---- 1v1 ----

    def record_match(self, match_id: str, seed: str, a: str, b: str, score_a: int, score_b: int, outcome_a: float, ranked: bool) -> dict:
        """Stores a finished match. `outcome_a` is 1 if `a` won, 0 if `b` did, 0.5 for a draw.
        Ranked matches move both ratings; returns each player's new rating and the change."""
        with self._lock:
            result = {a: (None, 0), b: (None, 0)}
            if ranked:
                rating = {uid: self._db.execute("SELECT rating FROM users WHERE id = ?", (uid,)).fetchone()[0] for uid in (a, b)}
                change_a = round(RATING_K * (outcome_a - expected_score(rating[a], rating[b])))
                for uid, delta, outcome in ((a, change_a, outcome_a), (b, -change_a, 1 - outcome_a)):
                    column = "wins" if outcome == 1 else "losses" if outcome == 0 else "draws"
                    self._db.execute(f"UPDATE users SET rating = rating + ?, {column} = {column} + 1 WHERE id = ?", (delta, uid))
                    result[uid] = (rating[uid] + delta, delta)
            winner = a if outcome_a == 1 else b if outcome_a == 0 else None
            self._db.execute(
                "INSERT INTO matches (id, seed, player_a, player_b, score_a, score_b, winner, ranked, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (match_id, seed, a, b, score_a, score_b, winner, int(ranked), time.time()),
            )
            self._db.commit()
        return result

    def top_versus(self, user_id: str | None = None, limit: int = 10) -> dict:
        with self._lock:
            rows = self._db.execute(
                "SELECT id, username, rating, wins, losses, draws FROM users WHERE wins + losses + draws > 0 "
                "ORDER BY rating DESC, wins DESC, created_at LIMIT ?",
                (limit,),
            ).fetchall()
            entries = [
                {"rank": index + 1, "name": name, "rating": rating, "wins": wins, "losses": losses, "draws": draws, "you": uid == user_id}
                for index, (uid, name, rating, wins, losses, draws) in enumerate(rows)
            ]
            you = None
            if user_id and not any(entry["you"] for entry in entries):
                row = self._db.execute("SELECT username, rating, wins, losses, draws FROM users WHERE id = ?", (user_id,)).fetchone()
                if row and sum(row[2:]) > 0:
                    ahead = self._db.execute(
                        "SELECT COUNT(*) FROM users WHERE wins + losses + draws > 0 AND (rating > ? OR (rating = ? AND wins > ?))",
                        (row[1], row[1], row[2]),
                    ).fetchone()[0]
                    you = {"rank": ahead + 1, "name": row[0], "rating": row[1], "wins": row[2], "losses": row[3], "draws": row[4], "you": True}
            total = self._db.execute("SELECT COUNT(*) FROM users WHERE wins + losses + draws > 0").fetchone()[0]
        return {"entries": entries, "you": you, "total": total}
