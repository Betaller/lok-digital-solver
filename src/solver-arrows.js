// solver-arrows.js - World 12 arrow push solver (best-effort).
// Model: arrow tiles ('>','<','^','v') are single-letter "words". Clicking one
// pushes the contiguous chain in that direction one step; the arrow tile itself
// blackens (PushCommand). Then normal word spelling continues.
//
// State = cells (coordinates are static; we model movement as tile identity moves).
// We use DFS over actions: [spell a normal word] or [push an arrow].
// This is a heuristic search; may time out on complex levels (reported honestly).

import { makeBoard, cellAt, canClick, isLetterCell, isSolved, blackout, boardKey, WORD_LIBRARY } from './engine.js';
import { findPlacements, applyWord, DIRS, Budget } from './solver.js';

const ARROW_DIR = { '>': { x: 1, y: 0 }, '<': { x: -1, y: 0 }, '^': { x: 0, y: -1 }, 'v': { x: 0, y: 1 } };

// Push chain: starting from arrow cell, move it + contiguous chain one step in dir.
// Returns new cells + step description, or null if invalid (chain would exit board or hit immovable).
function doPush(cells, arrow, dir, cols, rows) {
  // find contiguous chain in dir: all tiles directly in line
  const chain = [];
  let cur = arrow;
  while (true) {
    chain.push(cur);
    const nx = cur.x + dir.x, ny = cur.y + dir.y;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) break;
    const nxt = cellAt(cells, nx, ny);
    if (!nxt || nxt.type === 'empty') break;
    cur = nxt;
  }
  // check the tile beyond the chain end
  const end = chain[chain.length - 1];
  const bx = end.x + dir.x, by = end.y + dir.y;
  if (bx < 0 || by < 0 || bx >= cols || by >= rows) return null; // would exit -> invalid
  const beyond = cellAt(cells, bx, by);
  if (beyond && beyond.type !== 'empty') return null; // blocked

  // move chain: each tile shifts one step
  let out = cells.slice();
  for (let i = chain.length - 1; i >= 0; i--) {
    const t = chain[i];
    const nx = t.x + dir.x, ny = t.y + dir.y;
    out = out.map(c => (c.x === t.x && c.y === t.y) ? { ...c, x: nx, y: ny } : c);
  }
  // blacken the arrow tile (now at its new position)
  const newArrow = out.find(c => c.x === arrow.x + dir.x && c.y === arrow.y + dir.y);
  if (newArrow) out = out.map(c => (c === newArrow || (c.x === newArrow.x && c.y === newArrow.y)) ? blackout(c) : c);
  return { board: out, moved: chain.map(t => ({ x: t.x, y: t.y })), dir: `${dir.x},${dir.y}` };
}

export function solveArrows(level, opts = {}) {
  const { timeMs = 6000, nodeLimit = 2000000 } = opts;
  const budget = new Budget({ timeMs, nodeLimit });
  const cells0 = makeBoard(level);
  const cols = level.cols, rows = level.rows;
  if (isSolved(cells0)) return { status: 'solved', steps: [] };

  const memo = new Set();
  const maxDepth = (level.hints?.length || 1) * 3 + 10;
  const stack = [{ cells: cells0, steps: [], depth: 0 }];

  while (stack.length) {
    if (!budget.check()) return { status: 'timeout', reason: 'budget' };
    const fr = stack.pop();
    const { cells, steps, depth } = fr;
    if (depth > maxDepth) continue;
    const key = boardKey(cells);
    if (memo.has(key)) continue;
    memo.add(key);
    if (isSolved(cells)) return { status: 'solved', steps };

    // 1) push actions
    const arrows = cells.filter(c => c.type === 'letter' && ARROW_DIR[c.letter] && !c.blacked);
    for (const a of arrows) {
      const r = doPush(cells, a, ARROW_DIR[a.letter], cols, rows);
      if (r) {
        stack.push({
          cells: r.board,
          steps: steps.concat([{ word: a.letter, arrow: { x: a.x, y: a.y }, text: `推动箭头 ${a.letter} @ ${a.x},${a.y}` }]),
          depth: depth + 1,
        });
      }
    }
    // 2) word spell actions
    const words = level.hints && level.hints.length ? level.hints : Object.keys(WORD_LIBRARY);
    for (const w of words) {
      if (w.length === 1 && ARROW_DIR[w]) continue;
      if (!WORD_LIBRARY[w]) continue;
      const placements = findPlacements(cells, w, cols, rows);
      for (const pl of placements) {
        const apps = applyWord(cells, w, pl, cols, rows);
        for (const app of apps) {
          stack.push({ cells: app.board, steps: steps.concat([{ word: w, text: `拼 ${w}` }]), depth: depth + 1 });
        }
      }
    }
  }
  return { status: 'exhausted_no_solution', steps: [] };
}
