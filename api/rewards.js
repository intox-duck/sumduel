// v2.8 rewards: the wallet (coins + lives), the daily gift, the Climb and the Daily VS.
// GET  /api/rewards                       -> { wallet }                       (signed in)
// GET  /api/rewards?vs=1&d=YYYY-MM-DD     -> { day, ghosts:[...], mine }       (public, like the boards: names and times only)
// POST {action:'claimGift'}               -> { wallet, gift:{day, coins, lives} }
// POST {action:'buy', what:'life'|'refill'}
// POST {action:'climbStart', level}       -> uses a life up front; it comes back if you win (so quitting can't dodge it)
// POST {action:'climbContinue', id}       -> spend coins to keep going after running out of time or mistakes
// POST {action:'climbFinish', id, level, won, stars}
// POST {action:'vsFinish', d, raw, wrong, splits, rival:{type:'bot'|'player', id}}
// POST {action:'adopt', coins, lives, climb:{level, stars}}   -> a guest's progress moves into a brand-new account, once
import { route, send, fail, db, currentUser, requireUser, utcDay, logEvent } from './_lib.js';
import { ECON, AREA, mutate, getWallet, climbReward, giftFor, dayOf, err, newRunId, VS_N, VS_BOTS, botRun } from './_economy.js';

const MAX_LEVEL = 9999;

export default route(['GET', 'POST'], async (req, res) => {
  const sql = db();

  if (req.method === 'GET' && req.query?.vs) return vsBoard(req, res, sql);

  const u = await requireUser(req, res); if (!u) return;
  if (req.method === 'GET') return send(res, 200, { wallet: await getWallet(sql, u.id) });

  const b = req.body, action = b.action;
  try {
    if (action === 'claimGift') {
      const r = await mutate(sql, u.id, (w, nowMs) => {
        const today = dayOf(nowMs), yday = dayOf(nowMs - 86400000);
        if (w.gift_day === today) throw err(409, 'You’ve opened today’s gift. Come back tomorrow!');
        const streak = w.gift_day === yday ? (w.gift_streak % ECON.GIFTS.length) + 1 : 1;
        const g = giftFor(streak);
        w.coins += g.coins; w.lives += g.lives || 0; w.gift_day = today; w.gift_streak = streak;
        return { gift: { day: streak, coins: g.coins, lives: g.lives || 0 } };
      });
      await logEvent(req, u, 'gift_claimed', { detail: r.gift });
      return send(res, 200, r);
    }

    if (action === 'buy') {
      const what = b.what === 'refill' ? 'refill' : 'life';
      const r = await mutate(sql, u.id, w => {
        if (what === 'life') {
          if (w.coins < ECON.LIFE_COST) throw err(402, 'Not enough coins yet.');
          if (w.lives >= ECON.BONUS_CAP) throw err(409, 'Your hearts are full.');
          w.coins -= ECON.LIFE_COST; w.lives += 1;
          return { spent: ECON.LIFE_COST };
        }
        if (w.lives >= ECON.MAX_LIVES) throw err(409, 'Your hearts are already full.');
        if (w.coins < ECON.REFILL_COST) throw err(402, 'Not enough coins yet.');
        w.coins -= ECON.REFILL_COST; w.lives = ECON.MAX_LIVES;
        return { spent: ECON.REFILL_COST };
      });
      await logEvent(req, u, 'coins_spent', { detail: { what, coins: r.spent } });
      return send(res, 200, r);
    }

    if (action === 'climbStart') {
      const level = parseInt(b.level, 10);
      const r = await mutate(sql, u.id, (w, nowMs) => {
        if (!(level >= 1 && level <= Math.min(MAX_LEVEL, w.climb_level))) throw err(403, 'That level is still locked.');
        if (w.lives < 1) throw err(409, 'No hearts left. Wait for the next one, or buy one with coins.', { code: 'no_lives' });
        w.lives -= 1;
        w.run = { id: newRunId(), level, at: nowMs, cont: 0 };
        return { run: { id: w.run.id, level } };
      });
      return send(res, 200, r);
    }

    if (action === 'climbContinue') {
      const r = await mutate(sql, u.id, w => {
        if (!w.run || w.run.id !== String(b.id || '')) throw err(409, 'That level isn’t running any more.');
        if ((w.run.cont || 0) >= ECON.MAX_CONTINUES) throw err(409, 'No more extra goes on this level.');
        if (w.coins < ECON.CONTINUE_COST) throw err(402, 'Not enough coins yet.');
        w.coins -= ECON.CONTINUE_COST; w.run.cont = (w.run.cont || 0) + 1;
        return { spent: ECON.CONTINUE_COST };
      });
      await logEvent(req, u, 'coins_spent', { detail: { what: 'continue', level: r.wallet.run && r.wallet.run.level, coins: r.spent } });
      return send(res, 200, r);
    }

    if (action === 'climbFinish') {
      const level = parseInt(b.level, 10), won = !!b.won, stars = Math.max(1, Math.min(3, parseInt(b.stars, 10) || 1));
      const r = await mutate(sql, u.id, (w, nowMs) => {
        if (!w.run || w.run.id !== String(b.id || '') || w.run.level !== level) return { dup: true }; // already settled
        const run = w.run; w.run = null;
        if (!won) return { won: false, level };
        if (nowMs - run.at < ECON.CLIMB_MIN_MS) throw err(400, 'That was too quick to be real.');
        const prev = Number(w.climb_stars[level]) || 0;
        const rw = climbReward(level, stars, prev);
        // Coins and chest hearts stop after CLIMB_CAP paying wins a day (a forged-finish loop); progress never does.
        const today = dayOf(nowMs);
        if (w.climb_day !== today) { w.climb_day = today; w.climb_n = 0; }
        if (w.climb_n >= ECON.CLIMB_CAP) { rw.coins = 0; rw.lives = 0; } else w.climb_n++;
        w.lives += 1;                                  // the life used to start comes back on a win
        w.coins += rw.coins; w.lives += rw.lives;
        if (stars > prev) w.climb_stars[level] = stars;
        if (level + 1 > w.climb_level) w.climb_level = Math.min(MAX_LEVEL, level + 1);
        return { won: true, level, stars, prev, coins: rw.coins, lives: rw.lives, chest: rw.chest, area: Math.ceil(level / AREA) };
      });
      if (!r.dup) await logEvent(req, u, 'climb_finish', { detail: { level, won: r.won, stars: r.won ? stars : 0, coins: r.coins || 0, chest: r.chest || undefined } });
      return send(res, 200, r);
    }

    if (action === 'vsFinish') return vsFinish(req, res, sql, u);

    if (action === 'adopt') {
      // Only into an account made in the last 15 minutes whose wallet has never been written (rev 0): adopting is
      // itself a write, so it can happen once, and an existing account never takes over a guest's progress.
      const r = await mutate(sql, u.id, (w, nowMs) => {
        const fresh = w.rev === 0 && nowMs - new Date(u.created_at).getTime() < 15 * 60000;
        if (!fresh) return { adopted: false };
        const lv = Math.max(1, Math.min(500, parseInt(b.climb && b.climb.level, 10) || 1));
        const st = {};
        Object.entries((b.climb && b.climb.stars) || {}).forEach(([k, v]) => { const n = parseInt(k, 10), s = parseInt(v, 10); if (n >= 1 && n < lv && s >= 1 && s <= 3) st[n] = s; });
        w.climb_level = lv; w.climb_stars = st;
        w.coins = Math.max(w.coins, Math.min(3000, parseInt(b.coins, 10) || 0));
        w.lives = Math.max(w.lives, Math.min(ECON.BONUS_CAP, parseInt(b.lives, 10) || 0));
        return { adopted: true };
      });
      if (r.adopted) await logEvent(req, u, 'progress_adopted', { detail: { climb: r.wallet.climb.level, coins: r.wallet.coins } });
      return send(res, 200, r);
    }
  } catch (e) {
    if (e.status) return send(res, e.status, { error: e.message, code: e.code });
    throw e;
  }
  fail(res, 400, 'Unknown action');
});

// ---------- Daily VS ----------
function vsDay(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : utcDay(); }

async function vsBoard(req, res, sql) {
  const day = vsDay(req.query.d), me = await currentUser(req).catch(() => null);
  const rows = await sql`select v.user_id, u.name, v.time, v.raw, v.wrong, v.splits, v.rival, v.won
                         from daily_vs v join users u on u.id = v.user_id where v.day = ${day} order by v.time asc limit 40`;
  const g = r => ({ id: String(r.user_id), name: r.name, time: Number(r.time), raw: Number(r.raw), wrong: r.wrong, splits: r.splits || [] });
  // Your own run is looked up on its own, so it's found even when you're slower than the 40 shown.
  const [mine] = me ? await sql`select v.user_id, u.name, v.time, v.raw, v.wrong, v.splits from daily_vs v join users u on u.id = v.user_id
                                where v.day = ${day} and v.user_id = ${me.id}` : [];
  send(res, 200, { day, n: VS_N, ghosts: rows.filter(r => !me || String(r.user_id) !== String(me.id)).map(g), mine: mine ? { ...g(mine), me: true } : null,
    bots: VS_BOTS.map(bt => ({ id: bt.id, name: bt.name, ...botRun(bt, day) })) });
}

async function vsFinish(req, res, sql, u) {
  const b = req.body, d = String(b.d || '');
  if (d !== utcDay() && d !== utcDay(-1)) return fail(res, 400, 'That Daily VS has closed.');
  const raw = Number(b.raw), wrong = Math.max(0, Math.min(99, parseInt(b.wrong, 10) || 0));
  if (!Number.isFinite(raw) || raw < VS_N * 0.35 || raw > 3600) return fail(res, 400, 'Implausible time');
  const splits = (Array.isArray(b.splits) ? b.splits : []).slice(0, VS_N).map(Number).filter(Number.isFinite).map(x => Math.round(x * 100) / 100);
  const time = Math.round((raw + wrong * 3) * 1000) / 1000;
  const rv = b.rival || {};
  let rival = null;
  if (rv.type === 'bot') {
    const bot = VS_BOTS.find(x => x.id === rv.id);
    if (bot) rival = { key: 'bot:' + bot.id, name: bot.name, time: botRun(bot, d).time };
  } else if (rv.type === 'player') {
    const [g] = await sql`select v.time, u.name, v.user_id from daily_vs v join users u on u.id = v.user_id where v.day = ${d} and v.user_id = ${parseInt(rv.id, 10) || 0}`;
    if (g && String(g.user_id) !== String(u.id)) rival = { key: 'player:' + g.user_id, name: g.name, time: Number(g.time) };
  }
  if (!rival) return fail(res, 400, 'Pick a rival to race.');
  const won = time < rival.time;
  const ins = await sql`insert into daily_vs (day, user_id, time, raw, wrong, splits, rival, won)
                        values (${d}, ${u.id}, ${time}, ${raw}, ${wrong}, ${JSON.stringify(splits)}::jsonb, ${rival.key}, ${won})
                        on conflict (day, user_id) do nothing returning day`;
  const first = ins.length > 0;
  const prize = first ? (won ? ECON.VS_FIRST_WIN : ECON.VS_FIRST_LOSS) : (won ? ECON.VS_REMATCH_WIN : null);
  let r;
  try { r = await mutate(sql, u.id, w => { if (prize) { w.coins += prize.coins; w.lives += prize.lives || 0; } }); }
  catch (e) {
    // The prize didn't land: take the run back out, so trying again is still the first race and still pays.
    if (first) await sql`delete from daily_vs where day = ${d} and user_id = ${u.id}`.catch(() => {});
    throw e;
  }
  await logEvent(req, u, 'vs_finish', { detail: { day: d, rival: rival.name, won, time, rival_time: rival.time, first, coins: prize ? prize.coins : 0 } });
  send(res, 200, { ...r, won, first, time, rival: { name: rival.name, time: rival.time }, prize: prize || { coins: 0 } });
}
