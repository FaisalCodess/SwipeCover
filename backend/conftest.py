from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

import main
from accounts import RateLimiter, UserStore, hash_password
from scores import ScoreStore
from versus import Hub


@pytest.fixture
def client(tmp_path, monkeypatch):
    """The API on a throwaway database. The `with` keeps one event loop for every request and
    WebSocket in a test, which the 1v1 server (it shares state between connections) needs."""
    db = tmp_path / "scores.db"
    users = UserStore(db)
    monkeypatch.setattr(main, "store", ScoreStore(db))
    monkeypatch.setattr(main, "users", users)
    monkeypatch.setattr(main, "hub", Hub(users))
    monkeypatch.setattr(main, "limiter", RateLimiter())
    with TestClient(main.app) as test_client:
        yield test_client


@pytest.fixture
def signup(client):
    """Makes an account and returns `{"headers": ..., "user": ..., "token": ...}`."""

    def make(name="Player One"):
        # Straight into the database, so tests that need many players do not hit the sign-up limit.
        email = f"{name.lower().replace(' ', '_')}-{uuid4().hex[:6]}@example.com"
        user = main.users.create(email, name, password_hash=hash_password("correct horse battery"))
        token = main.users.new_session(user["id"])
        return {"headers": {"Authorization": f"Bearer {token}"}, "user": user, "token": token, "email": email}

    return make
