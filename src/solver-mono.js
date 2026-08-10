// solver-mono.js - World 13 monuments two-phase solver.
// Phase A: place pieces onto monument slots (#) via backtracking (no overlap, no fake slot X, cover all real slots).
// Phase B: run the core word solver on the assembled letter grid.
import { parseLevel, exportLevel } from './parse.js';
import { makeBoard, cellAt, isSolved, boardKey } from './engine.js';
import { solve } from './solver.js';

// Build the slot layout from parsed Level: slots are cells where grid char is '#'
// (fake slots are 'X' - they are decorative, cannot be landed on).
function collectSlots(level) {
  const slots = [];
  const fake = new Set();
  for (let y = 0; y < level.rows; y++) {
    for (let x = 0; x < level.cols; x++) {
      const ch = level.grid[y][x];
      if (ch === '#') slots.push({ x, y });
      else if (ch === 'X') fake.add(`${x},${y}`);
    }
  }
  return { slots, fake };
}

// Expand a piece shape (array of strings) into relative cells; '-' = empty.
// '*' in shape means extra hp layer on previous tile (mirror MonumentPiece.Setup).
function pieceCells(shape) {
  const cells = [];
  for (let y = 0; y < shape.length; y++) {
    let hp = 0;
    for (let x = 0; x < shape[y].length; x++) {
      const ch = shape[y][x];
      if (ch === '*') { if (cells.length) cells[cells.length - 1].hp++; continue; }
      if (ch !== '-') cells.push({ x, y, letter: ch, hp });
    }
  }
  return cells;
}

// Try to place `piece` such that its cells land exactly on `slot`.
// Returns list of placements: [{ anchor: {x,y}, letters: [{x,y,letter}] }]
function placementsForPiece(piece, slots, occupied, cols, rows) {
  const cells = pieceCells(piece.shape);
  const out = [];
  const slotSet = new Map();
  slots.forEach(s => slotSet.set(`${s.x},${s.y}`, s));
  for (const s of slots) {
    // anchor piece cell (0,0) at slot s, then check all cells land on slots
    let ok = true;
    const placed = [];
    for (const pc of cells) {
      const px = s.x + pc.x, py = s.y + pc.y;
      if (px < 0 || py < 0 || px >= cols || py >= rows) { ok = false; break; }
      const key = `${px},${py}`;
      if (!slotSet.has(key)) { ok = false; break; }
      if (occupied.has(key)) { ok = false; break; }
      placed.push({ x: px, y: py, letter: pc.letter, hp: pc.hp });
    }
    if (ok) out.push({ anchor: { x: s.x, y: s.y }, cells: placed });
  }
  return out;
}

// Phase A: enumerate up to N placement solutions.
export function placePiecesAll(level, pieces, cap = 200) {
  const { slots } = collectSlots(level);
  const occupied = new Set();
  const used = new Array(pieces.length).fill(false);
  const solution = [];
  const solutions = [];

  function backtrack(depth) {
    if (solutions.length >= cap) return true;
    if (depth === pieces.length) {
      solutions.push(solution.map(p => ({ ...p, cells: p.cells.map(c => ({ ...c })) })));
      return solutions.length >= cap;
    }
    for (let i = 0; i < pieces.length; i++) {
      if (used[i]) continue;
      const placements = placementsForPiece(pieces[i], slots, occupied, level.cols, level.rows);
      for (const p of placements) {
        p.cells.forEach(c => occupied.add(`${c.x},${c.y}`));
        used[i] = true;
        solution.push({ pieceIndex: i, ...p });
        if (backtrack(depth + 1)) return true;
        solution.pop();
        used[i] = false;
        p.cells.forEach(c => occupied.delete(`${c.x},${c.y}`));
      }
    }
    return false;
  }

  backtrack(0);
  return solutions;
}

// Build the assembled letter grid from a phase-A solution:
//   - piece letters become letter tiles
//   - leftover real slots (#) become blank target tiles
//   - fake slots (X) and empty cells stay empty
export function assembleGrid(level, solution) {
  const g = Array.from({ length: level.rows }, () => Array(level.cols).fill('-'));
  const on = Array.from({ length: level.rows }, () => Array(level.cols).fill(0));
  const { slots } = collectSlots(level);
  const occupied = new Set();
  for (const piece of solution) for (const c of piece.cells) occupied.add(`${c.x},${c.y}`);
  for (const s of slots) {
    if (!occupied.has(`${s.x},${s.y}`)) g[s.y][s.x] = '#';
  }
  for (const piece of solution) {
    for (const c of piece.cells) {
      if (c.letter === '#') g[c.y][c.x] = '#';
      else { g[c.y][c.x] = c.letter; on[c.y][c.x] = c.hp || 0; }
    }
  }
  return { cols: level.cols, rows: level.rows, grid: g, onions: on };
}

export function solveMonuments(level) {
  if (!level.pieces || !level.pieces.length) {
    return { status: 'exhausted_no_solution', reason: 'no pieces' };
  }
  const solutions = placePiecesAll(level, level.pieces, 200);
  if (!solutions.length) return { status: 'exhausted_no_solution', reason: 'no placement' };
  // Try each placement solution -> phase B word solve
  for (const sol of solutions) {
    const assembled = assembleGrid(level, sol);
    const sub = {
      ...assembled,
      world: level.world ?? 13,
      level: level.level,
      hints: level.hints || [],
      name: level.name,
    };
    const res = solve(sub, { timeMs: 6000, nodeLimit: 2000000 });
    if (res.status === 'solved') {
      return { ...res, monumentPlacement: sol };
    }
  }
  return { status: 'exhausted_no_solution', reason: 'phaseB' };
}
