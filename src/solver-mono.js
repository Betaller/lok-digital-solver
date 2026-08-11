// solver-mono.js - World 13 monuments two-phase solver.
// Phase A: place pieces onto monument slots (#) via backtracking (no overlap, no fake slot X, cover all real slots).
// Phase B: run the core word solver on the assembled letter grid.
import { parseLevel, exportLevel } from './parse.js';
import { makeBoard, cellAt, isSolved, boardKey, WORD_LIBRARY } from './engine.js';
import { solve, findPlacements } from './solver.js';

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

// Try to place `piece` such that its letter cells land exactly on slots.
// Anchor can be any position; only letter cells must match slots.
function placementsForPiece(piece, slots, occupied, cols, rows) {
  const cells = pieceCells(piece.shape);
  const out = [];
  const slotSet = new Map();
  slots.forEach(s => slotSet.set(`${s.x},${s.y}`, s));
  if (cells.length === 0) return out;

  const seen = new Set();
  for (const s of slots) {
    for (const anchorCell of cells) {
      const ox = s.x - anchorCell.x, oy = s.y - anchorCell.y;
      let ok = true;
      const placed = [];
      for (const pc of cells) {
        const px = ox + pc.x, py = oy + pc.y;
        if (px < 0 || py < 0 || px >= cols || py >= rows) { ok = false; break; }
        const key = `${px},${py}`;
        if (!slotSet.has(key) || occupied.has(key)) { ok = false; break; }
        placed.push({ x: px, y: py, letter: pc.letter, hp: pc.hp });
      }
      if (!ok) continue;
      const k = placed.map(c => `${c.x},${c.y}`).sort().join('|');
      if (!seen.has(k)) { seen.add(k); out.push({ cells: placed }); }
    }
    if (out.length >= 20) break; // cap per piece
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
    // find the piece with the fewest placements (minimum remaining values heuristic)
    let bestPiece = -1, bestPls = null, bestMin = Infinity;
    for (let i = 0; i < pieces.length; i++) {
      if (used[i]) continue;
      const pls = placementsForPiece(pieces[i], slots, occupied, level.cols, level.rows);
      if (pls.length < bestMin) { bestMin = pls.length; bestPiece = i; bestPls = pls; }
    }
    if (!bestPls || bestMin === 0) return false;
    used[bestPiece] = true;
    for (const p of bestPls) {
      p.cells.forEach(c => occupied.add(`${c.x},${c.y}`));
      solution.push({ pieceIndex: bestPiece, ...p });
      if (backtrack(depth + 1)) return true;
      solution.pop();
      p.cells.forEach(c => occupied.delete(`${c.x},${c.y}`));
      if (solutions.length >= cap) return true;
    }
    used[bestPiece] = false;
    return false;
  }

  backtrack(0);
  return solutions;
}

// Build the assembled letter grid from a phase-A solution.
// qAssign: optional Map of "x,y" -> letter for ? wildcard assignment.
export function assembleGrid(level, solution, qAssign) {
  const g = Array.from({ length: level.rows }, () => Array(level.cols).fill('-'));
  const on = Array.from({ length: level.rows }, () => Array(level.cols).fill(0));
  for (const piece of solution) {
    for (const c of piece.cells) {
      let letter = c.letter;
      if (letter === '?' && qAssign) {
        letter = qAssign.get(`${c.x},${c.y}`) ?? '?';
      }
      // piece cells with '#' stay as targets; all other letters become letter tiles
      if (letter === '#') g[c.y][c.x] = '#';
      else { g[c.y][c.x] = letter; on[c.y][c.x] = c.hp || 0; }
    }
  }
  // unfilled slots stay as '-' (empty), not targets
  return { cols: level.cols, rows: level.rows, grid: g, onions: on };
}

export function solveMonuments(level) {
  if (!level.pieces || !level.pieces.length) {
    return { status: 'exhausted_no_solution', reason: 'no pieces' };
  }
  const solutions = placePiecesAll(level, level.pieces, 200);
  if (!solutions.length) return { status: 'exhausted_no_solution', reason: 'no placement' };

  const usefulLetters = new Set();
  for (const cfg of Object.values(WORD_LIBRARY)) {
    for (const sp of cfg.spell) for (const ch of sp) usefulLetters.add(ch);
  }
  usefulLetters.add('X');
  const qLetters = [...usefulLetters];

  for (const sol of solutions) {
    const qPos = [];
    for (const p of sol) for (const c of p.cells) {
      if (c.letter === '?') qPos.push(c);
    }
    if (!qPos.length) {
      const assembled = assembleGrid(level, sol);
      const res = solve({ ...assembled, world: 0, level: level.level, hints: level.hints || [], name: level.name },
                        { timeMs: 30000, nodeLimit: 10000000, taQ: true });
      if (res.status === 'solved') return { ...res, monumentPlacement: sol };
      continue;
    }

    // Try ? assignments, but only those where all hint words become spellable
    const hints = level.hints || [];
    for (const a of qLetters) {
      for (const b of qLetters) {
        const m = new Map();
        m.set(qPos[0].x + ',' + qPos[0].y, a);
        if (qPos.length > 1) m.set(qPos[1].x + ',' + qPos[1].y, b);
        const assembled = assembleGrid(level, sol, m);
        const grid = makeBoard(assembled);
        let allOk = true;
        for (const h of hints) {
          if (!WORD_LIBRARY[h]) continue;
          let found = false;
          for (const sp of WORD_LIBRARY[h].spell) {
            if (findPlacements(grid, sp, assembled.cols, assembled.rows, { maxRec: 2000 }).length > 0) {
              found = true; break;
            }
          }
          if (!found) { allOk = false; break; }
        }
        if (!allOk) continue;
        const res = solve({ ...assembled, world: 0, level: level.level, hints: level.hints || [], name: level.name },
                          { timeMs: 30000, nodeLimit: 10000000, taQ: true });
        if (res.status === 'solved') return { ...res, monumentPlacement: sol };
      }
    }
  }
  return { status: 'exhausted_no_solution', reason: 'phaseB' };
}
