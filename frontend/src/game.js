// Client-side copy of the slide rules in backend/game.py, so moves feel instant.
export const DIRECTION_STEPS = {
  up: [-1, 0],
  left: [0, -1],
  down: [1, 0],
  right: [0, 1],
};

export function countDots(board) {
  return board.reduce((total, row) => total + row.filter((cell) => cell === '.').length, 0);
}

// Returns the new board/player plus the cells passed through, or null when the move is blocked.
export function slide(board, player, direction) {
  const [rowStep, colStep] = DIRECTION_STEPS[direction];
  const rows = board.length;
  const cols = board[0].length;
  let { row, col } = player;
  const path = [];

  while (true) {
    const nextRow = row + rowStep;
    const nextCol = col + colStep;
    if (nextRow < 0 || nextRow >= rows || nextCol < 0 || nextCol >= cols) break;
    if (board[nextRow][nextCol] === '|') break;
    row = nextRow;
    col = nextCol;
    path.push([row, col]);
  }

  if (!path.length) return null;

  const nextBoard = board.map((cells) => [...cells]);
  nextBoard[player.row][player.col] = '-';
  for (const [pathRow, pathCol] of path) nextBoard[pathRow][pathCol] = '-';
  nextBoard[row][col] = 'P';
  return { board: nextBoard, player: { row, col }, path };
}
