// solver-arrows.js - World 12 arrow push solver with A* priority search.
// Arrow tiles ('>','<','^','v') push chains in their direction; then words spell.
// ? wildcards can act as any arrow direction.
import { makeBoard, cellAt, canClick, isLetterCell, isSolved, blackout, boardKey,
         WORD_LIBRARY, cloneBoard, allCells, TYPE, CH } from './engine.js';
import { findPlacements, applyWord, Budget } from './solver.js';

const ARROW_DIR = { '>': { x: 1, y: 0 }, '<': { x: -1, y: 0 }, '^': { x: 0, y: -1 }, 'v': { x: 0, y: 1 } };

// Push chain: returns new board or null if invalid.
function doPush(grid, arrow, dir, cols, rows) {
  const chain = [];
  let cur = arrow;
  while (true) {
    chain.push(cur);
    const nx = cur.x + dir.x, ny = cur.y + dir.y;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) break;
    const nxt = cellAt(grid, nx, ny);
    if (!nxt || nxt.type === TYPE.EMPTY) break;
    cur = nxt;
  }
  const end = chain[chain.length - 1];
  const bx = end.x + dir.x, by = end.y + dir.y;
  if (bx < 0 || by < 0 || bx >= cols || by >= rows) return null;
  const beyond = cellAt(grid, bx, by);
  if (beyond && beyond.type !== TYPE.EMPTY) return null;

  let out = cloneBoard(grid);
  for (let i = chain.length - 1; i >= 0; i--) {
    const t = chain[i];
    const nx = t.x + dir.x, ny = t.y + dir.y;
    out[nx][ny] = { ...out[t.x][t.y], x: nx, y: ny };
  }
  for (const t of chain) {
    const stillNeeded = chain.some(c => c.x + dir.x === t.x && c.y + dir.y === t.y);
    if (!stillNeeded) {
      out[t.x][t.y] = { x: t.x, y: t.y, type: TYPE.EMPTY, letter: '', hp: 0, blacked: false };
    }
  }
  const nax = arrow.x + dir.x, nay = arrow.y + dir.y;
  out[nax][nay] = blackout(out[nax][nay]);
  return { board: out, moved: chain.map(t => ({ x: t.x, y: t.y })), dir: `${dir.x},${dir.y}` };
}

// Simple heuristic: count unblacked letters (lower bound on remaining work)
function heuristic(cells) {
  let count = 0;
  for (const c of allCells(cells)) {
    if (c.type === TYPE.LETTER && !c.blacked && c.letter !== '-' && c.letter !== '#') count++;
  }
  return count;
}

// Priority queue helpers
function pqPush(arr, item) { arr.push(item); arr.sort((a, b) => a.score - b.score); }
function pqPop(arr) { return arr.shift(); }

export function solveArrows(level, opts = {}) {
  const { timeMs = 6000, nodeLimit = 2000000 } = opts;
  const budget = new Budget({ timeMs, nodeLimit, memoCap: 500000 });
  const cells0 = makeBoard(level);
  const cols = level.cols, rows = level.rows;
  if (isSolved(cells0)) return { status: 'solved', steps: [] };

  const memo = new Set();
  const maxDepth = 30; // fixed depth limit
  const pq = [{ cells: cells0, steps: [], depth: 0, score: heuristic(cells0) }];

  while (pq.length) {
    if (!budget.check()) return { status: 'timeout', reason: 'budget' };
    const fr = pqPop(pq);
    const { cells, steps, depth, score } = fr;
    if (depth > maxDepth) continue;
    const key = boardKey(cells);
    if (memo.has(key)) continue;
    memo.add(key);
    if (memo.size > budget.memoCap) return { status: 'timeout', reason: 'memocap' };
    if (isSolved(cells)) return { status: 'solved', steps };

    // Push actions
    const arrows = allCells(cells).filter(c =>
      c.type === TYPE.LETTER && !c.blacked &&
      (ARROW_DIR[c.letter] || c.letter === CH.WILDCARD)
    );
    for (const a of arrows) {
      const dirs = a.letter === CH.WILDCARD ? Object.values(ARROW_DIR) : [ARROW_DIR[a.letter]];
      for (const dir of dirs) {
        const r = doPush(cells, a, dir, cols, rows);
        if (!r) continue;
        pqPush(pq, {
          cells: r.board, steps: steps.concat([{ word: a.letter, arrow: { x: a.x, y: a.y }, text: `推 ${a.letter} @ ${a.x},${a.y}` }]),
          depth: depth + 1, score: heuristic(r.board)
        });
      }
    }

    // Word spelling: try all words from library, not just hints
    for (const w of Object.keys(WORD_LIBRARY)) {
      if (w.length === 1 && ARROW_DIR[w]) continue;
      const cfg = WORD_LIBRARY[w];
      const placements = [];
      const seenKeys = new Set();
      for (const sp of cfg.spell) {
        for (const pl of findPlacements(cells, sp, cols, rows, { maxRec: 10000 })) {
          const pk = pl.tiles.map(t => `${t.x},${t.y}`).join('|');
          if (!seenKeys.has(pk)) { seenKeys.add(pk); placements.push(pl); }
          if (placements.length >= 50) break;
        }
        if (placements.length >= 50) break;
      }
      for (const pl of placements) {
        const apps = applyWord(cells, w, pl, cols, rows, { maxResults: 200 });
        for (const app of apps) {
          pqPush(pq, {
            cells: app.board, steps: steps.concat([{ word: w, text: `拼 ${w}` }]),
            depth: depth + 1, score: heuristic(app.board)
          });
        }
      }
    }
  }
  return { status: 'exhausted_no_solution', steps: [] };
}
