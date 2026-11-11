import main
from accounts import RateLimiter, hash_password, verify_password


def register(client, **overrides):
    body = {"email": "ann@example.com", "username": "Ann Lee", "password": "correct horse", **overrides}
    return client.post("/api/auth/register", json=body)


def test_registering_gives_a_session(client):
    response = register(client)
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["username"] == "Ann Lee" and body["user"]["email"] == "ann@example.com"
    assert "password_hash" not in body["user"] and body["user"]["has_password"] is True
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['token']}"})
    assert me.status_code == 200 and me.json()["user"]["id"] == body["user"]["id"]


def test_email_and_username_are_unique_whatever_the_case(client):
    assert register(client).status_code == 200
    assert register(client, username="Other One", email="ANN@example.com").status_code == 409
    assert register(client, username="ann lee", email="other@example.com").status_code == 409


def test_rejects_bad_details(client):
    assert register(client, email="not-an-email").status_code == 422
    assert register(client, username="ab").status_code == 422
    assert register(client, username="<script>").status_code == 422
    assert register(client, password="short").status_code == 422
    assert client.post("/api/auth/register", json={"email": "a@b.co"}).status_code == 422


def test_log_in_with_email_or_username(client):
    register(client)
    by_email = client.post("/api/auth/login", json={"identifier": "Ann@Example.com", "password": "correct horse"})
    by_name = client.post("/api/auth/login", json={"identifier": "ann lee", "password": "correct horse"})
    assert by_email.status_code == 200 and by_name.status_code == 200
    assert by_email.json()["token"] != by_name.json()["token"]


def test_wrong_credentials_are_refused_without_saying_which_part(client):
    register(client)
    wrong = client.post("/api/auth/login", json={"identifier": "ann@example.com", "password": "wrong password"})
    unknown = client.post("/api/auth/login", json={"identifier": "nobody@example.com", "password": "correct horse"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


def test_logging_out_ends_the_session(client):
    token = register(client).json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.post("/api/auth/logout", headers=headers).status_code == 200
    assert client.get("/api/auth/me", headers=headers).status_code == 401
    assert client.get("/api/auth/me").status_code == 401


def test_repeated_wrong_passwords_are_slowed_down(client):
    register(client)
    codes = [client.post("/api/auth/login", json={"identifier": "ann@example.com", "password": f"guess {n}"}).status_code for n in range(10)]
    assert codes[:8] == [401] * 8 and codes[8:] == [429, 429]


def test_secrets_are_not_stored_in_the_clear(client):
    token = register(client).json()["token"]
    rows = main.users._db.execute("SELECT password_hash FROM users").fetchall()
    assert rows[0][0].startswith("scrypt$") and "correct horse" not in rows[0][0]
    stored = [row[0] for row in main.users._db.execute("SELECT token_hash FROM sessions")]
    assert token not in stored and len(stored) == 1


def test_password_hashing_round_trips():
    stored = hash_password("hunter2hunter2")
    assert verify_password("hunter2hunter2", stored)
    assert not verify_password("hunter3hunter3", stored)
    assert not verify_password("anything", None) and not verify_password("anything", "garbage")


def test_rate_limiter_forgets_old_hits():
    limiter = RateLimiter()
    assert [limiter.allow("k", 2, 60) for _ in range(3)] == [True, True, False]
    assert limiter.allow("other", 2, 60)


# ---- Google ----


def test_google_sign_in_is_off_until_configured(client):
    assert client.get("/api/config").json() == {"google_client_id": None, "contact_email": None}
    assert client.post("/api/auth/google", json={"credential": "x"}).status_code == 404


def test_google_sign_in_creates_and_links_accounts(client, monkeypatch):
    monkeypatch.setattr(main, "GOOGLE_CLIENT_ID", "client-id")
    claims = {"sub": "g-1", "email": "gina@example.com"}
    monkeypatch.setattr(main, "_verify_google", lambda credential: claims)
    assert client.get("/api/config").json()["google_client_id"] == "client-id"

    # A first visit has no username yet: the browser is asked to pick one.
    first = client.post("/api/auth/google", json={"credential": "token"})
    assert first.json() == {"needs_username": True, "email": "gina@example.com"}
    assert client.post("/api/auth/google", json={"credential": "token", "username": "no"}).status_code == 422
    created = client.post("/api/auth/google", json={"credential": "token", "username": "Gina G"})
    assert created.status_code == 200 and created.json()["user"]["username"] == "Gina G"

    # Next time it just logs in.
    again = client.post("/api/auth/google", json={"credential": "token"})
    assert again.status_code == 200 and again.json()["user"]["id"] == created.json()["user"]["id"]


def test_google_login_takes_over_an_unverified_password_account(client, monkeypatch):
    """Anyone can register an email they do not own. When the real owner signs in with Google the
    account becomes theirs, and the password set before then stops working."""
    monkeypatch.setattr(main, "GOOGLE_CLIENT_ID", "client-id")
    register(client, email="owner@example.com", username="Squatter", password="squatter pass")
    monkeypatch.setattr(main, "_verify_google", lambda credential: {"sub": "g-9", "email": "owner@example.com"})
    assert client.post("/api/auth/google", json={"credential": "token"}).status_code == 200
    login = client.post("/api/auth/login", json={"identifier": "owner@example.com", "password": "squatter pass"})
    assert login.status_code == 401


# ---- usernames, renaming and deleting ----


def test_rude_and_official_looking_usernames_are_refused(client):
    for name in ("F u c k", "sh1t head", "Admin Bob", "SwipeCover", "n1gg3r"):
        assert register(client, username=name).status_code == 422, name
    assert register(client, username="Hancock").status_code == 200  # innocent look-alikes are fine


def test_changing_username_updates_past_scores(client, signup):
    from test_scores import payload, solve
    from game import current_day_key

    me = signup("Old Name")
    route = solve(1, current_day_key())
    assert client.post("/api/scores", json=payload(route, level=1), headers=me["headers"]).status_code == 200
    assert client.post("/api/auth/username", json={"username": "New Name"}, headers=me["headers"]).json()["user"]["username"] == "New Name"
    assert client.get("/api/leaderboard/1").json()["entries"][0]["name"] == "New Name"
    other = signup("Other One")
    assert client.post("/api/auth/username", json={"username": "new name"}, headers=other["headers"]).status_code == 409
    assert client.post("/api/auth/username", json={"username": "Admin"}, headers=other["headers"]).status_code == 422
    assert client.post("/api/auth/username", json={"username": "Fine Name"}).status_code == 401


def test_deleting_an_account_removes_everything(client, signup):
    from test_scores import payload, solve
    from game import current_day_key

    me = signup("Goner Gone")
    route = solve(1, current_day_key())
    client.post("/api/scores", json=payload(route, level=1), headers=me["headers"])

    body = {"confirm_username": "goner gone", "password": "wrong password here"}
    assert client.post("/api/auth/delete", json=body, headers=me["headers"]).status_code == 401
    assert client.post("/api/auth/delete", json={"confirm_username": "someone else", "password": "correct horse battery"}, headers=me["headers"]).status_code == 400
    ok = client.post("/api/auth/delete", json={"confirm_username": "Goner Gone", "password": "correct horse battery"}, headers=me["headers"])
    assert ok.status_code == 200

    assert client.get("/api/auth/me", headers=me["headers"]).status_code == 401
    assert client.get("/api/leaderboard/1").json()["entries"] == []
    assert client.post("/api/auth/login", json={"identifier": me["email"], "password": "correct horse battery"}).status_code == 401
    assert register(client, username="Goner Gone", email=me["email"]).status_code == 200  # the name and email are free again
