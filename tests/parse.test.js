import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLevel, exportLevel } from '../src/parse.js';
import { makeBoard, isSolved, boardKey } from '../src/engine.js';
import { findPlacements } from '../src/solver.js';

test('parse official simple level', () => {
  const r = parseLevel('3\n2\nLOK\n-#-');
  assert.equal(r.ok, true);
  assert.equal(r.level.cols, 3);
  assert.equal(r.level.rows, 2);
  assert.deepEqual(r.level.grid, [['L','O','K'],['-','#','-']]);
});

test('parse bare grid auto-infer', () => {
  const r = parseLevel('LOK\n-#-');
  assert.equal(r.ok, true);
  assert.equal(r.level.cols, 3);
  assert.equal(r.level.rows, 2);
});

test('parse onion layers attached to tile', () => {
  const r = parseLevel('3\n1\nL**O*K**');
  assert.equal(r.ok, true);
  assert.deepEqual(r.level.onions, [[2,1,2]]);
  assert.deepEqual(r.level.grid, [['L','O','K']]);
});

test('parse rejects stray star', () => {
  const r = parseLevel('2\n1\n*L');
  assert.equal(r.ok, false);
});

test('parse rejects illegal char with position', () => {
  const r = parseLevel('3\n2\nLéK\n-#-');
  assert.equal(r.ok, false);
  assert.equal(r.level, undefined);
  assert.ok(r.message.includes('非法字符'));
});

test('parse rejects non-rectangular', () => {
  const r = parseLevel('3\n2\nLON\n-#');
  assert.equal(r.ok, false);
});

test('parse empty input', () => {
  const r = parseLevel('');
  assert.equal(r.ok, false);
});

test('parse BOM + CRLF stripped', () => {
  const r = parseLevel('\uFEFF3\r\n2\r\nLOK\r\n-#-\r\n');
  assert.equal(r.ok, true);
});

test('roundtrip export -> parse -> export idempotent', () => {
  const ascii = '4\n3\nLKOL\nO--#\nK--K';
  const p1 = parseLevel(ascii);
  const exp1 = exportLevel(p1.level);
  const p2 = parseLevel(exp1);
  assert.equal(exp1, ascii);
  assert.deepEqual(exportLevel(p2.level), exp1);
});

test('roundtrip with onion + monument pieces', () => {
  const ascii = '3\n1\nL**O*K**\n&\nOLF#\n%\n2/1';
  const p1 = parseLevel(ascii);
  assert.equal(p1.ok, true);
  const exp1 = exportLevel(p1.level);
  const p2 = parseLevel(exp1);
  assert.deepEqual(exportLevel(p2.level), exp1);
});

test('findPlacements straight line', () => {
  const lv = parseLevel('3\n1\nLOK');
  const cells = makeBoard(lv.level);
  const pls = findPlacements(cells, 'LOK', 3, 1);
  assert.ok(pls.length >= 1);
});

test('findPlacements X conductor turn', () => {
  // L X X A / K path spell TLAK via X turns
  const lv = parseLevel('3\n2\nTLX\nKAX');
  const cells = makeBoard(lv.level);
  const pls = findPlacements(cells, 'TLAK', 3, 2);
  assert.ok(pls.length >= 1, 'should find TLAK with X turns');
});

test('findPlacements LOLO straight 4 tiles', () => {
  const lv = parseLevel('4\n1\nLOLO');
  assert.equal(lv.ok, true);
  const cells = makeBoard(lv.level);
  const pls = findPlacements(cells, 'LOLO', 4, 1);
  assert.ok(pls.length >= 1, 'LOLO straight should be found');
});
