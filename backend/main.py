import html
import json
import os
import time
import urllib.parse
import urllib.request
from collections import OrderedDict
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from threading import Lock
from typing import Literal
from uuid import uuid4

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Path as PathParam, Request, Response, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from game import (
    DAILY_TIME_ZONE,
    DIRECTIONS,
    LEVELS_PER_DAY,
    MAX_RUSH_MAPS,
    RUSH_SECONDS,
    Game,
    current_day_key,
    generate_map,
    generate_rush_map,
    solves,
)
from accounts import (
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    RESET_SECONDS,
    AccountError,
    RateLimiter,
    UserStore,
    clean_email,
    hash_password,
    name_is_blocked,
    verify_password,
)
from mailer import mail_enabled, send_mail
from scores import ScoreStore, clean_name
from versus import Hub

MAX_SESSIONS = 5000
SESSION_TTL_SECONDS = 2 * 60 * 60
# No human slides faster than this; anything quicker is a tampered time.
MIN_MS_PER_MOVE = 60
# The Swipe Rush clock is the browser's. A little slack covers a slow network and clock drift.
RUSH_GRACE_MS = 3000
# Nobody can see a board, plan it and swipe it clear in under this, so a run claiming
# faster has been tampered with. Low on purpose: the first boards need only 3-4 moves.
MIN_MS_PER_RUSH_MAP = 400
# Far longer than any board needs, just to bound what one request can ask the server to replay.
MAX_RUSH_ROUTE = 300
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
# Point this at persistent storage when deploying, or scores reset on every redeploy.
SCORES_DB = os.environ.get("SCORES_DB", str(Path(__file__).resolve().parent / "scores.db"))
store = ScoreStore(SCORES_DB)
# Accounts and sessions live in the same SQLite file as the scores.
users = UserStore(SCORES_DB)
hub = Hub(users)
limiter = RateLimiter()
# Shown on the privacy and terms pages as the address players can write to.
CONTACT_EMAIL = os.environ.get("CONTACT_EMAIL", "").strip()
# The site's public address (https://yourname.duckdns.org). Password reset emails no longer link to it
# (they carry a code), so it is optional.
PUBLIC_URL = os.environ.get("PUBLIC_URL", "").strip().rstrip("/")
# Set this to enable "Sign in with Google" (an OAuth web client ID from the Google Cloud console).
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173",
    ).split(",")
    if origin.strip()
]


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Build today's boards up front so the first player never waits on generation.
    for level in range(1, LEVELS_PER_DAY + 1):
        generate_map(level)
    yield


app = FastAPI(title="Swipe Cover API", lifespan=lifespan)

@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    return response


app.add_middleware(GZipMiddleware, minimum_size=500)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


class NewGamePayload(BaseModel):
    level: int = Field(default=1, ge=1, le=LEVELS_PER_DAY)


class MovePayload(BaseModel):
    session_id: str = Field(max_length=64)
    direction: str

    @field_validator("direction")
    @classmethod
    def validate_direction(cls, direction: str) -> str:
        if direction not in DIRECTIONS:
            raise ValueError("Direction must be up, left, down, or right.")
        return direction


class SessionPayload(BaseModel):
    session_id: str = Field(max_length=64)


class ScorePayload(BaseModel):
    day: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    level: int = Field(ge=1, le=LEVELS_PER_DAY)
    time_ms: int = Field(ge=0, le=24 * 60 * 60 * 1000)
    route: list[Literal["up", "left", "down", "right"]] = Field(min_length=1, max_length=2000)


class RushScorePayload(BaseModel):
    """A finished Swipe Rush run: the route that cleared each board, in order from board 0."""

    day: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    # When the last counted board was cleared, in milliseconds after the run began.
    time_ms: int = Field(ge=0, le=RUSH_SECONDS * 1000 + RUSH_GRACE_MS)
    routes: list[list[Literal["up", "left", "down", "right"]]] = Field(min_length=1, max_length=MAX_RUSH_MAPS)

    @field_validator("routes")
    @classmethod
    def validate_routes(cls, routes: list[list[str]]) -> list[list[str]]:
        if not all(1 <= len(route) <= MAX_RUSH_ROUTE for route in routes):
            raise ValueError("Every board needs between 1 and %d moves." % MAX_RUSH_ROUTE)
        return routes


class RegisterPayload(BaseModel):
    email: str = Field(max_length=254)
    username: str = Field(max_length=64)
    password: str = Field(max_length=PASSWORD_MAX_LENGTH)


class LoginPayload(BaseModel):
    identifier: str = Field(max_length=254)  # email or username
    password: str = Field(max_length=PASSWORD_MAX_LENGTH)


class RenamePayload(BaseModel):
    username: str = Field(max_length=64)


class DeletePayload(BaseModel):
    confirm_username: str = Field(max_length=64)
    password: str | None = Field(default=None, max_length=PASSWORD_MAX_LENGTH)


class ForgotPayload(BaseModel):
    email: str = Field(max_length=254)


class ResetPayload(BaseModel):
    email: str = Field(max_length=254)
    code: str = Field(max_length=16)
    password: str = Field(max_length=PASSWORD_MAX_LENGTH)


class GooglePayload(BaseModel):
    credential: str = Field(max_length=4096)
    username: str | None = Field(default=None, max_length=64)


# Sessions are kept in least-recently-used order so the oldest can be evicted.
games: OrderedDict[str, tuple[Game, float]] = OrderedDict()
games_lock = Lock()


def _prune_sessions(now: float) -> None:
    while games:
        _, (_, last_used) = next(iter(games.items()))
        if len(games) <= MAX_SESSIONS and now - last_used < SESSION_TTL_SECONDS:
            break
        games.popitem(last=False)


def _get_game(session_id: str) -> Game:
    now = time.monotonic()
    _prune_sessions(now)
    entry = games.get(session_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Game session not found.")
    games[session_id] = (entry[0], now)
    games.move_to_end(session_id)
    return entry[0]


# ---- accounts ----


def _bearer(authorization: str | None = Header(default=None)) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


def optional_user(token: str | None = Depends(_bearer)) -> dict | None:
    return users.user_for_token(token)


def require_user(user: dict | None = Depends(optional_user)) -> dict:
    if user is None:
        raise HTTPException(status_code=401, detail="Log in to do that.")
    return user


def _public(user: dict) -> dict:
    return {
        "id": user["id"],
        "username": user["username"],
        "email": user["email"],
        "has_password": bool(user["password_hash"]),
        "rating": user["rating"],
        "wins": user["wins"],
        "losses": user["losses"],
        "draws": user["draws"],
    }


def _session(user: dict) -> dict:
    return {"token": users.new_session(user["id"]), "user": _public(user)}


def _client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _check_username(username: str) -> str:
    cleaned = clean_name(username)
    if cleaned is None:
        raise HTTPException(status_code=422, detail="Usernames are 3-16 letters, numbers, spaces, _ or -.")
    if name_is_blocked(cleaned):
        raise HTTPException(status_code=422, detail="Please choose a different username.")
    return cleaned


@app.get("/api/config")
def config() -> dict:
    return {
        "google_client_id": GOOGLE_CLIENT_ID or None,
        "contact_email": CONTACT_EMAIL or None,
        "password_reset": reset_available(),
    }


def reset_available() -> bool:
    return mail_enabled()


@app.post("/api/auth/register")
def register(payload: RegisterPayload, request: Request) -> dict:
    if not limiter.allow(f"register:{_client_key(request)}", 8, 3600):
        raise HTTPException(status_code=429, detail="Too many sign-ups from here. Try again later.")
    email = clean_email(payload.email)
    if email is None:
        raise HTTPException(status_code=422, detail="That email does not look right.")
    username = _check_username(payload.username)
    if len(payload.password) < PASSWORD_MIN_LENGTH:
        raise HTTPException(status_code=422, detail=f"Passwords need at least {PASSWORD_MIN_LENGTH} characters.")
    try:
        user = users.create(email, username, password_hash=hash_password(payload.password))
    except AccountError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return _session(user)


@app.post("/api/auth/login")
def login(payload: LoginPayload, request: Request) -> dict:
    identifier = payload.identifier.strip().lower()
    if not (
        limiter.allow(f"login-ip:{_client_key(request)}", 30, 600)
        and limiter.allow(f"login-id:{identifier}", 8, 600)
    ):
        raise HTTPException(status_code=429, detail="Too many attempts. Wait a few minutes and try again.")
    user = users.by_email(identifier) if "@" in identifier else users.by_username(identifier)
    # Hash even when there is no such account, so the response time does not reveal which exist.
    valid = verify_password(payload.password, user["password_hash"] if user else hash_password("not-a-real-password"))
    if user is None or not valid:
        raise HTTPException(status_code=401, detail="Wrong email, username or password.")
    return _session(user)


def _send_reset_email(email: str, username: str, code: str) -> None:
    minutes = RESET_SECONDS // 60
    text = "\n".join([
        f"Hi {username},",
        "",
        "Your Swipe Cover password reset code is:",
        "",
        code,
        "",
        f"Type it into the game to choose a new password. It works once, for {minutes} minutes.",
        "",
        "If you did not ask for this, ignore this email: your password stays as it is.",
        "Nobody from Swipe Cover will ever ask you for this code.",
        "",
    ])
    name = html.escape(username)
    page = f"""<!doctype html>
<html><body style="margin:0;padding:24px 12px;background:#0f1115;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:440px;margin:0 auto;background:#171a21;border:1px solid #2a2f3a;border-radius:10px;padding:28px 24px;color:#e8eaf0;">
    <p style="margin:0 0 18px;font-size:13px;letter-spacing:4px;color:#8b93a7;">SWIPE COVER</p>
    <p style="margin:0 0 8px;font-size:18px;">Hi {name},</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#b9bfce;">Use this code to choose a new password. Type it into the game where you asked for the reset.</p>
    <p style="margin:0 0 20px;padding:16px;text-align:center;font-family:Consolas,Menlo,monospace;font-size:34px;letter-spacing:10px;font-weight:bold;color:#ffffff;background:#0f1115;border:1px solid #2a2f3a;border-radius:8px;">{code}</p>
    <p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:#8b93a7;">It works once and expires in {minutes} minutes.</p>
    <p style="margin:0;font-size:13px;line-height:1.5;color:#8b93a7;">Did not ask for this? Ignore this email and your password stays as it is. Nobody from Swipe Cover will ever ask you for this code.</p>
  </div>
</body></html>"""
    send_mail(email, f"{code} is your Swipe Cover code", text, page)


@app.post("/api/auth/forgot")
def forgot_password(payload: ForgotPayload, request: Request, background: BackgroundTasks) -> dict:
    """Emails a 6-digit reset code. The answer is the same whether or not the address has an account, so
    this cannot be used to find out who has one."""
    if not reset_available():
        raise HTTPException(status_code=503, detail="Password reset is not available right now.")
    email = clean_email(payload.email)
    if email is None:
        raise HTTPException(status_code=422, detail="That email does not look right.")
    if not (limiter.allow(f"forgot-ip:{_client_key(request)}", 6, 3600) and limiter.allow(f"forgot-id:{email}", 3, 3600)):
        raise HTTPException(status_code=429, detail="Too many requests. Try again in a while.")
    user = users.by_email(email)
    if user is not None:
        background.add_task(_send_reset_email, email, user["username"], users.new_reset(user["id"]))
    return {"ok": True}


@app.post("/api/auth/reset")
def reset_password(payload: ResetPayload, request: Request) -> dict:
    """Sets a new password from the emailed 6-digit code and logs the player in."""
    email = clean_email(payload.email)
    # A 6-digit code has a million possibilities, so guesses are capped per address (and per
    # connection): with a 15 minute code, an attacker gets a handful of tries, not thousands.
    if email is None or not (
        limiter.allow(f"reset-ip:{_client_key(request)}", 10, 900)
        and limiter.allow(f"reset-id:{email}", 5, 900)
    ):
        raise HTTPException(status_code=429, detail="Too many attempts. Wait a few minutes and try again.")
    if len(payload.password) < PASSWORD_MIN_LENGTH:
        raise HTTPException(status_code=422, detail=f"Passwords need at least {PASSWORD_MIN_LENGTH} characters.")
    user = users.use_reset(email, payload.code, hash_password(payload.password))
    if user is None:
        raise HTTPException(status_code=400, detail="That code is wrong or has expired. Check it, or ask for a new one.")
    return _session(user)


def _verify_google(credential: str) -> dict:
    """Checks a Google sign-in token with Google and returns its claims."""
    try:
        url = "https://oauth2.googleapis.com/tokeninfo?id_token=" + urllib.parse.quote(credential, safe="")
        with urllib.request.urlopen(url, timeout=6) as response:
            claims = json.load(response)
    except Exception as error:
        raise HTTPException(status_code=401, detail="Google could not confirm that sign-in.") from error
    if (
        claims.get("aud") != GOOGLE_CLIENT_ID
        or claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com")
        or str(claims.get("email_verified")).lower() != "true"
        or not claims.get("sub")
        or not claims.get("email")
    ):
        raise HTTPException(status_code=401, detail="Google could not confirm that sign-in.")
    return claims


@app.post("/api/auth/google")
def google_login(payload: GooglePayload, request: Request) -> dict:
    """Signs in with a Google token. A first-time player must also pick a username: without one
    this answers `needs_username`, and the browser asks again with the same token and a name."""
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=404, detail="Google sign-in is not set up.")
    if not limiter.allow(f"google:{_client_key(request)}", 30, 600):
        raise HTTPException(status_code=429, detail="Too many attempts. Wait a few minutes and try again.")
    claims = _verify_google(payload.credential)
    email = clean_email(claims["email"])
    if email is None:
        raise HTTPException(status_code=401, detail="Google could not confirm that sign-in.")
    user = users.by_google(claims["sub"])
    if user is None:
        existing = users.by_email(email)
        if existing is not None:
            user = users.link_google(existing["id"], claims["sub"])
        elif payload.username is None:
            return {"needs_username": True, "email": email}
        else:
            try:
                user = users.create(email, _check_username(payload.username), google_sub=claims["sub"])
            except AccountError as error:
                raise HTTPException(status_code=409, detail=str(error)) from error
    return _session(user)


@app.get("/api/auth/me")
def me(user: dict = Depends(require_user)) -> dict:
    return {"user": _public(user)}


@app.post("/api/auth/username")
def change_username(payload: RenamePayload, user: dict = Depends(require_user)) -> dict:
    username = _check_username(payload.username)
    try:
        updated = users.rename(user["id"], username)
    except AccountError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    store.rename_player(user["id"], updated["username"])
    return {"user": _public(updated)}


@app.post("/api/auth/delete")
def delete_account(payload: DeletePayload, request: Request, user: dict = Depends(require_user)) -> dict:
    """Deletes the logged-in player's account, their logins and their leaderboard entries.
    Asks them to type their username, and their password if they have one."""
    if not limiter.allow(f"delete:{user['id']}", 5, 600):
        raise HTTPException(status_code=429, detail="Too many attempts. Wait a few minutes and try again.")
    if payload.confirm_username.strip().lower() != user["username"].lower():
        raise HTTPException(status_code=400, detail="Type your username exactly to confirm.")
    if user["password_hash"] and not verify_password(payload.password or "", user["password_hash"]):
        raise HTTPException(status_code=401, detail="That password is not right.")
    hub.forget(user["id"])
    store.delete_player(user["id"])
    users.delete(user["id"])
    return {"deleted": True}


@app.post("/api/auth/logout")
def logout(token: str | None = Depends(_bearer)) -> dict:
    if token:
        users.end_session(token)
    return {"ok": True}


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "swipe-cover-api", "day": current_day_key()}


@app.get("/api/daily/{level}")
def daily_board(response: Response, level: int = PathParam(ge=1, le=LEVELS_PER_DAY)) -> dict:
    """Today's board for a level. The client plays it locally, so no session is created."""
    day = current_day_key()
    board, start = generate_map(level, day)
    response.headers["Cache-Control"] = "public, max-age=60"
    return {
        "level": level,
        "levels": LEVELS_PER_DAY,
        "day": day,
        "board": board,
        "player": {"row": start[0], "col": start[1]},
    }


@app.post("/api/game/new")
def new_game(payload: NewGamePayload) -> dict:
    session_id = str(uuid4())
    game = Game.new(payload.level)
    with games_lock:
        games[session_id] = (game, time.monotonic())
        _prune_sessions(time.monotonic())
    return {"session_id": session_id, **game.snapshot()}


@app.post("/api/game/move")
def move(payload: MovePayload) -> dict:
    with games_lock:
        game = _get_game(payload.session_id)
        moved = game.move(payload.direction)
        return {"session_id": payload.session_id, **game.snapshot(moved)}


@app.post("/api/game/restart")
def restart(payload: SessionPayload) -> dict:
    with games_lock:
        game = _get_game(payload.session_id)
        game.restart()
        return {"session_id": payload.session_id, **game.snapshot()}


@app.post("/api/scores")
def submit_score(payload: ScorePayload, user: dict = Depends(require_user)) -> dict:
    """Records a player's first finished run of a level. The moves are replayed on that day's
    board, so only real solves count; later runs of the same level are ignored."""
    # Yesterday is still accepted, for runs finished just before midnight or sent late.
    now = datetime.now(DAILY_TIME_ZONE)
    if payload.day not in (current_day_key(now), current_day_key(now - timedelta(days=1))):
        raise HTTPException(status_code=400, detail="That puzzle is no longer open for scores.")

    game = Game.new(payload.level, payload.day)
    if not all(game.move(direction) for direction in payload.route) or not game.won:
        raise HTTPException(status_code=400, detail="Those moves do not solve the puzzle.")
    if payload.time_ms < MIN_MS_PER_MOVE * len(payload.route):
        raise HTTPException(status_code=400, detail="That time is faster than the moves allow.")

    standing = store.submit(payload.day, payload.level, user["id"], user["username"], payload.time_ms, len(payload.route))
    return {"saved": True, "day": payload.day, "level": payload.level, **standing}


@app.post("/api/rush/scores")
def submit_rush_score(payload: RushScorePayload, user: dict = Depends(require_user)) -> dict:
    """Records a player's first Swipe Rush run of the day.

    Every route is replayed on that day's board of the same number, starting from board 0
    with none skipped, so only boards that were really cleared are counted.
    """
    now = datetime.now(DAILY_TIME_ZONE)
    if payload.day not in (current_day_key(now), current_day_key(now - timedelta(days=1))):
        raise HTTPException(status_code=400, detail="That Swipe Rush is no longer open for scores.")

    for index, route in enumerate(payload.routes):
        board, start = generate_rush_map(index, payload.day)
        if not solves(board, start, route):
            raise HTTPException(status_code=400, detail=f"Those moves do not clear board {index + 1}.")

    maps = len(payload.routes)
    moves = sum(len(route) for route in payload.routes)
    if payload.time_ms < max(MIN_MS_PER_MOVE * moves, MIN_MS_PER_RUSH_MAP * maps):
        raise HTTPException(status_code=400, detail="That time is faster than the moves allow.")

    standing = store.submit_rush(payload.day, user["id"], user["username"], maps, payload.time_ms, moves)
    return {"saved": True, "day": payload.day, **standing}


@app.get("/api/rush/leaderboard")
def rush_leaderboard(
    response: Response,
    user: dict | None = Depends(optional_user),
) -> dict:
    """Today's Swipe Rush top 10, plus the caller's own place when they are outside it."""
    day = current_day_key()
    response.headers["Cache-Control"] = "no-store"
    return {"day": day, **store.top_rush(day, user["id"] if user else None)}


@app.get("/api/leaderboard/{level}")
def leaderboard(
    response: Response,
    level: int = PathParam(ge=1, le=LEVELS_PER_DAY),
    user: dict | None = Depends(optional_user),
) -> dict:
    """Today's top 10 for a level, plus the caller's own place when they are outside it."""
    day = current_day_key()
    response.headers["Cache-Control"] = "no-store"
    return {"day": day, "level": level, **store.top(day, level, user["id"] if user else None)}


@app.get("/api/versus/leaderboard")
def versus_leaderboard(response: Response, user: dict | None = Depends(optional_user)) -> dict:
    """The best 1v1 players by rating, plus the caller's own place when they are outside the top 10."""
    response.headers["Cache-Control"] = "no-store"
    return users.top_versus(user["id"] if user else None)


def _origin_allowed(websocket: WebSocket) -> bool:
    """Browsers always send Origin on a WebSocket. Accept our own site and the configured origins."""
    origin = websocket.headers.get("origin")
    if origin is None:
        return True
    host = websocket.headers.get("host", "")
    return origin in ALLOWED_ORIGINS or urllib.parse.urlparse(origin).netloc == host


@app.websocket("/api/versus/ws")
async def versus_socket(websocket: WebSocket, token: str | None = None) -> None:
    user = users.user_for_token(token)
    if user is None or not _origin_allowed(websocket):
        await websocket.close(code=4401)
        return
    await hub.serve(websocket, user)


# Serve the built frontend from the same origin when it exists (`npm run build`).
if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
