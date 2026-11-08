// Live duels: two players, separate devices, polled (no websockets on Vercel functions).
// The server owns the clock: start_at is set server-side, finish times are checked against server time,
// and the result is decided here. Both players' battles are written server-side (cid "live-<id>").
//
// GET  /api/live?lobby=1                 -> { now, games:[open games], active: code|null }
// GET  /api/live?code=ABCDE              -> { now, game } (participants get full state; others a join preview)
// POST {action:'create', name, cfg:{ops,level,n}, private, password}
// POST {action:'join', code, password}
// POST {action:'ready', code, ready}
// POST {action:'progress', code, idx, wrong, raw?, extra?}
// POST {action:'leave', code}            (in a running game this forfeits)
// POST {action:'claim', code}            (opponent silent for 25 s -> win by forfeit)
// POST {action:'rematch', code}
import { randomInt } from 'node:crypto';
import { route, send, fail, db, requireUser, hashPassword, verifyPassword, logEvent } from './_lib.js';
import { screen } from './_safety.js';
import { makeQuestions, RANGES, OPS } from './_questions.js';

const PENALTY = 3;
const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const START_DELAY = 5;          // seconds from "both ready" to GO
const STALE_LOBBY = 60;         // host/guest silent this long in the lobby -> dropped
const GONE = 25;                // opponent silent this long mid-game -> claimable
const ACTIVE = ['open', 'full', 'playing'];
const limitSecs = n => Math.max(120, n * 20);

const newCode = () => Array.from({ length: 5 }, () => CODE_ABC[randomInt(CODE_ABC.length)]).join('');
const codeOk = c => /^[A-Z0-9]{5}$/.test(c);
const other = r => (r === 'host' ? 'guest' : 'host');

function cleanCfg(c) {
  c = c || {};
  const ops = Array.isArray(c.ops) ? [...new Set(c.ops.filter(o => OPS.includes(o)))] : [];
  const level = RANGES[c.level] ? c.level : 'medium';
  const n = [5, 10, 15, 20, 30].includes(Number(c.n)) ? Number(c.n) : 10;
  return { ops: ops.length ? ops : OPS.slice(), level, n };
}

async function load(sql, code) {
  const [g] = await sql`select g.*, h.name as host_name, h.email as host_email, x.name as guest_name, x.email as guest_email
                        from live_games g join users h on h.id = g.host_id left join users x on x.id = g.guest_id
                        where g.code = ${code}`;
  return g || null;
}
const roleOf = (g, u) => (String(g.host_id) === String(u.id) ? 'host' : g.guest_id && String(g.guest_id) === String(u.id) ? 'guest' : null);

async function housekeeping(sql) {
  await sql`update live_games set status = 'abandoned', updated_at = now()
            where status in ('open','full') and host_seen < now() - make_interval(secs => ${STALE_LOBBY})`;
  await sql`update live_games set guest_id = null, guest_ready = false, host_ready = false, status = 'open', updated_at = now()
            where status = 'full' and guest_seen < now() - make_interval(secs => ${STALE_LOBBY})`;
  await sql`update live_games set status = 'abandoned', updated_at = now()
            where status = 'playing' and greatest(host_seen, coalesce(guest_seen, host_seen)) < now() - interval '5 minutes'`;
}

// Leave whatever lobby this user is sitting in (one active game per player).
async function leaveLobbies(sql, u) {
  await sql`update live_games set status = 'cancelled', updated_at = now() where host_id = ${u.id} and status in ('open','full')`;
  await sql`update live_games set guest_id = null, guest_ready = false, host_ready = false, status = 'open', updated_at = now()
            where guest_id = ${u.id} and status = 'full'`;
}

function side(g, r, nowMs) {
  const p = r === 'host' ? 'host' : 'guest';
  const id = g[p + '_id'];
  if (!id) return null;
  const seen = g[p + '_seen'] ? new Date(g[p + '_seen']).getTime() : 0;
  return {
    name: g[p + '_name'], ready: g[p + '_ready'], idx: g[p + '_idx'], wrong: g[p + '_wrong'],
    done: !!g[p + '_done_at'], online: nowMs - seen < GONE * 1000,
  };
}

function view(g, u, nowDate) {
  const r = roleOf(g, u), nowMs = nowDate.getTime();
  const startMs = g.start_at ? new Date(g.start_at).getTime() : null;
  const base = { id: String(g.id), code: g.code, name: g.name, status: g.status, private: g.is_private, cfg: g.cfg, host: { name: g.host_name }, created_at: g.created_at };
  if (!r) return { ...base, you: null, invited: g.invited_id && String(g.invited_id) === String(u.id) };
  const opp = side(g, other(r), nowMs);
  return {
    ...base, you: r, start_at: g.start_at, limit: limitSecs(g.cfg.n),
    host: side(g, 'host', nowMs), guest: side(g, 'guest', nowMs),
    // Questions (with answers) only go out 3 s before GO, so nobody can practise them in the lobby.
    questions: g.questions && startMs && nowMs >= startMs - 3500 ? g.questions : null,
    result: g.result, rematch_code: g.rematch_code,
    opp_gone: g.status === 'playing' && !!opp && !opp.online && !opp.done,
  };
}

function battleFor(g, r, res) {
  const me = res[r], them = res[other(r)];
  const winner = res.winner == null ? -1 : res.winner === r ? 0 : 1;
  const pl = (s, name, extra) => ({
    name, time: s.time, raw: s.raw, wrong: s.wrong, dnf: s.dnf || undefined,
    splits: (extra && extra.splits) || [], bestStreak: (extra && extra.bestStreak) || 0, wrongBy: (extra && extra.wrongBy) || {},
  });
  return {
    cid: 'live-' + g.id, at: new Date(g.start_at).toISOString(), game: 'duel', mode: 'live', cfg: g.cfg, winner,
    live: { code: g.code, reason: res.reason, role: r },
    players: [pl(me, g[r + '_name'], g[r + '_extra']), pl(them, g[other(r) + '_name'], g[other(r) + '_extra'])],
  };
}

// Decide the result once. reason: finished | timeout | forfeit. loser: role that forfeited (forfeit only).
async function finalize(req, actor, sql, g, reason, loser) {
  const [{ now }] = await sql`select now()`;
  const startMs = new Date(g.start_at).getTime(), endMs = new Date(now).getTime();
  const res = { reason };
  for (const r of ['host', 'guest']) {
    const done = g[r + '_done_at'] ? new Date(g[r + '_done_at']).getTime() : null;
    const serverRaw = ((done || endMs) - startMs) / 1000;
    let raw = serverRaw;
    // Prefer the device's own stopwatch (fairer across network delays) if it agrees with the server clock.
    if (done && g[r + '_raw'] != null && g[r + '_raw'] <= serverRaw + 1 && g[r + '_raw'] >= serverRaw - 5) raw = g[r + '_raw'];
    const ex = g[r + '_extra'] || {};
    res[r] = { raw: +raw.toFixed(3), wrong: g[r + '_wrong'], idx: g[r + '_idx'], time: +(raw + g[r + '_wrong'] * PENALTY).toFixed(3), dnf: !done,
               splits: ex.splits || [], bestStreak: ex.bestStreak || 0 };
  }
  if (reason === 'forfeit') res.winner = other(loser);
  else if (!res.host.dnf && !res.guest.dnf) {
    const d = res.host.time - res.guest.time;
    res.winner = Math.abs(d) < 0.005 ? null : d < 0 ? 'host' : 'guest';
  } else if (res.host.dnf !== res.guest.dnf) res.winner = res.host.dnf ? 'guest' : 'host';
  else res.winner = res.host.idx === res.guest.idx ? null : res.host.idx > res.guest.idx ? 'host' : 'guest';

  const upd = await sql`update live_games set status = 'done', result = ${JSON.stringify(res)}::jsonb, updated_at = now()
                        where id = ${g.id} and status = 'playing' returning id`;
  if (!upd.length) return null; // someone else finalised first
  if (g.guest_id) {
    for (const [r, uid] of [['host', g.host_id], ['guest', g.guest_id]]) {
      const b = battleFor(g, r, res);
      await sql`insert into battles (user_id, client_id, game, played_at, data)
                values (${uid}, ${b.cid}, 'duel', ${b.at}, ${JSON.stringify(b)}::jsonb)
                on conflict (user_id, client_id) do nothing`;
    }
  }
  await logEvent(req, actor, 'live_finish', {
    detail: { code: g.code, reason, winner: res.winner ? g[res.winner + '_name'] : 'draw',
      host: { name: g.host_name, ...res.host }, guest: { name: g.guest_name, ...res.guest } },
  });
  return res;
}

export default route(['GET', 'POST'], async (req, res) => {
  const u = await requireUser(req, res); if (!u) return;
  const sql = db();

  if (req.method === 'GET') {
    const [{ now }] = await sql`select now()`;
    const nowDate = new Date(now);
    if (req.query?.lobby) {
      await housekeeping(sql);
      const games = await sql`select g.code, g.name, g.cfg, g.is_private, g.created_at, g.host_id, h.name as host_name
                              from live_games g join users h on h.id = g.host_id
                              where g.status = 'open' order by g.created_at desc limit 50`;
      const [act] = await sql`select code from live_games where status = any(${ACTIVE}) and (host_id = ${u.id} or guest_id = ${u.id})
                              order by created_at desc limit 1`;
      return send(res, 200, {
        now, active: act ? act.code : null,
        games: games.map(x => ({ code: x.code, name: x.name, host: x.host_name, cfg: x.cfg, private: x.is_private, created_at: x.created_at, mine: String(x.host_id) === String(u.id) })),
      });
    }
    const code = String(req.query?.code || '').toUpperCase();
    if (!codeOk(code)) return fail(res, 400, 'Bad game code');
    let g = await load(sql, code);
    if (!g) return fail(res, 404, 'No game with that code');
    const r = roleOf(g, u);
    if (r) {
      if (r === 'host') await sql`update live_games set host_seen = now() where id = ${g.id}`;
      else await sql`update live_games set guest_seen = now() where id = ${g.id}`;
      if (g.status === 'playing' && g.start_at && nowDate.getTime() > new Date(g.start_at).getTime() + limitSecs(g.cfg.n) * 1000) {
        await finalize(req, u, sql, g, 'timeout');
        g = await load(sql, code);
      }
    }
    return send(res, 200, { now, game: view(g, u, nowDate) });
  }

  const { action } = req.body;
  const code = String(req.body.code || '').toUpperCase();

  if (action === 'create') {
    const [busy] = await sql`select code from live_games where status = 'playing' and (host_id = ${u.id} or guest_id = ${u.id}) limit 1`;
    if (busy) return fail(res, 409, 'Finish your current game first (' + busy.code + ').');
    const cfg = cleanCfg(req.body.cfg);
    const rawName = String(req.body.name || '').trim() || (u.name + '’s game');
    const s = screen(rawName.slice(0, 40));
    if (!s.ok) return fail(res, 422, s.reason === 'too_long' ? 'Keep the game name short.' : s.message);
    const name = s.text.slice(0, 30);
    const priv = !!req.body.private;
    let pass_hash = null;
    if (priv) {
      const pw = String(req.body.password || '');
      if (pw.length < 3) return fail(res, 400, 'Private games need a password of at least 3 characters.');
      if (pw.length > 50) return fail(res, 400, 'That password is too long.');
      pass_hash = await hashPassword(pw);
    }
    await leaveLobbies(sql, u);
    let row = null;
    for (let i = 0; i < 6 && !row; i++) {
      [row] = await sql`insert into live_games (code, name, host_id, is_private, pass_hash, cfg)
                        values (${newCode()}, ${name}, ${u.id}, ${priv}, ${pass_hash}, ${JSON.stringify(cfg)}::jsonb)
                        on conflict (code) do nothing returning code`;
    }
    if (!row) return fail(res, 500, 'Could not create a game, try again');
    await logEvent(req, u, 'live_create', { detail: { code: row.code, name, private: priv, cfg, flags: s.flags.length ? s.flags : undefined } });
    return send(res, 200, { code: row.code });
  }

  if (!codeOk(code)) return fail(res, 400, 'Bad game code');
  let g = await load(sql, code);
  if (!g) return fail(res, 404, 'No game with that code');
  const r = roleOf(g, u);

  if (action === 'join') {
    if (r) return send(res, 200, { code });
    if (g.status !== 'open' || g.guest_id) return fail(res, 409, g.status === 'open' ? 'That game is full.' : 'That game isn’t open any more.');
    const invited = g.invited_id && String(g.invited_id) === String(u.id);
    if (g.is_private && !invited) {
      const [{ n }] = await sql`select count(*)::int as n from activity_log where actor_user_id = ${u.id} and action = 'live_join_failed'
                                and at > now() - interval '10 minutes'`;
      if (n >= 10) return fail(res, 429, 'Too many wrong passwords. Try again in 10 minutes.');
      if (!(await verifyPassword(String(req.body.password || ''), g.pass_hash))) {
        await logEvent(req, u, 'live_join_failed', { detail: { code } });
        return fail(res, 403, 'Wrong password for that game.');
      }
    }
    const [busy] = await sql`select code from live_games where status = 'playing' and (host_id = ${u.id} or guest_id = ${u.id}) limit 1`;
    if (busy) return fail(res, 409, 'Finish your current game first (' + busy.code + ').');
    await leaveLobbies(sql, u);
    const ok = await sql`update live_games set guest_id = ${u.id}, guest_seen = now(), status = 'full', host_ready = false, guest_ready = false, updated_at = now()
                         where id = ${g.id} and status = 'open' and guest_id is null returning id`;
    if (!ok.length) return fail(res, 409, 'Someone else just joined that game.');
    await logEvent(req, u, 'live_join', { target: { id: g.host_id, email: g.host_email }, detail: { code, name: g.name, private: g.is_private } });
    return send(res, 200, { code });
  }

  if (!r) return fail(res, 403, 'You’re not in that game.');

  if (action === 'ready') {
    if (g.status !== 'full') return fail(res, 409, g.status === 'open' ? 'Waiting for an opponent.' : 'The game has already started.');
    const ready = req.body.ready !== false;
    if (r === 'host') await sql`update live_games set host_ready = ${ready}, host_seen = now(), updated_at = now() where id = ${g.id}`;
    else await sql`update live_games set guest_ready = ${ready}, guest_seen = now(), updated_at = now() where id = ${g.id}`;
    const qs = makeQuestions(g.cfg.n, g.cfg.ops, g.cfg.level, randomInt(2147483647));
    const started = await sql`update live_games set status = 'playing', questions = ${JSON.stringify(qs)}::jsonb,
                                start_at = now() + make_interval(secs => ${START_DELAY}), updated_at = now()
                              where id = ${g.id} and status = 'full' and host_ready and guest_ready returning start_at`;
    if (started.length) await logEvent(req, u, 'live_start', { detail: { code, host: g.host_name, guest: g.guest_name, cfg: g.cfg } });
    return send(res, 200, { ok: true, started: started.length > 0 });
  }

  if (action === 'progress') {
    if (g.status !== 'playing') return send(res, 200, { ok: false, status: g.status });
    const [{ early }] = await sql`select now() < ${g.start_at}::timestamptz - interval '1 second' as early`;
    if (early) return fail(res, 409, 'Not started yet');
    const n = g.cfg.n, p = r;
    const idx = Math.max(g[p + '_idx'], Math.min(n, parseInt(req.body.idx, 10) || 0));
    const wrong = Math.max(g[p + '_wrong'], Math.min(999, parseInt(req.body.wrong, 10) || 0));
    const finishing = idx >= n && !g[p + '_done_at'];
    let extra = null, raw = null;
    if (finishing) {
      raw = Number(req.body.raw); if (!Number.isFinite(raw) || raw <= 0) raw = null;
      const e = req.body.extra || {};
      extra = { splits: Array.isArray(e.splits) ? e.splits.slice(0, 60).map(Number).filter(Number.isFinite) : [],
                bestStreak: Math.min(999, parseInt(e.bestStreak, 10) || 0),
                wrongBy: Object.fromEntries(Object.entries(e.wrongBy || {}).filter(([k]) => OPS.includes(k)).map(([k, v]) => [k, Math.min(999, parseInt(v, 10) || 0)])) };
    }
    if (p === 'host') {
      await sql`update live_games set host_idx = ${idx}, host_wrong = ${wrong}, host_seen = now(), updated_at = now(),
                host_done_at = case when ${finishing} then now() else host_done_at end,
                host_raw = case when ${finishing} then ${raw}::double precision else host_raw end,
                host_extra = case when ${finishing} then ${JSON.stringify(extra)}::jsonb else host_extra end
                where id = ${g.id}`;
    } else {
      await sql`update live_games set guest_idx = ${idx}, guest_wrong = ${wrong}, guest_seen = now(), updated_at = now(),
                guest_done_at = case when ${finishing} then now() else guest_done_at end,
                guest_raw = case when ${finishing} then ${raw}::double precision else guest_raw end,
                guest_extra = case when ${finishing} then ${JSON.stringify(extra)}::jsonb else guest_extra end
                where id = ${g.id}`;
    }
    g = await load(sql, code);
    if (g.host_done_at && g.guest_done_at) await finalize(req, u, sql, g, 'finished');
    return send(res, 200, { ok: true });
  }

  if (action === 'leave') {
    if (g.status === 'playing') {
      await finalize(req, u, sql, g, 'forfeit', r);
      await logEvent(req, u, 'live_leave', { detail: { code, during: 'game' } });
    } else if (g.status === 'open' || g.status === 'full') {
      if (r === 'host') await sql`update live_games set status = 'cancelled', updated_at = now() where id = ${g.id}`;
      else await sql`update live_games set guest_id = null, guest_ready = false, host_ready = false, status = 'open', updated_at = now() where id = ${g.id}`;
      await logEvent(req, u, 'live_leave', { detail: { code, during: 'lobby', role: r } });
    }
    return send(res, 200, { ok: true });
  }

  if (action === 'claim') {
    if (g.status !== 'playing') return fail(res, 409, 'The game isn’t running.');
    const o = other(r);
    const [{ gone }] = await sql`select coalesce(${g[o + '_seen']}::timestamptz, now() - interval '1 hour') < now() - make_interval(secs => ${GONE}) as gone`;
    if (!gone || g[o + '_done_at']) return fail(res, 409, 'Your opponent is still here.');
    await finalize(req, u, sql, g, 'forfeit', o);
    return send(res, 200, { ok: true });
  }

  if (action === 'rematch') {
    if (g.status !== 'done') return fail(res, 409, 'Finish this game first.');
    if (g.rematch_code) return send(res, 200, { code: g.rematch_code });
    const otherId = r === 'host' ? g.guest_id : g.host_id;
    await leaveLobbies(sql, u);
    let row = null;
    for (let i = 0; i < 6 && !row; i++) {
      [row] = await sql`insert into live_games (code, name, host_id, invited_id, is_private, pass_hash, cfg)
                        values (${newCode()}, ${g.name}, ${u.id}, ${otherId}, ${g.is_private}, ${g.pass_hash}, ${JSON.stringify(g.cfg)}::jsonb)
                        on conflict (code) do nothing returning code`;
    }
    const set = await sql`update live_games set rematch_code = ${row.code} where id = ${g.id} and rematch_code is null returning rematch_code`;
    if (!set.length) { // the other player beat us to it: use theirs, drop ours
      await sql`update live_games set status = 'cancelled' where code = ${row.code}`;
      const [again] = await sql`select rematch_code from live_games where id = ${g.id}`;
      return send(res, 200, { code: again.rematch_code });
    }
    await logEvent(req, u, 'live_create', { detail: { code: row.code, rematch_of: code } });
    return send(res, 200, { code: row.code });
  }

  fail(res, 400, 'Unknown action');
});
