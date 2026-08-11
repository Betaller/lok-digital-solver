// ui.js - main UI glue: tabs, level library, import, solve results.
// Depends on: parse, engine, solver, solver-mono, animate, draw, data.

import { LEVELS, LEVELS_SOURCE_VERSION } from '../data/levels.js';
import { parseLevel, exportLevel } from './parse.js';
import { makeBoard, isSolved, boardKey, cellAt } from './engine.js';
import { solve, probeOlko } from './solver.js';
import { solveMonuments } from './solver-mono.js';
import { solveArrows } from './solver-arrows.js';
import { animateSteps, renderBoard } from './animate.js';
import { createDrawTool } from './draw.js';
import { generatePuzzle } from './generator.js';

const WORLD_NAMES = {
  1:'LOK',2:'TLAK',3:'TA',4:'X',5:'BE',6:'GAPS',7:'LOLO',8:'QUESTION',9:'GRIVA',
  10:'ONIONS',11:'ABA',12:'ARROWS',13:'MONUMENTS',14:'CLOUDS',
};

let currentLevel = null;      // parsed Level (may be from library or import)
let currentMeta = null;       // {world, level, name, hints}
let resultState = null;       // {status, steps, ...}
let activeWorld = 1;

const $ = sel => document.querySelector(sel);

export function initUI() {
  buildTabs();
  buildWorldSelect();
  buildLevelGrid();
  bindImport();
  createDrawTool({
    onExport: ascii => { $('#draw-ascii').value = ascii; },
    onSolve: solveFromAscii,
  });
  $('#btn-import-solve').addEventListener('click', () => solveFromTextarea());
  $('#btn-import-probe').addEventListener('click', () => probeFromTextarea());
  $('#btn-import-file').addEventListener('click', () => $('#file-input').click());
  $('#btn-generate').addEventListener('click', onGeneratePuzzle);
  $('#file-input').addEventListener('change', onFileSelected);
  $('#btn-load-sample').addEventListener('click', loadSample);
  bindResultControls();
  // default: load world 1 level 1
  loadLibraryLevel(1, 1);
}

function buildTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $('#' + btn.dataset.tab.replace('panel-', 'panel-')).classList.add('active');
      $('#' + btn.dataset.tab + '-panel').classList.add('active');
    });
  });
  // simpler: data-tab maps to panel id
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.tab;
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const panel = document.getElementById('panel-' + id);
      if (panel) panel.classList.add('active');
    });
  });
}

function buildWorldSelect() {
  const wrap = $('#world-select');
  wrap.innerHTML = '';
  for (const w of Object.keys(WORLD_NAMES).map(Number)) {
    const b = document.createElement('button');
    b.className = 'wbtn' + (w === activeWorld ? ' active' : '');
    b.textContent = `${w}: ${WORLD_NAMES[w]}`;
    b.addEventListener('click', () => { activeWorld = w; buildWorldSelect(); buildLevelGrid(); });
    wrap.appendChild(b);
  }
}

function buildLevelGrid() {
  const grid = $('#level-grid');
  grid.innerHTML = '';
  const lvls = LEVELS.filter(l => l.world === activeWorld);
  for (const l of lvls) {
    const b = document.createElement('button');
    b.className = 'level-btn';
    b.textContent = l.level;
    const s = document.createElement('small');
    s.textContent = l.name || '';
    b.appendChild(s);
    b.title = `${l.world}-${l.level} ${l.name}`;
    b.addEventListener('click', () => loadLibraryLevel(l.world, l.level));
    grid.appendChild(b);
  }
  // load first
  if (lvls.length) loadLibraryLevel(activeWorld, lvls[0].level);
}

function loadLibraryLevel(world, level) {
  const l = LEVELS.find(x => x.world === world && x.level === level);
  if (!l) return;
  const pr = parseLevel(l.ascii);
  if (!pr.ok) { showError($('#import-err'), pr.message); return; }
  currentLevel = { ...pr.level, world, level, hints: l.hints, name: l.name, olko: l.olko };
  currentMeta = { world, level, name: l.name, hints: l.hints, advanced: l.advanced, olko: l.olko };
  // preview
  const prev = $('#level-preview');
  prev.innerHTML = '';
  prev.appendChild(renderBoard(currentLevel));
  const info = document.createElement('div');
  info.className = 'toolbar';
  info.innerHTML = '';
  const t = document.createElement('span');
  t.textContent = `世界 ${world}（${WORLD_NAMES[world]}）第 ${level} 关 · ${l.name || ''} · 提示词: ${(l.hints||[]).join(', ') || '无'}`;
  info.appendChild(t);
  const solveBtn = document.createElement('button');
  solveBtn.textContent = '求解';
  solveBtn.className = 'primary';
  solveBtn.addEventListener('click', () => runSolve(currentLevel));
  info.appendChild(solveBtn);
  const olkoBtn = document.createElement('button');
  olkoBtn.textContent = '探测 OLKO';
  olkoBtn.addEventListener('click', () => runOlko(currentLevel));
  info.appendChild(olkoBtn);
  prev.appendChild(info);
}

// ---------------------------------------------------------------- solving

function runSolve(level) {
  $('#result-status').textContent = '求解中…';
  $('#result-drawer').hidden = false;
  $('#result-progress').textContent = '';
  $('#solve-board').innerHTML = '';
  $('#step-list').innerHTML = '';
  // run async (chunked) to avoid blocking
  setTimeout(() => {
    let res;
    if (level.world === 13) {
      res = solveMonuments(level);
    } else if (level.world === 12) {
      res = solveArrows(level);
    } else {
      res = solve(level, { timeMs: 12000, nodeLimit: 4000000 });
      if (res.status !== 'solved') {
        res = solve(level, { timeMs: 12000, nodeLimit: 4000000, taQ: true });
      }
    }
    showResult(level, res);
  }, 10);
}

function showResult(level, res) {
  const status = $('#result-status');
  const prog = $('#result-progress');
  resultState = { level, res };
  if (res.status === 'solved') {
    status.textContent = '✓ 已找到解';
    status.style.color = 'var(--good)';
    prog.textContent = `${res.steps.length} 步`;
    const wrap = $('#solve-board');
    wrap.innerHTML = '';
    wrap.appendChild(renderBoard(level));
    const play = animateSteps(wrap.querySelector('.board'), level, res.steps);
    window.__play = play;
    renderSteps(res.steps);
    $('#btn-play').onclick = () => play.play();
    $('#btn-pause').onclick = () => play.pause();
    $('#btn-prev').onclick = () => play.prev();
    $('#btn-next').onclick = () => play.next();
    $('#btn-reset').onclick = () => play.reset();
    $('#speed').oninput = e => play.setSpeed(parseFloat(e.target.value));
    bindStepListClick(play);
  } else if (res.status === 'timeout') {
    status.textContent = '⚠ 未在时限内找到解（可能无解或过难）';
    status.style.color = 'var(--warn)';
    prog.textContent = res.reason || '';
  } else if (res.status === 'exhausted_no_solution') {
    status.textContent = '✗ 已穷尽搜索，确认无解';
    status.style.color = 'var(--bad)';
  } else if (res.status === 'unsupported') {
    status.textContent = `暂不支持：${res.reason}`;
    status.style.color = 'var(--warn)';
  }
}

function runOlko(level) {
  const r = probeOlko(level);
  const status = $('#result-status');
  $('#result-drawer').hidden = false;
  $('#solve-board').innerHTML = '';
  $('#step-list').innerHTML = '';
  if (r.possible) {
    status.textContent = `✓ 本关可以拼出 OLKO（${r.placements.length} 种拼法）`;
    status.style.color = 'var(--good)';
    const ol = document.createElement('ol');
    for (const p of r.placements) {
      const li = document.createElement('li');
      li.textContent = p.text;
      ol.appendChild(li);
    }
    $('#step-list').appendChild(ol);
  } else {
    status.textContent = '✗ 本关无法拼出 OLKO';
    status.style.color = 'var(--bad)';
  }
}

// ---------------------------------------------------------------- import

function bindImport() {
  // (bound in initUI)
}

function solveFromTextarea() {
  const text = $('#import-text').value;
  const pr = parseLevel(text);
  if (!pr.ok) { showError($('#import-err'), pr.message); return; }
  hideError($('#import-err'));
  currentLevel = { ...pr.level, world: 0, level: 0, hints: [], name: '自定义' };
  currentMeta = null;
  runSolve(currentLevel);
}

function probeFromTextarea() {
  const text = $('#import-text').value;
  const pr = parseLevel(text);
  if (!pr.ok) { showError($('#import-err'), pr.message); return; }
  hideError($('#import-err'));
  currentLevel = { ...pr.level, world: 0, level: 0, hints: [], name: '自定义' };
  runOlko(currentLevel);
}

function solveFromAscii(ascii) {
  const pr = parseLevel(ascii);
  if (!pr.ok) { alert(pr.message); return; }
  currentLevel = { ...pr.level, world: 0, level: 0, hints: [], name: '画题' };
  runSolve(currentLevel);
}

function onFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 64 * 1024) { showError($('#import-err'), '文件超过 64KB 上限'); return; }
  const reader = new FileReader();
  reader.onload = () => { $('#import-text').value = String(reader.result); hideError($('#import-err')); };
  reader.onerror = () => showError($('#import-err'), '读取文件失败');
  reader.readAsText(file);
  e.target.value = '';
}

function loadSample() {
  $('#import-text').value = '6\n6\n-L---L\n--O-O-\nLOK--\n--A#K-\n--L---\n#-----';
}

// ---------------------------------------------------------------- result controls / steps

function bindResultControls() {
  $('#btn-res-close').addEventListener('click', () => { $('#result-drawer').hidden = true; });
}

function renderSteps(steps) {
  const ol = $('#step-list');
  ol.innerHTML = '';
  steps.forEach((s, i) => {
    const li = document.createElement('li');
    li.textContent = `${i + 1}. ${s.text || ''}`;
    li.dataset.step = i;
    ol.appendChild(li);
  });
}

function bindStepListClick(play) {
  const ol = $('#step-list');
  ol.onclick = (e) => {
    const li = e.target.closest('li');
    if (li && li.dataset.step !== undefined) {
      play.seekTo(parseInt(li.dataset.step, 10));
    }
  };
}

function onGeneratePuzzle() {
  const cols = parseInt($('#draw-cols')?.value || 6, 10);
  const rows = parseInt($('#draw-rows')?.value || 6, 10);
  const opts = { cols, rows, wordCount: 2 + rnd(2), attempts: 50 };
  const p = generatePuzzle(opts);
  if (!p) { showError($('#import-err'), '生成失败，请重试'); return; }
  hideError($('#import-err'));
  $('#import-text').value = p.ascii;
  currentLevel = { ...p.level, world: 0, level: 0, hints: [], name: '\u968f\u673a\u751f\u6210' };
  currentMeta = null;
  runSolve(currentLevel);
}

function rnd(n) { return Math.floor(Math.random() * n); }

function showError(el, msg) {
  el.textContent = msg;
  el.hidden = false;
}
function hideError(el) { el.hidden = true; el.textContent = ''; }

export { WORLD_NAMES };
