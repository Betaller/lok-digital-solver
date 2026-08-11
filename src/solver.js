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
         isLetterCell, blackout, unblack, isSolved, boardKey, cloneBoard, cellAt } from './engine.js';
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

// Enumerate all paths spelling `word`. `cells` is the current board.
// Visit rules (from game CheckSameTile / CheckDoubleBack):
//   - may NOT click the same tile twice in a row
//   - may NOT step back to the second-to-last tile
//   - MAY revisit earlier tiles (this is how LOLO loops on L-O-L-O)
// Direction reversal is allowed only for LOLO/OLOL (their loop pattern needs it);
// for other words reversing the line is rejected.
export function findPlacements(cells, word, cols, rows, opts = {}) {
  const allowReverse = word === 'LOLO' || word === 'OLOL';
  const maxResults = opts.maxResults ?? 10000;
  const maxRec = opts.maxRec ?? 200000;
  const results = [];
  const n = word.length;
  if (n === 0) return results;
  let recCount = 0;

  function rec(path, dir, idx) {
    if (results.length >= maxResults) return;
    if (recCount++ >= maxRec) return;
    if (idx === n) {
      results.push({ tiles: path.slice() });
      return;
    }
    if (path.length > n * 3 + 1) return; // conductor cap: at most ~2 X between letters
    const last = path[path.length - 1];
    const want = word[idx];
    for (const d of DIRS) {
      if (path.length >= 2 && dir && !allowReverse && (d.x === -dir.x && d.y === -dir.y)) continue; // no reversal
      if (path.length >= 2 && dir && d.x === dir.x && d.y === dir.y) {
        // straight - allowed
      } else if (path.length >= 2) {
        // turning: allowed if last tile is 'X' or '?'
        const isXlike = last.letter === 'X' || last.letter === '?';
        if (!isXlike) continue;
      }
      const next = nextInDir(cells, last, d, cols, rows);
      if (!next) continue;
      // revisit rules
      const sameTile = path[path.length - 1] === next;
      if (sameTile) continue;
      // '?' may be revisited (each pass can take a different letter); 'X' too (conductor).
      // Other tiles may not step back to second-to-last.
      const isX = next.letter === 'X';
      const isQ = next.letter === '?';
      if (!isX && !isQ && path.length >= 2 && path[path.length - 2] === next) continue; // no double back
      let consumes = false;
      if (isX) consumes = false;            // conductor
      else if (isQ) consumes = true;        // ? matches any letter (may differ each pass)
      else if (next.letter === want) consumes = true;
      else continue;
      let newDir = dir;
      if (path.length >= 2 && dir) {
        if (d.x === dir.x && d.y === dir.y) newDir = dir;
        else newDir = d;
      } else {
        newDir = d;
      }
      if (consumes && idx < n) {
        rec(path.concat([next]), newDir, idx + 1);
      } else if (!consumes) {
        rec(path.concat([next]), newDir, idx);
      }
    }
  }

  for (const start of cells) {
    if (!canClick(start) || !isLetterCell(start)) continue;
    if (start.letter === 'X') continue; // X cannot be first
    const isQ = start.letter === '?';
    if (!isQ && start.letter !== word[0]) continue;
    rec([start], null, 1);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Word application: returns list of new boards + step descriptors
// ---------------------------------------------------------------------------

// blacken tiles; respect hp (return updated cells list)
function applyBlackout(cells, targets) {
  let out = cells.slice();
  for (const t of targets) {
    out = out.map(c => (c.x === t.x && c.y === t.y) ? blackout(c) : c);
  }
  return out;
}

// Generate all distinct boards after applying word `word` along `placement`.
// extra selection differs per word type.
export function applyWord(cells, word, placement, cols, rows, opts = {}) {
  const cfg = WORD_LIBRARY[word];
  const maxResults = opts.maxResults ?? 2000;
  const results = [];
  const tileCells = placement.tiles.filter(t => t.letter !== 'X' && !(t.letter === '?' && false));
  // determine which placement tiles actually get blackened:
  // X tiles do NOT get blackened; ? tiles DO (treated as letter).
  const toBlack = placement.tiles.filter(t => t.letter !== 'X');
  let board = applyBlackout(cells, toBlack);

  const candidates = cells.filter(c => c.type !== 'empty' && !c.blacked);
  const candidateSet = (exclude = []) => {
    const ex = new Set(exclude.map(t => `${t.x},${t.y}`));
    const out = candidates.filter(c => !ex.has(`${c.x},${c.y}`));
    return out.slice(0, maxResults);
  };

  // Helper: enumerate distinct resulting boards for extra selection
  function emit(boards, extraTiles, extraAction) {
    for (const b of boards) {
      if (results.length >= maxResults) break;
      results.push({ board: b, extras: extraTiles, extraAction });
    }
  }

  if (cfg.clouds) {
    // W (world 14): spelling W selects ALL unblackened W tiles; they form a shape.
    // Clicking a target tile copies that shape onto the target: every destination
    // cell must exist and be unblackened; then the shape's cells AND the W tiles
    // are blackened. (DoW: for each W i as anchor, test obj + (Wj - Wi).)
    const ws = cells.filter(c => c.letter === 'W' && !c.blacked);
    if (ws.length === 0) return results;
    const emitted = new Set();
    // anchor candidates: every non-empty, non-black cell (the clicked target tile)
    const anchors = cells.filter(c => c.type !== 'empty' && !c.blacked);
    // treat each W tile as potential anchor reference (like DoW loop over i)
    for (const ref of ws) {
      const rx = ref.x, ry = ref.y;
      for (const anchor of anchors) {
        const targets = [];
        let ok = true;
        for (const w of ws) {
          const dx = w.x - rx, dy = w.y - ry;
          const tx = anchor.x + dx, ty = anchor.y + dy;
          const t = cellAt(cells, tx, ty);
          if (!t || t.type === 'empty' || t.blacked) { ok = false; break; }
          if (!targets.some(x => x.x === t.x && x.y === t.y)) targets.push(t);
        }
        if (!ok) continue;
        let b = applyBlackout(board, ws);
        b = applyBlackout(b, targets);
        const k = boardKey(b);
        if (!emitted.has(k)) { emitted.add(k); results.push({ board: b, extras: [], extraAction: `W@${anchor.x},${anchor.y}` }); }
      }
    }
  } else if (cfg.globalLetter) {
    // TA: blacken all tiles matching a chosen letter. Choose any letter present
    // (including X - clicking an X tile triggers ExecuteTa("X") blackening all X).
    // Clicking a target '#' (letter="") triggers ExecuteTa("") -> blackens all targets.
    const letters = new Set();
    for (const c of cells) {
      if (c.type === 'empty' || c.blacked) continue;
      if (c.type === 'target') letters.add('');
      else if (c.type === 'letter' && c.letter && c.letter !== '?') letters.add(c.letter);
    }
    for (const L of letters) {
      const hits = cells.filter(c => {
        if (c.blacked) return false;
        if (L === '') return c.type === 'target';
        return c.type === 'letter' && c.letter === L;
      });
      emit([applyBlackout(board, hits)], [], `TA:${L === '' ? '#' : L}`);
    }
  } else if (cfg.createLetter) {
    // BE: choose a target '#' tile and assign it a letter. (letter choice - try letters needed)
    const targets = cells.filter(c => c.type === 'target' && !c.blacked);
    // Try assigning a letter that appears in the word library or currently on board
    const pool = new Set(cells.filter(c => c.type === 'letter' && c.letter && c.letter !== 'X').map(c => c.letter));
    for (const L of ['L','O','K','T','A','B','E','G','R','I','V','W']) {
      pool.add(L);
    }
    for (const tgt of targets) {
      for (const L of pool) {
        const b = board.map(c => (c.x === tgt.x && c.y === tgt.y) ? { ...c, type: 'letter', letter: L } : c);
        results.push({ board: b, extras: [], extraAction: `BE:${L}@${tgt.x},${tgt.y}` });
      }
    }
  } else if (cfg.diagonal) {
    // LOLO: blacken the diagonal through the clicked tile.
    // Game coords are y-up; in y-down display this is the x+y=const anti-diagonal.
    // Scan from (leftmost,bottommost) to (rightmost,topmost) along (+1,+1) in game coords
    // == in display coords scan (-1,+1)... simplest: collect cells with same (x+y).
    const anchors = cells.filter(c => c.type !== 'empty');
    const seen = new Set();
    for (const a of anchors) {
      const key = a.x + a.y;
      if (seen.has(key)) continue;
      seen.add(key);
      const diag = cells.filter(c => c.type !== 'empty' && (c.x + c.y) === key);
      const toBlack = diag; // targets (#) are not crossable -> included; letter tiles included
      emit([applyBlackout(board, toBlack)], [], 'lolo');
    }
  } else if (cfg.unblack) {
    // ABA: blacken word tiles + choose 1 extra tile to UNBLACK (UnsetSpentAba).
    // Target may be any non-empty tile: if black -> unblack; if not black -> hp++
    // (per UnsetSpentAba). Both variants explored.
    const abaCandidates = cells.filter(c => c.type !== 'empty');
    const seenAb = new Set();
    for (const ex of abaCandidates) {
      let b = applyBlackout(board, []);
      if (ex.blacked) {
        b = b.map(c => (c.x === ex.x && c.y === ex.y) ? unblack(c) : c);
      } else {
        // hp++ (add an onion layer) - useful when the tile will be peeled again
        b = b.map(c => (c.x === ex.x && c.y === ex.y) ? { ...c, hp: c.hp + 1 } : c);
      }
      const k = boardKey(b);
      if (!seenAb.has(k)) { seenAb.add(k); emit([b], [ex], 'aba'); }
    }
  } else if (cfg.extra === 1) {
    // LOK: 1 extra tile
    for (const ex of candidateSet()) {
      emit([applyBlackout(board, [ex])], [ex], 'extra');
    }
  } else if (cfg.extra === 2 && cfg.extraAdjacent) {
    // TLAK: 2 extra tiles, same row or column, middle cells passable (AreTilesAdjacent isTlak)
    const seenPairs = new Set();
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i], b = candidates[j];
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
function precheck(cells) {
  // any non-empty non-black cell that is a letter? if board has zero letters -> unsolvable unless already solved
  const anyLetter = cells.some(c => c.type === 'letter' && !c.blacked && c.letter && c.letter !== 'X');
  if (!anyLetter && !isSolved(cells)) {
    // maybe only targets need blackout; targets can be blacked only via words, so no letters => impossible
    const anyTarget = cells.some(c => (c.type === 'target') && !c.blacked);
    if (anyTarget) return false;
    return isSolved(cells);
  }
  return null; // unknown
}

export function solve(level, opts = {}) {
  const { timeMs = 5000, nodeLimit = 2000000, memoCap = 200000 } = opts;
  if (level.world === 13) {
    return { status: 'unsupported', reason: 'monuments' }; // handled by solver-mono
  }
  if (level.world === 12) {
    return { status: 'unsupported', reason: 'arrows' }; // handled by arrow solver
  }
  const budget = new Budget({ timeMs, nodeLimit, memoCap });
  const cells0 = makeBoard(level);
  const cols = level.cols, rows = level.rows;

  const pc = precheck(cells0);
  if (pc === false) return { status: 'exhausted_no_solution', steps: [] };
  if (pc === true) return { status: 'solved', steps: [] };

  // iterative DFS with explicit stack
  const memo = new Map();
  let best = { maxBlacked: cells0.filter(c => c.blacked && c.type !== 'empty').length, board: cells0, steps: [] };
  const maxDepth = (level.hints?.length ?? 1) * 2 + 8;

  const stack = [{ cells: cells0, steps: [], depth: 0 }];
  while (stack.length) {
    if (!budget.check()) {
      return { status: 'timeout', progress: best, reason: 'budget' };
    }
    const frame = stack.pop();
    const { cells, steps, depth } = frame;
    if (depth > maxDepth) continue;
    const key = boardKey(cells);
    if (memo.has(key)) continue;
    memo.set(key, true);
    if (memo.size > budget.memoCap) {
      return { status: 'timeout', progress: best, reason: 'memocap' };
    }
    if (isSolved(cells)) {
      return { status: 'solved', steps };
    }
    // update best progress
    const bCnt = cells.filter(c => c.type !== 'empty' && c.blacked).length;
    if (bCnt > best.maxBlacked) best = { maxBlacked: bCnt, board: cells, steps };

    // generate candidate word placements (free library), prefer hints first
    if (!budget.check()) {
      return { status: 'timeout', progress: best, reason: 'budget' };
    }
    let words = [];
    if (level.hints) {
      for (const h of level.hints) if (WORD_LIBRARY[h]) words.push(h);
    }
    // add words that are actually spellable on this board (free derivation)
    const spellable = new Set();
    for (const w of Object.keys(WORD_LIBRARY)) {
      if (words.includes(w)) continue;
      if (findPlacements(cells, w, cols, rows, { maxRec: 20000 }).length > 0) spellable.add(w);
    }
    const ordered = words.concat([...spellable]);
    let pushed = 0;
    for (const w of ordered) {
      const placements = findPlacements(cells, w, cols, rows, { maxRec: 20000 });
      for (const pl of placements) {
        const apps = applyWord(cells, w, pl, cols, rows, { maxResults: 800 });
        for (const app of apps) {
          if (!budget.check()) {
            return { status: 'timeout', progress: best, reason: 'budget' };
          }
          // compute exact effect diff (which cells change) for reliable replay/validation
          const { blackTiles, unblackTiles, letterChanges, hpChanges } = diffCells(cells, app.board);
          stack.push({ cells: app.board, steps: steps.concat([{
            word: w,
            tiles: pl.tiles.map(t => ({ x: t.x, y: t.y })),
            extras: app.extras.map(t => ({ x: t.x, y: t.y })),
            extraAction: app.extraAction,
            blackTiles, unblackTiles, letterChanges, hpChanges,
            text: describeStep(w, pl, app),
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
function diffCells(before, after) {
  const key = c => `${c.x},${c.y}`;
  const bMap = new Map(before.map(c => [key(c), c]));
  const aMap = new Map(after.map(c => [key(c), c]));
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
