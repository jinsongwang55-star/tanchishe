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
const SPECIAL_COLORS = { lineH: '#7ad0ff', lineV: '#7ad0ff', bomb: '#ff6b6b', rainbow: '#ffffff' };
const BOOSTERS = {
  hammer: { icon: '🔨', label: '爆破锤' },
  bomb: { icon: '💣', label: '炸弹' },
  rocket: { icon: '🎯', label: '瞄准火箭' },
  rainbow: { icon: '🌈', label: '彩虹球' },
  moves: { icon: '➕', label: '加步数', instant: true },
  time: { icon: '⏱', label: '加时器', instant: true },
  doubler: { icon: '✨', label: '双倍分数', instant: true }
};
const BOOSTER_KEYS = Object.keys(BOOSTERS);
const DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0]];
const CLEAR_MS = 230, FALL_MS = 210;

const MODES = {
  classic: { name: '经典模式', moves: 24, target: 3000 },
  rush: { name: '限时模式', time: 60 },
  collect: { name: '收集模式', moves: 22 },
  trial: { name: '挑战模式', moves: 22 },
  infinite: { name: '无限模式' }
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
let drag = null;
let musicTimer = null, musicStep = 0;
let scoreShown = 0;
let muted = localStorage.getItem('m3_muted') === '1';
let boosters = { hammer: 0, bomb: 0, rocket: 0, rainbow: 0 };
let aiming = null;
let doublerUntil = 0, doublerTimer = null;

const ui = {};

/* ================= 小工具 ================= */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const key = p => p.r + ',' + p.c;
const isGem = g => !!g && !g.stone;
const rand = n => Math.floor(Math.random() * n);
const shuffleArr = a => { for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const haptic = () => { try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {} };

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
const sndMatch = c => {
  const base = 420 + c * 60;
  beep(base, 0.14, 'sine', 0.12);
  beep(base, 0.14, 'sine', 0.08, 0.03);
  if (c > 0) { beep(base * 1.25, 0.12, 'triangle', 0.07, 0.05); beep(base * 1.5, 0.14, 'triangle', 0.06, 0.1); }
};
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
function sweep(f0, f1, dur, type = 'sine', vol = 0.1, delay = 0) {
  if (muted) return;
  ensureCtx();
  if (!ac) return;
  const t = ac.currentTime + delay;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(1, f0), t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(ac.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
const sndHammer = () => { noiseBurst(0.16, 0.22); beep(85, 0.2, 'sawtooth', 0.13); beep(50, 0.2, 'square', 0.1, 0.01); };
const sndBombBlast = () => { noiseBurst(0.5, 0.3); beep(80, 0.45, 'sawtooth', 0.14); beep(45, 0.4, 'sine', 0.1, 0.02); };
const sndRocketLaunch = () => { sweep(160, 980, 0.28, 'sawtooth', 0.1); sweep(240, 1400, 0.16, 'square', 0.06, 0.08); };
const sndRainbowBoost = () => [523, 659, 784, 988, 1175, 1397, 1568].forEach((f, i) => beep(f, 0.12, 'sine', 0.08, i * 0.05));
const sndMovesUp = () => { beep(523, 0.09, 'triangle', 0.1); beep(659, 0.1, 'triangle', 0.1, 0.07); beep(784, 0.16, 'triangle', 0.1, 0.14); };
const sndTimeUp = () => { beep(880, 0.06, 'square', 0.08); beep(988, 0.06, 'square', 0.08, 0.1); beep(1175, 0.14, 'triangle', 0.09, 0.2); };
const sndDoublerUp = () => [440, 554, 659, 880, 1109, 1319, 1760].forEach((f, i) => beep(f, 0.14, 'sine', 0.09, i * 0.04));
const sndBoosterDrop = () => { beep(660, 0.08, 'sine', 0.1); beep(880, 0.1, 'sine', 0.09, 0.06); beep(1100, 0.14, 'sine', 0.08, 0.12); };
const sndChain = i => beep(460 + i * 130, 0.08, 'triangle', 0.07);

/* ================= 背景音乐 ================= */
// 轻快愉悦的旋律（C 大调 I–IV–V–I 进行），跳音 + 低音伴奏 + 泛音点缀
const MELODY = [
  523.25, 659.25, 783.99, 659.25,   // C5 E5 G5 E5
  440.00, 523.25, 698.46, 523.25,   // A4 C5 F5 C5
  392.00, 493.88, 587.33, 493.88,   // G4 B4 D5 B4
  659.25, 587.33, 523.25, 523.25    // E5 D5 C5 C5
];
const BASS = [130.81, 174.61, 196.00, 130.81]; // C3 F3 G3 C3
const STEP_MS = 180;
function startMusic() {
  if (musicTimer || muted) return;
  ensureCtx();
  if (!ac) return;
  musicStep = 0;
  musicTimer = setInterval(() => {
    if (muted || !ac) return;
    const f = MELODY[musicStep % MELODY.length];
    beep(f, 0.15, 'triangle', 0.055);                                  // 主旋律跳音
    if (musicStep % 2 === 1) beep(f * 1.5, 0.08, 'sine', 0.02);        // 五度泛音点缀
    if (musicStep % 4 === 0) beep(BASS[(musicStep >> 2) % BASS.length], 0.6, 'triangle', 0.05); // 低音伴奏
    if (musicStep % 8 === 4) beep(f * 2, 0.12, 'sine', 0.02);          // 高八度点缀
    musicStep++;
  }, STEP_MS);
}
function stopMusic() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }

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
  const depth = new Map();
  const processed = new Set();
  for (const k of seed) depth.set(k, 0);
  let chainCount = 0;
  const CHAIN_MAX = 26;
  while (queue.length) {
    const k = queue.pop();
    if (clear.has(k)) continue;
    const [r, c] = k.split(',').map(Number);
    const g = grid[r][c];
    if (!g) continue;
    clear.add(k);
    if (g.stone) continue;
    const d = depth.get(k) || 0;
    if (g.special && !processed.has(k)) {
      processed.add(k);
      for (const cc of specialArea(g, r, c)) {
        const kk = key(cc);
        if (!clear.has(kk)) {
          if (!depth.has(kk)) depth.set(kk, d + 1);
          queue.push(kk);
        }
      }
    } else if (!g.special) {
      // 连锁反应：同色相邻方块以衰减概率引爆，形成链式扩散
      const p = d === 0 ? 0.5 : (d === 1 ? 0.18 : 0);
      if (p <= 0 || chainCount >= CHAIN_MAX) continue;
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= ROWS || nc >= COLS) continue;
        const ng = grid[nr][nc];
        if (!isGem(ng)) continue;
        const nk = nr + ',' + nc;
        if (clear.has(nk) || depth.has(nk)) continue;
        if (ng.special) {
          depth.set(nk, d + 1);
          queue.push(nk);
        } else if (ng.type === g.type && Math.random() < p) {
          depth.set(nk, d + 1);
          chainCount++;
          queue.push(nk);
        }
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
  s.className = 'scorefloat' + (isDoublerActive() ? ' doubler' : '');
  s.textContent = '+' + val;
  s.style.left = x + 'px';
  s.style.top = y + 'px';
  ui.board.appendChild(s);
  s.addEventListener('animationend', () => s.remove());
}

function spawnShockwave(clear, color) {
  const { x, y } = clearCenter(clear);
  const w = document.createElement('div');
  w.className = 'shockwave';
  w.style.left = x + 'px';
  w.style.top = y + 'px';
  const size = cellSize * (1.8 + Math.sqrt(clear.size) * 0.7);
  w.style.width = w.style.height = size + 'px';
  w.style.borderColor = color;
  ui.board.appendChild(w);
  w.addEventListener('animationend', () => w.remove());
}

function flashBoard(sp) {
  const f = document.createElement('div');
  f.className = 'flash';
  f.style.background = 'radial-gradient(circle, rgba(255,255,255,.95) 0%, ' + (SPECIAL_COLORS[sp] || '#ffffff') + ' 45%, transparent 78%)';
  ui.board.appendChild(f);
  f.addEventListener('animationend', () => f.remove());
}

/* ================= 道具华丽特效 ================= */
function cellCenter(cell) {
  return { x: (cell.c + 0.5) * cellSize, y: (cell.r + 0.5) * cellSize };
}
function flashColor(color) {
  const f = document.createElement('div');
  f.className = 'flash';
  f.style.background = 'radial-gradient(circle, rgba(255,255,255,.95) 0%, ' + color + ' 45%, transparent 78%)';
  ui.board.appendChild(f);
  f.addEventListener('animationend', () => f.remove());
}
function emit(x, y, color, count, opts = {}) {
  const spread = opts.spread || 1;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = cellSize * (opts.size || 0.14) * (0.6 + Math.random() * 0.9);
    p.style.width = p.style.height = size + 'px';
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    p.style.background = color;
    if (opts.glow) p.style.boxShadow = '0 0 ' + cellSize * 0.3 + 'px ' + color;
    const ang = opts.angle != null ? opts.angle + (Math.random() - 0.5) * spread : Math.random() * Math.PI * 2;
    const dist = cellSize * (opts.dist || 1.2) * (0.5 + Math.random() * 0.8);
    p.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
    p.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
    p.style.animationDuration = (opts.dur || 0.55) + 's';
    ui.board.appendChild(p);
    p.addEventListener('animationend', () => p.remove());
  }
}
function ring(x, y, color, size, dur = 0.5) {
  const r = document.createElement('div');
  r.className = 'fx-ring';
  r.style.left = x + 'px';
  r.style.top = y + 'px';
  r.style.width = r.style.height = size + 'px';
  r.style.borderColor = color;
  r.style.animationDuration = dur + 's';
  ui.board.appendChild(r);
  r.addEventListener('animationend', () => r.remove());
}
function emojiFx(x, y, ch, cls) {
  const e = document.createElement('div');
  e.className = 'emoji-fx' + (cls ? ' ' + cls : '');
  e.textContent = ch;
  e.style.left = x + 'px';
  e.style.top = y + 'px';
  e.style.fontSize = cellSize * 1.4 + 'px';
  ui.board.appendChild(e);
  e.addEventListener('animationend', () => e.remove());
}
function fxHammer(cell) {
  const { x, y } = cellCenter(cell);
  flashColor('#ffd166');
  ring(x, y, '#ffd166', cellSize * 2.6, 0.4);
  emit(x, y, '#ffdf80', 26, { size: 0.16, dist: 1.5, glow: true });
  emit(x, y, '#ffffff', 10, { size: 0.12, dist: 2.0 });
  emojiFx(x, y, '🔨', 'smash');
  shakeScreen();
}
function fxBomb(cell) {
  const { x, y } = cellCenter(cell);
  flashColor('#ff6b4a');
  ring(x, y, '#ff8a3d', cellSize * 3.2, 0.55);
  emit(x, y, '#ff9f43', 30, { size: 0.18, dist: 2.2, glow: true, dur: 0.7 });
  emit(x, y, '#ffd166', 16, { size: 0.14, dist: 1.6, dur: 0.6 });
  emit(x, y, '#ffffff', 12, { size: 0.1, dist: 2.6, dur: 0.5 });
  shakeScreen();
}
function fxRocket(cell, dir) {
  const { x, y } = cellCenter(cell);
  const horiz = dir === 'lineH';
  for (let i = 0; i < 24; i++) {
    const t = i / 24;
    const px = horiz ? x - (t - 0.5) * cellSize * 8 : x;
    const py = horiz ? y : y - (t - 0.5) * cellSize * 8;
    emit(px, py, i % 2 ? '#ff9f43' : '#ffd166', 1, { angle: horiz ? Math.PI : -Math.PI / 2, spread: 0.6, dist: 0.8, size: 0.14, dur: 0.35 });
  }
  flashColor('#7ad0ff');
  ring(x, y, '#7ad0ff', cellSize * 2.4, 0.45);
  emojiFx(x, y, '🚀', 'rocketfly');
  shakeScreen();
}
function fxRainbow() {
  const w = ui.board.clientWidth, h = ui.board.clientHeight;
  const colors = ['#ff5a76', '#ff9f43', '#feca57', '#2ecc71', '#4b7bec', '#a55eea'];
  for (let i = 0; i < 40; i++) {
    emit((Math.random() - 0.5) * w + w / 2, h + cellSize, colors[i % colors.length], 1, { angle: -Math.PI / 2, spread: 0.9, dist: 3.0, size: 0.16, dur: 0.9, glow: true });
  }
  flashColor('#ffffff');
  ring(w / 2, h / 2, '#ffffff', cellSize * 3, 0.6);
  shakeScreen();
}
function fxResource(label, color, ch) {
  const x = ui.board.clientWidth / 2, y = ui.board.clientHeight / 2;
  ring(x, y, color, cellSize * 2.6, 0.5);
  emit(x, y, color, 22, { size: 0.14, dist: 1.8, glow: true });
  const s = document.createElement('div');
  s.className = 'scorefloat resource-fx';
  s.textContent = ch + ' ' + label;
  s.style.color = color;
  s.style.left = x + 'px';
  s.style.top = y + 'px';
  ui.board.appendChild(s);
  s.addEventListener('animationend', () => s.remove());
}
function fxDoubler() {
  const w = ui.board.clientWidth, h = ui.board.clientHeight;
  flashColor('#ffd166');
  for (let i = 0; i < 36; i++) {
    emit(Math.random() * w, -cellSize, i % 2 ? '#ffd166' : '#fff3c4', 1, { angle: Math.PI / 2, spread: 0.4, dist: 3.0, size: 0.16, dur: 1.1, glow: true });
  }
  ring(w / 2, h / 2, '#ffd166', cellSize * 3.4, 0.6);
  ring(w / 2, h / 2, '#ffffff', cellSize * 2.6, 0.75);
  shakeScreen();
  if (ui.buff) { ui.buff.classList.remove('show'); void ui.buff.offsetWidth; ui.buff.classList.add('show'); }
}

async function animateClear(clear) {
  // 按到消除中心的距离排序，分波爆炸，形成连锁扩散的视觉冲击
  const cells = [...clear].map(k => {
    const [r, c] = k.split(',').map(Number);
    return { r, c };
  });
  const { x, y } = clearCenter(clear);
  cells.sort((a, b) => {
    const da = Math.hypot((a.c + 0.5) * cellSize - x, (a.r + 0.5) * cellSize - y);
    const db = Math.hypot((b.c + 0.5) * cellSize - x, (b.r + 0.5) * cellSize - y);
    return da - db;
  });
  const WAVES = 4;
  const per = Math.max(1, Math.ceil(cells.length / WAVES));
  let waveColor = '#ffd166';
  let sawSpecial = null;
  let wave = 0;
  for (let i = 0; i < cells.length; i++) {
    const { r, c } = cells[i];
    const g = grid[r][c];
    const el = g ? els.get(g.id) : null;
    if (el) {
      el.classList.add('poof');
      spawnParticles(el, g);
      if (!g.stone) waveColor = GEM_COLORS[g.type];
      if (g.special) { sndSpecialFire(g.special); sawSpecial = g.special; }
      else if (g.locked) sndLockBreak();
      else if (g.frozen) sndIceBreak();
    }
    if ((i + 1) % per === 0 && i < cells.length - 1) {
      sndChain(wave++);
      await sleep(36);
    }
  }
  spawnShockwave(clear, waveColor);
  if (sawSpecial) flashBoard(sawSpecial);
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
    if (combo > 0) {
      showCombo(combo + 1);
      if (mode === 'infinite') dropBooster('连击奖励');
    }
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
    const actual = addScore(gained);
    updateHud();
    spawnScoreFloat(clear, actual);
    maybeDropBooster(clear.size, combo);
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
  addScore(clear.size * 15);
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
  addScore(clear.size * 15);
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
    if (mode !== 'rush' && mode !== 'infinite') { moves--; updateHud(); }
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

/* ================= 道具系统 ================= */
function updateBoosters() {
  for (const k of BOOSTER_KEYS) {
    const btn = ui.boosters.querySelector(`[data-b="${k}"]`);
    if (!btn) continue;
    btn.querySelector('.n').textContent = boosters[k];
    btn.classList.toggle('empty', boosters[k] <= 0);
  }
}

function clearAim() {
  aiming = null;
  document.querySelectorAll('.booster').forEach(x => x.classList.remove('aiming'));
  if (ui.board) ui.board.classList.remove('aiming');
}

function boosterUsable(k) {
  if (k === 'moves' && mode === 'rush') return false;
  if (k === 'time' && mode !== 'rush') return false;
  return true;
}

function isDoublerActive() {
  return doublerUntil > 0 && Date.now() < doublerUntil;
}

function addScore(n) {
  const mult = isDoublerActive() ? 2 : 1;
  score += n * mult;
  return n * mult;
}

function stopDoubler() {
  if (doublerTimer) { clearInterval(doublerTimer); doublerTimer = null; }
  doublerUntil = 0;
  if (ui.buff) ui.buff.classList.remove('show');
}

function updateBuff() {
  const left = Math.ceil((doublerUntil - Date.now()) / 1000);
  if (left <= 0) { stopDoubler(); return; }
  if (ui.buff) { ui.buff.textContent = '✨ 双倍分数 ' + left + 's'; ui.buff.classList.add('show'); }
}

function activateDoubler() {
  doublerUntil = Date.now() + 15000;
  if (doublerTimer) clearInterval(doublerTimer);
  updateBuff();
  doublerTimer = setInterval(updateBuff, 250);
}

function activateInstaBooster(b) {
  if (!consumeBooster(b)) return;
  if (b === 'moves') {
    moves += 5; updateHud(); toast('步数 +5');
    sndMovesUp(); fxResource('步数+5', '#2ecc71', '➕');
  } else if (b === 'time') {
    timeLeft += 10; updateHud(); toast('时间 +10 秒');
    sndTimeUp(); fxResource('时间+10s', '#7ad0ff', '⏱');
  } else if (b === 'doubler') {
    activateDoubler(); toast('双倍分数生效 15 秒！');
    sndDoublerUp(); fxDoubler();
  }
}

function resetBoosters() {
  boosters = { hammer: 2, bomb: 2, rocket: 2, rainbow: 2, moves: 2, time: 2, doubler: 2 };
  stopDoubler();
  clearAim();
  updateBoosters();
}

function toggleAim(b) {
  if (busy || gameOver || !running) return;
  if (!boosterUsable(b)) { toast('当前模式不可用'); return; }
  if (boosters[b] <= 0) { toast('道具数量不足'); return; }
  if (BOOSTERS[b].instant) { activateInstaBooster(b); return; }
  if (aiming === b) { clearAim(); return; }
  clearAim();
  aiming = b;
  ui.boosters.querySelector(`[data-b="${b}"]`).classList.add('aiming');
  ui.board.classList.add('aiming');
  sndClick();
}

function consumeBooster(b) {
  if (boosters[b] <= 0) return false;
  boosters[b]--;
  updateBoosters();
  clearAim();
  haptic();
  return true;
}

function dropBooster(tag = '') {
  const pool = BOOSTER_KEYS.filter(boosterUsable);
  if (!pool.length) return;
  const b = pool[rand(pool.length)];
  boosters[b]++;
  updateBoosters();
  const btn = ui.boosters.querySelector(`[data-b="${b}"]`);
  if (btn) { btn.classList.remove('boost-gain'); void btn.offsetWidth; btn.classList.add('boost-gain'); }
  const word = tag || '获得';
  toast(BOOSTERS[b].icon + ' ' + word + ' ' + BOOSTERS[b].label + '！');
  sndBoosterDrop();
}

function maybeDropBooster(clearSize, comboCount) {
  let chance = 0;
  if (clearSize >= 8) chance = 1;
  else if (clearSize >= 6) chance = 0.7;
  else if (comboCount >= 3) chance = 0.5;
  if (chance > 0 && Math.random() < chance) dropBooster();
}

async function settleBoost(clear) {
  const gained = addScore(clear.size * 15);
  updateHud();
  spawnScoreFloat(clear, gained);
  applyGravityAndRefill();
  render();
  await sleep(FALL_MS);
  await resolve();
}

async function useHammer(cell) {
  const g = grid[cell.r][cell.c];
  if (!g) return;
  if (!consumeBooster('hammer')) return;
  sndHammer();
  fxHammer(cell);
  const { clear } = computeClearEffect(new Set([key(cell)]));
  await animateClear(clear);
  await settleBoost(clear);
}

async function useBomb(cell) {
  const g = grid[cell.r][cell.c];
  if (!g) return;
  if (!consumeBooster('bomb')) return;
  sndBombBlast();
  fxBomb(cell);
  const seed = new Set();
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const rr = cell.r + dr, cc = cell.c + dc;
    if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) seed.add(key({ r: rr, c: cc }));
  }
  const { clear } = computeClearEffect(seed);
  await animateClear(clear);
  await settleBoost(clear);
}

async function useRocket(cell) {
  const g = grid[cell.r][cell.c];
  if (!isGem(g) || g.stone) { toast('只能对糖果使用'); return; }
  if (!consumeBooster('rocket')) return;
  const dir = Math.random() < 0.5 ? 'lineH' : 'lineV';
  g.special = dir; g.frozen = false; g.locked = false;
  showBanner(dir); sndRocketLaunch(); fxRocket(cell, dir);
  const { clear } = computeClearEffect(new Set([key(cell)]));
  await animateClear(clear);
  await settleBoost(clear);
}

async function useRainbow(cell) {
  const g = grid[cell.r][cell.c];
  if (!isGem(g) || g.stone) { toast('只能对糖果使用'); return; }
  if (!consumeBooster('rainbow')) return;
  g.special = 'rainbow'; g.frozen = false; g.locked = false;
  showBanner('rainbow'); sndRainbowBoost(); fxRainbow();
  const { clear } = computeClearEffect(new Set([key(cell)]));
  await animateClear(clear);
  await settleBoost(clear);
}

async function fireBooster(b, cell) {
  busy = true;
  try {
    if (b === 'hammer') await useHammer(cell);
    else if (b === 'bomb') await useBomb(cell);
    else if (b === 'rocket') await useRocket(cell);
    else if (b === 'rainbow') await useRainbow(cell);
    evaluateEnd();
  } finally {
    busy = false;
  }
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
function setScore(v) {
  if (ui.hScore._raf) cancelAnimationFrame(ui.hScore._raf);
  ui.hScore.classList.remove('pop');
  void ui.hScore.offsetWidth;
  ui.hScore.classList.add('pop');
  const from = scoreShown;
  const start = performance.now();
  const dur = 320;
  const step = now => {
    const p = Math.min(1, (now - start) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    scoreShown = Math.round(from + (v - from) * e);
    ui.hScore.textContent = scoreShown;
    if (p < 1) ui.hScore._raf = requestAnimationFrame(step);
  };
  ui.hScore._raf = requestAnimationFrame(step);
}

function updateHud() {
  setScore(score);
  if (mode !== 'rush') ui.hMoves.textContent = (moves === Infinity ? '∞' : moves);
  if (mode === 'rush') {
    ui.hTime.textContent = timeLeft;
    ui.hTime.classList.toggle('low', timeLeft <= 5 && timeLeft >= 0);
  }
}

function updateBest() {
  if (ui.hBest) ui.hBest.textContent = +(localStorage.getItem('m3_best_' + mode) || 0);
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
  updateBest();
  if (ui.resultBest) ui.resultBest.textContent = '🏆 最高纪录 ' + (+(localStorage.getItem(k) || 0));
}

function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

/* ================= 开始游戏 ================= */
function startGame(m) {
  mode = m;
  stopTimer();
  gameOver = false; busy = false;
  score = 0; level = (m === 'trial') ? level : 1;
  sel = null; drag = null; lastSwapA = lastSwapB = null;
  scoreShown = 0;
  resetBoosters();
  if (ui.resultBest) ui.resultBest.textContent = '';
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
  } else if (m === 'infinite') {
    moves = Infinity;
  }

  initBoard(opts);

  // 初始有匹配则重来直到无匹配
  let guard = 0;
  while (hasMatch() && guard++ < 50) initBoard(opts);
  if (!hasAnyMove()) shuffleUntilMovable();

  // HUD 显示
  ui.hudMoves.style.display = (m !== 'rush') ? '' : 'none';
  ui.hudMoves.querySelector('.k').textContent = (m === 'infinite') ? '无限步数' : '剩余步数';
  ui.hudTime.style.display = (m === 'rush') ? '' : 'none';
  ui.hudLevel.style.display = (m === 'trial') ? '' : 'none';
  ui.hudTarget.style.display = (m === 'classic' || m === 'trial') ? '' : 'none';
  if (m === 'classic' || m === 'trial') ui.hTarget.textContent = targetScore;
  if (m === 'trial') ui.hLevel.textContent = level;
  if (m !== 'collect') collectRemain = [];

  ui.overlay.classList.remove('show');
  ui.btnNext.style.display = 'none';
  setActiveModeBtn(m);
  updateBest();
  renderTargets();
  updateHud();
  ui.tip.textContent = (m === 'infinite') ? '无限步数随意玩，打出连击即可获得道具奖励！' : '按住糖果向上下左右拖动，交换位置凑成 3 个以上即可消除';
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
function cellFromEvent(x, y) {
  const rect = ui.board.getBoundingClientRect();
  const cx = x - rect.left, cy = y - rect.top;
  const c = Math.floor(cx / cellSize), r = Math.floor(cy / cellSize);
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
  return { r, c };
}

function pointerPos(e) {
  const x = e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX;
  const y = e.touches && e.touches[0] ? e.touches[0].clientY : e.clientY;
  return { x, y };
}

function onPointerDown(e) {
  if (!running || busy || gameOver) return;
  e.preventDefault();
  const pos = pointerPos(e);
  const cell = cellFromEvent(pos.x, pos.y);
  if (!cell) return;
  if (aiming) {
    const b = aiming;
    clearAim();
    fireBooster(b, cell);
    return;
  }
  const g = grid[cell.r][cell.c];
  if (!g || g.stone) return;
  const el = els.get(g.id);
  drag = { r: cell.r, c: cell.c, x: pos.x, y: pos.y, el };
  if (el) el.classList.add('dragging');
  sndClick();
  startMusic();
  try { ui.board.setPointerCapture(e.pointerId); } catch (_) {}
}

function onPointerMove(e) {
  if (!drag || busy || gameOver) return;
  e.preventDefault();
  const pos = pointerPos(e);
  const dx = pos.x - drag.x, dy = pos.y - drag.y;
  if (drag.el) drag.el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
}

function finishDrag(e, commit) {
  const d = drag;
  if (!d) return;
  drag = null;
  if (d.el) { d.el.classList.remove('dragging'); d.el.style.transform = ''; }
  if (!commit) return;
  const pos = pointerPos(e);
  const dx = pos.x - d.x, dy = pos.y - d.y;
  const threshold = cellSize * 0.35;
  if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
  let dr = 0, dc = 0;
  if (Math.abs(dx) > Math.abs(dy)) dc = dx > 0 ? 1 : -1;
  else dr = dy > 0 ? 1 : -1;
  const nr = d.r + dr, nc = d.c + dc;
  if (nr < 0 || nc < 0 || nr >= ROWS || nc >= COLS) return;
  haptic();
  attemptMove({ r: d.r, c: d.c }, { r: nr, c: nc });
}

function onPointerUp(e) { finishDrag(e, true); }
function onPointerCancel(e) { finishDrag(e, false); }

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
  ui.hBest = document.getElementById('h-best');
  ui.resultBest = document.getElementById('result-best');
  ui.btnAgain = document.getElementById('btn-again');
  ui.btnNext = document.getElementById('btn-next');
  ui.boosters = document.getElementById('boosters');
  ui.buff = document.getElementById('buff');

  document.querySelectorAll('.mode-btn').forEach(b => b.addEventListener('click', () => { level = 1; startGame(b.dataset.mode); }));
  ui.btnAgain.addEventListener('click', restartModes);
  ui.btnNext.addEventListener('click', nextLevel);
  document.querySelectorAll('.booster').forEach(b => b.addEventListener('click', () => toggleAim(b.dataset.b)));
  document.getElementById('btn-hint').addEventListener('click', doHint);
  document.getElementById('btn-restart').addEventListener('click', restartModes);
  document.getElementById('btn-mute').addEventListener('click', () => {
    muted = !muted;
    localStorage.setItem('m3_muted', muted ? '1' : '0');
    document.getElementById('btn-mute').textContent = muted ? '🔇 音效' : '🔊 音效';
  });
  document.getElementById('btn-mute').textContent = muted ? '🔇 音效' : '🔊 音效';

  ui.board.addEventListener('pointerdown', onPointerDown);
  ui.board.addEventListener('pointermove', onPointerMove);
  ui.board.addEventListener('pointerup', onPointerUp);
  ui.board.addEventListener('pointercancel', onPointerCancel);

  window.addEventListener('resize', () => { layout(); render(); });
}

window.addEventListener('DOMContentLoaded', () => {
  bind();
  layout();
  startGame('classic');
});