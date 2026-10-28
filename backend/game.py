import random
from dataclasses import dataclass

ROWS = 9
COLS = 12
LEVELS_PER_DAY = 3
SOLVABILITY_RUNS = 8
SOLVABILITY_MAX_MOVES = 150
DIRECTIONS = {
    "up": (-1, 0),
    "left": (0, -1),
    "down": (1, 0),
    "right": (0, 1),
}
SOLVABILITY_DIRECTIONS = (
    "up",
    "left",
    "down",
    "right",
)


def count_dots(board: list[list[str]]) -> int:
    return sum(cell == "." for row in board for cell in row)


def slide(board: list[list[str]], player: tuple[int, int], direction: str) -> tuple[tuple[int, int], bool]:
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


def verify_solvability(original_board: list[list[str]], start: tuple[int, int]) -> bool:
    slide_paths: dict[tuple[int, int, str], tuple[tuple[int, int], int]] = {}
    dots = 0

    for row in range(ROWS):
        for col in range(COLS):
            position = (row, col)
            position_bit = 1 << (row * COLS + col)
            if original_board[row][col] == ".":
                dots |= position_bit

            for direction in SOLVABILITY_DIRECTIONS:
                row_step, col_step = DIRECTIONS[direction]
                next_row, next_col = row + row_step, col + col_step
                path = 0

                while (
                    0 <= next_row < ROWS
                    and 0 <= next_col < COLS
                    and original_board[next_row][next_col] != "|"
                ):
                    path |= 1 << (next_row * COLS + next_col)
                    next_row += row_step
                    next_col += col_step

                slide_paths[(row, col, direction)] = (
                    (next_row - row_step, next_col - col_step)
                    if path
                    else position,
                    path,
                )

    for _ in range(SOLVABILITY_RUNS):
        player = start
        remaining_dots = dots

        for _ in range(SOLVABILITY_MAX_MOVES):
            if remaining_dots == 0:
                return True

            valid_moves: list[str] = []
            best_moves: list[str] = []
            best_dots = -1

            for direction in SOLVABILITY_DIRECTIONS:
                destination, path = slide_paths[(player[0], player[1], direction)]
                if destination == player:
                    continue

                valid_moves.append(direction)
                cleared = (remaining_dots & path).bit_count()
                if cleared > best_dots:
                    best_dots = cleared
                    best_moves = [direction]
                elif cleared == best_dots:
                    best_moves.append(direction)

            if not valid_moves:
                break

            chosen_move = random.choice(best_moves if best_dots > 0 else valid_moves)
            destination, path = slide_paths[(player[0], player[1], chosen_move)]
            player = destination
            remaining_dots &= ~path

        if remaining_dots == 0:
            return True

    return False


def generate_map() -> tuple[list[list[str]], tuple[int, int]]:
    while True:
        board = [["." for _ in range(COLS)] for _ in range(ROWS)]

        wall_count = 12 + random.randrange(5)
        for _ in range(wall_count):
            row = random.randrange(ROWS)
            col = random.randrange(COLS)
            board[row][col] = "|"

        start = (random.randrange(ROWS), random.randrange(COLS))
        while board[start[0]][start[1]] == "|":
            start = (random.randrange(ROWS), random.randrange(COLS))
        board[start[0]][start[1]] = "P"

        if verify_solvability(board, start):
            return board, start


@dataclass
class Game:
    level: int
    board: list[list[str]]
    initial_board: list[list[str]]
    player: tuple[int, int]
    start_player: tuple[int, int]
    won: bool = False

    @classmethod
    def new(cls, level: int) -> "Game":
        if not 1 <= level <= LEVELS_PER_DAY:
            raise ValueError(f"Level must be between 1 and {LEVELS_PER_DAY}.")

        board, start = generate_map()
        initial_board = [row[:] for row in board]
        return cls(level, board, initial_board, start, start)

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
            "board": self.board,
            "player": {"x": self.player[0], "y": self.player[1]},
            "won": self.won,
            "remaining": count_dots(self.board),
        }
        if moved is not None:
            result["moved"] = moved
        return result
