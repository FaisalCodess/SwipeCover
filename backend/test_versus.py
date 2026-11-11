import time
from contextlib import contextmanager

import pytest
from starlette.websockets import WebSocketDisconnect

import versus
from game import generate_match_map
from test_rush import solve


@pytest.fixture(autouse=True)
def quick_matches(monkeypatch):
    """A match that starts at once, lasts a moment, and does not mind how fast boards are cleared."""
    monkeypatch.setattr(versus, "COUNTDOWN_SECONDS", 0)
    monkeypatch.setattr(versus, "MATCH_SECONDS", 1)
    monkeypatch.setattr(versus, "GRACE_SECONDS", 0.05)
    monkeypatch.setattr(versus, "MIN_MS_PER_MOVE", 0)
    monkeypatch.setattr(versus, "MIN_MS_PER_MAP", 0)


@contextmanager
def connect(client, who):
    with client.websocket_connect(f"/api/versus/ws?token={who['token']}") as socket:
        assert socket.receive_json()["type"] == "hello"
        yield socket


def until(socket, kind):
    while True:
        message = socket.receive_json()
        if message["type"] == kind:
            return message


def route_for(seed, index):
    return solve(*generate_match_map(seed, index))


def test_the_socket_needs_a_login(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/versus/ws"):
            pass
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/versus/ws?token=nonsense"):
            pass


def test_quick_match_pairs_two_players_on_the_same_boards(client, signup):
    alice, bobby = signup("Alice A"), signup("Bobby B")
    with connect(client, alice) as a, connect(client, bobby) as b:
        a.send_json({"type": "queue"})
        assert a.receive_json()["type"] == "searching"
        b.send_json({"type": "queue"})
        first, second = until(a, "matched"), until(b, "matched")
    assert first["seed"] == second["seed"] and len(first["seed"]) == 16
    assert (first["opponent"], second["opponent"]) == ("Bobby B", "Alice A")
    assert first["ranked"] and 900 <= first["remaining_ms"] <= 1000


def test_every_match_gets_new_boards(client, signup):
    seeds = []
    for _ in range(2):
        alice, bobby = signup(f"Alice {len(seeds)}"), signup(f"Bobby {len(seeds)}")
        with connect(client, alice) as a, connect(client, bobby) as b:
            a.send_json({"type": "queue"})
            b.send_json({"type": "queue"})
            seeds.append(until(a, "matched")["seed"])
            until(b, "result")
    assert seeds[0] != seeds[1]
    assert generate_match_map(seeds[0], 0) != generate_match_map(seeds[1], 0)


def test_boards_are_scored_in_order_and_the_better_player_wins(client, signup):
    alice, bobby = signup("Alice A"), signup("Bobby B")
    with connect(client, alice) as a, connect(client, bobby) as b:
        a.send_json({"type": "queue"})
        b.send_json({"type": "queue"})
        seed = until(a, "matched")["seed"]
        until(b, "matched")

        a.send_json({"type": "solved", "index": 0, "route": route_for(seed, 0)})
        assert until(a, "score") == {"type": "score", "you": 1, "them": 0}
        assert until(b, "score") == {"type": "score", "you": 0, "them": 1}
        a.send_json({"type": "solved", "index": 1, "route": route_for(seed, 1)})
        assert until(a, "score")["you"] == 2

        won, lost = until(a, "result"), until(b, "result")
    assert (won["outcome"], won["you"], won["them"]) == ("win", 2, 0)
    assert (lost["outcome"], lost["you"], lost["them"]) == ("lose", 0, 2)
    assert won["delta"] > 0 and lost["delta"] == -won["delta"]
    assert won["rating"] == 1000 + won["delta"]


def test_cheating_does_not_score(client, signup):
    alice, bobby = signup("Alice A"), signup("Bobby B")
    with connect(client, alice) as a, connect(client, bobby) as b:
        a.send_json({"type": "queue"})
        b.send_json({"type": "queue"})
        seed = until(a, "matched")["seed"]
        good = route_for(seed, 0)
        for bad in (
            {"index": 0, "route": good[:-1]},  # one move short
            {"index": 0, "route": []},
            {"index": 1, "route": route_for(seed, 1)},  # skipping board 1
            {"index": 0, "route": ["up", ["x"]]},
            {"index": "0", "route": good},
        ):
            a.send_json({"type": "solved", **bad})
            assert until(a, "rejected")["type"] == "rejected"
        result = until(a, "result")
    assert result["outcome"] == "draw" and (result["you"], result["them"]) == (0, 0)


def test_clearing_boards_faster_than_a_person_can_is_refused(client, signup, monkeypatch):
    monkeypatch.setattr(versus, "MIN_MS_PER_MAP", 10_000)
    alice, bobby = signup("Alice A"), signup("Bobby B")
    with connect(client, alice) as a, connect(client, bobby) as b:
        a.send_json({"type": "queue"})
        b.send_json({"type": "queue"})
        seed = until(a, "matched")["seed"]
        a.send_json({"type": "solved", "index": 0, "route": route_for(seed, 0)})
        assert until(a, "rejected")["index"] == 0


def test_nothing_scores_before_the_start(client, signup, monkeypatch):
    monkeypatch.setattr(versus, "COUNTDOWN_SECONDS", 5)
    alice, bobby = signup("Alice A"), signup("Bobby B")
    with connect(client, alice) as a, connect(client, bobby) as b:
        a.send_json({"type": "queue"})
        b.send_json({"type": "queue"})
        match = until(a, "matched")
        assert 4000 < match["starts_in_ms"] <= 5000
        a.send_json({"type": "solved", "index": 0, "route": route_for(match["seed"], 0)})
        a.send_json({"type": "cancel"})
        assert until(a, "idle")["type"] == "idle"  # no "score" came back before this


def test_a_tie_goes_to_whoever_got_there_first(client, signup, monkeypatch):
    monkeypatch.setattr(versus, "MATCH_SECONDS", 2)
    alice, bobby = signup("Alice A"), signup("Bobby B")
    with connect(client, alice) as a, connect(client, bobby) as b:
        a.send_json({"type": "queue"})
        b.send_json({"type": "queue"})
        seed = until(a, "matched")["seed"]
        until(b, "matched")
        b.send_json({"type": "solved", "index": 0, "route": route_for(seed, 0)})
        until(b, "score")
        time.sleep(0.05)
        a.send_json({"type": "solved", "index": 0, "route": route_for(seed, 0)})
        until(a, "score")
        assert until(a, "result")["outcome"] == "lose"
        assert until(b, "result")["outcome"] == "win"


def test_friends_play_with_a_code_and_it_does_not_change_ratings(client, signup):
    alice, bobby = signup("Alice A"), signup("Bobby B")
    with connect(client, alice) as a, connect(client, bobby) as b:
        a.send_json({"type": "create"})
        code = until(a, "room")["code"]
        assert len(code) == 5
        b.send_json({"type": "join", "code": code.lower()})
        first, second = until(a, "matched"), until(b, "matched")
        assert not first["ranked"] and first["seed"] == second["seed"]
        a.send_json({"type": "solved", "index": 0, "route": route_for(first["seed"], 0)})
        result = until(a, "result")
        until(b, "result")
    assert result["outcome"] == "win" and result["rating"] is None and result["delta"] == 0
    assert client.get("/api/versus/leaderboard").json()["entries"] == []


def test_bad_codes_and_double_booking(client, signup):
    alice, bobby = signup("Alice A"), signup("Bobby B")
    with connect(client, alice) as a, connect(client, bobby) as b:
        b.send_json({"type": "join", "code": "NOPE1"})
        assert "No game" in until(b, "error")["message"]
        a.send_json({"type": "create"})
        code = until(a, "room")["code"]
        a.send_json({"type": "join", "code": code})
        assert "own code" in until(a, "error")["message"]
        a.send_json({"type": "queue"})
        assert until(a, "error")["type"] == "error"  # already waiting in a room
        a.send_json({"type": "cancel"})
        until(a, "idle")
        b.send_json({"type": "join", "code": code})
        assert until(b, "error")["type"] == "error"  # the host cancelled


def test_a_closed_tab_leaves_the_queue(client, signup):
    alice, bobby = signup("Alice A"), signup("Bobby B")
    with connect(client, alice) as a:
        a.send_json({"type": "queue"})
        until(a, "searching")
    with connect(client, bobby) as b:
        b.send_json({"type": "queue"})
        assert until(b, "searching")["type"] == "searching"  # waits: nobody is there to match


def test_rejoining_a_running_match(client, signup, monkeypatch):
    monkeypatch.setattr(versus, "MATCH_SECONDS", 3)
    alice, bobby = signup("Alice A"), signup("Bobby B")
    with connect(client, bobby) as b:
        with connect(client, alice) as a:
            a.send_json({"type": "queue"})
            b.send_json({"type": "queue"})
            seed = until(a, "matched")["seed"]
            a.send_json({"type": "solved", "index": 0, "route": route_for(seed, 0)})
            until(a, "score")
        with connect(client, alice) as again:
            back = until(again, "matched")
            assert back["seed"] == seed and back["you"] == 1 and back["them"] == 0
            assert until(again, "result")["outcome"] == "win"


def test_the_versus_leaderboard_ranks_by_rating(client, signup):
    alice, bobby = signup("Alice A"), signup("Bobby B")
    with connect(client, alice) as a, connect(client, bobby) as b:
        a.send_json({"type": "queue"})
        b.send_json({"type": "queue"})
        seed = until(a, "matched")["seed"]
        a.send_json({"type": "solved", "index": 0, "route": route_for(seed, 0)})
        until(a, "result")
        until(b, "result")
    board = client.get("/api/versus/leaderboard", headers=bobby["headers"]).json()
    assert [(e["name"], e["wins"], e["losses"]) for e in board["entries"]] == [("Alice A", 1, 0), ("Bobby B", 0, 1)]
    assert board["entries"][0]["rating"] > 1000 > board["entries"][1]["rating"]
    assert [e["you"] for e in board["entries"]] == [False, True] and board["total"] == 2
