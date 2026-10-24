from threading import Lock
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from game import Game, LEVELS_PER_DAY

app = FastAPI(title="Swipe Cover API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ScorePayload(BaseModel):
    score: int = Field(ge=0)
    name: str = "Player"
    level: int = Field(ge=1, le=LEVELS_PER_DAY)


class NewGamePayload(BaseModel):
    level: int = Field(default=1, ge=1, le=LEVELS_PER_DAY)


class MovePayload(BaseModel):
    session_id: str
    direction: str

    @field_validator("direction")
    @classmethod
    def validate_direction(cls, direction: str) -> str:
        if direction not in ("up", "left", "down", "right"):
            raise ValueError("Direction must be up, left, down, or right.")
        return direction


class SessionPayload(BaseModel):
    session_id: str


games: dict[str, Game] = {}
games_lock = Lock()


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "swipe-cover-api"}


@app.get("/api/game/summary")
def game_summary() -> dict:
    return {
        "title": "Swipe Cover",
        "levels": 5,
        "themes": ["dark", "light"],
        "status": "ready",
    }


@app.post("/api/game/new")
def new_game(payload: NewGamePayload) -> dict:
    session_id = str(uuid4())
    game = Game.new(payload.level)
    with games_lock:
        games[session_id] = game
    return {"session_id": session_id, **game.snapshot()}


@app.post("/api/game/move")
def move(payload: MovePayload) -> dict:
    with games_lock:
        game = games.get(payload.session_id)
        if game is None:
            raise HTTPException(status_code=404, detail="Game session not found.")
        moved = game.move(payload.direction)
        return {"session_id": payload.session_id, **game.snapshot(moved)}


@app.post("/api/game/restart")
def restart(payload: SessionPayload) -> dict:
    with games_lock:
        game = games.get(payload.session_id)
        if game is None:
            raise HTTPException(status_code=404, detail="Game session not found.")
        game.restart()
        return {"session_id": payload.session_id, **game.snapshot()}


@app.post("/api/game/submit-score")
def submit_score(payload: ScorePayload) -> dict:
    return {
        "saved": True,
        "message": f"Saved score for {payload.name}",
        "score": payload.score,
        "level": payload.level,
    }
