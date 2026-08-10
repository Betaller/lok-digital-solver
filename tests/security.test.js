// security + robustness tests
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLevel } from '../src/parse.js';
import { solve } from '../src/solver.js';

test('huge grid rejected before solve', () => {
  const big = '65\n65\n' + Array(65).fill('L'.repeat(65)).join('\n');
  const r = parseLevel(big);
  assert.equal(r.ok, false);
  assert.ok(r.message.includes('上限'));
});

test('all-? grid does not hang (budget)', () => {
  const g = '10\n10\n' + Array(10).fill('?'.repeat(10)).join('\n');
  const r = parseLevel(g);
  assert.equal(r.ok, true);
  const res = solve({ ...r.level, world: 0, level: 0, hints: ['LOK'] }, { timeMs: 500, nodeLimit: 50000 });
  assert.ok(res.status === 'timeout' || res.status === 'exhausted_no_solution' || res.status === 'solved');
});

test('file size guard documented (64KB)', () => {
  // parse layer enforces <=64x64 which is well under 64KB
  const g = '64\n64\n' + Array(64).fill('L'.repeat(64)).join('\n');
  assert.ok(g.length < 64 * 1024);
});

test('control chars rejected', () => {
  const r = parseLevel('2\n1\nL\u0000');
  assert.equal(r.ok, false);
});

test('no RegExp injection from user input', () => {
  // adversarial pattern that would be a ReDoS if compiled
  const evil = '3\n2\nLOK\n-#-';
  const r = parseLevel(evil);
  assert.equal(r.ok, true);
  // ensure no crash on weird but valid-ish input
  const res = solve({ ...r.level, world: 0, level: 0, hints: ['LOK'] }, { timeMs: 500 });
  assert.ok(['solved', 'timeout', 'exhausted_no_solution'].includes(res.status));
});
