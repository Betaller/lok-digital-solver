// engine.js - LOK Digital board model + word effect executor.
// PURE functions, zero dependencies. Used by solver, animation, tests.
//
// Board = 2D array cells[cols][rows] for O(1) lookup.
// Cell = {x, y, type, letter, hp, blacked}

// Character constants
export const CH = {
  EMPTY:    '-',
  BLANK:    '#',
  PREBLACK: '=',
  CONDUCTOR:'X',
  WILDCARD: '?',
};

// Cell type constants
export const TYPE = {
  EMPTY:    'empty',
  BLANK:    'target',
  PREBLACK: 'preblack',
  LETTER:   'letter',
};

export const WORD_LIBRARY = {
  LOK:   { spell: 'LOK',                extra: 1 },
  TLAK:  { spell: 'TLAK',               extra: 2, extraAdjacent: true },
  TA:    { spell: 'TA',                 extra: 0, globalLetter: true },
  BE:    { spell: 'BE',                 extra: 0, createLetter: true },
  LOLO:  { spell: 'LOLO',               extra: 0, diagonal: true },
  ABA:   { spell: 'ABA',                extra: 1, onion: true },
  GRIVA: { spell: 'GRIVA',              extra: 0 },
  W:     { spell: 'W',                  extra: 0, clouds: true },
};

export const ALL_SPELLINGS = Object.values(WORD_LIBRARY)
  .map(w => w.spell)
  .filter(s => !s.includes('W') || s === 'W');

export const OLKO_SPELLINGS = ['OLKO', 'OKLO'];

// ---------------------------------------------------------------- board utils

export function makeBoard(level) {
  const cols = level.cols, rows = level.rows;
  const grid = new Array(cols);
  for (let x = 0; x < cols; x++) {
    grid[x] = new Array(rows);
    for (let y = 0; y < rows; y++) {
      const ch = (level.grid?.[y]?.[x]) ?? CH.EMPTY;
      let type, letter = '', hp = 0, blacked = false;
      if (ch === CH.EMPTY)      { type = TYPE.EMPTY; }
      else if (ch === CH.BLANK) { type = TYPE.BLANK; }
      else if (ch === CH.PREBLACK) { type = TYPE.PREBLACK; blacked = true; }
      else                      { type = TYPE.LETTER; letter = ch; }
      if (level.onions?.[y]?.[x]) hp = level.onions[y][x];
      grid[x][y] = { x, y, type, letter, hp, blacked };
    }
  }
  grid._cols = cols;
  grid._rows = rows;
  return grid;
}

export function cellAt(grid, x, y) {
  if (x < 0 || y < 0 || x >= grid._cols || y >= grid._rows) return undefined;
  return grid[x][y];
}

// Flatten to array for iteration
export function allCells(grid) {
  const out = [];
  for (let x = 0; x < grid._cols; x++)
    for (let y = 0; y < grid._rows; y++)
      out.push(grid[x][y]);
  return out;
}

export function cloneBoard(grid) {
  const cols = grid._cols, rows = grid._rows;
  const out = new Array(cols);
  for (let x = 0; x < cols; x++) {
    out[x] = new Array(rows);
    for (let y = 0; y < rows; y++)
      out[x][y] = { ...grid[x][y] };
  }
  out._cols = cols;
  out._rows = rows;
  return out;
}

export function putCell(grid, x, y, fn) {
  const out = cloneBoard(grid);
  out[x][y] = fn(out[x][y]);
  return out;
}

export function canBeCrossed(cell) {
  if (!cell) return true;
  if (cell.type === TYPE.EMPTY) return true;
  if (cell.blacked) return true;
  if (cell.type === TYPE.BLANK) return false;
  return cell.hp === 0;
}

export function canClick(cell) {
  if (!cell) return false;
  if (cell.type === TYPE.EMPTY) return false;
  if (cell.blacked) return false;
  return true;
}

export function isLetterCell(cell) {
  return cell && cell.type === TYPE.LETTER && cell.letter && cell.letter !== CH.EMPTY;
}

export function blackout(cell) {
  if (cell.hp > 0) return { ...cell, hp: cell.hp - 1, blacked: false };
  return { ...cell, blacked: true };
}

export function addOnion(cell) {
  return { ...cell, hp: cell.hp + 1, blacked: false };
}

export function isSolved(grid) {
  for (let x = 0; x < grid._cols; x++)
    for (let y = 0; y < grid._rows; y++)
      if (grid[x][y].type !== TYPE.EMPTY && !grid[x][y].blacked) return false;
  return true;
}

export function boardKey(grid) {
  const parts = [];
  for (let x = 0; x < grid._cols; x++)
    for (let y = 0; y < grid._rows; y++) {
      const c = grid[x][y];
      parts.push(`${c.type}:${c.letter}:${c.hp}:${c.blacked ? 1 : 0}`);
    }
  return parts.join('|');
}
