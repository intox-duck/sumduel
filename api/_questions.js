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
