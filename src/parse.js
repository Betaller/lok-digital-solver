// parse.js - single parsing entry: ASCII (official format or user input) -> Level
// Output contract: { ok:true, level } | { ok:false, row, col, message }
//
// ASCII format (official):
//   <cols>\n<rows>\n<grid line...>
// grid symbols:
//   '-' empty, '#' target, '=' preblack, letters, '?' 'W' arrows
//   '*' onion: immediately follows a tile, each * = +1 hp, NOT a column
//   monuments (world 13): after grid, '&' then pieces then '%' x/y '---'
// If first two lines are NOT integers, treat whole input as a bare grid and
// auto-infer cols/rows (all rows must be equal width).

const TILE_CHARS = new Set([
  '-', '#', '=',
  'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
  '?', '<', '>', '^', 'v',
]);

const MAX_COLS = 64;
const MAX_ROWS = 64;

export function parseLevel(text) {
  if (typeof text !== 'string') {
    return { ok: false, row: 0, col: 0, message: '未输入内容' };
  }
  let t = text.replace(/^\uFEFF/, '').replace(/\r/g, '');
  // strip leading/trailing blank lines
  const lines = t.split('\n');
  // find first non-empty and last non-empty
  let first = 0, last = lines.length - 1;
  while (first < lines.length && lines[first].trim() === '') first++;
  while (last >= 0 && lines[last].trim() === '') last--;
  if (first > last) return { ok: false, row: 0, col: 0, message: '未输入内容' };
  const body = lines.slice(first, last + 1);

  // Try official header: [0]=int cols, [1]=int rows
  let cols, rows, gridLines;
  const a = parseInt(body[0], 10);
  const b = parseInt(body[1], 10);
  if (Number.isInteger(a) && Number.isInteger(b) && a > 0 && b > 0 && body.length >= b + 2) {
    cols = a; rows = b;
    gridLines = body.slice(2, 2 + rows);
  } else {
    // bare grid: every line same length
    cols = body[0].length;
    rows = body.length;
    gridLines = body;
  }

  if (cols <= 0 || rows <= 0) return { ok: false, row: 1, col: 1, message: '网格尺寸无效' };
  if (cols > MAX_COLS || rows > MAX_ROWS) {
    return { ok: false, row: 1, col: 1, message: `网格 ${cols}×${rows} 超过上限 ${MAX_COLS}×${MAX_ROWS}` };
  }

  const grid = [];       // grid[y][x] = base char (letters, #, =, -)
  const onions = [];     // grid[y][x] = hp
  const cellsByPos = new Map(); // not needed; keep simple

  for (let y = 0; y < rows; y++) {
    const line = gridLines[y];
    const rowCells = [];
    const rowOnion = [];
    if (line.length < cols) {
      return { ok: false, row: first + y + 1, col: line.length + 1, message: `第 ${first + y + 1} 行宽度 ${line.length} 不足 ${cols}` };
    }
    let j = 0;
    for (let x = 0; x < cols; x++) {
      let ch = line[x + j];
      if (ch === undefined) { ch = '-'; }
      if (ch === '*') {
        return { ok: false, row: first + y + 1, col: x + 1, message: `星号 * 必须紧跟字母格` };
      }
      if (!TILE_CHARS.has(ch)) {
        return { ok: false, row: first + y + 1, col: x + 1, message: `第 ${first + y + 1} 行第 ${x + 1} 列非法字符 '${ch}'` };
      }
      let hp = 0;
      while (x + j + 1 < line.length && line[x + j + 1] === '*') { hp++; j++; }
      rowCells.push(ch);
      rowOnion.push(hp);
    }
    // Game behavior: characters beyond `cols` (that aren't '*' attached to a tile)
    // are silently ignored by CoroutineSetup (it only reads index x+j). Match that.
    grid.push(rowCells);
    onions.push(rowOnion);
  }

  // Monuments section (world 13): lines after grid that start with '&'
  let pieces = null;
  const rest = body.slice(2 + rows).filter(l => l.trim() !== '');
  if (rest.length && rest[0] === '&') {
    pieces = [];
    let i = 1;
    let shape = [];
    while (i < rest.length) {
      const tok = rest[i];
      if (tok === '%') {
        pieces.push({ shape: shape.slice(), coords: rest[i + 1] ?? '' });
        shape = []; i += 2;
      } else if (tok === '---') { i++; }
      else { shape.push(tok); i++; }
    }
    if (shape.length) pieces.push({ shape, coords: '' });
  }

  return {
    ok: true,
    level: { cols, rows, grid, onions, pieces },
  };
}

// Export Level to canonical ASCII (strict, idempotent with parseLevel)
export function exportLevel(level) {
  const lines = [`${level.cols}`, `${level.rows}`];
  for (let y = 0; y < level.rows; y++) {
    let row = '';
    for (let x = 0; x < level.cols; x++) {
      let ch = level.grid[y][x];
      if (ch === undefined) ch = '-';
      row += ch;
      const hp = level.onions?.[y]?.[x] ?? 0;
      row += '*'.repeat(hp);
    }
    lines.push(row);
  }
  if (level.pieces && level.pieces.length) {
    lines.push('&');
    for (const p of level.pieces) {
      for (const s of p.shape) lines.push(s);
      lines.push('%');
      lines.push(p.coords);
    }
  }
  return lines.join('\n');
}
