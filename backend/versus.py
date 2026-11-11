"""1v1 Swipe Rush. Two players race on the same boards; whoever clears more wins.

Three ways to play: a QUICK match (3 minutes, anyone, no rating), a RANKED match (5 minutes, against
someone with a close rating, moves both ratings) and a FRIEND match (a code to share, a length the
host picks, no rating).

Everything runs over one WebSocket per player (see `Hub.serve`). The server owns the match: it picks
the seed, keeps the clock and the score, and checks every cleared board by replaying the route the
player sends on its own copy of that board. The browser builds the boards itself from the seed (so
play is instant) but can only score by sending a route that really clears the next board in line.

State lives in memory, so run a single server process (see the README).
"""
import asyncio
import os
import secrets
import time
from dataclasses import dataclass, field
from uuid import uuid4

from fastapi import WebSocket, WebSocketDisconnect

from accounts import UserStore
from game import DIRECTIONS, MAX_RUSH_MAPS, RUSH_SECONDS, generate_match_map, solves

# What each way of finding an opponent means. Friend matches have no entry: the host picks the length.
MODES = {
    "quick": {"seconds": 3 * 60, "ranked": False},
    "ranked": {"seconds": RUSH_SECONDS, "ranked": True},
}
FRIEND_LENGTHS = (60, 3 * 60, 5 * 60)
FRIEND_DEFAULT_SECONDS = 3 * 60
# Set this to force every match to one length (handy for trying things out).
MATCH_SECONDS = int(os.environ["MATCH_SECONDS"]) if os.environ.get("MATCH_SECONDS") else None
# Ranked matchmaking: a player is first matched only with ratings within BASE points of theirs, and
# the range grows by GROWTH points for every second they wait, so nobody waits forever.
RANKED_BASE_WINDOW = 100
RANKED_GROWTH = 15
MATCHMAKER_INTERVAL = 1.0
# Time between "opponent found" and the first board, so both players are in the cave and ready.
COUNTDOWN_SECONDS = float(os.environ.get("MATCH_COUNTDOWN_SECONDS", 6))
# A cleared board may arrive a little after the clock ran out (network delay).
GRACE_SECONDS = 2.5
MIN_MS_PER_MOVE = 60
MIN_MS_PER_MAP = 400
MAX_ROUTE = 300
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I
CODE_LENGTH = 5


@dataclass
class Waiting:
    mode: str
    since: float  # monotonic clock
    rating: int


@dataclass
class Match:
    id: str
    seed: str
    users: dict[str, dict]  # user id -> user
    ranked: bool
    mode: str  # "quick", "ranked" or "friends"
    seconds: int
    starts_at: float
    ends_at: float
    scores: dict[str, int] = field(default_factory=dict)
    last_clear: dict[str, float] = field(default_factory=dict)  # seconds after the start
    last_progress: dict[str, float] = field(default_factory=dict)  # wall clock of the previous clear
    finished: bool = False

    def opponent(self, user_id: str) -> str:
        return next(uid for uid in self.users if uid != user_id)


class Hub:
    def __init__(self, store: UserStore):
        self.store = store
        self.sockets: dict[str, WebSocket] = {}
        self.queue: dict[str, Waiting] = {}  # user id -> what they are waiting for, oldest first
        self.rooms: dict[str, str] = {}  # invite code -> host's user id
        self.room_seconds: dict[str, int] = {}  # invite code -> how long that match will last
        self._ticker: asyncio.Task | None = None
        self.active: dict[str, Match] = {}  # user id -> their running match
        self.users: dict[str, dict] = {}

    # ---- plumbing ----

    async def _send(self, user_id: str, message: dict) -> None:
        socket = self.sockets.get(user_id)
        if socket is None:
            return
        try:
            await socket.send_json(message)
        except Exception:  # the player has gone; their disconnect handler tidies up
            pass

    def _leave_waiting(self, user_id: str) -> None:
        self.queue.pop(user_id, None)
        for code in [code for code, host in self.rooms.items() if host == user_id]:
            del self.rooms[code]
            self.room_seconds.pop(code, None)

    def forget(self, user_id: str) -> None:
        """The account is gone: it leaves the queue and any room it opened."""
        self._leave_waiting(user_id)

    def _busy(self, user_id: str) -> bool:
        return user_id in self.queue or user_id in self.active or user_id in self.rooms.values()

    def _new_code(self) -> str:
        while True:
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
            if code not in self.rooms:
                return code

    # ---- the connection ----

    async def serve(self, socket: WebSocket, user: dict) -> None:
        await socket.accept()
        user_id = user["id"]
        previous = self.sockets.get(user_id)
        if previous is not None:  # one tab at a time: the newest wins
            try:
                await previous.send_json({"type": "error", "message": "You opened SwipeCover somewhere else."})
                await previous.close()
            except Exception:
                pass
        self.sockets[user_id] = socket
        self.users[user_id] = user
        await self._send(user_id, {"type": "hello", "user": {"id": user_id, "username": user["username"]}})
        match = self.active.get(user_id)
        if match and not match.finished:
            await self._send_match(match, user_id)  # a reload or a dropped connection rejoins the match

        try:
            while True:
                message = await socket.receive_json()
                if isinstance(message, dict):
                    await self._handle(user_id, message)
        except (WebSocketDisconnect, RuntimeError, ValueError):
            pass
        finally:
            if self.sockets.get(user_id) is socket:
                del self.sockets[user_id]
                self._leave_waiting(user_id)

    async def _handle(self, user_id: str, message: dict) -> None:
        kind = message.get("type")
        if kind == "queue":
            await self._queue(user_id, str(message.get("mode", "quick")))
        elif kind == "create":
            await self._create_room(user_id, message.get("seconds"))
        elif kind == "join":
            await self._join_room(user_id, str(message.get("code", "")))
        elif kind == "cancel":
            self._leave_waiting(user_id)
            await self._send(user_id, {"type": "idle"})
        elif kind == "solved":
            await self._solved(user_id, message)

    # ---- finding an opponent ----

    async def _queue(self, user_id: str, mode: str) -> None:
        if mode not in MODES:
            await self._send(user_id, {"type": "error", "message": "Pick a match type."})
            return
        if self._busy(user_id):
            await self._send(user_id, {"type": "error", "message": "You are already waiting or in a match."})
            return
        account = self.store.by_id(user_id)
        if account is None:
            return
        self.queue[user_id] = Waiting(mode=mode, since=time.monotonic(), rating=account["rating"])
        await self._send(user_id, self._searching(user_id, time.monotonic()))
        await self._pair(mode)
        if mode == "ranked" and user_id in self.queue and (self._ticker is None or self._ticker.done()):
            self._ticker = asyncio.create_task(self._matchmaker())

    @staticmethod
    def _window(waiting: Waiting, now: float) -> int:
        """How far apart two ratings may be for this waiting player to accept the match."""
        return round(RANKED_BASE_WINDOW + RANKED_GROWTH * max(0.0, now - waiting.since))

    def _searching(self, user_id: str, now: float) -> dict:
        waiting = self.queue[user_id]
        message = {"type": "searching", "mode": waiting.mode}
        if waiting.mode == "ranked":
            message.update(rating=waiting.rating, range=self._window(waiting, now))
        return message

    async def _pair(self, mode: str) -> None:
        """Starts every match that can be made right now from the people waiting for `mode`."""
        while True:
            waiting = [(uid, entry) for uid, entry in self.queue.items() if entry.mode == mode and uid in self.sockets]
            if mode == "quick":
                pair = (waiting[0][0], waiting[1][0]) if len(waiting) >= 2 else None
            else:
                pair = self._closest_pair(waiting, time.monotonic())
            if pair is None:
                return
            for uid in pair:
                del self.queue[uid]
            await self._start(pair[0], pair[1], mode, self._length(mode))

    def _closest_pair(self, waiting: list[tuple[str, Waiting]], now: float) -> tuple[str, str] | None:
        """The two ranked players closest in rating, if their rating gap is within what either will accept."""
        best = None
        for index, (first, first_entry) in enumerate(waiting):
            for second, second_entry in waiting[index + 1:]:
                gap = abs(first_entry.rating - second_entry.rating)
                allowed = max(self._window(first_entry, now), self._window(second_entry, now))
                if gap <= allowed and (best is None or gap < best[0]):
                    best = (gap, first, second)
        return (best[1], best[2]) if best else None

    async def _matchmaker(self) -> None:
        """While anyone waits for a ranked match: retry every second as the accepted range grows,
        and tell them how wide the search has got."""
        try:
            while any(entry.mode == "ranked" for entry in self.queue.values()):
                await asyncio.sleep(MATCHMAKER_INTERVAL)
                await self._pair("ranked")
                now = time.monotonic()
                for uid, entry in list(self.queue.items()):
                    if entry.mode == "ranked":
                        await self._send(uid, self._searching(uid, now))
        finally:
            self._ticker = None

    @staticmethod
    def _length(mode: str) -> int:
        return MATCH_SECONDS if MATCH_SECONDS is not None else MODES[mode]["seconds"]

    async def _create_room(self, user_id: str, seconds) -> None:
        if self._busy(user_id):
            await self._send(user_id, {"type": "error", "message": "You are already waiting or in a match."})
            return
        seconds = seconds if seconds in FRIEND_LENGTHS else FRIEND_DEFAULT_SECONDS
        code = self._new_code()
        self.rooms[code] = user_id
        self.room_seconds[code] = seconds
        await self._send(user_id, {"type": "room", "code": code, "seconds": seconds})

    async def _join_room(self, user_id: str, code: str) -> None:
        code = code.strip().upper()
        host = self.rooms.get(code)
        if host == user_id:
            await self._send(user_id, {"type": "error", "message": "That is your own code: send it to your friend."})
        elif self._busy(user_id):
            await self._send(user_id, {"type": "error", "message": "You are already waiting or in a match."})
        elif host is None or host not in self.sockets:
            await self._send(user_id, {"type": "error", "message": "No game with that code. Check it and try again."})
        else:
            seconds = self.room_seconds.pop(code, FRIEND_DEFAULT_SECONDS)
            del self.rooms[code]
            await self._start(host, user_id, "friends", MATCH_SECONDS if MATCH_SECONDS is not None else seconds)

    # ---- the match ----

    async def _start(self, first: str, second: str, mode: str, seconds: int) -> None:
        now = time.time()
        match = Match(
            id=str(uuid4()),
            seed=secrets.token_hex(8),
            users={uid: self.users[uid] for uid in (first, second)},
            ranked=bool(MODES.get(mode, {}).get("ranked")),
            mode=mode,
            seconds=seconds,
            starts_at=now + COUNTDOWN_SECONDS,
            ends_at=now + COUNTDOWN_SECONDS + seconds,
            scores={first: 0, second: 0},
        )
        for uid in (first, second):
            self.active[uid] = match
        asyncio.create_task(self._finish_later(match))
        for uid in (first, second):
            await self._send_match(match, uid)

    async def _send_match(self, match: Match, user_id: str) -> None:
        now = time.time()
        opponent = match.opponent(user_id)
        await self._send(user_id, {
            "type": "matched",
            "match_id": match.id,
            "seed": match.seed,
            "ranked": match.ranked,
            "mode": match.mode,
            "duration_ms": match.seconds * 1000,
            "opponent": match.users[opponent]["username"],
            "starts_in_ms": max(0, round((match.starts_at - now) * 1000)),
            "remaining_ms": max(0, round((match.ends_at - max(now, match.starts_at)) * 1000)),
            "you": match.scores[user_id],
            "them": match.scores[opponent],
        })

    async def _solved(self, user_id: str, message: dict) -> None:
        match = self.active.get(user_id)
        now = time.time()
        if match is None or match.finished or now < match.starts_at or now > match.ends_at + GRACE_SECONDS:
            return
        index, route = message.get("index"), message.get("route")
        if (
            index != match.scores[user_id]
            or index >= MAX_RUSH_MAPS
            or not isinstance(route, list)
            or not 1 <= len(route) <= MAX_ROUTE
            or any(not isinstance(step, str) or step not in DIRECTIONS for step in route)
        ):
            await self._send(user_id, {"type": "rejected", "index": index})
            return
        board, start = generate_match_map(match.seed, index)
        since = now - match.last_progress.get(user_id, match.starts_at)
        if not solves(board, start, route) or since * 1000 < max(MIN_MS_PER_MOVE * len(route), MIN_MS_PER_MAP):
            await self._send(user_id, {"type": "rejected", "index": index})
            return
        match.scores[user_id] += 1
        match.last_clear[user_id] = now - match.starts_at
        match.last_progress[user_id] = now
        opponent = match.opponent(user_id)
        await self._send(user_id, {"type": "score", "you": match.scores[user_id], "them": match.scores[opponent]})
        await self._send(opponent, {"type": "score", "you": match.scores[opponent], "them": match.scores[user_id]})

    async def _finish_later(self, match: Match) -> None:
        await asyncio.sleep(max(0, match.ends_at + GRACE_SECONDS - time.time()))
        match.finished = True
        first, second = list(match.users)
        score_a, score_b = match.scores[first], match.scores[second]
        if score_a != score_b:
            outcome = 1.0 if score_a > score_b else 0.0
        else:
            # Level on boards: the one who cleared their last board sooner wins; nothing cleared is a draw.
            time_a = match.last_clear.get(first, float("inf"))
            time_b = match.last_clear.get(second, float("inf"))
            outcome = 0.5 if time_a == time_b else (1.0 if time_a < time_b else 0.0)
        try:
            changes = self.store.record_match(match.id, match.seed, first, second, score_a, score_b, outcome, match.ranked)
        except Exception as error:  # never leave players hanging because the record could not be saved
            print(f"Could not record match {match.id}: {error}")
            changes = {first: (None, 0), second: (None, 0)}
        for uid, outcome_for in ((first, outcome), (second, 1 - outcome)):
            self.active.pop(uid, None)
            other = match.opponent(uid)
            rating, delta = changes[uid]
            await self._send(uid, {
                "type": "result",
                "outcome": "win" if outcome_for == 1 else "lose" if outcome_for == 0 else "draw",
                "you": match.scores[uid],
                "them": match.scores[other],
                "opponent": match.users[other]["username"],
                "ranked": match.ranked,
                "mode": match.mode,
                "rating": rating,
                "delta": delta,
            })
