// generator.js - generate guaranteed-solvable puzzles.
//
// Approach: reverse construction. We pick a word sequence, lay the word tiles
// onto a blank grid, then run the real solver to confirm solvability and
// capture the actual solution steps.

import { WORD_LIBRARY } from './engine.js';
import { exportLevel } from './parse.js';
import { solve } from './solver.js';

const WORD_POOL = ['LOK', 'LOK', 'TLAK', 'TLAK', 'TA', 'TA'];
const LETTERS = 'LOKTABEGRIV';

function rnd(n) { return Math.floor(Math.random() * n); }
function rndPick(arr) { return arr[rnd(arr.length)]; }

function build(cols, rows, wordList) {
  const grid = Array.from({ length: rows }, () => Array(cols).fill('-'));
  const onions = Array.from({ length: rows }, () => Array(cols).fill(0));
  const solution = [];
  const placed = new Set();

  for (const w of wordList) {
    const spell = WORD_LIBRARY[w].spell;
    const n = spell.length;
    const placements = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x <= cols - n; x++) {
        let ok = true;
        for (let i = 0; i < n; i++) {
          const k = `${x + i},${y}`;
          if (placed.has(k) && grid[y][x + i] !== spell[i]) { ok = false; break; }
        }
        if (ok) placements.push({ dir: 'h', x, y, tiles: spell.split('').map((ch, i) => ({ x: x + i, y, ch })) });
      }
    }
    for (let y = 0; y <= rows - n; y++) {
      for (let x = 0; x < cols; x++) {
        let ok = true;
        for (let i = 0; i < n; i++) {
          const k = `${x},${y + i}`;
          if (placed.has(k) && grid[y + i][x] !== spell[i]) { ok = false; break; }
        }
        if (ok) placements.push({ dir: 'v', x, y, tiles: spell.split('').map((ch, i) => ({ x, y: y + i, ch })) });
      }
    }
    if (!placements.length) return null;
    const p = rndPick(placements);
    for (const t of p.tiles) {
      if (grid[t.y][t.x] === '-') grid[t.y][t.x] = t.ch;
      placed.add(`${t.x},${t.y}`);
    }
    const extras = [];
    const cap = WORD_LIBRARY[w].extra || 0;
    const empties = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (grid[y][x] === '-' && !placed.has(`${x},${y}`)) empties.push({ x, y });
    }
    for (let i = empties.length - 1; i > 0; i--) { const j = rnd(i + 1); [empties[i], empties[j]] = [empties[j], empties[i]]; }
    for (const e of empties.slice(0, cap)) {
      extras.push(e);
      placed.add(`${e.x},${e.y}`);
    }
    solution.push({ word: w, tiles: p.tiles.map(t => ({ x: t.x, y: t.y })), extras });
  }

  for (const step of solution) {
    for (const ex of step.extras) grid[ex.y][ex.x] = '#';
  }

  return { grid, onions, solution };
}

export function generatePuzzle(opts = {}) {
  const cols = opts.cols ?? 5 + rnd(3);
  const rows = opts.rows ?? 5 + rnd(3);
  const wordCount = opts.wordCount ?? 2 + rnd(2);
  const attempts = opts.attempts ?? 100;
  for (let a = 0; a < attempts; a++) {
    const wordList = [];
    for (let i = 0; i < wordCount; i++) wordList.push(rndPick(WORD_POOL));
    const r = build(cols, rows, wordList);
    if (!r) continue;
    const level = { cols, rows, grid: r.grid, onions: r.onions };
    const ascii = exportLevel(level);
    const res = solve({ ...level, world: 0, level: 0, hints: [] }, { timeMs: 800, nodeLimit: 200000 });
    if (res.status !== 'solved') continue;
    const solutionText = (res.steps || []).map((s, i) => {
      const tiles = (s.tiles || []).map(t => `(${t.x},${t.y})`).join('\u2192');
      const extras = (s.extras && s.extras.length) ? ` \u989d\u5916:${s.extras.map(t => `(${t.x},${t.y})`).join(',')}` : '';
      const act = s.extraAction && !['extra','none'].includes(s.extraAction) ? ` (${s.extraAction})` : '';
      return `${i + 1}. ${s.word || '?'} ${tiles}${extras}${act}`;
    }).join('\n');
    return { ascii, level, solution: res.steps || [], solutionText };
  }
  return null;
}
