// solver.js - DFS solver with free word library, path enumeration, triple budget.
// Pure functions, depends only on engine.js and parse.js.
//
// Design (per adversarial review):
// - word set = global WORD_LIBRARY (free derivation), hints only for ordering/UI
// - termination = all non-empty cells blacked (words may repeat, not all must be used)
// - placement enumeration = path DFS allowing 90-degree turns at X or ?-locked-as-X
// - pruning only: state-dedup memo, depth cap, triple budget
// - explicit stack iterative DFS (no recursion overflow)
// - result: solved / timeout / exhausted_no_solution / unsupported
// - OLKO probe independent of solving

import { WORD_LIBRARY, OLKO_SPELLINGS, makeBoard, canBeCrossed, canClick,
         isLetterCell, blackout, addOnion, isSolved, boardKey, cloneBoard, cellAt,
         allCells, putCell, CH, TYPE } from './engine.js';
import { parseLevel } from './parse.js';

export const DIRS = [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];

export class Budget {
  constructor({ timeMs = 5000, nodeLimit = 2000000, memoCap = 200000 } = {}) {
    this.timeMs = timeMs;
    this.nodeLimit = nodeLimit;
    this.memoCap = memoCap;
    this.start = performance.now ? performance.now() : Date.now();
    this.nodes = 0;
    this.exhausted = true; // becomes false if budget hit
  }
  check() {
    this.nodes++;
    if ((performance.now ? performance.now() : Date.now()) - this.start > this.timeMs) { this.exhausted = false; return false; }
    if (this.nodes > this.nodeLimit) { this.exhausted = false; return false; }
    return true;
  }
}

// ---------------------------------------------------------------------------
// Placement enumeration: find all paths spelling `word` on board `cells`
// Supports: straight lines, jumping (cross empty/blacked), turning at X or ?-as-X,
//           ? matches any letter; X is conductor (not counted).
// Returns array of { tiles: [cell], turns: [bool] }
// ---------------------------------------------------------------------------

function neighbors(cells, cell, cols, rows) {
  const out = [];
  for (const d of DIRS) {
    const nx = cell.x + d.x, ny = cell.y + d.y;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
    const t = cellAt(cells, nx, ny);
    if (t) out.push(t);
  }
  return out;
}

// Find next clickable tile in a given direction from `from`, crossing allowed cells.
// Crossing allowed: empty cells, blacked cells. Blocking: targets (no letter).
function nextInDir(cells, from, d, cols, rows) {
  let x = from.x + d.x, y = from.y + d.y;
  while (x >= 0 && y >= 0 && x < cols && y < rows) {
    const t = cellAt(cells, x, y);
    if (t) {
      if (t.type === 'empty') { x += d.x; y += d.y; continue; }
      if (t.blacked) { x += d.x; y += d.y; continue; }      // blacked = bridge, cross over
      if (isLetterCell(t)) return t;                        // first letter tile in line
      return null;                                          // target (no letter) blocks
    }
    x += d.x; y += d.y;
  }
  return null;
}

// Enumerate all paths spelling `word` on the board via conductor-path rules.
// Supports: straight-line jumps (over empty/blacked cells), 90° turns at X/?,
//           ? as wildcard (consumed) or pass-through conductor.
// Visit rules (from game CheckSameTile / CheckDoubleBack):
//   - must move to a different cell each step
//   - cannot double-back to the prior cell (X/? allow loop-around, not direct U-turn)
//   - MA-Y revisit any earlier tile after visiting X/? conductors
export function findPlacements(grid, word, cols, rows, opts = {}) {
  const maxResults = opts.maxResults ?? 10000;
  const maxRec = opts.maxRec ?? 200000;
  const results = [];
  const wordLength = word.length;
  if (wordLength === 0) return results;
  let searchCount = 0;

  // Direction from the second-to-last cell to the last cell in the path.
  // Returns null for the first move (only one cell in path).
  function directionFrom(path) {
    if (path.length < 2) return null;
    const a = path[path.length - 2], b = path[path.length - 1];
    return { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) };
  }

  // Check whether moving in direction `d` from the current path is valid
  // according to conductor-path rules (no reversal, turn only at X/?).
  function canProceed(path, d, prevD) {
    if (!prevD) return true;                 // first move: any direction allowed
    // No 180° reversal
    if (d.x === -prevD.x && d.y === -prevD.y) return false;
    // Straight or turn: turning only at X / ?
    if (!(d.x === prevD.x && d.y === prevD.y)) {
      const last = path[path.length - 1];
      if (last.letter !== 'X' && last.letter !== '?') return false;
    }
    return true;
  }

  // DFS over the grid. `path` accumulates visited tiles; `idx` is the next
  // position in `word` to match (0-based, advances on letter consumption).
  function search(path, idx) {
    if (results.length >= maxResults) return;
    if (searchCount++ >= maxRec) return;
    if (idx === wordLength) {
      results.push({ tiles: path.slice() });
      return;
    }
    if (path.length > wordLength * 3 + 1) return; // too many conductors between letters

    const last = path[path.length - 1];
    const want = word[idx];
    const prevD = directionFrom(path);

    for (const d of DIRS) {
      if (!canProceed(path, d, prevD)) continue;
      const next = nextInDir(grid, last, d, cols, rows);
      if (!next) continue;
      if (last === next) continue; // must move to different cell

      const isX = next.letter === 'X';
      const isQ = next.letter === '?';
      // Never double-back to the immediate predecessor cell.
      // X/? allow looping back to an earlier cell, not a direct U-turn.
      if (path.length >= 2 && path[path.length - 2] === next) continue;

      if (isX) {
        // X conductor: pass through without consuming
        search(path.concat([next]), idx);
      } else if (isQ) {
        // ? wildcard: can consume as any letter OR pass through as conductor
        if (idx < wordLength) search(path.concat([Object.assign({}, next, { _consume: true })]), idx + 1);
        search(path.concat([next]), idx);
      } else if (next.letter === want) {
        // Regular letter match
        search(path.concat([next]), idx + 1);
      }
    }
  }

  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      const start = grid[x][y];
      if (!canClick(start) || !isLetterCell(start)) continue;
      if (start.letter === CH.CONDUCTOR) continue; // X cannot start a word
      const isQ = start.letter === CH.WILDCARD;
      if (!isQ && start.letter !== word[0]) continue;
      search([{ ...start, _consume: true }], 1);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Word application: returns list of new boards + step descriptors
// ---------------------------------------------------------------------------

// blacken tiles; respect hp (return updated cells list)
function applyBlackout(grid, targets) {
  let out = cloneBoard(grid);
  for (const t of targets) {
    out[t.x][t.y] = blackout(out[t.x][t.y]);
  }
  return out;
}

// Generate all distinct boards after applying word `word` along `placement`.
// extra selection differs per word type.
export function applyWord(grid, word, placement, cols, rows, opts = {}) {
  const wdef = WORD_LIBRARY[word];
  const maxResults = opts.maxResults ?? 2000;
  const results = [];
  const tileCells = placement.tiles.filter(t => {
    if (t.letter === CH.CONDUCTOR) return false;
    if (t.letter === CH.WILDCARD) return t._consume === true;
    return true;
  });
  let board = applyBlackout(grid, tileCells);

  const allBoard = allCells(board);
  const boardCandidates = allBoard.filter(c => c.type !== TYPE.EMPTY && !c.blacked);
  const candidateSet = (exclude = []) => {
    const ex = new Set(exclude.map(t => `${t.x},${t.y}`));
    return boardCandidates.filter(c => !ex.has(`${c.x},${c.y}`)).slice(0, maxResults);
  };

  function emit(boards, extraTiles, extraAction) {
    for (const b of boards) {
      if (results.length >= maxResults) break;
      results.push({ board: b, extras: extraTiles, extraAction });
    }
  }

  if (wdef.clouds) {
    const allCells0 = allCells(grid);
    const ws = allCells0.filter(c => c.letter === 'W' && !c.blacked);
    // All W cells get hp-1 every time W is spelled
    let b = applyBlackout(board, ws);
    if (ws.length === 0) {
      results.push({ board: b, extras: [], extraAction: 'W' });
      return results;
    }
    // Cloud pattern uses original W set (before hp-1)
    const anchors = allCells0.filter(c => c.type !== TYPE.EMPTY && !c.blacked);
    const emitted = new Set();
    const allResults = [];
    for (const ref of ws) {
      const rx = ref.x, ry = ref.y;
      for (const anchor of anchors) {
        const targets = [];
        for (const w of ws) {
          const dx = w.x - rx, dy = w.y - ry;
          const tx = anchor.x + dx, ty = anchor.y + dy;
          if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue;
          const t = cellAt(grid, tx, ty);
          if (!t || t.type === TYPE.EMPTY || t.blacked) continue;
          if (!targets.some(x => x.x === t.x && x.y === t.y)) targets.push(t);
        }
        if (targets.length === 0) continue;
        let bb = applyBlackout(b, targets);
        bb[ref.x][ref.y] = blackout(bb[ref.x][ref.y]);
        const k = boardKey(bb);
        if (!emitted.has(k)) { emitted.add(k); allResults.push({ board: bb, extras: [], extraAction: `W@${anchor.x},${anchor.y}`, blacked: targets.length }); }
      }
    }
    // Keep top-N W results by cells blacked (limit branching)
    allResults.sort((a, b) => b.blacked - a.blacked);
    for (const r of allResults) results.push(r);
  } else if (wdef.globalLetter) {
    const allCells0 = allCells(grid);
    const letters = new Set();
    for (const c of allCells0) {
      if (c.type === TYPE.EMPTY || c.blacked) continue;
      if (c.type === TYPE.BLANK) letters.add('');
      else if (c.type === TYPE.LETTER && c.letter) letters.add(c.letter);
    }
    if (opts.taQ !== true) letters.delete(CH.WILDCARD);
    for (const L of letters) {
      const hits = allCells0.filter(c => {
        if (c.blacked) return false;
        if (L === '') return c.type === TYPE.BLANK;
        return c.type === TYPE.LETTER && c.letter === L;
      });
      emit([applyBlackout(board, hits)], [], `TA:${L === '' ? '#' : L}`);
    }
  } else if (wdef.createLetter) {
    const allCells0 = allCells(grid);
    const targets = allCells0.filter(c => c.type === TYPE.BLANK && !c.blacked);
    const usefulLetters = new Set();
    for (const wdef of Object.values(WORD_LIBRARY)) {
      for (const ch of wdef.spell) usefulLetters.add(ch);
    }
    usefulLetters.add(CH.WILDCARD); // BE can create ?
    for (const tgt of targets) {
      for (const L of usefulLetters) {
        const b = putCell(board, tgt.x, tgt.y, c => ({ ...c, type: TYPE.LETTER, letter: L }));
        if (results.length >= maxResults) return results;
        results.push({ board: b, extras: [], extraAction: `BE:${L}@${tgt.x},${tgt.y}` });
      }
    }
  } else if (wdef.diagonal) {
    // LOLO: blacken the diagonal through the clicked anchor tile.
    // Player may select any non-empty tile as anchor; try all unique diagonals.
    const allCells0 = allCells(grid);
    const anchors = allCells0.filter(c => c.type !== TYPE.EMPTY);
    const seen = new Set();
    for (const a of anchors) {
      const key = a.x + a.y;
      if (seen.has(key)) continue;
      seen.add(key);
      const diag = allCells0.filter(c => c.type !== TYPE.EMPTY && (c.x + c.y) === key);
      emit([applyBlackout(board, diag)], [], 'lolo');
    }
  } else if (wdef.onion) {
    // ABA: blacken word tiles + add 1 onion OR unblack a blacked tile.
    const allCells0 = allCells(grid);
    const abaCandidates = allCells0.filter(c => c.type !== TYPE.EMPTY);
    const seenAb = new Set();
    for (const ex of abaCandidates) {
      const cell = cellAt(grid, ex.x, ex.y); // original state
      const b = cell.blacked
        ? putCell(board, ex.x, ex.y, c => ({ ...c, hp: 0, blacked: false }))  // unblack
        : putCell(board, ex.x, ex.y, addOnion);                                  // hp++
      const k = boardKey(b);
      if (!seenAb.has(k)) { seenAb.add(k); emit([b], [ex], 'aba'); }
    }
  } else if (wdef.extra === 1) {
    for (const ex of candidateSet()) {
      emit([applyBlackout(board, [ex])], [ex], 'extra');
    }
  } else if (wdef.extra === 2 && wdef.extraAdjacent) {
    const seenPairs = new Set();
    const bc = boardCandidates;
    for (let i = 0; i < bc.length; i++) {
      for (let j = i + 1; j < bc.length; j++) {
        const a = bc[i], b = bc[j];
        const sameRow = a.y === b.y && a.x !== b.x;
        const sameCol = a.x === b.x && a.y !== b.y;
        if (!sameRow && !sameCol) continue;
        // middle cells must be passable (empty or blacked)
        let ok = true;
        if (sameRow) {
          const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
          for (let x = lo + 1; x < hi; x++) {
            const m = board.find(c => c.x === x && c.y === a.y);
            if (m && m.type !== 'empty' && !m.blacked) { ok = false; break; }
          }
        } else {
          const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
          for (let y = lo + 1; y < hi; y++) {
            const m = board.find(c => c.x === a.x && c.y === y);
            if (m && m.type !== 'empty' && !m.blacked) { ok = false; break; }
          }
        }
        if (!ok) continue;
        const pk = `${a.x},${a.y}-${b.x},${b.y}`;
        if (seenPairs.has(pk)) continue;
        seenPairs.add(pk);
        emit([applyBlackout(board, [a, b])], [a, b], 'extra');
      }
    }
  } else {
    // GRIVA: no extras
    emit([board], [], 'none');
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main solver
// ---------------------------------------------------------------------------

// Pre-checks for cheap no-solution
function precheck(grid) {
  const all = allCells(grid);
  const anyLetter = all.some(c => c.type === TYPE.LETTER && !c.blacked && c.letter && c.letter !== CH.CONDUCTOR);
  if (!anyLetter && !isSolved(grid)) {
    const anyTarget = all.some(c => c.type === TYPE.BLANK && !c.blacked);
    if (anyTarget) return false;
    return isSolved(grid);
  }
  return null; // unknown
}

export function solve(level, opts = {}) {
  const { timeMs = 5000, nodeLimit = 2000000, memoCap = 500000, taQ = false } = opts;
  if (level.world === 13) {
    return { status: 'unsupported', reason: 'monuments' };
  }
  if (level.world === 12) {
    return { status: 'unsupported', reason: 'arrows' };
  }
  const budget = new Budget({ timeMs, nodeLimit, memoCap });
  const cells0 = makeBoard(level);
  const cols = level.cols, rows = level.rows;

  const pc = precheck(cells0);
  if (pc === false) return { status: 'exhausted_no_solution', steps: [] };
  if (pc === true) return { status: 'solved', steps: [] };

  const memo = new Map();
  const all0 = allCells(cells0);
  let best = { maxBlacked: all0.filter(c => c.blacked && c.type !== TYPE.EMPTY).length, board: cells0, steps: [] };

  const stack = [{ cells: cells0, steps: [], depth: 0 }];
  while (stack.length) {
    if (!budget.check()) {
      return { status: 'timeout', progress: best, reason: 'budget' };
    }
    const frame = stack.pop();
    const { cells, steps, depth } = frame;
    const key = boardKey(cells);
    if (memo.has(key)) continue;
    memo.set(key, true);
    if (memo.size > budget.memoCap) {
      return { status: 'timeout', progress: best, reason: 'memocap' };
    }
    if (isSolved(cells)) {
      return { status: 'solved', steps };
    }
    const allC = allCells(cells);
    const bCnt = allC.filter(c => c.type !== TYPE.EMPTY && c.blacked).length;
    if (bCnt > best.maxBlacked) best = { maxBlacked: bCnt, board: cells, steps };

    if (!budget.check()) {
      return { status: 'timeout', progress: best, reason: 'budget' };
    }
    let pushed = 0;
    for (const wordName of Object.keys(WORD_LIBRARY)) {
      const wdef = WORD_LIBRARY[wordName];
      if (!wdef) continue;
      const placements = [];
      const seenKeys = new Set();
      for (const pl of findPlacements(cells, wdef.spell, cols, rows, { maxRec: 20000 })) {
        const pk = pl.tiles.map(t => `${t.x},${t.y}`).join('|');
        if (!seenKeys.has(pk)) { seenKeys.add(pk); placements.push(pl); }
        if (placements.length >= 200) break;
      }
      if (placements.length === 0) continue;
      for (const pl of placements) {
        const apps = applyWord(cells, wordName, pl, cols, rows, { maxResults: 800, taQ });
        for (const app of apps) {
          if (!budget.check()) {
            return { status: 'timeout', progress: best, reason: 'budget' };
          }
          const { blackTiles, unblackTiles, letterChanges, hpChanges } = diffCells(cells, app.board);
          stack.push({ cells: app.board, steps: steps.concat([{
            word: wordName,
            tiles: pl.tiles.map(t => ({ x: t.x, y: t.y })),
            extras: app.extras.map(t => ({ x: t.x, y: t.y })),
            extraAction: app.extraAction,
            blackTiles, unblackTiles, letterChanges, hpChanges,
            text: describeStep(wordName, pl, app),
          }]), depth: depth + 1 });
          pushed++;
        }
      }
    }
    if (pushed === 0) budget.exhausted = true;
  }
  return { status: 'exhausted_no_solution', steps: [] };
}

// Diff two boards: which cells got blackened / unblackened / letter-changed.
export function diffCells(before, after) {
  const ba = allCells(before);
  const aa = allCells(after);
  const key = c => `${c.x},${c.y}`;
  const bMap = new Map(ba.map(c => [key(c), c]));
  const aMap = new Map(aa.map(c => [key(c), c]));
  const blackTiles = [], unblackTiles = [], letterChanges = [], hpChanges = [];
  for (const [k, a] of aMap) {
    const b = bMap.get(k);
    if (!b) continue;
    if (!b.blacked && a.blacked) blackTiles.push({ x: a.x, y: a.y });
    if (b.blacked && !a.blacked) unblackTiles.push({ x: a.x, y: a.y });
    if (b.letter !== a.letter) letterChanges.push({ x: a.x, y: a.y, from: b.letter, to: a.letter });
    if (b.hp !== a.hp) hpChanges.push({ x: a.x, y: a.y, from: b.hp, to: a.hp });
  }
  return { blackTiles, unblackTiles, letterChanges, hpChanges };
}

function describeStep(word, placement, app) {
  const pts = placement.tiles.map(t => `${t.x},${t.y}`).join(' ');
  const extras = app.extras.length ? ` 额外格:${app.extras.map(t => `${t.x},${t.y}`).join(' ')}` : '';
  const act = app.extraAction && app.extraAction !== 'none' && app.extraAction !== 'extra' ? ` (${app.extraAction})` : '';
  return `拼 ${word} @ ${pts}${extras}${act}`;
}

// ---------------------------------------------------------------------------
// OLKO probe: can the board spell OLKO or OKLO (4-tile path)?
// Independent of solving; returns placements.
// ---------------------------------------------------------------------------

export function probeOlko(level) {
  const cells0 = makeBoard(level);
  const cols = level.cols, rows = level.rows;
  const result = { possible: false, placements: [] };
  for (const w of OLKO_SPELLINGS) {
    const pls = findPlacements(cells0, w, cols, rows);
    for (const pl of pls) {
      result.possible = true;
      result.placements.push({
        word: w,
        tiles: pl.tiles.map(t => ({ x: t.x, y: t.y })),
        text: `拼 ${w} @ ${pl.tiles.map(t => `${t.x},${t.y}`).join(' ')}`,
      });
    }
  }
  // dedup
  result.placements = result.placements.filter((p, i) =>
    result.placements.findIndex(q => q.text === p.text) === i);
  return result;
}
