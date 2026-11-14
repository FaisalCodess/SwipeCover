"""Player accounts: the users table and login sessions.

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
RESET_SECONDS = 15 * 60
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128
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
                created_at REAL NOT NULL
            )
            """
        )
        self._db.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (email)")
        self._db.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users (username_lower)")
        self._db.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_google ON users (google_sub) WHERE google_sub IS NOT NULL")
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
            CREATE TABLE IF NOT EXISTS password_resets (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users (id),
                expires_at REAL NOT NULL
            )
            """
        )
        self._db.commit()

    # ---- accounts ----

    @staticmethod
    def _row(row) -> dict | None:
        if row is None:
            return None
        keys = ("id", "email", "username", "password_hash", "google_sub", "email_verified")
        return dict(zip(keys, row))

    _COLUMNS = "id, email, username, password_hash, google_sub, email_verified"

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
        """Removes the account and its logins."""
        with self._lock:
            self._db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            self._db.execute("DELETE FROM password_resets WHERE user_id = ?", (user_id,))
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

    # ---- forgotten passwords ----

    def new_reset(self, user_id: str) -> str:
        """A 6-digit, single-use code (valid for RESET_SECONDS) for choosing a new password.
        Asking again replaces the old one. Only a hash of it is stored."""
        code = f"{secrets.randbelow(1_000_000):06d}"
        now = time.time()
        with self._lock:
            self._db.execute("DELETE FROM password_resets WHERE expires_at < ? OR user_id = ?", (now, user_id))
            self._db.execute(
                "INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
                (_hash_token(f"{user_id}:{code}"), user_id, now + RESET_SECONDS),
            )
            self._db.commit()
        return code

    def use_reset(self, email: str, code: str, password_hash: str) -> dict | None:
        """Spends a reset code: sets the new password, logs every device out, and returns the user.
        None if the email or code is wrong, used or expired. Being able to read the email proves it is theirs.
        The caller must rate-limit attempts: a 6-digit code is only safe with a handful of guesses."""
        code = code.strip().replace(" ", "")
        user = self.by_email(email)
        if user is None or not code.isdigit() or len(code) != 6:
            return None
        user_id = user["id"]
        with self._lock:
            row = self._db.execute(
                "SELECT user_id FROM password_resets WHERE token_hash = ? AND expires_at > ?", (_hash_token(f"{user_id}:{code}"), time.time())
            ).fetchone()
            if row is None:
                return None
            self._db.execute("DELETE FROM password_resets WHERE user_id = ?", (user_id,))
            self._db.execute("UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?", (password_hash, user_id))
            self._db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            self._db.commit()
        return self.by_id(user_id)
