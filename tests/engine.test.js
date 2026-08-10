import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBoard, blackout, isSolved, boardKey, canBeCrossed, WORD_LIBRARY } from '../src/engine.js';
import { parseLevel } from '../src/parse.js';
import { solve, findPlacements, applyWord, probeOlko } from '../src/solver.js';

test('blackout with onion hp', () => {
  let c = { x: 0, y: 0, type: 'letter', letter: 'L', hp: 2, blacked: false };
  c = blackout(c); assert.equal(c.blacked, false); assert.equal(c.hp, 1);
  c = blackout(c); assert.equal(c.blacked, false); assert.equal(c.hp, 0);
  c = blackout(c); assert.equal(c.blacked, true);
});

test('isSolved basic', () => {
  const lv = parseLevel('3\n2\nLOK\n-#-');
  const cells = makeBoard(lv.level);
  assert.equal(isSolved(cells), false);
});

test('solve world 1 level 1', () => {
  const lv = parseLevel('3\n2\nLOK\n-#-');
  const res = solve({ ...lv.level, world: 1, level: 1, hints: ['LOK'] });
  assert.equal(res.status, 'solved');
  assert.ok(res.steps.length >= 1);
});

test('solve level with onion (10-1 L**O*K**)', () => {
  const lv = parseLevel('3\n1\nL**O*K**');
  const res = solve({ ...lv.level, world: 10, level: 1, hints: ['LOK','LOK'] }, { timeMs: 8000 });
  assert.equal(res.status, 'solved', JSON.stringify(res));
});

test('solve TLAK with same-line extras (2-3)', () => {
  const ascii = '7\n6\n--#-T--\n--T-L--\n--L-#--\nLOA###K\n--K-A--\n----K--';
  const lv = parseLevel(ascii);
  assert.equal(lv.ok, true, lv.message);
  const res = solve({ ...lv.level, world: 2, level: 3, hints: ['TLAK','TLAK','LOK'] }, { timeMs: 10000 });
  assert.equal(res.status, 'solved', JSON.stringify(res));
});

test('TA global blackout includes X', () => {
  // 6-1
  const ascii = '4\n5\nTLX-\n--X-\nLOX-\n--XX\n-KAX';
  const lv = parseLevel(ascii);
  const res = solve({ ...lv.level, world: 6, level: 1, hints: ['LOK','TA'] }, { timeMs: 10000 });
  assert.equal(res.status, 'solved', JSON.stringify(res));
});

test('OLKO probe finds 8-18', () => {
  const ascii = '8\n8\n-----?--\n-----??-\n---T-???\n-M--U---\n---I----\n#L#-----\n#-O-?---\n###-----';
  const lv = parseLevel(ascii);
  const r = probeOlko({ ...lv.level, world: 8 });
  assert.equal(r.possible, true);
});

test('word library sanity', () => {
  assert.ok(WORD_LIBRARY.LOK.extra === 1);
  assert.ok(WORD_LIBRARY.TLAK.extra === 2);
});
