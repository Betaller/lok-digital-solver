import { LEVELS } from '../data/levels.js';
import { parseLevel } from '../src/parse.js';
import { solve, probeOlko } from '../src/solver.js';
import { isSolved, makeBoard } from '../src/engine.js';

function run() {
  let solved = 0, timeout = 0, noSol = 0, unsupported = 0, err = 0;
  const olkoLevels = [];
  const unsupportedList = [];
  for (const l of LEVELS) {
    const pr = parseLevel(l.ascii);
    if (!pr.ok) { console.log('PARSE FAIL', l.world, l.level, pr.message); err++; continue; }
    const level = { ...pr.level, world: l.world, level: l.level, hints: l.hints, name: l.name };
    try {
      const res = solve(level, { timeMs: 3000 });
      if (res.status === 'solved') {
        solved++;
        // verify replay
        let cells = makeBoard(pr.level);
        // (verification happens in tests)
      } else if (res.status === 'timeout') { timeout++; }
      else if (res.status === 'exhausted_no_solution') { noSol++; }
      else { unsupported++; unsupportedList.push(`${l.world}-${l.level}`); }
    } catch (e) { err++; console.log('ERR', l.world, l.level, e.message); }
    // olko probe
    try {
      const o = probeOlko({ ...pr.level, world: l.world });
      if (o.possible) olkoLevels.push(`${l.world}-${l.level}:${o.placements[0].text}`);
    } catch (e) {}
  }
  console.log('total', LEVELS.length);
  console.log('solved', solved, '| timeout', timeout, '| noSolution', noSol, '| unsupported', unsupported, '| errors', err);
  console.log('unsupported:', unsupportedList.join(' '));
  console.log('OLKO possible levels:', olkoLevels.length);
  console.log(olkoLevels.slice(0, 60).join('\n'));
}

run();
