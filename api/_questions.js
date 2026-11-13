// Server copy of the client's seeded question generator (app.js makeQuestions). Keep the two in sync:
// live games generate questions here and send them to both devices.
export function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h | 0; }
export const RANGES = {
  easy: { add: [1, 10, 1, 10], mul: [2, 5, 1, 10] },
  medium: { add: [10, 99, 2, 99], mul: [2, 12, 2, 12] },
  hard: { add: [100, 999, 11, 999], mul: [6, 25, 3, 12] },
};
export const OPS = ['+', '−', '×', '÷'];
export function makeQuestions(n, ops, level, seed) {
  const r = rng(seed), R = RANGES[level] || RANGES.medium;
  const ri = (a, b) => a + Math.floor(r() * (b - a + 1));
  const out = []; let last = '';
  while (out.length < n) {
    const op = ops[Math.floor(r() * ops.length)]; let text, ans, a, b;
    if (op === '+' || op === '−') {
      a = ri(R.add[0], R.add[1]); b = ri(R.add[2], R.add[3]);
      if (op === '+') { text = a + ' + ' + b; ans = a + b; } else { text = (a + b) + ' − ' + b; ans = a; }
    } else {
      a = ri(R.mul[0], R.mul[1]); b = ri(R.mul[2], R.mul[3]);
      if (r() < 0.5) { const t = a; a = b; b = t; }
      if (op === '×') { text = a + ' × ' + b; ans = a * b; }
      else { if (a === 1 && b !== 1) { const u = a; a = b; b = u; } text = (a * b) + ' ÷ ' + a; ans = b; }
    }
    if (text === last) continue;
    last = text; out.push({ text, ans: String(ans), op });
  }
  return out;
}
// Truth or Lie: an equation that's right ~50% of the time; lies are near-misses. Same as app.js makeTol.
export function makeTol(n, ops, level, seed) {
  const base = makeQuestions(n, ops, level, seed), r = rng(seed ^ 0x5bd1e995);
  return base.map(q => {
    const truth = r() < 0.5; let shown = Number(q.ans);
    if (!truth) {
      let deltas = [1, 2, 10, -1, -2, -10];
      if (q.op === '×' || q.op === '÷') deltas = deltas.concat([Number(q.text.split(' ')[2]) || 3, -(Number(q.text.split(' ')[2]) || 3)]);
      const d = deltas[Math.floor(r() * deltas.length)];
      shown = shown + d; if (shown < 0) shown = Number(q.ans) + Math.abs(d);
    }
    return { text: q.text + ' = ' + shown, truth };
  });
}

// A blank in the equation. Same shape the Climb trail uses in app.js (toMissing). ans is always a string.
export function toMissing(q, first) {
  const t = q.text.split(' '), a = t[0], op = t[1], b = t[2];
  return first
    ? { text: '? ' + op + ' ' + b + ' = ' + q.ans, ans: a, op, full: true }
    : { text: a + ' ' + op + ' ? = ' + q.ans, ans: b, op, full: true };
}

// ---------------------------------------------------------------------------------------------------
// v3 live games. These are only ever generated here (live games are made on the server and sent to both
// devices), so unlike makeQuestions/makeTol they have no copy in app.js.
// ---------------------------------------------------------------------------------------------------

// One sum, the same rules as makeQuestions, with its value as a number.
function oneSum(r, op, R) {
  const ri = (a, b) => a + Math.floor(r() * (b - a + 1));
  let a, b;
  if (op === '+' || op === '−') {
    a = ri(R.add[0], R.add[1]); b = ri(R.add[2], R.add[3]);
    return op === '+' ? { text: a + ' + ' + b, v: a + b } : { text: (a + b) + ' − ' + b, v: a };
  }
  a = ri(R.mul[0], R.mul[1]); b = ri(R.mul[2], R.mul[3]);
  if (r() < 0.5) { const t = a; a = b; b = t; }
  if (op === '×') return { text: a + ' × ' + b, v: a * b };
  if (a === 1 && b !== 1) { const u = a; a = b; b = u; }
  return { text: (a * b) + ' ÷ ' + a, v: b };
}

// The Climb (live): a cliff of CLIMB_BANDS.length ledges that get harder on the way up. Each ledge has
// CLIMB_ALTS different sums, so a player who slips back down meets a fresh sum on the way up again.
// Shape: questions[ledge][alt] = { text, ans, op }.
export const CLIMB_BANDS = ['easy', 'easy', 'easy', 'easy', 'medium', 'medium', 'medium', 'medium', 'medium', 'hard', 'hard', 'hard'];
export const CLIMB_ALTS = 4;
export function makeClimb(ops, seed) {
  return CLIMB_BANDS.map((level, i) => makeQuestions(CLIMB_ALTS, ops, level, (seed + Math.imul(i + 1, 0x9E3779B1)) | 0));
}

// Target: combine the number tiles with + − × ÷ to make the target. Every puzzle is built from a real
// solution that uses all its tiles with whole, positive numbers at every step (so it can always be done),
// but any route to the target counts and players don't have to use every tile.
// Shape: { nums: [..], target, sol: ['6 × 4 = 24', ...] }.
const TARGET_CFG = {
  easy: { k: 3, lo: 1, hi: 9, tmin: 6, tmax: 30 },
  medium: { k: 4, lo: 1, hi: 10, tmin: 10, tmax: 60 },
  hard: { k: 4, lo: 2, hi: 12, big: [15, 20, 25], tmin: 20, tmax: 150 },
};
export function combine(a, b, op) {
  if (op === '+') return a + b;
  if (op === '−') return a > b ? a - b : null;            // no zero, no negatives
  if (op === '×') return a > 1 && b > 1 ? a * b : null;    // ×1 makes a dull step
  if (op === '÷') return b > 1 && a % b === 0 && a > b ? a / b : null;
  return null;
}
export function makeTargets(n, ops, level, seed) {
  const r = rng(seed), C = TARGET_CFG[level] || TARGET_CFG.medium, out = [], seen = new Set();
  let use = ops.filter(o => OPS.includes(o)); if (!use.length) use = OPS.slice();
  let tries = 0;
  while (out.length < n) {
    // A single operation that can't build a puzzle (÷ alone rarely can) gets + and × added after a while.
    if (++tries > 400 * (out.length + 1)) use = [...new Set(use.concat(['+', '×']))];
    const nums = Array.from({ length: C.k }, () => C.lo + Math.floor(r() * (C.hi - C.lo + 1)));
    if (C.big && r() < 0.5) nums[0] = C.big[Math.floor(r() * C.big.length)];
    let pool = nums.slice(); const sol = []; let ok = true;
    while (pool.length > 1) {
      const i = Math.floor(r() * pool.length); let j = Math.floor(r() * (pool.length - 1)); if (j >= i) j++;
      const op = use[Math.floor(r() * use.length)];
      let x = pool[i], y = pool[j];
      if ((op === '−' || op === '÷') && x < y) { const t = x; x = y; y = t; }
      const v = combine(x, y, op);
      if (v == null) { ok = false; break; }
      sol.push(x + ' ' + op + ' ' + y + ' = ' + v);
      pool = pool.filter((_, k) => k !== i && k !== j); pool.push(v);
    }
    if (!ok) continue;
    const t = pool[0];
    if (t < C.tmin || t > C.tmax || nums.includes(t)) continue;
    const key = nums.slice().sort((a, b) => a - b).join(',') + '>' + t;
    if (seen.has(key)) continue;
    seen.add(key);
    for (let k = nums.length - 1; k > 0; k--) { const m = Math.floor(r() * (k + 1)); const s = nums[k]; nums[k] = nums[m]; nums[m] = s; }
    out.push({ nums, target: t, sol });
  }
  return out;
}

// Bigger: two sums side by side, tap the bigger one. Close calls on purpose (within about 20 %), never a tie.
// Hard mixes the operations across the two sides. Shape: { l, r, lv, rv, ans: 'l'|'r', op }.
export function makeBigger(n, ops, level, seed) {
  const r = rng(seed), R = RANGES[level] || RANGES.medium, out = [];
  let use = ops.filter(o => OPS.includes(o)); if (!use.length) use = OPS.slice();
  const pick = () => use[Math.floor(r() * use.length)];
  let guard = 0;
  while (out.length < n && guard++ < n * 200) {
    const opL = pick(), opR = level === 'hard' || r() < 0.3 ? pick() : opL;
    const L = oneSum(r, opL, R);
    let M = null;
    for (let t = 0; t < 40 && !M; t++) {
      const c = oneSum(r, opR, R), d = Math.abs(c.v - L.v);
      if (c.v !== L.v && c.text !== L.text && d <= Math.max(2, Math.round(L.v * 0.2))) M = c;
    }
    if (!M) continue;
    if (out.length && out[out.length - 1].l === L.text) continue;
    out.push({ l: L.text, r: M.text, lv: L.v, rv: M.v, ans: L.v > M.v ? 'l' : 'r', op: opL });
  }
  while (out.length < n) out.push(out[out.length % Math.max(1, out.length)] || { l: '2 + 2', r: '2 + 3', lv: 4, rv: 5, ans: 'r', op: '+' });
  return out;
}

// Questions for a live game. n is already the right length for that game (see api/live.js cleanCfg).
export function makeLiveQuestions(game, n, ops, level, seed) {
  if (game === 'tol') return makeTol(n, ops, level, seed);
  if (game === 'climb') return makeClimb(ops, seed);
  if (game === 'target') return makeTargets(n, ops, level, seed);
  if (game === 'bigger') return makeBigger(n, ops, level, seed);
  const base = makeQuestions(n, ops, level, seed);
  if (game === 'missing') {
    const r = rng(seed ^ 0x2545f491);
    return base.map(q => toMissing(q, r() < 0.5));
  }
  return base;
}
