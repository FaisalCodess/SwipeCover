import os
import time
from collections import OrderedDict
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from threading import Lock
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, Header, HTTPException, Path as PathParam, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from game import DAILY_TIME_ZONE, DIRECTIONS, LEVELS_PER_DAY, Game, current_day_key, generate_map
from scores import ScoreStore, clean_name

MAX_SESSIONS = 5000
SESSION_TTL_SECONDS = 2 * 60 * 60
# No human slides faster than this; anything quicker is a tampered time.
MIN_MS_PER_MOVE = 60
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
# Point this at persistent storage when deploying, or scores reset on every redeploy.
SCORES_DB = os.environ.get("SCORES_DB", str(Path(__file__).resolve().parent / "scores.db"))
store = ScoreStore(SCORES_DB)
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

app.add_middleware(GZipMiddleware, minimum_size=500)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Player-Id"],
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
    player_id: str = Field(pattern=r"^[0-9a-f-]{36}$")
    name: str = Field(max_length=64)
    time_ms: int = Field(ge=0, le=24 * 60 * 60 * 1000)
    route: list[Literal["up", "left", "down", "right"]] = Field(min_length=1, max_length=2000)


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
def submit_score(payload: ScorePayload) -> dict:
    """Records a finished run. The moves are replayed on that day's board, so only real solves count."""
    name = clean_name(payload.name)
    if name is None:
        raise HTTPException(status_code=422, detail="Names are 3-16 letters, numbers, spaces, _ or -.")

    # Yesterday is still accepted, for runs finished just before midnight or sent late.
    now = datetime.now(DAILY_TIME_ZONE)
    if payload.day not in (current_day_key(now), current_day_key(now - timedelta(days=1))):
        raise HTTPException(status_code=400, detail="That puzzle is no longer open for scores.")

    game = Game.new(payload.level, payload.day)
    if not all(game.move(direction) for direction in payload.route) or not game.won:
        raise HTTPException(status_code=400, detail="Those moves do not solve the puzzle.")
    if payload.time_ms < MIN_MS_PER_MOVE * len(payload.route):
        raise HTTPException(status_code=400, detail="That time is faster than the moves allow.")

    standing = store.submit(payload.day, payload.level, payload.player_id, name, payload.time_ms, len(payload.route))
    return {"saved": True, "day": payload.day, "level": payload.level, **standing}


@app.get("/api/leaderboard/{level}")
def leaderboard(
    response: Response,
    level: int = PathParam(ge=1, le=LEVELS_PER_DAY),
    x_player_id: str | None = Header(default=None, max_length=36),
) -> dict:
    """Today's top 10 for a level, plus the caller's own place when they are outside it."""
    day = current_day_key()
    response.headers["Cache-Control"] = "no-store"
    return {"day": day, "level": level, **store.top(day, level, x_player_id)}


# Serve the built frontend from the same origin when it exists (`npm run build`).
if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
