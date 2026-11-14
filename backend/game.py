from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache

ROWS = 9
COLS = 12
LEVELS_PER_DAY = 3
# Jordan has been on permanent UTC+3 since 2022; the frontend uses the same offset.
DAILY_TIME_ZONE = timezone(timedelta(hours=3))
MAX_GENERATION_ATTEMPTS = 20000
WALK_MAX_STEPS = 80
WALK_STOPPER_BUDGET = 9
DIRECTIONS = {
    "up": (-1, 0),
    "left": (0, -1),
    "down": (1, 0),
    "right": (0, 1),
}

# A "zone" is a strongly connected group of stop positions: inside one, every
# move can be undone. Crossing into another zone is a one-way move, so more
# zones means more ways to trap yourself and more planning required.
LEVEL_RULES = {
    1: {"walls": (12, 18), "zones": (1, 1)},
    2: {"walls": (14, 20), "zones": (2, 3)},
    3: {"walls": (14, 24), "zones": (4, 99)},
}

Board = list[list[str]]
Position = tuple[int, int]
MASK_32 = 0xFFFFFFFF


def _imul(left: int, right: int) -> int:
    return (left * right) & MASK_32


class SeededRandom:
    """mulberry32 seeded with an FNV-1a hash of a string.

    Mirrored exactly in frontend/src/generator.js, so the browser builds the same
    daily boards as the server and the game still works when the server is offline.
    """

    def __init__(self, seed: str):
        state = 0x811C9DC5
        for char in seed:
            state = _imul(state ^ ord(char), 0x01000193)
        self.state = state

    def random(self) -> float:
        self.state = (self.state + 0x6D2B79F5) & MASK_32
        value = self.state
        value = _imul(value ^ (value >> 15), value | 1)
        value = ((value + _imul(value ^ (value >> 7), value | 61)) & MASK_32) ^ value
        return ((value ^ (value >> 14)) & MASK_32) / 4294967296

    def randrange(self, stop: int) -> int:
        return int(self.random() * stop)

    def weighted_index(self, weights: list[int]) -> int:
        remaining = self.random() * sum(weights)
        for index, weight in enumerate(weights):
            remaining -= weight
            if remaining < 0:
                return index
        return len(weights) - 1


def current_day_key(now: datetime | None = None) -> str:
    return (now or datetime.now(DAILY_TIME_ZONE)).astimezone(DAILY_TIME_ZONE).strftime("%Y-%m-%d")


def count_dots(board: Board) -> int:
    return sum(cell == "." for row in board for cell in row)


def slide(board: Board, player: Position, direction: str) -> tuple[Position, bool]:
    row_step, col_step = DIRECTIONS[direction]
    rows, cols = len(board), len(board[0])
    row, col = player
    moved = False

    while True:
        next_row, next_col = row + row_step, col + col_step
        if not (0 <= next_row < rows and 0 <= next_col < cols):
            break
        if board[next_row][next_col] == "|":
            break
        board[row][col] = "-"
        row, col = next_row, next_col
        board[row][col] = "P"
        moved = True

    return (row, col), moved


def _bit(position: Position, cols: int) -> int:
    return 1 << (position[0] * cols + position[1])


def _slide_edges(board: Board) -> dict[Position, list[tuple[Position, int]]]:
    """Every open cell mapped to the (destination, covered cells) of each possible slide."""
    rows, cols = len(board), len(board[0])
    edges: dict[Position, list[tuple[Position, int]]] = {}
    for row in range(rows):
        for col in range(cols):
            if board[row][col] == "|":
                continue
            moves = []
            for row_step, col_step in DIRECTIONS.values():
                next_row, next_col = row + row_step, col + col_step
                path = 0
                while 0 <= next_row < rows and 0 <= next_col < cols and board[next_row][next_col] != "|":
                    path |= _bit((next_row, next_col), cols)
                    next_row += row_step
                    next_col += col_step
                if path:
                    moves.append(((next_row - row_step, next_col - col_step), path))
            edges[(row, col)] = moves
    return edges


@dataclass
class Analysis:
    solvable: bool
    zones: int


def analyze(board: Board, start: Position) -> Analysis:
    """Exact solvability check.

    Inside a strongly connected component of the stop graph the player can take
    every slide and still leave by any exit, so the puzzle is solvable exactly
    when some path through the component DAG covers every dot.
    """
    edges = _slide_edges(board)
    rows, cols = len(board), len(board[0])
    dots = 0
    for row in range(rows):
        for col in range(cols):
            if board[row][col] == ".":
                dots |= _bit((row, col), cols)

    # Tarjan's SCC algorithm over the positions reachable from the start.
    index_of: dict[Position, int] = {}
    low: dict[Position, int] = {}
    on_stack: set[Position] = set()
    stack: list[Position] = []
    component_of: dict[Position, int] = {}
    component_count = 0

    def connect(node: Position) -> None:
        nonlocal component_count
        index_of[node] = low[node] = len(index_of)
        stack.append(node)
        on_stack.add(node)
        for target, _ in edges[node]:
            if target not in index_of:
                connect(target)
                low[node] = min(low[node], low[target])
            elif target in on_stack:
                low[node] = min(low[node], index_of[target])
        if low[node] == index_of[node]:
            while True:
                member = stack.pop()
                on_stack.discard(member)
                component_of[member] = component_count
                if member == node:
                    break
            component_count += 1

    connect(start)

    inner = [0] * component_count
    exits: list[set[tuple[int, int]]] = [set() for _ in range(component_count)]
    for node, component in component_of.items():
        for target, path in edges[node]:
            if component_of[target] == component:
                inner[component] |= path
            else:
                exits[component].add((component_of[target], path))

    failed: set[tuple[int, int]] = set()

    def search(component: int, covered: int) -> bool:
        covered |= inner[component]
        if covered & dots == dots:
            return True
        if (component, covered) in failed:
            return False
        if any(search(target, covered | path) for target, path in exits[component]):
            return True
        failed.add((component, covered))
        return False

    return Analysis(search(component_of[start], _bit(start, cols)), component_count)


def _constructed_board(
    rng: SeededRandom, rows: int, cols: int, max_steps: int, stopper_budget: int
) -> tuple[Board, Position]:
    """Build a board around a random solution walk, so it is solvable by construction.

    A stopper wall is only ever placed on a cell the walk has not touched, so it
    never changes an earlier slide. Cells the walk never reaches become walls.
    """
    start = (rng.randrange(rows), rng.randrange(cols))
    walls: set[Position] = set()
    visited = {start}
    player = start
    idle_steps = 0

    for _ in range(max_steps):
        options = []
        for row_step, col_step in DIRECTIONS.values():
            row, col = player
            path = []
            while True:
                row, col = row + row_step, col + col_step
                if not (0 <= row < rows and 0 <= col < cols) or (row, col) in walls:
                    break
                path.append((row, col))

            new_cells = 0
            for index, cell in enumerate(path):
                new_cells += cell not in visited
                beyond = (cell[0] + row_step, cell[1] + col_step)
                if index == len(path) - 1:
                    options.append((path[: index + 1], None, new_cells))
                elif beyond not in visited and len(walls) < stopper_budget:
                    options.append((path[: index + 1], beyond, new_cells))

        if not options:
            break
        path, stopper, new_cells = options[rng.weighted_index([1 + 4 * cells * cells for _, _, cells in options])]
        if stopper:
            walls.add(stopper)
        visited.update(path)
        player = path[-1]
        idle_steps = 0 if new_cells else idle_steps + 1
        if idle_steps >= 5:
            break

    board = [["." if (row, col) in visited else "|" for col in range(cols)] for row in range(rows)]
    board[start[0]][start[1]] = "P"
    return board, start


def _find_board(seed: str, rules: dict) -> tuple[tuple[str, ...], Position]:
    """Draw boards from the seed until one is solvable and fits the rules.

    Falls back to the first solvable board that fit the wall limits, so it always returns something.
    """
    rng = SeededRandom(seed)
    fallback = None

    for _ in range(rules["attempts"]):
        board, start = _constructed_board(rng, rules["rows"], rules["cols"], rules["steps"], rules["stoppers"])
        walls = sum(row.count("|") for row in board)
        if not rules["walls"][0] <= walls <= rules["walls"][1]:
            continue
        result = analyze(board, start)
        if not result.solvable:
            continue
        fallback = fallback or (board, start)
        if rules["zones"][0] <= result.zones <= rules["zones"][1]:
            return tuple("".join(row) for row in board), start

    if fallback is None:
        raise RuntimeError("Could not generate a solvable board.")
    board, start = fallback
    return tuple("".join(row) for row in board), start


@lru_cache(maxsize=32)
def _daily_map(day: str, level: int) -> tuple[tuple[str, ...], Position]:
    rules = {
        **LEVEL_RULES[level],
        "rows": ROWS,
        "cols": COLS,
        "steps": WALK_MAX_STEPS,
        "stoppers": WALK_STOPPER_BUDGET,
        "attempts": MAX_GENERATION_ATTEMPTS,
    }
    return _find_board(f"swipe-cover:{day}:{level}", rules)


def generate_map(level: int, day: str | None = None) -> tuple[Board, Position]:
    """The board for a level is the same for every player on a given day."""
    rows, start = _daily_map(day or current_day_key(), level)
    return [list(row) for row in rows], start


# ---- Swipe Rush ----------------------------------------------------------------
# Five minutes, as many boards as you can clear. Every player gets the same endless
# sequence each day, in the same order, so board N is a pure function of (day, N).
#
# The boards are small and quick, and get bigger and trickier as the run goes on.
# `steps` is the length of the random solution walk a board is built around, so the
# shortest solution is about that many moves; the table is the difficulty dial.
# Mirrored exactly in frontend/src/generator.js (RUSH_TIERS there).
RUSH_SECONDS = 300
# No run gets anywhere near this many boards; it just bounds what the server will replay.
MAX_RUSH_MAPS = 150
RUSH_ATTEMPTS = 400
RUSH_TIERS = (
    # (first board index, rules for the boards from there on)
    (0, {"rows": 4, "cols": 5, "steps": 4, "stoppers": 2, "walls": (5, 10), "zones": (1, 1)}),
    (2, {"rows": 5, "cols": 6, "steps": 5, "stoppers": 3, "walls": (9, 16), "zones": (1, 1)}),
    (5, {"rows": 5, "cols": 7, "steps": 6, "stoppers": 4, "walls": (10, 20), "zones": (1, 1)}),
    (9, {"rows": 5, "cols": 7, "steps": 7, "stoppers": 4, "walls": (10, 20), "zones": (1, 2)}),
    (14, {"rows": 6, "cols": 8, "steps": 8, "stoppers": 5, "walls": (14, 28), "zones": (1, 2)}),
    (20, {"rows": 6, "cols": 8, "steps": 10, "stoppers": 6, "walls": (14, 30), "zones": (2, 3)}),
    (28, {"rows": 7, "cols": 9, "steps": 12, "stoppers": 7, "walls": (18, 36), "zones": (2, 4)}),
)


def rush_rules(index: int) -> dict:
    rules = [tier for first, tier in RUSH_TIERS if first <= index][-1]
    return {**rules, "attempts": RUSH_ATTEMPTS}


@lru_cache(maxsize=2048)
def _rush_map(day: str, index: int) -> tuple[tuple[str, ...], Position]:
    return _find_board(f"swipe-cover:rush:{day}:{index}", rush_rules(index))


def generate_rush_map(index: int, day: str | None = None) -> tuple[Board, Position]:
    """Board number `index` (from 0) of a day's Swipe Rush: the same for every player."""
    rows, start = _rush_map(day or current_day_key(), index)
    return [list(row) for row in rows], start


@lru_cache(maxsize=4096)
def _match_map(seed: str, index: int) -> tuple[tuple[str, ...], Position]:
    return _find_board(f"swipe-cover:mp:{seed}:{index}", rush_rules(index))


def generate_match_map(seed: str, index: int) -> tuple[Board, Position]:
    """Board number `index` of a 1v1 match. Each match has its own random `seed`, so every match
    plays on fresh boards (same difficulty curve as Swipe Rush); both players get the same ones."""
    rows, start = _match_map(seed, index)
    return [list(row) for row in rows], start


def solves(board: Board, start: Position, route: list[str]) -> bool:
    """True when every move slides the ball and the last one covers the final square."""
    board = [row[:] for row in board]
    position = start
    for step, direction in enumerate(route):
        position, moved = slide(board, position, direction)
        if not moved:
            return False
        if count_dots(board) == 0:
            return step == len(route) - 1
    return False


@dataclass
class Game:
    level: int
    day: str
    board: Board
    initial_board: Board
    player: Position
    start_player: Position
    won: bool = False

    @classmethod
    def new(cls, level: int, day: str | None = None) -> "Game":
        if not 1 <= level <= LEVELS_PER_DAY:
            raise ValueError(f"Level must be between 1 and {LEVELS_PER_DAY}.")

        day = day or current_day_key()
        board, start = generate_map(level, day)
        initial_board = [row[:] for row in board]
        return cls(level, day, board, initial_board, start, start)

    def move(self, direction: str) -> bool:
        if self.won or direction not in DIRECTIONS:
            return False

        self.player, moved = slide(self.board, self.player, direction)
        if moved:
            self.won = count_dots(self.board) == 0
        return moved

    def restart(self) -> None:
        self.board = [row[:] for row in self.initial_board]
        self.player = self.start_player
        self.won = False

    def snapshot(self, moved: bool | None = None) -> dict:
        result = {
            "level": self.level,
            "day": self.day,
            "board": self.board,
            "player": {"row": self.player[0], "col": self.player[1]},
            "won": self.won,
            "remaining": count_dots(self.board),
        }
        if moved is not None:
            result["moved"] = moved
        return result
