// Live games: two players, separate devices, polled (no websockets on Vercel functions).
// The server owns the clock: start_at is set server-side, finish times are checked against server time,
// and the result is decided here. Both players' battles are written server-side (cid "live-<id>").
//
// v2.8: three games, chosen when the game is created (cfg.game; games made before v2.8 have none = duel):
//   duel   - the same N questions on separate clocks; fastest total time (+3 s per wrong) wins.
//   sprint - 60 seconds, the same question stream; most correct wins (fewer wrong breaks a tie).
//   tol    - Truth or Lie, judged by the server round by round. Both devices reveal statement k at the same
//            server time. Each player gets one call per statement. The fastest correct call (reaction time
//            measured on the device, sanity-checked against the server clock) scores. First to 7 wins.
//            Statements go out one at a time and their answers only after the round, so nobody can peek.
//
// GET  /api/live?lobby=1                 -> { now, games:[open games], active: code|null }
// GET  /api/live?code=ABCDE              -> { now, game } (participants get full state; others a join preview)
// POST {action:'create', name, cfg:{game,ops,level,n}, private, password}
// POST {action:'join', code, password}
// POST {action:'ready', code, ready}
// POST {action:'progress', code, idx, wrong, raw?, extra?, final?}   (duel, sprint)
// POST {action:'call', code, k, said, rt}                           (tol)
// POST {action:'leave', code}            (in a running game this forfeits)
// POST {action:'claim', code}            (opponent silent for 25 s -> win by forfeit)
// POST {action:'rematch', code}
import { randomInt } from 'node:crypto';
import { route, send, fail, db, requireUser, hashPassword, verifyPassword, logEvent } from './_lib.js';
import { screen } from './_safety.js';
import { makeQuestions, makeTol, RANGES, OPS } from './_questions.js';
import { ensureSchema } from './_schema.js';
import { battleCoins, awardBattle } from './_economy.js';

const PENALTY = 3;
const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const START_DELAY = 5;          // seconds from "both ready" to GO
const STALE_LOBBY = 60;         // host/guest silent this long in the lobby -> dropped
const GONE = 25;                // opponent silent this long mid-game -> claimable
const ACTIVE = ['open', 'full', 'playing'];
const GAMES = ['duel', 'tol', 'sprint'];
const SPRINT_SECS = 60, SPRINT_Q = 400, SPRINT_MAX = 150;
const TOL_TARGET = 7, TOL_MAX = 25;
const TOL_WINDOW = 6000;        // ms to make a call once a statement is up
const TOL_GAP = 1800;           // ms between a round ending and the next statement (time to show who scored)
const TOL_LEAD = 1200;          // ms before the reveal that the statement text is sent, so both devices show it on time

const gameOf = cfg => (cfg && GAMES.includes(cfg.game) ? cfg.game : 'duel');
const limitSecs = cfg => {
  const g = gameOf(cfg);
  if (g === 'sprint') return SPRINT_SECS + 15;
  if (g === 'tol') return Math.ceil(TOL_MAX * (TOL_WINDOW + TOL_GAP) / 1000) + 15;
  return Math.max(120, cfg.n * 20);
};

const newCode = () => Array.from({ length: 5 }, () => CODE_ABC[randomInt(CODE_ABC.length)]).join('');
const codeOk = c => /^[A-Z0-9]{5}$/.test(c);
const other = r => (r === 'host' ? 'guest' : 'host');
const ms = t => new Date(t).getTime();
const iso = t => new Date(t).toISOString();

function cleanCfg(c) {
  c = c || {};
  const game = GAMES.includes(c.game) ? c.game : 'duel';
  const ops = Array.isArray(c.ops) ? [...new Set(c.ops.filter(o => OPS.includes(o)))] : [];
  const level = RANGES[c.level] ? c.level : 'medium';
  const n = game === 'sprint' ? SPRINT_Q : game === 'tol' ? TOL_MAX : ([5, 10, 15, 20, 30].includes(Number(c.n)) ? Number(c.n) : 10);
  return { game, ops: ops.length ? ops : OPS.slice(), level, n };
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

// ---------- Truth or Lie: the whole game follows from the start time and the two players' calls ----------
// calls live in host_extra.calls / guest_extra.calls as { "<k>": { s: 1|0 (said true), rt: ms, at: server ms } }.
// Each player only ever writes their own column, so the two devices can't overwrite each other.
function tolTimeline(g, nowMs) {
  const qs = g.questions || [], C = { host: (g.host_extra && g.host_extra.calls) || {}, guest: (g.guest_extra && g.guest_extra.calls) || {} };
  const sc = { host: 0, guest: 0 }, wrong = { host: 0, guest: 0 }, rts = { host: [], guest: [] }, rounds = [];
  let R = ms(g.start_at);
  for (let k = 0; k < qs.length; k++) {
    const h = C.host[k], x = C.guest[k], closes = R + TOL_WINDOW;
    if (!(h && x) && nowMs < closes) return { sc, wrong, rts, rounds, cur: { k, R, closes }, done: false, C };
    const res = { k, end: h && x ? Math.max(h.at, x.at) : closes, winner: null };
    for (const [side, c] of [['host', h], ['guest', x]]) {
      if (!c) { res[side] = null; continue; }
      const ok = (c.s === 1) === !!qs[k].truth;
      res[side] = { s: c.s, rt: c.rt, ok };
      if (!ok) wrong[side]++;
    }
    const hOk = res.host && res.host.ok, xOk = res.guest && res.guest.ok;
    if (hOk && xOk) res.winner = h.rt < x.rt ? 'host' : x.rt < h.rt ? 'guest' : (h.at <= x.at ? 'host' : 'guest');
    else if (hOk) res.winner = 'host';
    else if (xOk) res.winner = 'guest';
    if (res.winner) { sc[res.winner]++; rts[res.winner].push(res[res.winner].rt); }
    rounds.push(res);
    if (sc.host >= TOL_TARGET || sc.guest >= TOL_TARGET) return { sc, wrong, rts, rounds, cur: null, done: true, endMs: res.end, C };
    R = res.end + TOL_GAP;
  }
  return { sc, wrong, rts, rounds, cur: null, done: true, endMs: R - TOL_GAP, C };
}

function tolView(g, r, nowMs) {
  const T = tolTimeline(g, nowMs), qs = g.questions || [];
  const last = T.rounds[T.rounds.length - 1];
  const cur = T.cur;
  return {
    target: TOL_TARGET, max: TOL_MAX, window: TOL_WINDOW, score: T.sc, wrong: T.wrong,
    round: cur ? {
      k: cur.k, at: iso(cur.R), closes: iso(cur.closes),
      text: nowMs >= cur.R - TOL_LEAD ? qs[cur.k].text : null,
      mine: T.C[r][cur.k] ? { s: T.C[r][cur.k].s, rt: T.C[r][cur.k].rt } : null,
      oppCalled: !!T.C[other(r)][cur.k],
    } : null,
    last: last ? { k: last.k, text: qs[last.k].text, truth: !!qs[last.k].truth, host: last.host, guest: last.guest, winner: last.winner } : null,
  };
}

function side(g, r, nowMs) {
  const p = r === 'host' ? 'host' : 'guest';
  const id = g[p + '_id'];
  if (!id) return null;
  const seen = g[p + '_seen'] ? ms(g[p + '_seen']) : 0;
  return {
    name: g[p + '_name'], ready: g[p + '_ready'], idx: g[p + '_idx'], wrong: g[p + '_wrong'],
    done: !!g[p + '_done_at'], online: nowMs - seen < GONE * 1000,
  };
}

function view(g, u, nowDate) {
  const r = roleOf(g, u), nowMs = nowDate.getTime(), game = gameOf(g.cfg);
  const startMs = g.start_at ? ms(g.start_at) : null;
  const cfg = { ...g.cfg, game };
  const base = { id: String(g.id), code: g.code, name: g.name, status: g.status, private: g.is_private, cfg, host: { name: g.host_name }, created_at: g.created_at };
  if (!r) return { ...base, you: null, invited: g.invited_id && String(g.invited_id) === String(u.id) };
  const opp = side(g, other(r), nowMs);
  const out = {
    ...base, you: r, start_at: g.start_at, limit: limitSecs(g.cfg),
    host: side(g, 'host', nowMs), guest: side(g, 'guest', nowMs),
    // Questions (with answers) only go out 3.5 s before GO, so nobody can practise them in the lobby.
    // Truth or Lie never sends its answers ahead: see tolView.
    questions: game !== 'tol' && g.questions && startMs && nowMs >= startMs - 3500 ? g.questions : null,
    result: g.result, rematch_code: g.rematch_code,
    opp_gone: g.status === 'playing' && !!opp && !opp.online && !opp.done,
  };
  if (game === 'sprint') out.sprint = SPRINT_SECS;
  if (game === 'tol' && g.status === 'playing' && startMs) out.tol = tolView(g, r, nowMs);
  return out;
}

function battleFor(g, r, res) {
  const game = gameOf(g.cfg), me = res[r], them = res[other(r)];
  const winner = res.winner == null ? -1 : res.winner === r ? 0 : 1;
  const ex = s => g[s + '_extra'] || {};
  let players;
  if (game === 'tol') {
    players = [r, other(r)].map(s => ({ name: g[s + '_name'], score: res[s].score, wrong: res[s].wrong, avgRt: res[s].avgRt, dnf: res[s].dnf || undefined }));
  } else if (game === 'sprint') {
    players = [r, other(r)].map(s => ({ name: g[s + '_name'], score: res[s].score, wrong: res[s].wrong,
      splits: ex(s).splits || [], bestStreak: ex(s).bestStreak || 0, wrongBy: ex(s).wrongBy || {} }));
  } else {
    const pl = (s, name, extra) => ({
      name, time: s.time, raw: s.raw, wrong: s.wrong, dnf: s.dnf || undefined,
      splits: (extra && extra.splits) || [], bestStreak: (extra && extra.bestStreak) || 0, wrongBy: (extra && extra.wrongBy) || {},
    });
    players = [pl(me, g[r + '_name'], ex(r)), pl(them, g[other(r) + '_name'], ex(other(r)))];
  }
  return {
    cid: 'live-' + g.id, at: iso(g.start_at), game, mode: 'live', cfg: { ...g.cfg, game }, winner,
    live: { code: g.code, reason: res.reason, role: r },
    players,
  };
}

function duelResult(g, nowMs, reason, loser) {
  const startMs = ms(g.start_at), res = { reason };
  for (const r of ['host', 'guest']) {
    const done = g[r + '_done_at'] ? ms(g[r + '_done_at']) : null;
    const serverRaw = ((done || nowMs) - startMs) / 1000;
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
  return res;
}

function sprintResult(g, nowMs, reason, loser) {
  const res = { reason: reason === 'timeout' ? 'finished' : reason };
  for (const r of ['host', 'guest']) {
    const ex = g[r + '_extra'] || {};
    res[r] = { score: g[r + '_idx'], wrong: g[r + '_wrong'], splits: ex.splits || [], bestStreak: ex.bestStreak || 0 };
  }
  if (reason === 'forfeit') res.winner = other(loser);
  else {
    const h = res.host, x = res.guest;
    res.winner = h.score !== x.score ? (h.score > x.score ? 'host' : 'guest') : h.wrong !== x.wrong ? (h.wrong < x.wrong ? 'host' : 'guest') : null;
  }
  return res;
}

function tolResult(g, nowMs, reason, loser) {
  const T = tolTimeline(g, nowMs), res = { reason: reason === 'timeout' ? 'finished' : reason };
  const avg = a => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length / 1000).toFixed(2) : null);
  for (const r of ['host', 'guest']) res[r] = { score: T.sc[r], wrong: T.wrong[r], avgRt: avg(T.rts[r]) };
  if (reason === 'forfeit') res.winner = other(loser);
  else res.winner = T.sc.host === T.sc.guest ? null : T.sc.host > T.sc.guest ? 'host' : 'guest';
  return res;
}

// Decide the result once. reason: finished | timeout | forfeit. loser: role that forfeited (forfeit only).
async function finalize(req, actor, sql, g, reason, loser) {
  const [{ now }] = await sql`select now()`;
  const game = gameOf(g.cfg), nowMs = ms(now);
  const res = (game === 'tol' ? tolResult : game === 'sprint' ? sprintResult : duelResult)(g, nowMs, reason, loser);

  const upd = await sql`update live_games set status = 'done', result = ${JSON.stringify(res)}::jsonb, updated_at = now()
                        where id = ${g.id} and status = 'playing' returning id`;
  if (!upd.length) return null; // someone else finalised first
  if (g.guest_id) {
    for (const [r, uid] of [['host', g.host_id], ['guest', g.guest_id]]) {
      const b = battleFor(g, r, res);
      const ins = await sql`insert into battles (user_id, client_id, game, played_at, data)
                            values (${uid}, ${b.cid}, ${b.game}, ${b.at}, ${JSON.stringify(b)}::jsonb)
                            on conflict (user_id, client_id) do nothing returning id`;
      if (ins.length) await awardBattle(sql, uid, battleCoins(b));
    }
  }
  const brief = r => (game === 'duel' ? { name: g[r + '_name'], ...res[r] } : { name: g[r + '_name'], score: res[r].score, wrong: res[r].wrong });
  await logEvent(req, actor, 'live_finish', {
    detail: { code: g.code, game, reason: res.reason, winner: res.winner ? g[res.winner + '_name'] : 'draw', host: brief('host'), guest: brief('guest') },
  });
  return res;
}

// Finish a running game whose time is up (or, for Truth or Lie, whose last round has been decided).
async function settle(req, u, sql, g, nowMs) {
  if (g.status !== 'playing' || !g.start_at) return false;
  if (gameOf(g.cfg) === 'tol' && tolTimeline(g, nowMs).done) { await finalize(req, u, sql, g, 'finished'); return true; }
  if (nowMs > ms(g.start_at) + limitSecs(g.cfg) * 1000) { await finalize(req, u, sql, g, 'timeout'); return true; }
  return false;
}

export default route(['GET', 'POST'], async (req, res) => {
  const u = await requireUser(req, res); if (!u) return;
  await ensureSchema();
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
        games: games.map(x => ({ code: x.code, name: x.name, host: x.host_name, cfg: { ...x.cfg, game: gameOf(x.cfg) }, private: x.is_private, created_at: x.created_at, mine: String(x.host_id) === String(u.id) })),
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
      if (await settle(req, u, sql, g, nowDate.getTime())) g = await load(sql, code);
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
    await logEvent(req, u, 'live_join', { target: { id: g.host_id, email: g.host_email }, detail: { code, name: g.name, private: g.is_private, game: gameOf(g.cfg) } });
    return send(res, 200, { code });
  }

  if (!r) return fail(res, 403, 'You’re not in that game.');

  if (action === 'ready') {
    if (g.status !== 'full') return fail(res, 409, g.status === 'open' ? 'Waiting for an opponent.' : 'The game has already started.');
    const ready = req.body.ready !== false;
    if (r === 'host') await sql`update live_games set host_ready = ${ready}, host_seen = now(), updated_at = now() where id = ${g.id}`;
    else await sql`update live_games set guest_ready = ${ready}, guest_seen = now(), updated_at = now() where id = ${g.id}`;
    const game = gameOf(g.cfg), seed = randomInt(2147483647);
    const qs = game === 'tol' ? makeTol(TOL_MAX, g.cfg.ops, g.cfg.level, seed)
      : makeQuestions(game === 'sprint' ? SPRINT_Q : g.cfg.n, g.cfg.ops, g.cfg.level, seed);
    const started = await sql`update live_games set status = 'playing', questions = ${JSON.stringify(qs)}::jsonb,
                                start_at = now() + make_interval(secs => ${START_DELAY}), updated_at = now()
                              where id = ${g.id} and status = 'full' and host_ready and guest_ready returning start_at`;
    if (started.length) await logEvent(req, u, 'live_start', { detail: { code, game, host: g.host_name, guest: g.guest_name, cfg: g.cfg } });
    return send(res, 200, { ok: true, started: started.length > 0 });
  }

  if (action === 'progress') {
    if (g.status !== 'playing') return send(res, 200, { ok: false, status: g.status });
    const game = gameOf(g.cfg);
    if (game === 'tol') return fail(res, 400, 'Truth or Lie uses calls, not progress.');
    const [{ now }] = await sql`select now()`;
    const nowMs = ms(now), startMs = ms(g.start_at);
    if (nowMs < startMs - 1000) return fail(res, 409, 'Not started yet');
    const p = r;
    let idx, finishing;
    if (game === 'sprint') {
      // Correct answers so far, capped at a pace no child (or adult) can beat.
      const plausible = Math.min(SPRINT_MAX, Math.floor(Math.max(0, nowMs - startMs) / 1000 * 2.5) + 3);
      idx = Math.max(g[p + '_idx'], Math.min(plausible, parseInt(req.body.idx, 10) || 0));
      finishing = !!req.body.final && !g[p + '_done_at'] && nowMs >= startMs + (SPRINT_SECS - 3) * 1000;
    } else {
      const n = g.cfg.n;
      idx = Math.max(g[p + '_idx'], Math.min(n, parseInt(req.body.idx, 10) || 0));
      finishing = idx >= n && !g[p + '_done_at'];
    }
    const wrong = Math.max(g[p + '_wrong'], Math.min(999, parseInt(req.body.wrong, 10) || 0));
    let extra = null, raw = null;
    if (finishing) {
      raw = Number(req.body.raw); if (!Number.isFinite(raw) || raw <= 0) raw = null;
      const e = req.body.extra || {};
      extra = { splits: Array.isArray(e.splits) ? e.splits.slice(0, 160).map(Number).filter(Number.isFinite) : [],
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

  if (action === 'call') {
    if (gameOf(g.cfg) !== 'tol') return fail(res, 400, 'Only Truth or Lie takes calls.');
    if (g.status !== 'playing') return send(res, 200, { ok: false, status: g.status });
    const [{ now }] = await sql`select now()`;
    const nowMs = ms(now), T = tolTimeline(g, nowMs), k = parseInt(req.body.k, 10);
    if (!T.cur || T.cur.k !== k) return send(res, 200, { ok: false, late: true, game: view(g, u, new Date(now)) });
    if (nowMs < T.cur.R - 600) return fail(res, 409, 'Wait for the statement.');
    // Reaction time from the device, kept honest by the server clock: never faster than it could have
    // been given the network (2.5 s allowance), never slower than when the call actually arrived.
    const serverRt = nowMs - T.cur.R;
    let rt = Number(req.body.rt);
    if (!Number.isFinite(rt)) rt = serverRt;
    rt = Math.round(Math.max(200, Math.max(serverRt - 2500, Math.min(serverRt + 300, rt))));
    const call = JSON.stringify({ s: req.body.said ? 1 : 0, rt, at: nowMs }), key = String(k);
    if (r === 'host') {
      await sql`update live_games set host_extra = jsonb_set(coalesce(host_extra, '{}'::jsonb), '{calls}',
                  coalesce(host_extra->'calls', '{}'::jsonb) || jsonb_build_object(${key}::text, ${call}::jsonb)),
                  host_seen = now(), updated_at = now()
                where id = ${g.id} and status = 'playing' and not (coalesce(host_extra->'calls', '{}'::jsonb) ? ${key})`;
    } else {
      await sql`update live_games set guest_extra = jsonb_set(coalesce(guest_extra, '{}'::jsonb), '{calls}',
                  coalesce(guest_extra->'calls', '{}'::jsonb) || jsonb_build_object(${key}::text, ${call}::jsonb)),
                  guest_seen = now(), updated_at = now()
                where id = ${g.id} and status = 'playing' and not (coalesce(guest_extra->'calls', '{}'::jsonb) ? ${key})`;
    }
    g = await load(sql, code);
    if (await settle(req, u, sql, g, nowMs)) g = await load(sql, code);
    return send(res, 200, { ok: true, game: view(g, u, new Date(now)) });
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
