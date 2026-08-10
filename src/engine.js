// engine.js - LOK Digital board model + word effect executor.
// PURE functions, zero dependencies. Used by solver, animation, tests.
//
// Cell types:
//   'empty'          - '-' no tile, can be crossed freely
//   'target'         - '#' blank tile, must be blackened via extra blackouts
//   'preblack'       - '=' blank tile, already blackened at start
//   'letter'         - a letter tile (letter may be X, ?, W, arrows...)
//
// Cell fields: {x,y,type,letter,hp,blacked}
//   hp: onion layers; blackout on hp>0 decrements hp without blackening.
//   blacked: currently black.

export const WORD_LIBRARY = {
  LOK:   { spell: ['LOK', 'KOL'],   extra: 1 },
  TLAK:  { spell: ['TLAK', 'KALT'], extra: 2, extraAdjacent: true },
  TA:    { spell: ['TA', 'AT'],     extra: 0, globalLetter: true },
  BE:    { spell: ['BE', 'EB'],     extra: 0, createLetter: true },
  LOLO:  { spell: ['LOLO', 'OLOL'], extra: 0, diagonal: true },
  ABA:   { spell: ['ABA'],          extra: 1, unblack: true },
  GRIVA: { spell: ['GRIVA', 'AVIRG'], extra: 0 },
  W:     { spell: ['W'],            extra: 0, clouds: true },
};

// Words that can be spelled from board letters (incl. reversed). Used by solver.
export const ALL_SPELLINGS = Object.values(WORD_LIBRARY)
  .flatMap(w => w.spell)
  .filter(s => !s.includes('W') || s === 'W');

export const OLKO_SPELLINGS = ['OLKO', 'OKLO'];

// ---------------------------------------------------------------- board utils

export function makeBoard(level) {
  // level = {cols, rows, grid: string[][] } or Level object from parse.js
  const cells = [];
  for (let y = 0; y < level.rows; y++) {
    for (let x = 0; x < level.cols; x++) {
      const ch = (level.grid?.[y]?.[x]) ?? '-';
      let type = 'empty';
      let letter = '';
      let hp = 0;
      let blacked = false;
      if (ch === '-') { type = 'empty'; }
      else if (ch === '#') { type = 'target'; }
      else if (ch === '=') { type = 'preblack'; blacked = true; }
      else { type = 'letter'; letter = ch; }
      if (level.onions?.[y]?.[x]) hp = level.onions[y][x];
      cells.push({ x, y, type, letter, hp, blacked });
    }
  }
  return cells;
}

export function cellAt(cells, x, y) {
  return cells.find(c => c.x === x && c.y === y);
}

// A tile can be crossed when spelling if it is empty, blacked, or active w/ hp==0.
export function canBeCrossed(cell) {
  if (!cell) return true;                 // no tile = empty space
  if (cell.type === 'empty') return true;
  if (cell.blacked) return true;          // blacked tiles are bridges
  if (cell.type === 'target') return false;
  return cell.hp === 0;                   // letter tiles block unless hp broken (not represented in static solver)
}

export function canClick(cell) {
  if (!cell) return false;
  if (cell.type === 'empty') return false;
  if (cell.blacked) return false;         // blacked cannot be re-spelled (except ABA target)
  return true;
}

export function isLetterCell(cell) {
  return cell && cell.type === 'letter' && cell.letter && cell.letter !== '-';
}

// Blackout: if hp>0 decrement only; else blacken. Returns new cell (immutable-ish copy).
export function blackout(cell) {
  if (cell.hp > 0) return { ...cell, hp: cell.hp - 1, blacked: false };
  return { ...cell, blacked: true };
}

export function unblack(cell) {
  return { ...cell, blacked: false };
}

// Is the board solved? all non-empty cells blacked.
export function isSolved(cells) {
  return cells.every(c => c.type === 'empty' || c.blacked);
}

export function boardKey(cells) {
  return cells.map(c => `${c.type}:${c.letter}:${c.hp}:${c.blacked ? 1 : 0}`).join('|');
}

export function cloneBoard(cells) {
  return cells.map(c => ({ ...c }));
}
