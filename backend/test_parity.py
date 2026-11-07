"""The browser builds boards itself when the server is unreachable (frontend/src/generator.js).
Both generators must agree exactly, or offline players would get different puzzles."""
import json
import shutil
import subprocess
from datetime import date, timedelta
from pathlib import Path

import pytest

from game import generate_map, generate_rush_map

GENERATOR = Path(__file__).resolve().parent.parent / "frontend" / "src" / "generator.js"
DAYS = [(date(2026, 3, 1) + timedelta(days=offset)).isoformat() for offset in range(30)]
# Enough boards to cover every Swipe Rush tier (the last one starts at board 28).
RUSH_BOARDS = 45
SCRIPT = """
const { generateDailyBoard, generateRushBoard } = await import(process.argv[1]);
const days = JSON.parse(process.argv[2]);
const rushBoards = Number(process.argv[3]);
const daily = days.flatMap((day) => [1, 2, 3].map((level) => generateDailyBoard(day, level)));
const rush = days.flatMap((day) => Array.from({ length: rushBoards }, (_, index) => generateRushBoard(day, index)));
const shape = ({ board, player }) => [board, player];
console.log(JSON.stringify({ daily: daily.map(shape), rush: rush.map(shape) }));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js is not installed")
def test_browser_generator_matches_server():
    result = subprocess.run(
        ["node", "--input-type=module", "-e", SCRIPT, GENERATOR.as_uri(), json.dumps(DAYS), str(RUSH_BOARDS)],
        capture_output=True, text=True, check=True, timeout=120,
    )
    browser = json.loads(result.stdout)
    server_daily = [
        [board, {"row": start[0], "col": start[1]}]
        for day in DAYS for board, start in (generate_map(level, day) for level in (1, 2, 3))
    ]
    assert browser["daily"] == server_daily

    # The server replays a Swipe Rush run on its own boards, so these must match too.
    server_rush = [
        [board, {"row": start[0], "col": start[1]}]
        for day in DAYS for board, start in (generate_rush_map(index, day) for index in range(RUSH_BOARDS))
    ]
    assert browser["rush"] == server_rush
