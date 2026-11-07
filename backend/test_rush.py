import statistics
import time
from collections import deque
from datetime import date, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

import game
import main
from game import (
    DIRECTIONS,
    MAX_RUSH_MAPS,
    RUSH_SECONDS,
    RUSH_TIERS,
    analyze,
    current_day_key,
    generate_rush_map,
    rush_rules,
    solves,
)
from scores import ScoreStore

DAYS = [(date(2026, 1, 1) + timedelta(days=offset)).isoformat() for offset in range(25)]
TIER_STARTS = [first for first, _ in RUSH_TIERS]


def solve(board, start):
    """Shortest winning route, by breadth-first search over (position, squares left)."""
    rows, cols = len(board), len(board[0])
    bit = lambda row, col: 1 << (row * cols + col)  # noqa: E731
    dots = sum(bit(r, c) for r in range(rows) for c in range(cols) if board[r][c] == ".")
    queue = deque([(start, dots, ())])
    seen = {(start, dots)}
    while queue:
        (row, col), left, route = queue.popleft()
        if not left:
            return list(route)
        for name, (row_step, col_step) in DIRECTIONS.items():
            r, c, covered = row, col, 0
            while 0 <= r + row_step < rows and 0 <= c + col_step < cols and board[r + row_step][c + col_step] != "|":
                r, c = r + row_step, c + col_step
                covered |= bit(r, c)
            state = ((r, c), left & ~covered)
            if covered and state not in seen:
                seen.add(state)
                queue.append((*state, (*route, name)))
    raise AssertionError("unsolvable board")


def routes_for(day, count):
    return [solve(*generate_rush_map(index, day)) for index in range(count)]


# ---- the boards -------------------------------------------------------------------


def test_rush_boards_are_solvable_and_fit_their_tier():
    for day in DAYS:
        for index in range(0, 40):
            board, start = generate_rush_map(index, day)
            rules = rush_rules(index)
            assert len(board) == rules["rows"] and len(board[0]) == rules["cols"], (day, index)
            assert board[start[0]][start[1]] == "P"
            walls = sum(row.count("|") for row in board)
            assert rules["walls"][0] <= walls <= rules["walls"][1], (day, index, walls)
            assert analyze(board, start).solvable, (day, index)


def test_rush_boards_get_bigger_and_trickier_as_the_run_goes_on():
    averages = []
    for first in TIER_STARTS:
        lengths = [len(solve(*generate_rush_map(first + offset, day))) for day in DAYS[:6] for offset in range(2)]
        averages.append(statistics.mean(lengths))
    assert averages == sorted(averages) and averages[-1] > averages[0] + 3, averages


def test_the_first_boards_are_quick_ones():
    # Each of the first few boards can be cleared in a handful of moves: a warm-up, not a wall.
    for day in DAYS[:10]:
        assert all(len(solve(*generate_rush_map(index, day))) <= 6 for index in range(5))


def test_rush_boards_are_the_same_for_everyone_on_a_day():
    game._rush_map.cache_clear()
    first = [generate_rush_map(index, "2026-05-05") for index in range(12)]
    game._rush_map.cache_clear()
    assert [generate_rush_map(index, "2026-05-05") for index in range(12)] == first
    assert generate_rush_map(3, "2026-05-06") != first[3]
    assert len({tuple(map(tuple, board)) for board, _ in first}) > 8  # and the boards differ from each other


def test_rush_generation_is_fast():
    game._rush_map.cache_clear()
    started = time.perf_counter()
    for index in range(MAX_RUSH_MAPS):
        generate_rush_map(index, "2026-07-14")
    assert time.perf_counter() - started < 3


def test_solves_checks_the_whole_route():
    board, start = generate_rush_map(4, "2026-03-03")
    route = solve(board, start)
    assert solves(board, start, route)
    assert not solves(board, start, route[:-1])  # stops one move short
    assert not solves(board, start, [*route, route[-1]])  # keeps moving after the board is cleared
    assert not solves(board, start, [])
    # A move straight into a wall slides nowhere and must not count.
    blocked = next(d for d, (dr, dc) in DIRECTIONS.items() if not (0 <= start[0] + dr < len(board) and 0 <= start[1] + dc < len(board[0]))
                   or board[start[0] + dr][start[1] + dc] == "|")
    assert not solves(board, start, [blocked, *route])


# ---- the API -----------------------------------------------------------------------


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "store", ScoreStore(tmp_path / "scores.db"))
    return TestClient(main.app)


@pytest.fixture(scope="module")
def routes():
    return routes_for(current_day_key(), 8)


def payload(routes, count=None, **overrides):
    count = len(routes) if count is None else count
    moves = sum(len(route) for route in routes[:count])
    return {
        "day": current_day_key(), "player_id": str(uuid4()), "name": "Rusher One",
        "time_ms": max(main.MIN_MS_PER_MOVE * moves, main.MIN_MS_PER_RUSH_MAP * count) + 5000,
        "routes": routes[:count], **overrides,
    }


def test_a_valid_run_is_ranked(client, routes):
    response = client.post("/api/rush/scores", json=payload(routes, 5))
    assert response.status_code == 200
    body = response.json()
    assert (body["rank"], body["maps"], body["moves"]) == (1, 5, sum(len(route) for route in routes[:5]))


def test_routes_must_clear_their_own_board_in_order(client, routes):
    assert client.post("/api/rush/scores", json=payload(routes, 3)).status_code == 200
    # Wrong order: board 2's route sent as board 1's.
    assert client.post("/api/rush/scores", json=payload([routes[1], routes[0], routes[2]])).status_code == 400
    # Skipping board 1 entirely.
    assert client.post("/api/rush/scores", json=payload([routes[0], routes[2]])).status_code == 400
    # Stops one move short, or keeps going after the board is cleared.
    assert client.post("/api/rush/scores", json=payload([routes[0], routes[1][:-1]])).status_code == 400
    assert client.post("/api/rush/scores", json=payload([routes[0], [*routes[1], routes[1][-1]]])).status_code == 400
    # An empty route clears nothing.
    assert client.post("/api/rush/scores", json=payload([routes[0], []])).status_code == 422


def test_rejects_impossible_times_names_old_days_and_oversized_runs(client, routes):
    moves = sum(len(route) for route in routes[:8])
    assert client.post("/api/rush/scores", json=payload(routes, 8, time_ms=moves * 10)).status_code == 400
    # Plenty for the moves, but too quick to have seen, planned and cleared eight boards.
    too_quick_per_board = main.MIN_MS_PER_RUSH_MAP * 8 - 1
    assert too_quick_per_board > main.MIN_MS_PER_MOVE * moves
    assert client.post("/api/rush/scores", json=payload(routes, 8, time_ms=too_quick_per_board)).status_code == 400
    assert client.post("/api/rush/scores", json=payload(routes, 8, time_ms=main.MIN_MS_PER_RUSH_MAP * 8)).status_code == 200
    assert client.post("/api/rush/scores", json=payload(routes, 4, time_ms=(RUSH_SECONDS + 10) * 1000)).status_code == 422
    assert client.post("/api/rush/scores", json=payload(routes, 4, name="no")).status_code == 422
    assert client.post("/api/rush/scores", json=payload(routes, 4, day="2020-01-01")).status_code == 400
    too_many = [routes[0]] * (MAX_RUSH_MAPS + 1)
    assert client.post("/api/rush/scores", json=payload(too_many, time_ms=100000)).status_code == 422


def test_ranks_by_boards_cleared_then_by_who_got_there_sooner(client, routes):
    me = str(uuid4())
    entries = [("Slow Six", 6, 200000), ("Fast Six", 6, 150000), ("Seven Up", 7, 290000), ("Me Myself", 4, 100000)]
    for name, count, time_ms in entries:
        owner = me if name == "Me Myself" else str(uuid4())
        assert client.post("/api/rush/scores", json=payload(routes, count, name=name, time_ms=time_ms, player_id=owner)).status_code == 200

    board = client.get("/api/rush/leaderboard", headers={"X-Player-Id": me}).json()
    assert [(e["name"], e["maps"]) for e in board["entries"]] == [("Seven Up", 7), ("Fast Six", 6), ("Slow Six", 6), ("Me Myself", 4)]
    assert [e["rank"] for e in board["entries"]] == [1, 2, 3, 4]
    assert [e["you"] for e in board["entries"]] == [False, False, False, True]
    assert board["total"] == 4 and board["you"] is None


def test_you_are_shown_below_the_top_ten(client, routes):
    me = str(uuid4())
    client.post("/api/rush/scores", json=payload(routes, 2, name="Me Myself", player_id=me))
    for index in range(11):
        client.post("/api/rush/scores", json=payload(routes, 5, name=f"Rival {index:02}", time_ms=60000 + index))
    board = client.get("/api/rush/leaderboard", headers={"X-Player-Id": me}).json()
    assert len(board["entries"]) == 10 and board["total"] == 12
    assert board["you"] == {"rank": 12, "name": "Me Myself", "maps": 2, "time_ms": board["you"]["time_ms"], "moves": board["you"]["moves"], "you": True}


def test_only_a_players_first_rush_run_counts(client, routes):
    me = str(uuid4())
    first = client.post("/api/rush/scores", json=payload(routes, 3, player_id=me, time_ms=40000))
    assert first.status_code == 200 and first.json()["maps"] == 3

    # A later run, even a far better one, is practice and changes nothing.
    better = client.post("/api/rush/scores", json=payload(routes, 8, player_id=me, time_ms=30000))
    assert better.status_code == 200
    assert (better.json()["maps"], better.json()["time_ms"]) == (3, 40000)

    board = client.get("/api/rush/leaderboard", headers={"X-Player-Id": me}).json()
    assert board["total"] == 1 and board["entries"][0]["maps"] == 3


def test_an_empty_leaderboard_is_fine(client):
    board = client.get("/api/rush/leaderboard").json()
    assert board["entries"] == [] and board["you"] is None and board["total"] == 0
