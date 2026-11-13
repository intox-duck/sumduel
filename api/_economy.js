// v2.8 rewards: coins, lives, the Climb, the daily gift and the Daily VS.
// The numbers are mirrored in app.js (ECON + the guest wallet), so guests get the same game. Keep them in step.
// Generous on purpose (the owner asked): lives come back fast, cost little, and gifts hand out plenty.
import { randomBytes } from 'node:crypto';
import { rng, hashStr } from './_questions.js';

export const ECON = {
  START_COINS: 200, START_LIVES: 5,
  MAX_LIVES: 5,            // the clock refills up to here
  BONUS_CAP: 15,           // gifts, chests and purchases can go above MAX_LIVES, up to this
  REGEN_MIN: 10,           // one life back every 10 minutes
  LIFE_COST: 20, REFILL_COST: 60,
  CONTINUE_COST: 25, MAX_CONTINUES: 3,
  // 7-day gift calendar. Miss a day and it starts again at day 1 (which still pays).
  GIFTS: [{ coins: 50 }, { coins: 75 }, { coins: 100, lives: 1 }, { coins: 125 }, { coins: 150, lives: 2 }, { coins: 200 }, { coins: 300, lives: 5 }],
  CHEST: { coins: 150, lives: 2 },        // first clear of every 12th level (an area's last level)
  VS_FIRST_WIN: { coins: 100, lives: 2 },
  VS_FIRST_LOSS: { coins: 40, lives: 1 },
  VS_REMATCH_WIN: { coins: 10 },
  EARN_CAP: 80,            // coin-paying battles per UTC day (stops a forged-battle loop, never reached in play)
  CLIMB_CAP: 200,          // coin-paying Climb wins per UTC day; past it, wins still unlock levels and keep stars
  CLIMB_MIN_MS: 6000,      // no Climb level can honestly be cleared faster than this
};
export const AREA = 12;    // levels per area

export const dayOf = ms => new Date(ms).toISOString().slice(0, 10);
export const err = (status, message, extra) => Object.assign(new Error(message), { status, ...extra });

// Coins for one finished battle (also used for live games, which the server records itself).
export function battleCoins(b) {
  const P = Array.isArray(b.players) ? b.players : [];
  if (b.mode === 'ghost') return b.winner === 0 ? 10 : 5;            // Daily VS pays its own prize on top
  if (b.mode === 'live') return 15 + (b.winner === 0 ? 15 : 0);
  if (b.game === 'duel' || b.game === 'tol') return 10 + (b.winner === 0 ? 10 : 0);
  if (b.game === 'sprint') return 5 + Math.min(25, Math.floor((Number(P[0] && P[0].score) || 0) / 2));
  if (b.game === 'daily') return b.practice ? 5 : 40;
  return 0;
}

// Coins for finishing a Climb level. prev = stars already held on that level (0 = first clear).
export function climbReward(level, stars, prev) {
  const out = { coins: 0, lives: 0, chest: false };
  if (!prev) out.coins = 20 + 10 * stars;
  else if (stars > prev) out.coins = 10 * (stars - prev);
  else out.coins = 5;
  if (!prev && level % AREA === 0) { out.chest = true; out.coins += ECON.CHEST.coins; out.lives += ECON.CHEST.lives; }
  return out;
}

export function giftFor(streak) { return ECON.GIFTS[(Math.max(1, streak) - 1) % ECON.GIFTS.length]; }

// Lives refill on a clock while below MAX_LIVES. lives_at is when the next refill started counting.
export function regen(w, nowMs) {
  const R = ECON.REGEN_MIN * 60000;
  if (w.lives >= ECON.MAX_LIVES) { w.lives_at = nowMs; return w; }
  let at = new Date(w.lives_at).getTime();
  if (!Number.isFinite(at) || at > nowMs) at = nowMs;
  const n = Math.floor((nowMs - at) / R);
  if (n > 0) { w.lives = Math.min(ECON.MAX_LIVES, w.lives + n); at += n * R; }
  w.lives_at = w.lives >= ECON.MAX_LIVES ? nowMs : at;
  return w;
}

export function pubWallet(w, nowMs) {
  const today = dayOf(nowMs), yday = dayOf(nowMs - 86400000);
  const next = w.gift_day === yday ? (w.gift_streak % ECON.GIFTS.length) + 1 : 1;
  const stars = w.climb_stars || {};
  return {
    coins: w.coins, lives: w.lives, maxLives: ECON.MAX_LIVES,
    nextLifeMs: w.lives >= ECON.MAX_LIVES ? null : Math.max(0, new Date(w.lives_at).getTime() + ECON.REGEN_MIN * 60000 - nowMs),
    climb: { level: w.climb_level, stars, total: Object.values(stars).reduce((a, s) => a + (Number(s) || 0), 0) },
    gift: { ready: w.gift_day !== today, day: w.gift_day === today ? w.gift_streak : next, claimedToday: w.gift_day === today },
    run: w.run ? { id: w.run.id, level: w.run.level, cont: w.run.cont || 0 } : null,
    now: new Date(nowMs).toISOString(),
  };
}

async function load(sql, uid) {
  await sql`insert into wallets (user_id) values (${uid}) on conflict (user_id) do nothing`;
  const [w] = await sql`select w.*, now() as now from wallets w where w.user_id = ${uid}`;
  return w;
}

export async function getWallet(sql, uid) {
  const w = await load(sql, uid), nowMs = new Date(w.now).getTime();
  return pubWallet(regen(w, nowMs), nowMs);
}

// Read-modify-write with optimistic locking (rev), so two devices can't lose each other's coins.
// fn(w, nowMs) edits w in place and returns extra fields for the response; throw err() to refuse.
export async function mutate(sql, uid, fn) {
  for (let i = 0; i < 4; i++) {
    const w0 = await load(sql, uid), nowMs = new Date(w0.now).getTime();
    const w = regen({ ...w0, climb_stars: { ...(w0.climb_stars || {}) }, run: w0.run ? { ...w0.run } : null }, nowMs);
    const out = fn(w, nowMs) || {};
    w.coins = Math.max(0, Math.round(w.coins));
    w.lives = Math.max(0, Math.min(ECON.BONUS_CAP, Math.round(w.lives)));
    const rows = await sql`update wallets set coins = ${w.coins}, lives = ${w.lives}, lives_at = ${new Date(w.lives_at).toISOString()}::timestamptz,
                             climb_level = ${w.climb_level}, climb_stars = ${JSON.stringify(w.climb_stars)}::jsonb,
                             gift_day = ${w.gift_day}, gift_streak = ${w.gift_streak}, run = ${w.run ? JSON.stringify(w.run) : null}::jsonb,
                             earn_day = ${w.earn_day}, earn_n = ${w.earn_n}, climb_day = ${w.climb_day}, climb_n = ${w.climb_n},
                             rev = rev + 1, updated_at = now()
                           where user_id = ${uid} and rev = ${w0.rev} returning *`;
    if (rows.length) return { wallet: pubWallet(rows[0], nowMs), ...out };
  }
  throw err(409, 'Busy. Try again.');
}

// Pay coins for finished battles (in order, until the daily cap), in ONE wallet write however many there are.
// Never throws: rewards must not break saving a game.
export async function awardBattles(sql, uid, list) {
  const pay = (list || []).map(c => Math.max(0, Math.round(Number(c) || 0))).filter(c => c > 0);
  if (!pay.length) return 0;
  try {
    const r = await mutate(sql, uid, (w, nowMs) => {
      const today = dayOf(nowMs);
      if (w.earn_day !== today) { w.earn_day = today; w.earn_n = 0; }
      const take = pay.slice(0, Math.max(0, ECON.EARN_CAP - w.earn_n));
      const paid = take.reduce((a, c) => a + c, 0);
      w.earn_n += take.length; w.coins += paid;
      return { paid };
    });
    return r.paid;
  } catch (e) { console.error('awardBattles failed', e.message); return 0; }
}
export const awardBattle = (sql, uid, coins) => awardBattles(sql, uid, [coins]);

export const newRunId = () => randomBytes(6).toString('base64url');

// ---------- Daily VS ----------
export const VS_N = 15;
export const VS_BOTS = [
  { id: 'wobble', name: 'Wobble the Jellyfish', pace: 5.2, wrong: 2 },
  { id: 'crab', name: 'Captain Crab', pace: 3.4, wrong: 1 },
  { id: 'shark', name: 'Sid the Shark', pace: 2.1, wrong: 0 },
];
// A bot's run is fixed for the day, so everyone races the same Captain Crab. Same formula as app.js botRun.
export function botRun(bot, day) {
  const r = rng(hashStr('vsbot-' + bot.id + '-' + day)), splits = [];
  for (let i = 0; i < VS_N; i++) splits.push(Math.round(bot.pace * (0.65 + r() * 0.7) * 100) / 100);
  const raw = Math.round(splits.reduce((a, s) => a + s, 0) * 1000) / 1000;
  return { splits, raw, wrong: bot.wrong, time: Math.round((raw + bot.wrong * 3) * 1000) / 1000 };
}
