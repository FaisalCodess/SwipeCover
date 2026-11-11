from collections import deque

import pytest

import main
from game import COLS, DIRECTIONS, ROWS, current_day_key, generate_map
from scores import clean_name


def solve(level: int, day: str) -> list[str]:
    """Shortest winning route, by breadth-first search over (position, dots left)."""
    board, start = generate_map(level, day)
    bit = lambda row, col: 1 << (row * COLS + col)  # noqa: E731
    dots = sum(bit(r, c) for r in range(ROWS) for c in range(COLS) if board[r][c] == ".")
    queue = deque([(start, dots, ())])
    seen = {(start, dots)}
    while queue:
        (row, col), left, route = queue.popleft()
        if not left:
            return list(route)
        for name, (row_step, col_step) in DIRECTIONS.items():
            r, c, covered = row, col, 0
            while 0 <= r + row_step < ROWS and 0 <= c + col_step < COLS and board[r + row_step][c + col_step] != "|":
                r, c = r + row_step, c + col_step
                covered |= bit(r, c)
            state = ((r, c), left & ~covered)
            if covered and state not in seen:
                seen.add(state)
                queue.append((*state, (*route, name)))
    raise AssertionError("unsolvable board")


@pytest.fixture(scope="module")
def route():
    return solve(3, current_day_key())


def payload(route, **overrides):
    return {"day": current_day_key(), "level": 3, "time_ms": 30000, "route": route, **overrides}


def post(client, who, body):
    return client.post("/api/scores", json=body, headers=who["headers"])


def test_clean_name():
    assert clean_name("  Speedy   Keyz ") == "Speedy Keyz"
    assert clean_name("لاعب_1") == "لاعب_1"
    assert clean_name("ab") is None
    assert clean_name("x" * 17) is None
    assert clean_name("<script>") is None


def test_valid_run_is_ranked(client, signup, route):
    response = post(client, signup(), payload(route))
    assert response.status_code == 200
    assert response.json()["rank"] == 1 and response.json()["moves"] == len(route)


def test_needs_a_login(client, route):
    assert client.post("/api/scores", json=payload(route)).status_code == 401
    assert client.post("/api/scores", json=payload(route), headers={"Authorization": "Bearer nonsense"}).status_code == 401


def test_rejects_runs_that_do_not_solve_the_board(client, signup, route):
    me = signup()
    assert post(client, me, payload(route[:-1])).status_code == 400
    assert post(client, me, payload([*route, route[-1]])).status_code == 400
    assert post(client, me, payload(route, level=1)).status_code == 400


def test_rejects_impossible_times_and_old_days(client, signup, route):
    me = signup()
    assert post(client, me, payload(route, time_ms=len(route) * 10)).status_code == 400
    assert post(client, me, payload(route, day="2020-01-01")).status_code == 400


def test_ranks_everyone_by_their_time(client, signup, route):
    me = signup("Myself")
    post(client, me, payload(route, time_ms=40000))
    for index in range(11):
        post(client, signup(f"Rival {index:02}"), payload(route, time_ms=20000 + index))

    board = client.get("/api/leaderboard/3", headers=me["headers"]).json()
    assert [entry["rank"] for entry in board["entries"]] == list(range(1, 11))
    assert board["entries"][0]["name"] == "Rival 00"
    assert board["total"] == 12
    assert board["you"] == {"rank": 12, "name": "Myself", "time_ms": 40000, "moves": len(route), "you": True}


def test_only_a_players_first_run_counts(client, signup, route):
    me = signup("Myself")
    first = post(client, me, payload(route, time_ms=40000))
    assert first.status_code == 200 and first.json()["rank"] == 1

    # Replays are practice. A faster one (the solution is now known) must not replace the first run.
    fastest_possible = len(route) * main.MIN_MS_PER_MOVE
    faster = post(client, me, payload(route, time_ms=fastest_possible))
    assert faster.status_code == 200
    assert faster.json()["time_ms"] == 40000
    post(client, me, payload(route, time_ms=90000))

    board = client.get("/api/leaderboard/3", headers=me["headers"]).json()
    assert board["total"] == 1
    assert board["entries"] == [{"rank": 1, "name": "Myself", "time_ms": 40000, "moves": len(route), "you": True}]


def test_a_repeat_submission_keeps_the_original_standing(client, signup, route):
    me = signup("Myself")
    post(client, me, payload(route, time_ms=40000))
    post(client, signup("Rival"), payload(route, time_ms=20000))

    fastest_possible = len(route) * main.MIN_MS_PER_MOVE
    again = post(client, me, payload(route, time_ms=fastest_possible)).json()
    assert (again["rank"], again["time_ms"]) == (2, 40000)


def test_each_level_has_its_own_first_run(client, signup):
    me = signup()
    for level, time_ms in ((1, 30000), (3, 45000)):
        solution = solve(level, current_day_key())
        response = post(client, me, payload(solution, level=level, time_ms=time_ms))
        assert response.status_code == 200 and response.json()["rank"] == 1

    assert client.get("/api/leaderboard/1", headers=me["headers"]).json()["entries"][0]["time_ms"] == 30000
    assert client.get("/api/leaderboard/3", headers=me["headers"]).json()["entries"][0]["time_ms"] == 45000
