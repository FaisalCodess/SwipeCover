// Line-for-line port of the daily board generator in backend/game.py.
// Both sides use the same seeded random numbers, so a browser that cannot reach
// the server still builds exactly the same three puzzles as everyone else.
// If you change the generation rules, change them in both files.
import { DIRECTION_STEPS } from './game.js';

const ROWS = 9;
const COLS = 12;
const LEVELS_PER_DAY = 3;
const MAX_GENERATION_ATTEMPTS = 20000;
const WALK_MAX_STEPS = 80;
const WALK_STOPPER_BUDGET = 9;
const STEPS = Object.values(DIRECTION_STEPS);
const LEVEL_RULES = {
  1: { walls: [12, 18], zones: [1, 1] },
  2: { walls: [14, 20], zones: [2, 3] },
  3: { walls: [14, 24], zones: [4, 99] },
};
const CELL_BITS = Array.from({ length: ROWS * COLS }, (_, index) => 1n << BigInt(index));

const imul = (left, right) => Math.imul(left, right) >>> 0;
const bit = (row, col) => CELL_BITS[row * COLS + col];
const cellKey = (row, col) => row * COLS + col;

class SeededRandom {
  constructor(seed) {
    let state = 0x811c9dc5;
    for (const char of seed) state = imul(state ^ char.charCodeAt(0), 0x01000193);
    this.state = state;
  }

  random() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = imul(value ^ (value >>> 15), value | 1);
    value = ((((value + imul(value ^ (value >>> 7), value | 61)) >>> 0) ^ value) >>> 0);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  randrange(stop) {
    return Math.floor(this.random() * stop);
  }

  randint(low, high) {
    return low + this.randrange(high - low + 1);
  }

  weightedIndex(weights) {
    let remaining = this.random() * weights.reduce((total, weight) => total + weight, 0);
    for (let index = 0; index < weights.length; index += 1) {
      remaining -= weights[index];
      if (remaining < 0) return index;
    }
    return weights.length - 1;
  }
}

function slideEdges(board) {
  const edges = new Map();
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      if (board[row][col] === '|') continue;
      const moves = [];
      for (const [rowStep, colStep] of STEPS) {
        let nextRow = row + rowStep;
        let nextCol = col + colStep;
        let path = 0n;
        while (nextRow >= 0 && nextRow < ROWS && nextCol >= 0 && nextCol < COLS && board[nextRow][nextCol] !== '|') {
          path |= bit(nextRow, nextCol);
          nextRow += rowStep;
          nextCol += colStep;
        }
        if (path) moves.push([cellKey(nextRow - rowStep, nextCol - colStep), path]);
      }
      edges.set(cellKey(row, col), moves);
    }
  }
  return edges;
}

// Exact solvability check; see `analyze` in backend/game.py for how it works.
export function analyze(board, start) {
  const edges = slideEdges(board);
  let dots = 0n;
  board.forEach((cells, row) => cells.forEach((cell, col) => {
    if (cell === '.') dots |= bit(row, col);
  }));

  const indexOf = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const componentOf = new Map();
  let componentCount = 0;

  function connect(node) {
    indexOf.set(node, indexOf.size);
    low.set(node, indexOf.get(node));
    stack.push(node);
    onStack.add(node);
    for (const [target] of edges.get(node)) {
      if (!indexOf.has(target)) {
        connect(target);
        low.set(node, Math.min(low.get(node), low.get(target)));
      } else if (onStack.has(target)) {
        low.set(node, Math.min(low.get(node), indexOf.get(target)));
      }
    }
    if (low.get(node) === indexOf.get(node)) {
      while (true) {
        const member = stack.pop();
        onStack.delete(member);
        componentOf.set(member, componentCount);
        if (member === node) break;
      }
      componentCount += 1;
    }
  }

  const startKey = cellKey(start.row, start.col);
  connect(startKey);

  const inner = Array(componentCount).fill(0n);
  const exits = Array.from({ length: componentCount }, () => new Map());
  for (const [node, component] of componentOf) {
    for (const [target, path] of edges.get(node)) {
      const targetComponent = componentOf.get(target);
      if (targetComponent === component) inner[component] |= path;
      else exits[component].set(`${targetComponent}:${path}`, [targetComponent, path]);
    }
  }

  const failed = new Set();
  function search(component, covered) {
    const reached = covered | inner[component];
    if ((reached & dots) === dots) return true;
    const key = `${component}:${reached}`;
    if (failed.has(key)) return false;
    for (const [target, path] of exits[component].values()) {
      if (search(target, reached | path)) return true;
    }
    failed.add(key);
    return false;
  }

  return { solvable: search(componentOf.get(startKey), bit(start.row, start.col)), zones: componentCount };
}

function constructedBoard(rng) {
  const start = { row: rng.randrange(ROWS), col: rng.randrange(COLS) };
  const walls = new Set();
  const visited = new Set([cellKey(start.row, start.col)]);
  let player = start;
  let idleSteps = 0;

  for (let step = 0; step < WALK_MAX_STEPS; step += 1) {
    const options = [];
    for (const [rowStep, colStep] of STEPS) {
      let { row, col } = player;
      const path = [];
      while (true) {
        row += rowStep;
        col += colStep;
        if (row < 0 || row >= ROWS || col < 0 || col >= COLS || walls.has(cellKey(row, col))) break;
        path.push({ row, col });
      }

      let newCells = 0;
      path.forEach((cell, index) => {
        newCells += visited.has(cellKey(cell.row, cell.col)) ? 0 : 1;
        const beyond = cellKey(cell.row + rowStep, cell.col + colStep);
        if (index === path.length - 1) {
          options.push([path.slice(0, index + 1), null, newCells]);
        } else if (!visited.has(beyond) && walls.size < WALK_STOPPER_BUDGET) {
          options.push([path.slice(0, index + 1), beyond, newCells]);
        }
      });
    }

    if (!options.length) break;
    const [path, stopper, newCells] = options[rng.weightedIndex(options.map(([, , cells]) => 1 + 4 * cells * cells))];
    if (stopper !== null) walls.add(stopper);
    for (const cell of path) visited.add(cellKey(cell.row, cell.col));
    player = path[path.length - 1];
    idleSteps = newCells ? 0 : idleSteps + 1;
    if (idleSteps >= 5) break;
  }

  const board = Array.from({ length: ROWS }, (_, row) => (
    Array.from({ length: COLS }, (_, col) => (visited.has(cellKey(row, col)) ? '.' : '|'))
  ));
  board[start.row][start.col] = 'P';
  return { board, start };
}

const cache = new Map();

// Same shape as the server's `GET /api/daily/{level}` response.
export function generateDailyBoard(day, level) {
  const cacheKey = `${day}:${level}`;
  if (!cache.has(cacheKey)) {
    const rules = LEVEL_RULES[level];
    const rng = new SeededRandom(`swipe-cover:${day}:${level}`);
    let chosen = null;
    let fallback = null;

    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS && !chosen; attempt += 1) {
      const candidate = constructedBoard(rng);
      const walls = candidate.board.flat().filter((cell) => cell === '|').length;
      if (walls < rules.walls[0] || walls > rules.walls[1]) continue;
      const result = analyze(candidate.board, candidate.start);
      if (!result.solvable) continue;
      fallback ||= candidate;
      if (result.zones >= rules.zones[0] && result.zones <= rules.zones[1]) chosen = candidate;
    }

    const { board, start } = chosen || fallback;
    cache.set(cacheKey, { board, start });
  }
  const { board, start } = cache.get(cacheKey);
  return { level, levels: LEVELS_PER_DAY, day, board: board.map((row) => [...row]), player: { ...start } };
}
