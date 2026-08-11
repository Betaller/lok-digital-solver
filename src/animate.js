// animate.js - render board as DOM + virtual-timeline playback (WAAPI-free, rAF loop).
// Depends on engine only (board model + step descriptors).

import { cellAt, makeBoard, cloneBoard, blackout, allCells } from './engine.js';

// Render a board (Level) as a DOM element `.board`
export function renderBoard(level, opts = {}) {
  const board = document.createElement('div');
  board.className = 'board';
  const cols = level.cols, rows = level.rows;
  for (let y = 0; y < rows; y++) {
    const row = document.createElement('div');
    row.className = 'row';
    for (let x = 0; x < cols; x++) {
      const ch = (level.grid?.[y]?.[x]) ?? '-';
      const hp = level.onions?.[y]?.[x] ?? 0;
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.x = x; cell.dataset.y = y;
      if (ch === '-') { cell.classList.add('empty'); }
      else if (ch === '#') { cell.classList.add('target'); }
      else if (ch === '=') { cell.classList.add('preblack'); cell.classList.add('blacked'); }
      else {
        cell.textContent = ch;
        if (ch === 'X') cell.classList.add('xcell');
        else if (ch === '?') cell.classList.add('q');
        else if (ch === 'W') cell.classList.add('w');
      }
      if (hp > 0) {
        const hpEl = document.createElement('span');
        hpEl.className = 'hp';
        hpEl.textContent = hp;
        cell.appendChild(hpEl);
      }
      row.appendChild(cell);
    }
    board.appendChild(row);
  }
  return board;
}

// Step descriptors produced by solver:
//   { word, tiles:[{x,y}], extras:[{x,y}], extraAction, text }
// We render a highlight pass then a blackout pass per step.

export function animateSteps(boardEl, level, steps) {
  const cellEls = {};
  boardEl.querySelectorAll('.cell').forEach(c => {
    cellEls[`${c.dataset.x},${c.dataset.y}`] = c;
  });

  const total = steps.length;
  let frame = 0;          // current step index
  let playing = false;
  let speed = 1;
  let raf = null;
  let lastT = 0;

  const STEP_MS = 1400;

  function clearAnimClasses() {
    boardEl.querySelectorAll('.cell').forEach(c => {
      c.classList.remove('highlight', 'flash', 'dim', 'peeling', 'oniadded');
    });
  }

  // apply board state up to step `n` (exclusive):
  //   - reset letters to base
  //   - apply hp changes (onion layer count) from steps 0..n-1
  //   - blacken/unblacken per recorded diff
  //   - apply letter changes (BE)
  function renderBlackState(n) {
    // reset all cells to base (letter + hp display)
    boardEl.querySelectorAll('.cell').forEach(c => {
      c.classList.remove('blacked', 'flash', 'peeling', 'oniadded');
      const x = +c.dataset.x, y = +c.dataset.y;
      const ch = level.grid?.[y]?.[x] ?? '-';
      const baseHp = level.onions?.[y]?.[x] ?? 0;
      c.textContent = (ch === '-' || ch === '#' || ch === '=') ? '' : ch;
      let hpEl = c.querySelector('.hp');
      if (baseHp > 0) {
        if (!hpEl) { hpEl = document.createElement('span'); hpEl.className = 'hp'; c.appendChild(hpEl); }
        hpEl.textContent = baseHp;
        hpEl.style.display = '';
      } else if (hpEl) {
        hpEl.remove();
      }
    });
    // re-mark initial preblack '='
    boardEl.querySelectorAll('.cell').forEach(c => {
      const x = +c.dataset.x, y = +c.dataset.y;
      const ch = level.grid?.[y]?.[x] ?? '-';
      if (ch === '=') c.classList.add('blacked');
    });
    // apply steps 0..n-1 cumulatively
    for (let i = 0; i < n; i++) {
      const s = steps[i];
      // hp changes first (so peel/add onion before black)
      for (const hc of (s.hpChanges || [])) {
        const c = cellEls[`${hc.x},${hc.y}`];
        if (!c) continue;
        if (hc.to > 0) {
          let hpEl = c.querySelector('.hp');
          if (!hpEl) { hpEl = document.createElement('span'); hpEl.className = 'hp'; c.appendChild(hpEl); }
          hpEl.textContent = hc.to;
          hpEl.style.display = '';
        } else {
          const hpEl = c.querySelector('.hp');
          if (hpEl) hpEl.remove();
        }
      }
      for (const t of (s.blackTiles || [])) {
        const c = cellEls[`${t.x},${t.y}`];
        if (c && !c.classList.contains('empty')) c.classList.add('blacked');
      }
      for (const t of (s.unblackTiles || [])) {
        const c = cellEls[`${t.x},${t.y}`];
        if (c) c.classList.remove('blacked');
      }
      for (const lc of (s.letterChanges || [])) {
        const c = cellEls[`${lc.x},${lc.y}`];
        if (c && lc.to) c.textContent = lc.to;
      }
    }
  }

  function showStep(n) {
    clearAnimClasses();
    renderBlackState(n);
    if (n >= total) return;

    const s = steps[n];
    const extraAction = s.extraAction || '';
    const isTA = extraAction.startsWith('TA:');
    const isBE = extraAction.startsWith('BE:');
    const isABA = extraAction === 'aba';
    const isW = extraAction.startsWith('W@');

    // --- phase 1: highlight word tiles + all affected tiles ---
    // Collect all tiles involved in this step
    const allKeys = new Set();
    for (const t of (s.tiles || [])) allKeys.add(`${t.x},${t.y}`);
    for (const t of (s.blackTiles || [])) allKeys.add(`${t.x},${t.y}`);
    for (const t of (s.extras || [])) allKeys.add(`${t.x},${t.y}`);
    for (const t of (s.unblackTiles || [])) allKeys.add(`${t.x},${t.y}`);
    for (const lc of (s.letterChanges || [])) allKeys.add(`${lc.x},${lc.y}`);

    // word tiles first, then extras/effects, then blackTiles (global TA)
    const ordered = [];
    for (const t of (s.tiles || [])) { const k = `${t.x},${t.y}`; if (!ordered.includes(k)) ordered.push(k); }
    for (const t of (s.extras || [])) { const k = `${t.x},${t.y}`; if (!ordered.includes(k)) ordered.push(k); }
    // For TA, animate all globally-affected tiles as a batch after word tiles
    const taGlobal = [];
    if (isTA) {
      for (const t of (s.blackTiles || [])) {
        const k = `${t.x},${t.y}`;
        if (!ordered.includes(k)) taGlobal.push(k);
      }
    }
    // remaining blackTiles (non-TA) and unblackTiles
    for (const t of (s.unblackTiles || [])) { const k = `${t.x},${t.y}`; if (!ordered.includes(k) && !taGlobal.includes(k)) ordered.push(k); }
    for (const t of (s.blackTiles || [])) { const k = `${t.x},${t.y}`; if (!ordered.includes(k) && !taGlobal.includes(k)) ordered.push(k); }

    // --- phase 2: animate word tiles first ---
    const animDelay = (i) => i * 120;
    ordered.forEach((k, i) => {
      const c = cellEls[k];
      if (!c || c.classList.contains('empty')) return;
      setTimeout(() => c.classList.add('highlight'), animDelay(i));

      const hc = (s.hpChanges || []).find(h => `${h.x},${h.y}` === k);
      const isBlacked = (s.blackTiles || []).some(t => `${t.x},${t.y}` === k);
      const isUnblacked = (s.unblackTiles || []).some(t => `${t.x},${t.y}` === k);
      const hpIncreased = hc && hc.to > hc.from;
      const hpDecreased = hc && hc.to < hc.from;

      if (hpIncreased) {
        // ABA: onion layer added
        setTimeout(() => {
          c.classList.add('oniadded');
          const hpEl = c.querySelector('.hp');
          if (!hpEl) {
            const el = document.createElement('span');
            el.className = 'hp';
            el.textContent = hc.to;
            c.appendChild(el);
          } else {
            hpEl.textContent = hc.to;
          }
        }, 400 + animDelay(i));
        setTimeout(() => c.classList.remove('oniadded'), 900 + animDelay(i));
      } else if (hpDecreased) {
        // onion peel: reduce hp count, blacken only if hp goes to 0
        setTimeout(() => {
          c.classList.add('peeling');
          const hpEl = c.querySelector('.hp');
          if (hc.to > 0) {
            if (hpEl) hpEl.textContent = hc.to;
          } else {
            if (hpEl) hpEl.remove();
            c.classList.add('blacked');
          }
        }, 380 + animDelay(i));
        setTimeout(() => c.classList.remove('peeling'), 900 + animDelay(i));
      } else if (isBlacked) {
        // regular blackening
        setTimeout(() => c.classList.add('blacked'), 380 + animDelay(i));
        setTimeout(() => c.classList.add('flash'), 380 + animDelay(i));
      } else if (isUnblacked) {
        // ABA: unblack a previously blacked tile
        setTimeout(() => {
          c.classList.remove('blacked');
          c.classList.add('flash');
        }, 380 + animDelay(i));
      }
    });

    // --- phase 3: TA global effect (all matching tiles simultaneously) ---
    if (isTA && taGlobal.length) {
      setTimeout(() => {
        taGlobal.forEach(k => {
          const c = cellEls[k];
          if (!c || c.classList.contains('empty')) return;
          c.classList.add('highlight');
        });
      }, animDelay(ordered.length) + 100);
      setTimeout(() => {
        taGlobal.forEach(k => {
          const c = cellEls[k];
          if (!c || c.classList.contains('empty')) return;
          c.classList.add('blacked');
          c.classList.add('flash');
        });
      }, animDelay(ordered.length) + 480);
    }

    // --- phase 4: W cloud copy effect ---
    if (isW) {
      const shapeTiles = (s.blackTiles || []).filter(t =>
        !(s.tiles || []).some(tt => tt.x === t.x && tt.y === t.y));
      if (shapeTiles.length) {
        setTimeout(() => {
          shapeTiles.forEach(t => {
            const c = cellEls[`${t.x},${t.y}`];
            if (!c || c.classList.contains('empty')) return;
            c.classList.add('highlight');
            c.classList.add('oniadded');
          });
        }, animDelay(ordered.length) + 100);
        setTimeout(() => {
          shapeTiles.forEach(t => {
            const c = cellEls[`${t.x},${t.y}`];
            if (!c || c.classList.contains('empty')) return;
            c.classList.add('blacked');
            c.classList.add('flash');
            c.classList.remove('oniadded');
          });
        }, animDelay(ordered.length) + 500);
      }
    }

    // --- phase 5: BE letter creation ---
    for (const lc of (s.letterChanges || [])) {
      const c = cellEls[`${lc.x},${lc.y}`];
      if (c) {
        setTimeout(() => {
          c.textContent = lc.to;
          c.classList.add('flash');
          c.classList.add('oniadded');
        }, 500);
        setTimeout(() => c.classList.remove('oniadded'), 1000);
      }
    }
  }

  function tick(ts) {
    if (!playing) return;
    if (!lastT) lastT = ts;
    const dt = ts - lastT;
    lastT = ts;
    frameRef += dt * speed;
    const idx = Math.floor(frameRef / STEP_MS);
    if (idx !== frame) {
      frame = Math.min(idx, total);
      showStep(frame);
    }
    if (frame >= total) { playing = false; pause(); return; }
    raf = requestAnimationFrame(tick);
  }
  let frameRef = 0;

  function play() {
    playing = true; lastT = 0; raf = requestAnimationFrame(tick);
  }
  function pause() { playing = false; if (raf) cancelAnimationFrame(raf); raf = null; }
  function reset() { frame = 0; frameRef = 0; playing = false; showStep(0); }
  function next() { if (frame < total) { frame++; showStep(frame); } }
  function prev() { if (frame > 0) { frame--; showStep(frame); } }
  function seekTo(i) { frame = Math.max(0, Math.min(i, total)); frameRef = frame * STEP_MS; showStep(frame); }
  function setSpeed(v) { speed = v; }

  showStep(0);

  return { play, pause, reset, next, prev, seekTo, setSpeed, get frame() { return frame; } };
}

export function renderStepsHtml(steps) {
  return steps.map((s, i) => `<li>${i + 1}. ${s.text || ''}</li>`).join('');
}

// --- Arrow puzzle replay & animation ---

// Replay arrow steps from the initial level, returning a Level-like board state per step.
function replayArrowSteps(level, steps) {
  const cols = level.cols, rows = level.rows;
  let cells = makeBoard(level);
  const states = [];

  function cellsToLevel(c, stepIdx) {
    const g = Array.from({ length: rows }, () => Array(cols).fill('-'));
    const on = Array.from({ length: rows }, () => Array(cols).fill(0));
    const all = allCells(c);
    for (const cell of all) {
      if (cell.type === 'letter' && cell.letter && !cell.blacked && cell.letter !== '-') {
        g[cell.y][cell.x] = cell.letter;
        on[cell.y][cell.x] = cell.hp || 0;
      } else if (cell.type === 'letter' && cell.blacked && cell.letter && cell.letter !== '-') {
        g[cell.y][cell.x] = '=';
      }
      // empty cells stay '-' (default)
    }
    return { cols, rows, grid: g, onions: on };
  }

  states.push(cellsToLevel(cells, 0));

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const stepType = s.type || (s.arrow ? 'push' : 'word');
    if (stepType === 'push' && s.moved && s.dir) {
      let out = cloneBoard(cells);
      // Move tiles in reverse order (furthest first)
      const moved = s.moved;
      for (let mi = moved.length - 1; mi >= 0; mi--) {
        const m = moved[mi];
        const nx = m.x + s.dir.x, ny = m.y + s.dir.y;
        out[nx][ny] = { ...out[m.x][m.y], x: nx, y: ny };
      }
      for (const m of moved) {
        const stillNeeded = moved.some(
          c => c.x + s.dir.x === m.x && c.y + s.dir.y === m.y
        );
        if (!stillNeeded) out[m.x][m.y] = { x: m.x, y: m.y, type: 'empty', letter: '', hp: 0, blacked: false };
      }
      // Arrow is blacked after push
      const ax = s.arrow.x + s.dir.x, ay = s.arrow.y + s.dir.y;
      out[ax][ay] = blackout(out[ax][ay]);
      cells = out;
    } else if (stepType === 'word') {
      let out = cloneBoard(cells);
      for (const t of (s.blackTiles || [])) out[t.x][t.y] = blackout(out[t.x][t.y]);
      for (const t of (s.unblackTiles || [])) {
        if (out[t.x][t.y]) out[t.x][t.y].blacked = false;
      }
      for (const lc of (s.letterChanges || [])) {
        if (out[lc.x][lc.y]) {
          out[lc.x][lc.y].letter = lc.to;
          out[lc.x][lc.y].type = 'letter';
        }
      }
      for (const hc of (s.hpChanges || [])) {
        if (out[hc.x][hc.y]) out[hc.x][hc.y].hp = hc.to;
      }
      cells = out;
    }
    states.push(cellsToLevel(cells, i + 1));
  }
  return states;
}

// Play arrow steps by swapping board states (pre-rendered).
export function animateArrowSteps(boardWrap, level, steps) {
  const states = replayArrowSteps(level, steps);
  const total = steps.length;
  let frame = 0;
  let playing = false;
  let speed = 1;
  let raf = null;
  let lastT = 0;
  const STEP_MS = 1400;

  // Build all board DOMs (states has total+1: init + after each step)
  const boardEls = states.map(s => renderBoard(s));
  boardEls.forEach(el => {
    el.style.display = 'none';
    boardWrap.appendChild(el);
  });
  boardEls[0].style.display = '';

  function showStep(n) {
    if (frame < boardEls.length) boardEls[frame].style.display = 'none';
    frame = Math.max(0, Math.min(n, total));
    boardEls[frame].style.display = '';
  }

  function tick(ts) {
    if (!playing) return;
    if (!lastT) lastT = ts;
    const dt = ts - lastT;
    lastT = ts;
    frameRef += dt * speed;
    const idx = Math.floor(frameRef / STEP_MS);
    if (idx !== frame) showStep(Math.min(idx, total));
    if (frame >= total) { playing = false; pause(); return; }
    raf = requestAnimationFrame(tick);
  }
  let frameRef = 0;

  function play() { playing = true; lastT = 0; raf = requestAnimationFrame(tick); }
  function pause() { playing = false; if (raf) cancelAnimationFrame(raf); raf = null; }
  function reset() { frame = 0; frameRef = 0; playing = false; showStep(0); }
  function next() { if (frame < total) showStep(frame + 1); }
  function prev() { if (frame > 0) showStep(frame - 1); }
  function seekTo(i) { showStep(i); }
  function setSpeed(v) { speed = v; }

  showStep(0);
  return { play, pause, reset, next, prev, seekTo, setSpeed, get frame() { return frame; } };
}
