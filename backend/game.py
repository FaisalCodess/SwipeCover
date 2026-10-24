import random
from dataclasses import dataclass

ROWS = 9
COLS = 12
LEVELS_PER_DAY = 5
DIRECTIONS = {
    "up": (-1, 0),
    "left": (0, -1),
    "down": (1, 0),
    "right": (0, 1),
}


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

        board = [["." for _ in range(COLS)] for _ in range(ROWS)]
        mid_row, mid_col = ROWS // 2, COLS // 2

        for row in range(1, ROWS - 1):
            for col in range(1, COLS - 1):
                distance = abs(row - mid_row) + abs(col - mid_col)
                if distance <= 3 and random.random() < 0.7:
                    board[row][col] = "|"

        block_count = 12 + min(level * 2, 14)
        for _ in range(block_count):
            row = random.randint(2, ROWS - 3)
            col = random.randint(2, COLS - 3)
            spread = random.choice((1, 2))
            for row_offset in range(-spread, spread + 1):
                for col_offset in range(-spread, spread + 1):
                    target_row, target_col = row + row_offset, col + col_offset
                    if 0 < target_row < ROWS - 1 and 0 < target_col < COLS - 1:
                        board[target_row][target_col] = "|"

        candidates = [
            (row, col)
            for row in range(1, ROWS - 1)
            for col in range(1, COLS - 1)
            if board[row][col] != "|"
        ]
        start = random.choice(candidates)
        board[start[0]][start[1]] = "-"
        initial_board = [row[:] for row in board]
        return cls(level, board, initial_board, start, start)

    def move(self, direction: str) -> bool:
        if self.won or direction not in DIRECTIONS:
            return False

        row, col = self.player
        row_step, col_step = DIRECTIONS[direction]
        moved = False
        while True:
            next_row, next_col = row + row_step, col + col_step
            if not (0 <= next_row < ROWS and 0 <= next_col < COLS):
                break
            if self.board[next_row][next_col] == "|":
                break
            self.board[row][col] = "-"
            row, col = next_row, next_col
            self.board[row][col] = "-"
            moved = True

        if moved:
            self.player = (row, col)
            self.won = all(cell != "." for board_row in self.board for cell in board_row)
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
            "remaining": sum(cell == "." for row in self.board for cell in row),
        }
        if moved is not None:
            result["moved"] = moved
        return result
