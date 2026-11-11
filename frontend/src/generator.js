// Line-for-line port of the board generator in backend/game.py (the daily boards and
// the Swipe Rush boards). Both sides use the same seeded random numbers, so a browser
// that cannot reach the server still builds exactly the same puzzles as everyone else,
// and the server can replay a Swipe Rush run on the very boards the player saw.
// If you change the generation rules, change them in both files.
import { DIRECTION_STEPS } from './game.js';

// The daily board size, which is also the biggest board there is, so it sizes the bit table.
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

// Swipe Rush: small boards that get bigger and trickier as a run goes on. `steps` is the
// length of the random solution walk a board is built around, so the shortest solution is
// about that many moves: this table is the difficulty dial. Same table as RUSH_TIERS in game.py.
const RUSH_ATTEMPTS = 400;
const RUSH_TIERS = [
  // [first board index, rules for the boards from there on]
  [0, { rows: 4, cols: 5, steps: 4, stoppers: 2, walls: [5, 10], zones: [1, 1] }],
  [2, { rows: 5, cols: 6, steps: 5, stoppers: 3, walls: [9, 16], zones: [1, 1] }],
  [5, { rows: 5, cols: 7, steps: 6, stoppers: 4, walls: [10, 20], zones: [1, 1] }],
  [9, { rows: 5, cols: 7, steps: 7, stoppers: 4, walls: [10, 20], zones: [1, 2] }],
  [14, { rows: 6, cols: 8, steps: 8, stoppers: 5, walls: [14, 28], zones: [1, 2] }],
  [20, { rows: 6, cols: 8, steps: 10, stoppers: 6, walls: [14, 30], zones: [2, 3] }],
  [28, { rows: 7, cols: 9, steps: 12, stoppers: 7, walls: [18, 36], zones: [2, 4] }],
];
const CELL_BITS = Array.from({ length: ROWS * COLS }, (_, index) => 1n << BigInt(index));

const imul = (left, right) => Math.imul(left, right) >>> 0;
const bit = (row, col, cols) => CELL_BITS[row * cols + col];
const cellKey = (row, col, cols) => row * cols + col;

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
  const rows = board.length;
  const cols = board[0].length;
  const edges = new Map();
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (board[row][col] === '|') continue;
      const moves = [];
      for (const [rowStep, colStep] of STEPS) {
        let nextRow = row + rowStep;
        let nextCol = col + colStep;
        let path = 0n;
        while (nextRow >= 0 && nextRow < rows && nextCol >= 0 && nextCol < cols && board[nextRow][nextCol] !== '|') {
          path |= bit(nextRow, nextCol, cols);
          nextRow += rowStep;
          nextCol += colStep;
        }
        if (path) moves.push([cellKey(nextRow - rowStep, nextCol - colStep, cols), path]);
      }
      edges.set(cellKey(row, col, cols), moves);
    }
  }
  return edges;
}

// Exact solvability check; see `analyze` in backend/game.py for how it works.
export function analyze(board, start) {
  const cols = board[0].length;
  const edges = slideEdges(board);
  let dots = 0n;
  board.forEach((cells, row) => cells.forEach((cell, col) => {
    if (cell === '.') dots |= bit(row, col, cols);
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

  const startKey = cellKey(start.row, start.col, cols);
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

  return { solvable: search(componentOf.get(startKey), bit(start.row, start.col, cols)), zones: componentCount };
}

function constructedBoard(rng, rows, cols, maxSteps, stopperBudget) {
  const start = { row: rng.randrange(rows), col: rng.randrange(cols) };
  const walls = new Set();
  const visited = new Set([cellKey(start.row, start.col, cols)]);
  let player = start;
  let idleSteps = 0;

  for (let step = 0; step < maxSteps; step += 1) {
    const options = [];
    for (const [rowStep, colStep] of STEPS) {
      let { row, col } = player;
      const path = [];
      while (true) {
        row += rowStep;
        col += colStep;
        if (row < 0 || row >= rows || col < 0 || col >= cols || walls.has(cellKey(row, col, cols))) break;
        path.push({ row, col });
      }

      let newCells = 0;
      path.forEach((cell, index) => {
        newCells += visited.has(cellKey(cell.row, cell.col, cols)) ? 0 : 1;
        const beyond = cellKey(cell.row + rowStep, cell.col + colStep, cols);
        if (index === path.length - 1) {
          options.push([path.slice(0, index + 1), null, newCells]);
        } else if (!visited.has(beyond) && walls.size < stopperBudget) {
          options.push([path.slice(0, index + 1), beyond, newCells]);
        }
      });
    }

    if (!options.length) break;
    const [path, stopper, newCells] = options[rng.weightedIndex(options.map(([, , cells]) => 1 + 4 * cells * cells))];
    if (stopper !== null) walls.add(stopper);
    for (const cell of path) visited.add(cellKey(cell.row, cell.col, cols));
    player = path[path.length - 1];
    idleSteps = newCells ? 0 : idleSteps + 1;
    if (idleSteps >= 5) break;
  }

  const board = Array.from({ length: rows }, (_, row) => (
    Array.from({ length: cols }, (_, col) => (visited.has(cellKey(row, col, cols)) ? '.' : '|'))
  ));
  board[start.row][start.col] = 'P';
  return { board, start };
}

// Draws boards from the seed until one is solvable and fits the rules; see `_find_board` in game.py.
function findBoard(seed, rules) {
  const rng = new SeededRandom(seed);
  let fallback = null;

  for (let attempt = 0; attempt < rules.attempts; attempt += 1) {
    const candidate = constructedBoard(rng, rules.rows, rules.cols, rules.steps, rules.stoppers);
    const walls = candidate.board.flat().filter((cell) => cell === '|').length;
    if (walls < rules.walls[0] || walls > rules.walls[1]) continue;
    const result = analyze(candidate.board, candidate.start);
    if (!result.solvable) continue;
    fallback ||= candidate;
    if (result.zones >= rules.zones[0] && result.zones <= rules.zones[1]) return candidate;
  }

  if (!fallback) throw new Error('Could not generate a solvable board.');
  return fallback;
}

const cache = new Map();

// Same shape as the server's `GET /api/daily/{level}` response.
export function generateDailyBoard(day, level) {
  const cacheKey = `${day}:${level}`;
  if (!cache.has(cacheKey)) {
    const rules = {
      ...LEVEL_RULES[level],
      rows: ROWS,
      cols: COLS,
      steps: WALK_MAX_STEPS,
      stoppers: WALK_STOPPER_BUDGET,
      attempts: MAX_GENERATION_ATTEMPTS,
    };
    cache.set(cacheKey, findBoard(`swipe-cover:${day}:${level}`, rules));
  }
  const { board, start } = cache.get(cacheKey);
  return { level, levels: LEVELS_PER_DAY, day, board: board.map((row) => [...row]), player: { ...start } };
}

const rushCache = new Map();

function rushRules(index) {
  const [, rules] = RUSH_TIERS.filter(([first]) => first <= index).at(-1);
  return { ...rules, attempts: RUSH_ATTEMPTS };
}

// Board number `index` (from 0) of a day's Swipe Rush: the same for every player.
export function generateRushBoard(day, index) {
  const cacheKey = `${day}:${index}`;
  if (!rushCache.has(cacheKey)) rushCache.set(cacheKey, findBoard(`swipe-cover:rush:${day}:${index}`, rushRules(index)));
  const { board, start } = rushCache.get(cacheKey);
  return { index, day, board: board.map((row) => [...row]), player: { ...start } };
}

const matchCache = new Map();

// Board number `index` of a 1v1 match. `seed` comes from the server, one per match, so every match
// plays on fresh boards (same difficulty curve as Swipe Rush); both players get the same ones.
export function generateMatchBoard(seed, index) {
  const cacheKey = `${seed}:${index}`;
  if (!matchCache.has(cacheKey)) {
    if (matchCache.size > 600) matchCache.clear();
    matchCache.set(cacheKey, findBoard(`swipe-cover:mp:${seed}:${index}`, rushRules(index)));
  }
  const { board, start } = matchCache.get(cacheKey);
  return { index, seed, board: board.map((row) => [...row]), player: { ...start } };
}
