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

    def randint(self, low: int, high: int) -> int:
        return low + self.randrange(high - low + 1)

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
    row, col = player
    moved = False

    while True:
        next_row, next_col = row + row_step, col + col_step
        if not (0 <= next_row < ROWS and 0 <= next_col < COLS):
            break
        if board[next_row][next_col] == "|":
            break
        board[row][col] = "-"
        row, col = next_row, next_col
        board[row][col] = "P"
        moved = True

    return (row, col), moved


def _bit(position: Position) -> int:
    return 1 << (position[0] * COLS + position[1])


def _slide_edges(board: Board) -> dict[Position, list[tuple[Position, int]]]:
    """Every open cell mapped to the (destination, covered cells) of each possible slide."""
    edges: dict[Position, list[tuple[Position, int]]] = {}
    for row in range(ROWS):
        for col in range(COLS):
            if board[row][col] == "|":
                continue
            moves = []
            for row_step, col_step in DIRECTIONS.values():
                next_row, next_col = row + row_step, col + col_step
                path = 0
                while 0 <= next_row < ROWS and 0 <= next_col < COLS and board[next_row][next_col] != "|":
                    path |= _bit((next_row, next_col))
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
    dots = 0
    for row in range(ROWS):
        for col in range(COLS):
            if board[row][col] == ".":
                dots |= _bit((row, col))

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

    return Analysis(search(component_of[start], _bit(start)), component_count)


def _constructed_board(rng: SeededRandom) -> tuple[Board, Position]:
    """Build a board around a random solution walk, so it is solvable by construction.

    A stopper wall is only ever placed on a cell the walk has not touched, so it
    never changes an earlier slide. Cells the walk never reaches become walls.
    """
    start = (rng.randrange(ROWS), rng.randrange(COLS))
    walls: set[Position] = set()
    visited = {start}
    player = start
    idle_steps = 0

    for _ in range(WALK_MAX_STEPS):
        options = []
        for row_step, col_step in DIRECTIONS.values():
            row, col = player
            path = []
            while True:
                row, col = row + row_step, col + col_step
                if not (0 <= row < ROWS and 0 <= col < COLS) or (row, col) in walls:
                    break
                path.append((row, col))

            new_cells = 0
            for index, cell in enumerate(path):
                new_cells += cell not in visited
                beyond = (cell[0] + row_step, cell[1] + col_step)
                if index == len(path) - 1:
                    options.append((path[: index + 1], None, new_cells))
                elif beyond not in visited and len(walls) < WALK_STOPPER_BUDGET:
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

    board = [["." if (row, col) in visited else "|" for col in range(COLS)] for row in range(ROWS)]
    board[start[0]][start[1]] = "P"
    return board, start


@lru_cache(maxsize=32)
def _daily_map(day: str, level: int) -> tuple[tuple[str, ...], Position]:
    rules = LEVEL_RULES[level]
    rng = SeededRandom(f"swipe-cover:{day}:{level}")
    fallback = None

    for _ in range(MAX_GENERATION_ATTEMPTS):
        board, start = _constructed_board(rng)
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


def generate_map(level: int, day: str | None = None) -> tuple[Board, Position]:
    """The board for a level is the same for every player on a given day."""
    rows, start = _daily_map(day or current_day_key(), level)
    return [list(row) for row in rows], start


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
