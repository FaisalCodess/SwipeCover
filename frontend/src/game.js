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

// Plays saved moves back from the start, to pick a run up where the player left it. Each state
// before a move is kept as undo history. Replay stops early at a move that no longer fits the
// board, or that would solve the level, so a stale save can never hand out a finished board.
export function replayRoute(board, player, route) {
  let state = { board, player, route: [] };
  const history = [];
  for (const direction of route) {
    const next = slide(state.board, state.player, direction);
    if (!next || countDots(next.board) === 0) break;
    history.push(state);
    state = { board: next.board, player: next.player, route: [...state.route, direction] };
  }
  return { ...state, history };
}
