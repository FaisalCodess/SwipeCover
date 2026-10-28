"""The browser builds boards itself when the server is unreachable (frontend/src/generator.js).
Both generators must agree exactly, or offline players would get different puzzles."""
import json
import shutil
import subprocess
from datetime import date, timedelta
from pathlib import Path

import pytest

from game import generate_map

GENERATOR = Path(__file__).resolve().parent.parent / "frontend" / "src" / "generator.js"
DAYS = [(date(2026, 3, 1) + timedelta(days=offset)).isoformat() for offset in range(30)]
SCRIPT = """
const { generateDailyBoard } = await import(process.argv[1]);
const days = JSON.parse(process.argv[2]);
const boards = days.flatMap((day) => [1, 2, 3].map((level) => generateDailyBoard(day, level)));
console.log(JSON.stringify(boards.map(({ board, player }) => [board, player])));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js is not installed")
def test_browser_generator_matches_server():
    result = subprocess.run(
        ["node", "--input-type=module", "-e", SCRIPT, GENERATOR.as_uri(), json.dumps(DAYS)],
        capture_output=True, text=True, check=True, timeout=120,
    )
    browser_boards = json.loads(result.stdout)
    server_boards = [
        [board, {"row": start[0], "col": start[1]}]
        for day in DAYS for board, start in (generate_map(level, day) for level in (1, 2, 3))
    ]
    assert browser_boards == server_boards
