// animate.js - render board as DOM + virtual-timeline playback (WAAPI-free, rAF loop).
// Depends on engine only (board model + step descriptors).

import { cellAt } from './engine.js';

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

  const STEP_MS = 1200;

  function clearState() {
    boardEl.querySelectorAll('.cell').forEach(c => {
      c.classList.remove('highlight', 'flash', 'blacked', 'dim');
    });
    // restore base
    renderBlackState(boardEl, 0);
  }

  // apply board state up to step `n` (exclusive):
  //   - reset letters to base
  //   - apply hp changes (onion layer count) from steps 0..n-1
  //   - blacken/unblacken per recorded diff
  function renderBlackState(n) {
    // reset all cells to base (letter + hp display)
    boardEl.querySelectorAll('.cell').forEach(c => {
      c.classList.remove('blacked', 'flash');
      const x = +c.dataset.x, y = +c.dataset.y;
      const ch = level.grid?.[y]?.[x] ?? '-';
      const baseHp = level.onions?.[y]?.[x] ?? 0;
      c.textContent = (ch === '-' || ch === '#' || ch === '=') ? '' : ch;
      // reset hp display
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
    // apply steps 0..n-1: hp changes first, then blackouts
    for (let i = 0; i < n; i++) {
      const s = steps[i];
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
    clearState();
    renderBlackState(n);
    // highlight current step tiles: word tiles, then extra/global effect tiles
    if (n < total) {
      const s = steps[n];
      // tiles to highlight = word tiles (conductors highlighted too) + any newly blackened
      const hl = new Set();
      for (const t of (s.tiles || [])) hl.add(`${t.x},${t.y}`);
      for (const t of (s.blackTiles || [])) hl.add(`${t.x},${t.y}`);
      for (const t of (s.extras || [])) hl.add(`${t.x},${t.y}`);
      // order: word tiles first, then the rest
      const ordered = [];
      for (const t of (s.tiles || [])) { const k = `${t.x},${t.y}`; if (!ordered.includes(k)) ordered.push(k); }
      for (const k of hl) if (!ordered.includes(k)) ordered.push(k);
      ordered.forEach((k, i) => {
        const c = cellEls[k];
        if (c && !c.classList.contains('empty')) {
          setTimeout(() => c.classList.add('highlight'), i * 140);
          // if this tile has hp in the step's final state, only peel a layer (flash hp), don't blacken
          const hc = (s.hpChanges || []).find(h => `${h.x},${h.y}` === k);
          const becomesBlack = (s.blackTiles || []).some(t => `${t.x},${t.y}` === k) && !(hc && hc.to > 0);
          if (becomesBlack) {
            setTimeout(() => c.classList.add('blacked'), 380 + i * 140);
          }
          setTimeout(() => c.classList.add('flash'), 380 + i * 140);
        }
      });
      // letter changes (BE) animate as letter pop
      for (const lc of (s.letterChanges || [])) {
        const c = cellEls[`${lc.x},${lc.y}`];
        if (c) {
          setTimeout(() => { c.textContent = lc.to; c.classList.add('flash'); }, 500);
        }
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

  // initial
  showStep(0);

  return { play, pause, reset, next, prev, seekTo, setSpeed, get frame() { return frame; } };
}

export function renderStepsHtml(steps) {
  return steps.map((s, i) => `<li>${i + 1}. ${s.text || ''}</li>`).join('');
}
