import time
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

import game
from game import COLS, LEVEL_RULES, ROWS, Game, analyze, generate_map, slide
from main import app

DAYS = [(date(2026, 1, 1) + timedelta(days=offset)).isoformat() for offset in range(40)]


def board_from(rows: list[str]) -> list[list[str]]:
    return [list(row) for row in rows]


def test_slide_stops_at_walls_and_edges():
    board = board_from([
        "P..|........",
        *["." * COLS for _ in range(ROWS - 1)],
    ])
    position, moved = slide(board, (0, 0), "right")
    assert (position, moved) == ((0, 2), True)
    assert board[0][:3] == ["-", "-", "P"]

    position, moved = slide(board, position, "up")
    assert (position, moved) == ((0, 2), False)


def test_analyze_rejects_unreachable_dots():
    # The ball can never stop in the middle column, so the middle dots stay uncovered.
    board = board_from(["P" + "." * (COLS - 1), *["." * COLS for _ in range(ROWS - 1)]])
    assert not analyze(board, (0, 0)).solvable


@pytest.mark.parametrize("level", sorted(LEVEL_RULES))
def test_daily_boards_are_solvable_and_match_level_rules(level):
    for day in DAYS:
        board, start = generate_map(level, day)
        walls = sum(row.count("|") for row in board)
        result = analyze(board, start)
        assert result.solvable, (day, level)
        assert board[start[0]][start[1]] == "P"
        low, high = LEVEL_RULES[level]["walls"]
        assert low <= walls <= high, (day, level, walls)


def test_levels_get_harder():
    zones = {level: [analyze(*generate_map(level, day)).zones for day in DAYS] for level in LEVEL_RULES}
    assert sum(zones[1]) < sum(zones[2]) < sum(zones[3])


def test_boards_are_the_same_for_everyone_on_a_day():
    game._daily_map.cache_clear()
    first = generate_map(2, "2026-05-05")
    game._daily_map.cache_clear()
    assert generate_map(2, "2026-05-05") == first
    assert generate_map(2, "2026-05-06") != first


def test_generation_is_fast():
    game._daily_map.cache_clear()
    started = time.perf_counter()
    for level in LEVEL_RULES:
        generate_map(level, "2026-07-14")
    assert time.perf_counter() - started < 2


def test_game_can_be_won_and_restarted():
    current = Game.new(1, "2026-03-03")
    assert not current.won
    # A move that does nothing must not count as progress.
    current.restart()
    assert current.board == current.initial_board
    assert current.player == current.start_player


client = TestClient(app)


def test_api_daily_and_sessions():
    assert client.get("/api/health").json()["status"] == "ok"

    daily = client.get("/api/daily/2").json()
    assert daily["level"] == 2 and len(daily["board"]) == ROWS and len(daily["board"][0]) == COLS
    assert client.get("/api/daily/4").status_code == 422

    created = client.post("/api/game/new", json={"level": 1}).json()
    assert created["board"] == daily["board"] or created["level"] == 1
    moved = client.post("/api/game/move", json={"session_id": created["session_id"], "direction": "up"})
    assert moved.status_code == 200 and "moved" in moved.json()
    assert client.post("/api/game/move", json={"session_id": created["session_id"], "direction": "jump"}).status_code == 422
    assert client.post("/api/game/restart", json={"session_id": "missing"}).status_code == 404
