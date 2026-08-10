// draw.js - visual puzzle editor with Pointer Events, pan/zoom-less (scroll), undo/redo.
// Exports createDrawTool({onExport, onSolve}).

import { renderBoard } from './animate.js';
import { exportLevel } from './parse.js';

const TOOLS = [
  { id: 'erase', label: '空', desc: '空格' },
  { id: 'letter', label: 'A', desc: '字母（可调层数）' },
  { id: 'target', label: '#', desc: '目标格' },
  { id: 'preblack', label: '=', desc: '预黑格' },
  { id: 'x', label: 'X', desc: '导体 X' },
  { id: 'q', label: '?', desc: '问号' },
  { id: 'w', label: 'W', desc: '云朵' },
  { id: 'arrow', label: '→', desc: '箭头' },
];

const ARROWS = ['>', '<', '^', 'v'];
const LETTERS = 'LOKTABEGRIVWXYZ';

export function createDrawTool({ onExport, onSolve } = {}) {
  const colsIn = document.getElementById('draw-cols');
  const rowsIn = document.getElementById('draw-rows');
  const stage = document.getElementById('draw-stage');
  const toolbar = document.getElementById('draw-toolbar');
  const asciiOut = document.getElementById('draw-ascii');
  const undoBtn = document.getElementById('btn-draw-undo');
  const redoBtn = document.getElementById('btn-draw-redo');
  const clearBtn = document.getElementById('btn-draw-clear');
  const exportBtn = document.getElementById('btn-draw-export');
  const solveBtn = document.getElementById('btn-draw-solve');
  const resizeBtn = document.getElementById('btn-draw-resize');

  let cols = parseInt(colsIn.value, 10) || 6;
  let rows = parseInt(rowsIn.value, 10) || 6;
  let grid = initGrid(cols, rows);
  let hp = initGrid(cols, rows);          // onion layers
  let arrowDir = initGrid(cols, rows, '>');
  let activeTool = 'letter';
  let activeLetter = 'L';
  let activeArrow = '>';
  let undoStack = [];
  let redoStack = [];

  function initGrid(c, r, v = '') { return Array.from({length: r}, () => Array(c).fill(v)); }
  function snapshot() {
    return {
      cols, rows,
      grid: grid.map(r => r.slice()),
      hp: hp.map(r => r.slice()),
      arrowDir: arrowDir.map(r => r.slice()),
    };
  }
  function restore(s) {
    cols = s.cols; rows = s.rows;
    grid = s.grid.map(r => r.slice());
    hp = s.hp.map(r => r.slice());
    arrowDir = s.arrowDir.map(r => r.slice());
    colsIn.value = cols; rowsIn.value = rows;
    render();
  }
  function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 100) undoStack.shift(); redoStack = []; }
  function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); }
  function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); }

  function buildToolbar() {
    toolbar.innerHTML = '';
    for (const t of TOOLS) {
      const b = document.createElement('button');
      b.className = 'tool' + (t.id === activeTool ? ' active' : '');
      b.textContent = t.label;
      b.title = t.desc;
      b.addEventListener('click', () => {
        activeTool = t.id;
        toolbar.querySelectorAll('.tool').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        if (t.id === 'letter') pickLetter();
        if (t.id === 'arrow') pickArrow();
      });
      toolbar.appendChild(b);
    }
  }

  function pickLetter() {
    const l = prompt('选择字母（含层数，如 L 或 L**）', activeLetter + '*'.repeat(0));
    if (!l) return;
    const m = l.toUpperCase().replace(/\*/g, '');
    if (/^[A-Z]$/.test(m)) activeLetter = m;
  }

  function pickArrow() {
    const a = prompt('选择箭头方向 (> < ^ v)', activeArrow);
    if (ARROWS.includes(a)) activeArrow = a;
  }

  function render() {
    stage.innerHTML = '';
    const level = buildLevel();
    const board = renderBoard(level);
    board.style.transform = 'scale(1)';
    board.style.transformOrigin = 'top left';
    // make cells interactive
    board.querySelectorAll('.cell').forEach(c => {
      c.style.cursor = 'pointer';
      const x = +c.dataset.x, y = +c.dataset.y;
      c.addEventListener('pointerdown', e => { e.preventDefault(); paint(x, y); });
      c.addEventListener('pointerenter', e => { if (e.buttons === 1) paint(x, y); });
    });
    stage.appendChild(board);
    stage.scrollTop = 0; stage.scrollLeft = 0;
    syncAscii();
  }

  function buildLevel() {
    // convert editor state -> Level object for renderBoard
    const g = grid.map((row, y) => row.map((ch, x) => {
      if (activeTool === 'preblack' && ch === '=') return '=';
      return ch;
    }));
    const level = { cols, rows, grid: g, onions: hp };
    return level;
  }

  function paint(x, y) {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    const prev = grid[y][x];
    const prevHp = hp[y][x];
    // only push undo if something changes
    const ch = grid[y][x];
    let changed = false;
    switch (activeTool) {
      case 'erase': if (ch !== '-' || hp[y][x] !== 0) { changed = true; grid[y][x] = '-'; hp[y][x] = 0; } break;
      case 'letter': if (ch !== activeLetter || hp[y][x] !== 0) { changed = true; grid[y][x] = activeLetter; hp[y][x] = 0; } break;
      case 'target': if (ch !== '#') { changed = true; grid[y][x] = '#'; hp[y][x] = 0; } break;
      case 'preblack': if (ch !== '=') { changed = true; grid[y][x] = '='; hp[y][x] = 0; } break;
      case 'x': if (ch !== 'X') { changed = true; grid[y][x] = 'X'; hp[y][x] = 0; } break;
      case 'q': if (ch !== '?') { changed = true; grid[y][x] = '?'; hp[y][x] = 0; } break;
      case 'w': if (ch !== 'W') { changed = true; grid[y][x] = 'W'; hp[y][x] = 0; } break;
      case 'arrow': if (ch !== activeArrow) { changed = true; grid[y][x] = activeArrow; hp[y][x] = 0; } break;
    }
    if (changed) { pushUndo(); render(); }
  }

  function syncAscii() {
    const level = buildLevel();
    const ascii = exportLevel(level);
    asciiOut.value = ascii;
    if (onExport) onExport(ascii);
  }

  function rebuild() {
    const c = parseInt(colsIn.value, 10) || 6;
    const r = parseInt(rowsIn.value, 10) || 6;
    if (c > 64 || r > 64) { alert('最大 64×64'); return; }
    pushUndo();
    cols = c; rows = r;
    grid = initGrid(c, r);
    hp = initGrid(c, r);
    arrowDir = initGrid(c, r, '>');
    render();
  }

  clearBtn.addEventListener('click', () => { pushUndo(); grid = initGrid(cols, rows); hp = initGrid(cols, rows); render(); });
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);
  resizeBtn.addEventListener('click', rebuild);
  exportBtn.addEventListener('click', () => {
    syncAscii();
    navigator.clipboard?.writeText(asciiOut.value).catch(() => {});
  });
  solveBtn.addEventListener('click', () => { syncAscii(); if (onSolve) onSolve(asciiOut.value); });

  buildToolbar();
  render();
}
