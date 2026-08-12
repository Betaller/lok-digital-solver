// solver-arrows.js - World 12 arrow push solver with A* priority search.
import { makeBoard, cellAt, isSolved, blackout, boardKey,
         WORD_LIBRARY, cloneBoard, allCells, TYPE, CH } from './engine.js';
import { findPlacements, applyWord, Budget, diffCells } from './solver.js';

const ARROW_DIR = { '>': { x: 1, y: 0 }, '<': { x: -1, y: 0 }, '^': { x: 0, y: -1 }, 'v': { x: 0, y: 1 } };

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
    if (!stillNeeded) out[t.x][t.y] = { x: t.x, y: t.y, type: TYPE.EMPTY, letter: '', hp: 0, blacked: false };
  }
  out[arrow.x + dir.x][arrow.y + dir.y] = blackout(out[arrow.x + dir.x][arrow.y + dir.y]);
  return { board: out, moved: chain.map(t => ({ x: t.x, y: t.y })), dir: `${dir.x},${dir.y}` };
}

// Heuristic: min effort to arrange target word letters in a line
function heuristic(cells, targetWords) {
  const letters = allCells(cells).filter(c =>
    c.type === TYPE.LETTER && !c.blacked && c.letter !== '-' && c.letter !== '#'
  );
  if (!letters.length) return 0;
  if (!targetWords || !targetWords.length) return letters.length * 5;
  let bestCost = Infinity;
  for (const word of targetWords) {
    const wdef = WORD_LIBRARY[word];
    if (!wdef) continue;
    const sp = wdef.spell;
    for (const anchor of letters) {
      if (anchor.letter !== sp[0]) continue;
      for (const d of [{dx:1,dy:0},{dx:0,dy:1}]) {
        let cost = 0, ok = true;
        const used = new Set();
        for (let i = 0; i < sp.length; i++) {
          const tx = anchor.x + d.dx * i, ty = anchor.y + d.dy * i;
          let bestD = Infinity, bestJ = -1;
          for (let j = 0; j < letters.length; j++) {
            if (used.has(j)) continue;
            if (letters[j].letter !== sp[i]) continue;
            const dist = Math.abs(letters[j].x - tx) + Math.abs(letters[j].y - ty);
            if (dist < bestD) { bestD = dist; bestJ = j; }
          }
          if (bestJ < 0) { ok = false; break; }
          used.add(bestJ);
          cost += bestD;
        }
        if (ok && cost < bestCost) bestCost = cost;
      }
    }
  }
  if (bestCost === Infinity) return letters.length * 10;
  const tl = targetWords[0] ? (WORD_LIBRARY[targetWords[0]]?.spell?.length || 0) : 0;
  return bestCost + Math.max(0, letters.length - tl);
}

function pqPush(arr, item) { arr.push(item); } // BFS queue
function pqPop(arr) { return arr.shift(); }

export function solveArrows(level, opts = {}) {
  const { timeMs = 30000, nodeLimit = 10000000 } = opts;
  const budget = new Budget({ timeMs, nodeLimit, memoCap: 5000000 });
  const cells0 = makeBoard(level);
  const cols = level.cols, rows = level.rows;
  if (isSolved(cells0)) return { status: 'solved', steps: [] };

  const hints = (level.hints && level.hints.length) ? level.hints : Object.keys(WORD_LIBRARY);
  const targetWords = hints.filter(w => WORD_LIBRARY[w] && !ARROW_DIR[w]);

  // Letters needed by any target word (plus ?/X wildcards)
  const usefulLetters = new Set();
  for (const w of targetWords) {
    for (const ch of WORD_LIBRARY[w].spell) usefulLetters.add(ch);
  }
  usefulLetters.add('?');
  usefulLetters.add('X');

  function hasUsefulLetters(cells) {
    const all = allCells(cells);
    return all.some(c =>
      c.type === TYPE.LETTER && !c.blacked && usefulLetters.has(c.letter)
    );
  }

  const memo = new Set();
  const queue = [{ cells: cells0, steps: [], depth: 0 }];

  while (queue.length) {
    if (!budget.check()) return { status: 'timeout', reason: 'budget' };
    const fr = pqPop(queue);
    const { cells, steps, depth } = fr;
    const key = boardKey(cells);
    if (memo.has(key)) continue;
    memo.add(key);
    if (isSolved(cells)) return { status: 'solved', steps };

    // Quick pre-check: any useful letter or arrow on this board?
    const anyUseful = hasUsefulLetters(cells);

    // Arrows
    const arrows = allCells(cells).filter(c =>
      c.type === TYPE.LETTER && !c.blacked &&
      (ARROW_DIR[c.letter] || c.letter === CH.WILDCARD)
    );
    for (const a of arrows) {
      const dirs = a.letter === CH.WILDCARD ? Object.values(ARROW_DIR) : [ARROW_DIR[a.letter]];
      for (const dir of dirs) {
        const r = doPush(cells, a, dir, cols, rows);
        if (!r) continue;
        // Dead-end prune: push consumed last arrow AND no word spellable
        const childArrows = allCells(r.board).filter(c =>
          c.type === TYPE.LETTER && !c.blacked &&
          (ARROW_DIR[c.letter] || c.letter === CH.WILDCARD)
        );
        if (childArrows.length === 0 && !hasUsefulLetters(r.board)) continue;
        pqPush(queue, {
          cells: r.board, steps: steps.concat([{
            type: 'push', word: a.letter,
            arrow: { x: a.x, y: a.y },
            dir: { x: dir.x, y: dir.y },
            moved: r.moved.map(t => ({ x: t.x, y: t.y })),
            text: `推 ${a.letter} @ ${a.x},${a.y}`
          }]),
          depth: depth + 1,
        });
      }
    }

    // Words — only generate if any useful letter exists
    if (anyUseful) {
    for (const word of targetWords) {
      const wdef = WORD_LIBRARY[word];
      let wcount = 0;
      for (const pl of findPlacements(cells, wdef.spell, cols, rows, { maxRec: 10000 })) {
        const apps = applyWord(cells, word, pl, cols, rows, { maxResults: 200, taQ: true });
        for (const app of apps) {
          const diff = diffCells(cells, app.board);
          pqPush(queue, {
            cells: app.board, steps: steps.concat([{
              type: 'word', word: word,
              tiles: pl.tiles.map(t => ({ x: t.x, y: t.y })),
              extras: (app.extras || []).map(t => ({ x: t.x, y: t.y })),
              extraAction: app.extraAction,
              blackTiles: diff.blackTiles, unblackTiles: diff.unblackTiles,
              letterChanges: diff.letterChanges, hpChanges: diff.hpChanges,
              text: `拼 ${word}`,
            }]),
            depth: depth + 1,
          });
          if (++wcount >= 30) break;
        }
        if (wcount >= 30) break;
      }
    }
    }

    if (!anyUseful && arrows.length === 0) budget.exhausted = true;
  }
  return { status: 'exhausted_no_solution', steps: [] };
}
