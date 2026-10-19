'use strict';

/* ================= 常量与配置 ================= */
const ROWS = 8, COLS = 8, N = 6;
const GEMS = ['🍓', '🍊', '🍇', '🍏', '🍋', '🫐'];
const GEM_NAMES = ['草莓', '橙子', '葡萄', '青苹果', '柠檬', '蓝莓'];
const GEM_COLORS = ['#ff5a76', '#ff9f43', '#a55eea', '#2ecc71', '#feca57', '#4b7bec'];
const SPECIAL_META = {
  lineH: { label: '横行火箭', icon: '↔️' },
  lineV: { label: '竖列火箭', icon: '↕️' },
  bomb: { label: '炸弹', icon: '💣' },
  rainbow: { label: '彩虹', icon: '🌈' }
};
const DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0]];
const CLEAR_MS = 230, FALL_MS = 210;

const MODES = {
  classic: { name: '经典模式', moves: 24, target: 3000 },
  rush: { name: '限时模式', time: 60 },
  collect: { name: '收集模式', moves: 22 },
  trial: { name: '挑战模式', moves: 22 }
};

/* ================= 状态 ================= */
let grid = [];
let els = new Map();
let gid = 0;
let cellSize = 0;

let mode = 'classic';
let running = false;
let busy = false;
let gameOver = false;

let score = 0;
let moves = 0;
let timeLeft = 0;
let timerId = null;
let level = 1;
let targetScore = 0;
let collectRemain = [];
let lastSwapA = null, lastSwapB = null;
let sel = null;
let muted = localStorage.getItem('m3_muted') === '1';

const ui = {};

/* ================= 小工具 ================= */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const key = p => p.r + ',' + p.c;
const isGem = g => !!g && !g.stone;
const rand = n => Math.floor(Math.random() * n);
const shuffleArr = a => { for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const mkGem = type => ({ id: ++gid, type, special: null, frozen: false, locked: false });
const mkStone = () => ({ id: ++gid, stone: true });

/* ================= 音效 ================= */
let ac = null;
function ensureCtx() {
  if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (ac && ac.state === 'suspended') ac.resume();
}
function unlockAudio() { ensureCtx(); }
function beep(freq, dur, type = 'sine', vol = 0.12, delay = 0) {
  if (muted) return;
  ensureCtx();
  if (!ac) return;
  const t = ac.currentTime + delay;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(ac.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
function noiseBurst(dur = 0.3, vol = 0.15) {
  if (muted) return;
  ensureCtx();
  if (!ac) return;
  const t = ac.currentTime;
  const n = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ac.createBufferSource(); src.buffer = buf;
  const g = ac.createGain(); g.gain.value = vol;
  const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
  src.connect(f); f.connect(g); g.connect(ac.destination);
  src.start(t);
}
const sndSwap = () => beep(300, 0.08, 'triangle', 0.08);
const sndFail = () => beep(140, 0.15, 'sawtooth', 0.06);
const sndMatch = c => { beep(420 + c * 55, 0.14, 'sine', 0.12); beep(420 + c * 55, 0.14, 'sine', 0.08, 0.03); };
const sndSpecialFire = sp => {
  if (sp === 'bomb') { noiseBurst(0.3, 0.18); beep(120, 0.28, 'sawtooth', 0.12); }
  else if (sp === 'rainbow') { [660, 780, 990, 1320, 1650].forEach((f, i) => beep(f, 0.14, 'sine', 0.09, i * 0.045)); }
  else { beep(540, 0.1, 'square', 0.07); beep(760, 0.16, 'square', 0.06, 0.05); }
};
const sndSpawn = () => { beep(700, 0.1, 'sine', 0.09); beep(1050, 0.14, 'sine', 0.07, 0.06); };
const sndClick = () => beep(240, 0.06, 'triangle', 0.06);
const sndShuffle = () => { for (let i = 0; i < 5; i++) beep(280 + i * 130, 0.06, 'triangle', 0.06, i * 0.05); };
const sndDropFx = () => beep(200, 0.05, 'sine', 0.04);
const sndIceBreak = () => { noiseBurst(0.12, 0.06); beep(1500, 0.08, 'triangle', 0.07); };
const sndLockBreak = () => beep(520, 0.09, 'square', 0.06);
const sndCountdown = () => { beep(880, 0.07, 'square', 0.08); beep(880, 0.07, 'square', 0.08, 0.12); };
const sndCollect = () => { beep(660, 0.1, 'sine', 0.1); beep(880, 0.15, 'sine', 0.09, 0.07); };
const sndWin = () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.22, 'sine', 0.12, i * 0.12));
const sndLose = () => [400, 330, 260, 200].forEach((f, i) => beep(f, 0.25, 'sine', 0.1, i * 0.13));

/* ================= 棋盘生成 ================= */
function randomTypeFor(r, c) {
  const bad = new Set();
  if (c >= 2 && isGem(grid[r][c - 1]) && isGem(grid[r][c - 2]) && grid[r][c - 1].type === grid[r][c - 2].type) bad.add(grid[r][c - 1].type);
  if (r >= 2 && isGem(grid[r - 1][c]) && isGem(grid[r - 2][c]) && grid[r - 1][c].type === grid[r - 2][c].type) bad.add(grid[r - 1][c].type);
  let t;
  do { t = rand(N); } while (bad.has(t) && bad.size < N);
  return t;
}

function initBoard(opts = {}) {
  grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      grid[r][c] = mkGem(randomTypeFor(r, c));
    }
  }
  // 挑战模式障碍
  if (opts.obstacles) {
    placeObstacles(opts.ice, opts.locked, opts.stone);
  }
}

function placeObstacles(ice, locked, stone) {
  const cells = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cells.push({ r, c });
  shuffleArr(cells);
  let i = 0;
  const take = n => { const out = []; while (i < cells.length && out.length < n) out.push(cells[i++]); return out; };
  take(stone).forEach(p => { grid[p.r][p.c] = mkStone(); });
  take(ice).forEach(p => { if (grid[p.r][p.c] && !grid[p.r][p.c].stone) grid[p.r][p.c].frozen = true; });
  take(locked).forEach(p => { if (grid[p.r][p.c] && !grid[p.r][p.c].stone) grid[p.r][p.c].locked = true; });
}

/* ================= 匹配检测 ================= */
function detectMatches() {
  const cells = new Set();
  for (let r = 0; r < ROWS; r++) {
    let c = 0;
    while (c < COLS) {
      const g = grid[r][c];
      if (!isGem(g)) { c++; continue; }
      let end = c;
      while (end + 1 < COLS && isGem(grid[r][end + 1]) && grid[r][end + 1].type === g.type) end++;
      if (end - c + 1 >= 3) { for (let k = c; k <= end; k++) cells.add(r + ',' + k); }
      c = end + 1;
    }
  }
  for (let c = 0; c < COLS; c++) {
    let r = 0;
    while (r < ROWS) {
      const g = grid[r][c];
      if (!isGem(g)) { r++; continue; }
      let end = r;
      while (end + 1 < ROWS && isGem(grid[end + 1][c]) && grid[end + 1][c].type === g.type) end++;
      if (end - r + 1 >= 3) { for (let k = r; k <= end; k++) cells.add(k + ',' + c); }
      r = end + 1;
    }
  }
  const comps = [];
  const visited = new Set();
  for (const k of cells) {
    if (visited.has(k)) continue;
    const q = [k]; visited.add(k); const comp = [];
    while (q.length) {
      const cur = q.pop();
      const [r, c] = cur.split(',').map(Number);
      comp.push({ r, c });
      const g = grid[r][c];
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= ROWS || nc >= COLS) continue;
        const ng = grid[nr][nc];
        if (!isGem(ng) || ng.type !== g.type) continue;
        const nk = nr + ',' + nc;
        if (cells.has(nk) && !visited.has(nk)) { visited.add(nk); q.push(nk); }
      }
    }
    comps.push(comp);
  }
  return { cells, comps };
}

function hasMatch() { return detectMatches().cells.size > 0; }

/* ================= 特殊合成判定 ================= */
function originFor(comp, preferred) {
  if (lastSwapA && comp.some(p => p.r === lastSwapA.r && p.c === lastSwapA.c)) return lastSwapA;
  if (lastSwapB && comp.some(p => p.r === lastSwapB.r && p.c === lastSwapB.c)) return lastSwapB;
  if (preferred) return preferred;
  return comp[Math.floor(comp.length / 2)];
}

function specialInfo(comp) {
  const set = new Set(comp.map(p => key(p)));
  let maxH = 0, maxV = 0, inter = null;
  for (const p of comp) {
    let h = 1, cc = p.c - 1;
    while (cc >= 0 && set.has(p.r + ',' + cc)) { h++; cc--; }
    cc = p.c + 1;
    while (cc < COLS && set.has(p.r + ',' + cc)) { h++; cc++; }
    let v = 1, rr = p.r - 1;
    while (rr >= 0 && set.has(rr + ',' + p.c)) { v++; rr--; }
    rr = p.r + 1;
    while (rr < ROWS && set.has(rr + ',' + p.c)) { v++; rr++; }
    maxH = Math.max(maxH, h); maxV = Math.max(maxV, v);
    if (h >= 3 && v >= 3) inter = p;
  }
  if (inter) return { type: 'bomb', origin: originFor(comp, inter) };
  if (maxH >= 5 || maxV >= 5) return { type: 'rainbow', origin: originFor(comp, null) };
  if (maxH >= 4) return { type: 'lineH', origin: originFor(comp, null) };
  if (maxV >= 4) return { type: 'lineV', origin: originFor(comp, null) };
  return { type: 'none' };
}

/* ================= 消除范围 ================= */
function mostFrequentType() {
  const cnt = new Array(N).fill(0);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const g = grid[r][c]; if (isGem(g)) cnt[g.type]++;
  }
  let t = 0; for (let i = 1; i < N; i++) if (cnt[i] > cnt[t]) t = i;
  return t;
}

function specialArea(g, r, c) {
  const res = [];
  if (g.special === 'lineH') { for (let cc = 0; cc < COLS; cc++) res.push({ r, c: cc }); }
  else if (g.special === 'lineV') { for (let rr = 0; rr < ROWS; rr++) res.push({ r: rr, c }); }
  else if (g.special === 'bomb') {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) res.push({ r: rr, c: cc });
    }
  }
  else if (g.special === 'rainbow') {
    const t = mostFrequentType();
    for (let rr = 0; rr < ROWS; rr++) for (let cc = 0; cc < COLS; cc++) {
      const gg = grid[rr][cc]; if (isGem(gg) && gg.type === t) res.push({ r: rr, c: cc });
    }
  }
  return res;
}

function computeClearEffect(seed) {
  const clear = new Set();
  const queue = [...seed];
  const processed = new Set();
  while (queue.length) {
    const k = queue.pop();
    if (clear.has(k)) continue;
    const [r, c] = k.split(',').map(Number);
    const g = grid[r][c];
    if (!g) continue;
    clear.add(k);
    if (g.stone) continue;
    if (g.special && !processed.has(k)) {
      processed.add(k);
      for (const cc of specialArea(g, r, c)) {
        const kk = key(cc);
        if (!clear.has(kk)) queue.push(kk);
      }
    }
  }
  return { clear };
}

/* ================= 重力 + 补充 ================= */
function applyGravityAndRefill() {
  for (let c = 0; c < COLS; c++) {
    let write = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      const g = grid[r][c];
      if (!g) continue;
      if (g.stone) { write = r - 1; continue; }
      if (write !== r) { grid[write][c] = g; grid[r][c] = null; }
      write--;
    }
    for (let r = write; r >= 0; r--) { const g = mkGem(randomTypeFor(r, c)); g.new = true; grid[r][c] = g; }
  }
}

/* ================= 渲染 ================= */
function layout() {
  const board = ui.board;
  cellSize = board.clientWidth / COLS;
  board.style.setProperty('--cell', cellSize + 'px');
}

function createGemEl() {
  const el = document.createElement('div');
  el.className = 'cell';
  el.innerHTML = '<span class="face"></span><span class="badge"></span>';
  ui.board.appendChild(el);
  return el;
}

function syncEl(el, g, r, c) {
  const size = cellSize - 6;
  el.style.width = size + 'px';
  el.style.height = size + 'px';
  el.style.left = (c * cellSize + 3) + 'px';
  el.style.top = (r * cellSize + 3) + 'px';
  let cls = 'cell';
  if (g.stone) cls += ' stone';
  else {
    cls += ' gem t' + g.type;
    if (g.special) cls += ' special ' + g.special;
    if (g.frozen) cls += ' frozen';
    if (g.locked) cls += ' locked';
    if (g.new) cls += ' drop';
    if (g.spawned) cls += ' spawn-pop';
  }
  el.className = cls;
  el.querySelector('.face').textContent = g.stone ? '🪨' : GEMS[g.type];
  const badge = g.special ? SPECIAL_META[g.special].icon : (g.locked ? '🔒' : (g.frozen ? '❄️' : ''));
  el.querySelector('.badge').textContent = badge;
  if (g.new) delete g.new;
  if (g.spawned) delete g.spawned;
}

function render() {
  const seen = new Set();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const g = grid[r][c]; if (!g) continue;
    seen.add(g.id);
    let el = els.get(g.id);
    if (!el) { el = createGemEl(); els.set(g.id, el); }
    syncEl(el, g, r, c);
  }
  for (const [id, el] of els) if (!seen.has(id)) { el.remove(); els.delete(id); }
  applySelection();
}

function applySelection() {
  if (!sel) return;
  const g = grid[sel.r] && grid[sel.r][sel.c];
  if (g) { const el = els.get(g.id); if (el) el.classList.add('sel'); }
}

function setSel(cell) {
  clearSel();
  sel = cell;
  sndClick();
  applySelection();
}
function clearSel() {
  if (sel) {
    const g = grid[sel.r] && grid[sel.r][sel.c];
    if (g) { const el = els.get(g.id); if (el) el.classList.remove('sel'); }
    sel = null;
  }
}

/* ================= 消除流程 ================= */
function prepareMatch(cells, comps) {
  const seed = new Set(); const spawns = []; const unlocks = [];
  for (const comp of comps) {
    const g0 = grid[comp[0].r][comp[0].c];
    const info = specialInfo(comp);
    let origin = null;
    if (info.type !== 'none') { origin = info.origin; spawns.push({ r: origin.r, c: origin.c, special: info.type, type: g0.type }); }
    for (const p of comp) {
      const g = grid[p.r][p.c];
      if (!isGem(g)) continue;
      if (g.locked) { unlocks.push({ r: p.r, c: p.c }); continue; }
      if (origin && p.r === origin.r && p.c === origin.c) continue;
      seed.add(key(p));
    }
  }
  return { seed, spawns, unlocks };
}

function clearCenter(clear) {
  let sx = 0, sy = 0, n = 0;
  for (const k of clear) { const [r, c] = k.split(',').map(Number); sx += c; sy += r; n++; }
  if (!n) return { x: 0, y: 0 };
  return { x: (sx / n + 0.5) * cellSize, y: (sy / n + 0.5) * cellSize };
}

function spawnParticles(el, g) {
  const color = g.stone ? '#9b8fb0' : GEM_COLORS[g.type];
  const rect = el.getBoundingClientRect();
  const brd = ui.board.getBoundingClientRect();
  const x = rect.left - brd.left + rect.width / 2;
  const y = rect.top - brd.top + rect.height / 2;
  const count = g.stone ? 6 : 12;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = cellSize * (0.1 + Math.random() * 0.2);
    p.style.width = p.style.height = size + 'px';
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    p.style.background = color;
    const ang = Math.random() * Math.PI * 2;
    const dist = cellSize * (0.6 + Math.random() * 1.3);
    p.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
    p.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
    ui.board.appendChild(p);
    p.addEventListener('animationend', () => p.remove());
  }
}

function spawnScoreFloat(clear, val) {
  const { x, y } = clearCenter(clear);
  const s = document.createElement('div');
  s.className = 'scorefloat';
  s.textContent = '+' + val;
  s.style.left = x + 'px';
  s.style.top = y + 'px';
  ui.board.appendChild(s);
  s.addEventListener('animationend', () => s.remove());
}

async function animateClear(clear) {
  for (const k of clear) {
    const [r, c] = k.split(',').map(Number);
    const g = grid[r][c];
    if (!g) continue;
    const el = els.get(g.id);
    if (el) {
      el.classList.add('poof');
      spawnParticles(el, g);
      if (g.special) sndSpecialFire(g.special);
      else if (g.locked) sndLockBreak();
      else if (g.frozen) sndIceBreak();
    }
  }
  await sleep(CLEAR_MS);
  for (const k of clear) {
    const [r, c] = k.split(',').map(Number);
    const g = grid[r][c];
    if (g) { const el = els.get(g.id); if (el) el.remove(); els.delete(g.id); grid[r][c] = null; }
  }
}

function updateTargets(clear) {
  if (mode !== 'collect') return;
  let changed = false;
  for (const k of clear) {
    const [r, c] = k.split(',').map(Number);
    const g = grid[r][c];
    if (!isGem(g)) continue;
    const t = collectRemain.find(x => x.type === g.type);
    if (t && t.left > 0) { t.left--; changed = true; if (t.left === 0) sndCollect(); }
  }
  if (changed) renderTargets();
}

function collectDone() {
  return mode === 'collect' && collectRemain.every(t => t.left <= 0);
}

async function resolve(initialSeed = null) {
  let combo = 0;
  let seed = initialSeed;
  while (true) {
    let spawns = [], unlocks = [];
    if (!seed) {
      const { cells, comps } = detectMatches();
      if (cells.size === 0) break;
      const prep = prepareMatch(cells, comps);
      seed = prep.seed; spawns = prep.spawns; unlocks = prep.unlocks;
    }
    const { clear } = computeClearEffect(seed);
    const finalUnlocks = unlocks.filter(p => !clear.has(key(p)));
    sndMatch(combo);
    if (combo > 0) showCombo(combo + 1);
    updateTargets(clear);
    await animateClear(clear);
    for (const p of finalUnlocks) { const g = grid[p.r][p.c]; if (isGem(g)) g.locked = false; }
    for (const s of spawns) {
      const ng = mkGem(s.type);
      ng.special = s.special;
      ng.spawned = true;
      grid[s.r][s.c] = ng;
      showBanner(s.special);
      sndSpawn();
    }
    applyGravityAndRefill();
    render();
    sndDropFx();
    await sleep(FALL_MS);
    combo++;
    const gained = clear.size * 10 * combo;
    score += gained;
    updateHud();
    spawnScoreFloat(clear, gained);
    seed = null;
  }
  lastSwapA = lastSwapB = null;
  return combo;
}

function showCombo(c) {
  const el = ui.combo;
  el.textContent = '连击 x' + c + ' !';
  el.style.fontSize = (38 + Math.min(c, 8) * 4) + 'px';
  el.style.opacity = 1;
  shakeScreen();
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = 0; }, 550);
}

function showBanner(sp) {
  const meta = SPECIAL_META[sp];
  ui.banner.textContent = meta.icon + ' ' + meta.label + ' 合成！';
  ui.banner.classList.remove('show');
  void ui.banner.offsetWidth;
  ui.banner.classList.add('show');
  clearTimeout(ui.banner._t);
  ui.banner._t = setTimeout(() => ui.banner.classList.remove('show'), 900);
}

function shakeScreen() {
  ui.board.classList.remove('shake-screen');
  void ui.board.offsetWidth;
  ui.board.classList.add('shake-screen');
}

/* ================= 交换与移动 ================= */
function swapCells(a, b) {
  const t = grid[a.r][a.c]; grid[a.r][a.c] = grid[b.r][b.c]; grid[b.r][b.c] = t;
}

function isAdjacent(a, b) { return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1; }

function swapBackOrShake(a, b) {
  swapCells(a, b); render();
  const ga = grid[a.r][a.c], gb = grid[b.r][b.c];
  if (ga) { const el = els.get(ga.id); if (el) el.classList.add('shake'); }
  if (gb) { const el = els.get(gb.id); if (el) el.classList.add('shake'); }
  sndFail();
}

async function doSpecialCombo(a, b, ga, gb) {
  let seed = new Set([key(a), key(b)]);
  if (ga.special === 'rainbow' && gb.special === 'rainbow') {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (isGem(grid[r][c])) seed.add(key({ r, c }));
  } else {
    specialArea(ga, a.r, a.c).forEach(p => seed.add(key(p)));
    specialArea(gb, b.r, b.c).forEach(p => seed.add(key(p)));
  }
  const { clear } = computeClearEffect(seed);
  updateTargets(clear);
  await animateClear(clear);
  applyGravityAndRefill();
  render();
  await sleep(FALL_MS);
  score += clear.size * 15;
  updateHud();
  await resolve();
}

async function rainbowWith(rainCell, otherCell, other) {
  const seed = new Set([key(rainCell), key(otherCell)]);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const g = grid[r][c]; if (isGem(g) && g.type === other.type) seed.add(key({ r, c }));
  }
  if (other.special) specialArea(other, otherCell.r, otherCell.c).forEach(p => seed.add(key(p)));
  const { clear } = computeClearEffect(seed);
  updateTargets(clear);
  await animateClear(clear);
  applyGravityAndRefill();
  render();
  await sleep(FALL_MS);
  score += clear.size * 15;
  updateHud();
  await resolve();
}

async function tryMove(a, b, ga, gb) {
  if (ga.special && gb.special) { await doSpecialCombo(a, b, ga, gb); return true; }
  if (ga.special === 'rainbow') { await rainbowWith(a, b, gb); return true; }
  if (gb.special === 'rainbow') { await rainbowWith(b, a, ga); return true; }

  swapCells(a, b);
  lastSwapA = a; lastSwapB = b;
  sndSwap();
  render();
  if (hasMatch()) { await resolve(); return true; }
  await sleep(60);
  swapBackOrShake(a, b);
  await sleep(220);
  return false;
}

async function attemptMove(a, b) {
  if (busy || gameOver || !running) return;
  const ga = grid[a.r][a.c], gb = grid[b.r][b.c];
  if (!ga || !gb || ga.stone || gb.stone) return;
  if (ga.frozen || gb.frozen || ga.locked || gb.locked) {
    const fa = els.get(ga.id), fb = els.get(gb.id);
    if (fa) fa.classList.add('shake');
    if (fb) fb.classList.add('shake');
    sndFail();
    setTimeout(() => { if (fa) fa.classList.remove('shake'); if (fb) fb.classList.remove('shake'); }, 200);
    return;
  }
  busy = true;
  const ok = await tryMove(a, b, ga, gb);
  if (ok) {
    if (mode !== 'rush') { moves--; updateHud(); }
    evaluateEnd();
  }
  busy = false;
  if (!gameOver && ok) await ensureMoves();
}

/* ================= 无路可走时洗牌 ================= */
function hasAnyMove() {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const ga = grid[r][c];
    if (!isGem(ga)) continue;
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= ROWS || nc >= COLS) continue;
      const gb = grid[nr][nc];
      if (!isGem(gb)) continue;
      swapCells({ r, c }, { r: nr, c: nc });
      const m = hasMatch();
      swapCells({ r, c }, { r: nr, c: nc });
      if (m) return true;
    }
  }
  return false;
}

function shuffleUntilMovable() {
  let tries = 0;
  do {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const g = grid[r][c];
      if (isGem(g) && !g.frozen && !g.locked) { g.type = rand(N); g.special = null; }
    }
    tries++;
  } while ((hasMatch() || !hasAnyMove()) && tries < 500);
}

async function ensureMoves() {
  if (hasAnyMove()) return;
  toast('没有可消除的组合，自动洗牌');
  sndShuffle();
  shakeScreen();
  shuffleUntilMovable();
  render();
  await sleep(300);
}

/* ================= 提示 ================= */
function findHint() {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const ga = grid[r][c];
    if (!isGem(ga) || ga.frozen || ga.locked) continue;
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= ROWS || nc >= COLS) continue;
      const gb = grid[nr][nc];
      if (!isGem(gb) || gb.frozen || gb.locked) continue;
      swapCells({ r, c }, { r: nr, c: nc });
      const m = hasMatch();
      swapCells({ r, c }, { r: nr, c: nc });
      if (m) return [{ r, c }, { r: nr, c: nc }];
    }
  }
  return null;
}

function doHint() {
  if (busy || gameOver || !running) return;
  const h = findHint();
  if (!h) { toast('没有可走的路'); return; }
  const [a, b] = h;
  const ea = els.get(grid[a.r][a.c].id), eb = els.get(grid[b.r][b.c].id);
  if (ea) ea.classList.add('sel');
  if (eb) eb.classList.add('sel');
  setTimeout(() => { if (ea) ea.classList.remove('sel'); if (eb) eb.classList.remove('sel'); }, 900);
}

/* ================= HUD / UI ================= */
function updateHud() {
  ui.hScore.textContent = score;
  if (mode !== 'rush') ui.hMoves.textContent = moves;
  if (mode === 'rush') {
    ui.hTime.textContent = timeLeft;
    ui.hTime.classList.toggle('low', timeLeft <= 5 && timeLeft >= 0);
  }
}

function renderTargets() {
  const box = ui.targets;
  if (mode !== 'collect') { box.innerHTML = ''; return; }
  box.innerHTML = '';
  for (const t of collectRemain) {
    const d = document.createElement('div');
    d.className = 'target' + (t.left <= 0 ? ' done' : '');
    d.innerHTML = `<span>${GEMS[t.type]}</span><span class="ct">${Math.max(0, t.left)}</span>`;
    box.appendChild(d);
  }
}

function toast(msg) {
  ui.toast.textContent = msg;
  ui.toast.classList.add('show');
  clearTimeout(ui.toast._t);
  ui.toast._t = setTimeout(() => ui.toast.classList.remove('show'), 1800);
}

/* ================= 结束判定 ================= */
function evaluateEnd() {
  if (mode === 'collect') {
    if (collectDone()) return gameWin();
    if (moves <= 0) return gameLose();
  } else if (mode === 'classic' || mode === 'trial') {
    if (score >= targetScore) return gameWin();
    if (moves <= 0) return gameLose();
  }
}

function gameWin() {
  gameOver = true; stopTimer();
  const win = mode === 'trial';
  ui.resultTitle.textContent = win ? '关卡通过！' : '胜利！';
  ui.resultTitle.style.color = '#7ad0ff';
  ui.resultScore.textContent = score;
  ui.resultSub.textContent = win ? `第 ${level} 关完成，准备好进入下一关了吗？` : '太棒了，你达成了目标！';
  ui.btnNext.style.display = win && level < 3 ? '' : 'none';
  if (level >= 3 && win) ui.btnNext.style.display = 'none';
  ui.overlay.classList.add('show');
  sndWin();
  saveBest();
}

function gameLose() {
  gameOver = true; stopTimer();
  ui.resultTitle.textContent = '挑战失败';
  ui.resultTitle.style.color = '#ff7ad9';
  ui.resultScore.textContent = score;
  ui.resultSub.textContent = mode === 'classic' || mode === 'trial' ? `目标 ${targetScore} 分，还差一点，再试试吧！` : '步数用完了，再试试吧！';
  ui.btnNext.style.display = 'none';
  ui.overlay.classList.add('show');
  sndLose();
  saveBest();
}

function endRush() {
  gameOver = true; stopTimer();
  ui.resultTitle.textContent = '时间到！';
  ui.resultTitle.style.color = '#ffd166';
  ui.resultScore.textContent = score;
  ui.resultSub.textContent = '限时模式以最终得分为准，冲击更高记录吧！';
  ui.btnNext.style.display = 'none';
  ui.overlay.classList.add('show');
  saveBest();
}

function saveBest() {
  const k = 'm3_best_' + mode;
  const prev = +(localStorage.getItem(k) || 0);
  if (score > prev) localStorage.setItem(k, String(score));
}

function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

/* ================= 开始游戏 ================= */
function startGame(m) {
  mode = m;
  stopTimer();
  gameOver = false; busy = false;
  score = 0; level = (m === 'trial') ? level : 1;
  sel = null; lastSwapA = lastSwapB = null;
  els.forEach(el => el.remove()); els.clear();

  let opts = {};
  if (m === 'trial') {
    opts = { obstacles: true, ice: 3 + level * 2, locked: 1 + level, stone: 2 + level * 2 };
    moves = MODES.trial.moves;
    targetScore = 2000 + (level - 1) * 1200;
  } else if (m === 'classic') {
    moves = MODES.classic.moves; targetScore = MODES.classic.target;
  } else if (m === 'rush') {
    timeLeft = MODES.rush.time;
  } else if (m === 'collect') {
    moves = MODES.collect.moves;
    const order = shuffleArr([0, 1, 2, 3, 4, 5]).slice(0, 4);
    collectRemain = order.map(t => ({ type: t, left: 6 + rand(5) }));
  }

  initBoard(opts);

  // 初始有匹配则重来直到无匹配
  let guard = 0;
  while (hasMatch() && guard++ < 50) initBoard(opts);
  if (!hasAnyMove()) shuffleUntilMovable();

  // HUD 显示
  ui.hudMoves.style.display = (m !== 'rush') ? '' : 'none';
  ui.hudTime.style.display = (m === 'rush') ? '' : 'none';
  ui.hudLevel.style.display = (m === 'trial') ? '' : 'none';
  ui.hudTarget.style.display = (m === 'classic' || m === 'trial') ? '' : 'none';
  if (m === 'classic' || m === 'trial') ui.hTarget.textContent = targetScore;
  if (m === 'trial') ui.hLevel.textContent = level;
  if (m !== 'collect') collectRemain = [];

  ui.overlay.classList.remove('show');
  ui.btnNext.style.display = 'none';
  setActiveModeBtn(m);
  renderTargets();
  updateHud();
  render();
  running = true;

  if (m === 'rush') {
    timerId = setInterval(() => {
      if (gameOver) return;
      timeLeft--;
      updateHud();
      if (timeLeft <= 5 && timeLeft > 0) sndCountdown();
      if (timeLeft <= 0) { endRush(); }
    }, 1000);
  }
}

function setActiveModeBtn(m) {
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
}

function restartModes() {
  // 重新开始当前模式（挑战模式从当前关卡重来）
  startGame(mode);
}

function nextLevel() {
  level++;
  startGame('trial');
}

/* ================= 输入 ================= */
function cellFromEvent(e) {
  const rect = ui.board.getBoundingClientRect();
  const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
  const c = Math.floor(x / cellSize), r = Math.floor(y / cellSize);
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
  return { r, c };
}

function onPointerDown(e) {
  if (!running || busy || gameOver) return;
  e.preventDefault();
  const cell = cellFromEvent(e);
  if (!cell) return;
  const g = grid[cell.r][cell.c];
  if (!g) { clearSel(); return; }
  if (sel) {
    if (sel.r === cell.r && sel.c === cell.c) { clearSel(); return; }
    if (isAdjacent(sel, cell)) {
      const from = sel; clearSel();
      attemptMove(from, cell);
      return;
    }
    setSel(cell);
  } else {
    setSel(cell);
  }
}

/* ================= 初始化 ================= */
function bind() {
  ui.board = document.getElementById('board');
  ui.hScore = document.getElementById('h-score');
  ui.hMoves = document.getElementById('h-moves');
  ui.hTime = document.getElementById('h-time');
  ui.hLevel = document.getElementById('h-level');
  ui.hTarget = document.getElementById('h-target');
  ui.hudMoves = document.getElementById('hud-moves');
  ui.hudTime = document.getElementById('hud-time');
  ui.hudLevel = document.getElementById('hud-level');
  ui.hudTarget = document.getElementById('hud-target');
  ui.targets = document.getElementById('targets');
  ui.combo = document.getElementById('combo');
  ui.banner = document.getElementById('banner');
  ui.tip = document.getElementById('tip');
  ui.toast = document.getElementById('toast');
  ui.overlay = document.getElementById('overlay');
  ui.resultTitle = document.getElementById('result-title');
  ui.resultScore = document.getElementById('result-score');
  ui.resultSub = document.getElementById('result-sub');
  ui.btnAgain = document.getElementById('btn-again');
  ui.btnNext = document.getElementById('btn-next');

  document.querySelectorAll('.mode-btn').forEach(b => b.addEventListener('click', () => { level = 1; startGame(b.dataset.mode); }));
  ui.btnAgain.addEventListener('click', restartModes);
  ui.btnNext.addEventListener('click', nextLevel);
  document.getElementById('btn-hint').addEventListener('click', doHint);
  document.getElementById('btn-restart').addEventListener('click', restartModes);
  document.getElementById('btn-mute').addEventListener('click', () => {
    muted = !muted;
    localStorage.setItem('m3_muted', muted ? '1' : '0');
    document.getElementById('btn-mute').textContent = muted ? '🔇 音效' : '🔊 音效';
  });
  document.getElementById('btn-mute').textContent = muted ? '🔇 音效' : '🔊 音效';

  ui.board.addEventListener('pointerdown', onPointerDown);
  ui.board.addEventListener('touchstart', e => { if (e.touches.length === 1) { /* pointerdown 会处理 */ } }, { passive: false });

  window.addEventListener('resize', () => { layout(); render(); });
}

window.addEventListener('DOMContentLoaded', () => {
  bind();
  layout();
  startGame('classic');
});