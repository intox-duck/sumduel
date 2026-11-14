// Party games (v3.1): two to four players, each on their own device. One so far: Treasure Dive ('dive').
//
// Treasure Dive: every diver gets the same sum at the same server time, with four answers to pick from.
//   Right answer: dive 2 m. The fastest right answer dives 1 m more. Wrong answer: float up 1 m (never above 0).
//   No answer: stay put. The last round is golden: everything counts double. Deepest diver after n rounds wins
//   (ties: more right answers, then the quicker average). A round closes when every diver still in the game has
//   answered, or after WINDOW. Reaction times are measured on the device and checked against the server clock,
//   the same way as live Truth or Lie, so a slow connection doesn't lose rounds.
//
// Party games live in live_games, like the two-player games, with NO schema change. The columns mean:
//   host_id     whoever holds the room: the creator, passed to the next diver if they leave the lobby
//   guest_id    always null, so the two-player queries (host_id/guest_id) never pick up a party game
//   host_idx    seats taken (1-4). A plain column, so two people joining at once can't overfill the room
//   host_seen   the last time ANYONE in the room was seen (so live.js housekeeping closes rooms everyone left)
//   host_extra  { seats: { "<user id>": { n: name, o: joined ms, r: ready, s: last seen ms, l: left ms } },
//                 calls: { "<user id>": { "<k>": { c: choice 0-3, rt: reaction ms, at: server ms } } },
//                 inv: [user ids invited to a rematch: they skip the password] }
//   questions   [{ text, choices: [4 strings], ans: index, op }]   (makeDive; answers never go out early)
//   result      { reason, players: [{ id, name, depth, right, wrong, fast, avgRt, place, dnf }], last }
// Every write only touches the writer's own keys (jsonb_set on seats.<id> or calls.<id>), so devices can't
// overwrite each other, and the whole game follows from start_at and the calls (diveTimeline), like Truth or Lie.
import { randomInt } from 'node:crypto';
import { send, fail, verifyPassword, logEvent } from './_lib.js';
import { makeLiveQuestions } from './_questions.js';
import { battleCoins, awardBattle } from './_economy.js';

export const PARTY_GAMES = ['dive'];
export const isParty = cfg => !!cfg && PARTY_GAMES.includes(cfg.game);
export const MAX_SEATS = 4, MIN_SEATS = 2;
export const DIVE_NS = [6, 10, 15];       // rounds, chosen in the lobby
const WINDOW = 10000;    // ms to answer once the sum is up
const GAP = 2800;        // ms between a round closing and the next sum (time to show who dived where)
const LEAD = 1200;       // ms before the reveal that the sum is sent, so every device shows it on time
const SLACK = 1200;      // ms a device's reaction time may undercut the server-measured one
const START_DELAY = 5;   // s from "everyone ready" to the first sum's countdown ending
const STALE_LOBBY = 60;  // s silent in the lobby -> seat given up
const GONE = 25;         // s silent mid-game -> counted as gone (left), so rounds stop waiting for them
const SEEN_EVERY = 3000; // ms: a poll only rewrites "last seen" this often
export const diveLimit = n => Math.ceil(n * (WINDOW + GAP) / 1000) + 20;

const ms = t => new Date(t).getTime();
const iso = t => new Date(t).toISOString();
const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 5 }, () => CODE_ABC[randomInt(CODE_ABC.length)]).join('');

const seatMap = g => (g.host_extra && g.host_extra.seats) || {};
export function seatsOf(g) {
  return Object.entries(seatMap(g)).map(([id, s]) => ({ id, ...s })).sort((a, b) => (a.o || 0) - (b.o || 0) || (a.id < b.id ? -1 : 1));
}
export const isSeated = (g, u) => !!seatMap(g)[String(u.id)];
const invitedOf = (g, uid) => Array.isArray(g.host_extra && g.host_extra.inv) && g.host_extra.inv.map(String).includes(uid);
export const newPartyExtra = (u, nowMs, inv) => ({ seats: { [String(u.id)]: { n: u.name, o: nowMs, r: false, s: nowMs } }, calls: {}, ...(inv ? { inv } : {}) });

async function reload(sql, id) {
  const [g] = await sql`select g.*, h.name as host_name, h.email as host_email from live_games g join users h on h.id = g.host_id where g.id = ${id}`;
  return g || null;
}

// ---------- membership across every kind of room (two-player games use host_id/guest_id; party games, seats) ----------
// The game this player is playing right now, if any (one game at a time). A diver who left a party game is free.
export async function busyCode(sql, u) {
  const uid = String(u.id);
  const [b] = await sql`select code from live_games where status = 'playing' and (
      (not (coalesce(cfg->>'game', 'duel') = any(${PARTY_GAMES})) and (host_id = ${u.id} or guest_id = ${u.id}))
      or (host_extra->'seats'->${uid} is not null and host_extra->'seats'->${uid}->>'l' is null)) limit 1`;
  return b ? b.code : null;
}
// Leave whatever lobby this user is sitting in (one active game per player).
export async function leaveLobbies(sql, u) {
  const uid = String(u.id);
  await sql`update live_games set status = 'cancelled', updated_at = now()
            where host_id = ${u.id} and status in ('open','full') and not (coalesce(cfg->>'game', 'duel') = any(${PARTY_GAMES}))`;
  await sql`update live_games set guest_id = null, guest_ready = false, host_ready = false, status = 'open', updated_at = now()
            where guest_id = ${u.id} and status = 'full'`;
  const rooms = await sql`select g.*, h.name as host_name from live_games g join users h on h.id = g.host_id
                          where g.status in ('open','full') and coalesce(g.host_extra->'seats', '{}'::jsonb) ? ${uid}`;
  for (const g of rooms) await dropSeat(sql, g, uid);
}
// The active room code for the lobby's "You're in game X" bar.
export async function activeCode(sql, u) {
  const uid = String(u.id);
  const [a] = await sql`select code from live_games where status = any(${['open', 'full', 'playing']}) and (
      (not (coalesce(cfg->>'game', 'duel') = any(${PARTY_GAMES})) and (host_id = ${u.id} or guest_id = ${u.id}))
      or (host_extra->'seats'->${uid} is not null and host_extra->'seats'->${uid}->>'l' is null))
      order by created_at desc limit 1`;
  return a ? a.code : null;
}

// Give up a seat in a lobby. The room passes to the next diver, or closes if nobody's left.
async function dropSeat(sql, g, uid) {
  const rest = seatsOf(g).filter(s => s.id !== uid);
  if (!rest.length) {
    await sql`update live_games set status = 'cancelled', updated_at = now() where id = ${g.id} and status in ('open','full')`;
    return;
  }
  const host = String(g.host_id) === uid ? rest[0].id : String(g.host_id);
  await sql`update live_games set host_extra = host_extra #- array['seats', ${uid}::text], host_idx = greatest(0, host_idx - 1),
              host_id = ${host}, status = 'open', updated_at = now()
            where id = ${g.id} and status in ('open','full') and host_extra->'seats' ? ${uid}`;
}

// ---------- the game: everything follows from start_at, the seats and the calls ----------
export function diveTimeline(g, nowMs) {
  const qs = g.questions || [], seats = seatsOf(g), calls = (g.host_extra && g.host_extra.calls) || {};
  const st = {};
  for (const s of seats) st[s.id] = { depth: 0, right: 0, wrong: 0, fast: 0, rts: [] };
  const rounds = [];
  let R = ms(g.start_at);
  for (let k = 0; k < qs.length; k++) {
    // A round waits for everyone who hadn't left by the time it was revealed. Fewer than two: the game is over.
    const need = seats.filter(s => !(s.l && s.l <= R)).map(s => s.id);
    if (need.length < MIN_SEATS) return { st, rounds, cur: null, done: true, short: true };
    const closes = R + WINDOW, got = need.filter(id => calls[id] && calls[id][k]);
    if (got.length < need.length && nowMs < closes) return { st, rounds, cur: { k, R, closes }, done: false };
    const end = got.length === need.length ? Math.max(R, ...got.map(id => calls[id][k].at)) : closes;
    const gold = k === qs.length - 1, mult = gold ? 2 : 1, res = { k, end, gold, picks: {}, fastest: null };
    let best = null;
    for (const id of got) {
      const c = calls[id][k], ok = c.c === qs[k].ans;
      res.picks[id] = { c: c.c, ok, rt: c.rt };
      if (ok && (!best || c.rt < best.rt || (c.rt === best.rt && c.at < best.at))) best = { id, rt: c.rt, at: c.at };
    }
    if (best) res.fastest = best.id;
    for (const id of got) {
      const p = res.picks[id], s = st[id], before = s.depth;
      if (p.ok) {
        s.right++; s.rts.push(p.rt);
        s.depth += (2 + (id === res.fastest ? 1 : 0)) * mult;
        if (id === res.fastest) s.fast++;
      } else { s.wrong++; s.depth = Math.max(0, s.depth - mult); }
      p.d = s.depth - before;
    }
    rounds.push(res);
    R = end + GAP;
  }
  return { st, rounds, cur: null, done: true };
}

const roundOut = (qs, L) => (L ? { k: L.k, text: qs[L.k].text, choices: qs[L.k].choices, ans: qs[L.k].ans, picks: L.picks, fastest: L.fastest, gold: L.gold } : null);

function diveView(g, uid, nowMs) {
  const T = diveTimeline(g, nowMs), qs = g.questions || [], calls = (g.host_extra && g.host_extra.calls) || {};
  const depth = {};
  for (const id in T.st) depth[id] = T.st[id].depth;
  const cur = T.cur, show = cur && nowMs >= cur.R - LEAD;
  return {
    n: qs.length, window: WINDOW, depth,
    round: cur ? {
      k: cur.k, at: iso(cur.R), closes: iso(cur.closes), gold: cur.k === qs.length - 1,
      // The sum and its four answers go out just before the reveal; which one is right only after the round.
      text: show ? qs[cur.k].text : null, choices: show ? qs[cur.k].choices : null,
      mine: calls[uid] && calls[uid][cur.k] ? { c: calls[uid][cur.k].c, rt: calls[uid][cur.k].rt } : null,
      called: Object.keys(calls).filter(id => calls[id] && calls[id][cur.k]),
    } : null,
    last: roundOut(qs, T.rounds[T.rounds.length - 1]),
  };
}

export function partyView(g, u, nowDate) {
  const nowMs = nowDate.getTime(), uid = String(u.id), seats = seatsOf(g);
  const base = { id: String(g.id), code: g.code, name: g.name, status: g.status, private: g.is_private, cfg: { ...g.cfg }, party: true,
    max: MAX_SEATS, min: MIN_SEATS, count: seats.length, host: { name: g.host_name }, created_at: g.created_at };
  if (!seatMap(g)[uid]) return { ...base, you: null, seats: seats.map(s => ({ name: s.n })), invited: invitedOf(g, uid) };
  const startMs = g.start_at ? ms(g.start_at) : null;
  return {
    ...base, you: 'seat', me: uid, start_at: g.start_at, limit: diveLimit(g.cfg.n),
    seats: seats.map(s => ({ id: s.id, name: s.n, ready: !!s.r, online: nowMs - (s.s || 0) < GONE * 1000, left: !!s.l, host: s.id === String(g.host_id) })),
    dive: g.status === 'playing' && startMs ? diveView(g, uid, nowMs) : null,
    result: g.result, rematch_code: g.rematch_code,
  };
}

// ---------- the result, decided once ----------
function diveResult(g, nowMs, reason) {
  const T = diveTimeline(g, nowMs), qs = g.questions || [];
  const avg = a => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length / 1000).toFixed(2) : null);
  const rows = seatsOf(g).map(s => {
    const t = T.st[s.id];
    return { id: s.id, name: s.n, depth: t.depth, right: t.right, wrong: t.wrong, fast: t.fast, avgRt: avg(t.rts), dnf: !!s.l };
  });
  // Divers who left come last. Then deepest first; ties go to more right answers, then the quicker average.
  const key = r => [r.dnf ? 1 : 0, -r.depth, -r.right, r.avgRt == null ? 1e9 : r.avgRt];
  const cmp = (a, b) => { const x = key(a), y = key(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
  rows.sort(cmp);
  rows.forEach((r, i) => { r.place = i && cmp(r, rows[i - 1]) === 0 ? rows[i - 1].place : i + 1; });
  return { reason, players: rows, rounds: T.rounds.length, last: roundOut(qs, T.rounds[T.rounds.length - 1]) };
}

// The battle record from one diver's side: them first, then everyone else by place. winner: 0 = I won outright,
// -1 = I shared first place, 1 = someone else won (the same meaning the record and the players dashboard use).
export function partyBattle(g, res, uid) {
  const me = res.players.find(p => p.id === uid), others = res.players.filter(p => p.id !== uid);
  const top = res.players.filter(p => p.place === 1 && !p.dnf);
  const winner = !me || me.dnf || me.place !== 1 ? 1 : top.length > 1 ? -1 : 0;
  return {
    cid: 'live-' + g.id, at: iso(g.start_at), game: g.cfg.game, mode: 'live', cfg: { ...g.cfg }, winner,
    place: me ? me.place : res.players.length, of: res.players.length,
    live: { code: g.code, reason: res.reason, role: 'seat' },
    players: (me ? [me] : []).concat(others).map(p => ({ name: p.name, depth: p.depth, right: p.right, wrong: p.wrong, avgRt: p.avgRt, place: p.place, dnf: p.dnf || undefined })),
  };
}

async function finalize(req, actor, sql, g, reason) {
  const [{ now }] = await sql`select now()`;
  const res = diveResult(g, ms(now), reason);
  const upd = await sql`update live_games set status = 'done', result = ${JSON.stringify(res)}::jsonb, updated_at = now()
                        where id = ${g.id} and status = 'playing' returning id`;
  if (!upd.length) return null; // someone else finalised first
  for (const p of res.players) {
    const b = partyBattle(g, res, p.id);
    const ins = await sql`insert into battles (user_id, client_id, game, played_at, data)
                          values (${p.id}, ${b.cid}, ${b.game}, ${b.at}, ${JSON.stringify(b)}::jsonb)
                          on conflict (user_id, client_id) do nothing returning id`;
    if (ins.length) await awardBattle(sql, p.id, battleCoins(b));
  }
  const top = res.players.filter(p => p.place === 1 && !p.dnf);
  await logEvent(req, actor, 'live_finish', {
    detail: { code: g.code, game: g.cfg.game, reason, winner: top.length === 1 ? top[0].name : 'draw',
              players: res.players.map(p => ({ name: p.name, depth: p.depth, right: p.right, wrong: p.wrong, place: p.place, dnf: p.dnf })) },
  });
  return res;
}

// Finish a running game that's over: every round played, fewer than two divers left, or out of time.
async function settle(req, u, sql, g, nowMs) {
  if (g.status !== 'playing' || !g.start_at) return false;
  const T = diveTimeline(g, nowMs);
  const stillIn = seatsOf(g).filter(s => !s.l).length;
  if (stillIn < MIN_SEATS) { await finalize(req, u, sql, g, 'forfeit'); return true; }
  if (T.done) { await finalize(req, u, sql, g, T.short ? 'forfeit' : 'finished'); return true; }
  if (nowMs > ms(g.start_at) + diveLimit(g.cfg.n) * 1000) { await finalize(req, u, sql, g, 'timeout'); return true; }
  return false;
}

// GET /api/live?code=X for a party room. Members keep their seat alive, tidy up silent seats, and settle the game.
export async function partyGet(req, u, sql, g, nowDate) {
  const uid = String(u.id), nowMs = nowDate.getTime(), seat = seatMap(g)[uid];
  if (!seat) return partyView(g, u, nowDate);
  let changed = false;
  if (nowMs - (seat.s || 0) > SEEN_EVERY) {
    await sql`update live_games set host_extra = jsonb_set(host_extra, array['seats', ${uid}::text, 's'], to_jsonb(${nowMs}::bigint)), host_seen = now()
              where id = ${g.id} and host_extra->'seats' ? ${uid}`;
    changed = true;
  }
  const others = seatsOf(g).filter(s => s.id !== uid);
  if (g.status === 'open' || g.status === 'full') {
    // A diver silent for a minute gives up their seat; a room whose holder has gone passes to the next diver.
    for (const s of others) if (nowMs - (s.s || 0) > STALE_LOBBY * 1000) { await dropSeat(sql, await reload(sql, g.id), s.id); changed = true; }
    const fresh = changed ? await reload(sql, g.id) : g;
    if (fresh && !seatMap(fresh)[String(fresh.host_id)] && seatMap(fresh)[uid]) {
      await sql`update live_games set host_id = ${uid} where id = ${g.id} and host_id = ${fresh.host_id}`;
      changed = true;
    }
  } else if (g.status === 'playing') {
    // Mid-game, a diver silent for GONE seconds counts as gone: rounds stop waiting for them from the next one.
    for (const s of others) {
      if (!s.l && nowMs - (s.s || 0) > GONE * 1000) {
        await sql`update live_games set host_extra = jsonb_set(host_extra, array['seats', ${s.id}::text, 'l'], to_jsonb(${nowMs}::bigint)), updated_at = now()
                  where id = ${g.id} and status = 'playing' and (host_extra->'seats'->${s.id}->>'l') is null`;
        changed = true;
      }
    }
    if (changed) g = await reload(sql, g.id);
    if (await settle(req, u, sql, g, nowMs)) changed = true;
  }
  return partyView(changed ? await reload(sql, g.id) : g, u, nowDate);
}

// POST actions on a party room (create is handled in live.js, which builds the row with newPartyExtra).
export async function partyAction(req, res, u, sql, g, action) {
  const uid = String(u.id), code = g.code;
  const [{ now }] = await sql`select now()`;
  const nowMs = ms(now), seat = seatMap(g)[uid];

  if (action === 'join') {
    if (seat) return send(res, 200, { code });
    if (g.status !== 'open' || g.host_idx >= MAX_SEATS) return fail(res, 409, g.status === 'full' || g.status === 'open' ? 'That game is full.' : 'That game isn’t open any more.');
    if (g.is_private && !invitedOf(g, uid)) {
      const [{ n }] = await sql`select count(*)::int as n from activity_log where actor_user_id = ${u.id} and action = 'live_join_failed'
                                and at > now() - interval '10 minutes'`;
      if (n >= 10) return fail(res, 429, 'Too many wrong passwords. Try again in 10 minutes.');
      if (!(await verifyPassword(String(req.body.password || ''), g.pass_hash))) {
        await logEvent(req, u, 'live_join_failed', { detail: { code } });
        return fail(res, 403, 'Wrong password for that game.');
      }
    }
    const busy = await busyCode(sql, u);
    if (busy) return fail(res, 409, 'Finish your current game first (' + busy + ').');
    await leaveLobbies(sql, u);
    const mine = JSON.stringify({ n: u.name, o: nowMs, r: false, s: nowMs });
    const ok = await sql`update live_games set host_extra = jsonb_set(host_extra, array['seats', ${uid}::text], ${mine}::jsonb),
                           host_idx = host_idx + 1, status = case when host_idx + 1 >= ${MAX_SEATS} then 'full' else 'open' end,
                           host_seen = now(), updated_at = now()
                         where id = ${g.id} and status = 'open' and host_idx < ${MAX_SEATS} and not (host_extra->'seats' ? ${uid}) returning id`;
    if (!ok.length) return fail(res, 409, 'That game just filled up.');
    await logEvent(req, u, 'live_join', { target: { id: g.host_id, email: g.host_email }, detail: { code, name: g.name, private: g.is_private, game: g.cfg.game, seats: g.host_idx + 1 } });
    return send(res, 200, { code });
  }

  if (!seat) return fail(res, 403, 'You’re not in that game.');

  if (action === 'ready') {
    if (g.status !== 'open' && g.status !== 'full') return fail(res, 409, 'The game has already started.');
    const ready = req.body.ready !== false;
    await sql`update live_games set host_extra = jsonb_set(host_extra, array['seats', ${uid}::text, 'r'], ${JSON.stringify(ready)}::jsonb),
                host_seen = now(), updated_at = now()
              where id = ${g.id} and status in ('open','full') and host_extra->'seats' ? ${uid}`;
    g = await reload(sql, g.id);
    const seats = seatsOf(g);
    let started = false;
    // Everyone in the room is ready, and there are at least two: go. host_idx pins the seat count, so a diver who
    // joins at that very moment stops the start (they haven't pressed ready yet).
    if (seats.length >= MIN_SEATS && seats.every(s => s.r)) {
      const qs = makeLiveQuestions(g.cfg.game, g.cfg.n, g.cfg.ops, g.cfg.level, randomInt(2147483647));
      const st = await sql`update live_games set status = 'playing', questions = ${JSON.stringify(qs)}::jsonb,
                             start_at = now() + make_interval(secs => ${START_DELAY}), updated_at = now()
                           where id = ${g.id} and status in ('open','full') and host_idx = ${seats.length} returning start_at`;
      started = st.length > 0;
      if (started) await logEvent(req, u, 'live_start', { detail: { code, game: g.cfg.game, players: seats.map(s => s.n), cfg: g.cfg } });
    }
    return send(res, 200, { ok: true, started });
  }

  if (action === 'call') {
    if (g.status !== 'playing') return send(res, 200, { ok: false, status: g.status });
    if (seat.l) return fail(res, 409, 'You left this game.');
    const T = diveTimeline(g, nowMs), k = parseInt(req.body.k, 10), c = parseInt(req.body.choice, 10);
    if (!T.cur || T.cur.k !== k) return send(res, 200, { ok: false, late: true, game: partyView(g, u, new Date(now)) });
    if (!(c >= 0 && c <= 3)) return fail(res, 400, 'Pick one of the four answers.');
    if (nowMs < T.cur.R - 150) return fail(res, 409, 'Wait for the sum.');
    // Reaction time from the device, bounded by the server clock (see live Truth or Lie in api/live.js).
    const serverRt = nowMs - T.cur.R;
    let rt = Number(req.body.rt);
    if (!Number.isFinite(rt)) rt = serverRt;
    rt = Math.round(Math.max(300, Math.max(serverRt - SLACK, Math.min(serverRt + 300, rt))));
    const call = JSON.stringify({ c, rt, at: nowMs }), key = String(k);
    // An answer also counts as being seen.
    await sql`update live_games set host_extra = jsonb_set(jsonb_set(host_extra, array['calls', ${uid}::text],
                coalesce(host_extra->'calls'->${uid}, '{}'::jsonb) || jsonb_build_object(${key}::text, ${call}::jsonb)),
                array['seats', ${uid}::text, 's'], to_jsonb(${nowMs}::bigint)),
                host_seen = now(), updated_at = now()
              where id = ${g.id} and status = 'playing' and not (coalesce(host_extra->'calls'->${uid}, '{}'::jsonb) ? ${key})`;
    g = await reload(sql, g.id);
    if (await settle(req, u, sql, g, nowMs)) g = await reload(sql, g.id);
    return send(res, 200, { ok: true, game: partyView(g, u, new Date(now)) });
  }

  if (action === 'leave') {
    if (g.status === 'playing') {
      // Leaving mid-game: you're out (last place, a loss); the others carry on while at least two are left.
      await sql`update live_games set host_extra = jsonb_set(host_extra, array['seats', ${uid}::text, 'l'], to_jsonb(${nowMs}::bigint)), updated_at = now()
                where id = ${g.id} and status = 'playing' and (host_extra->'seats'->${uid}->>'l') is null`;
      await logEvent(req, u, 'live_leave', { detail: { code, during: 'game', game: g.cfg.game } });
      await settle(req, u, sql, await reload(sql, g.id), nowMs);
    } else if (g.status === 'open' || g.status === 'full') {
      await dropSeat(sql, g, uid);
      await logEvent(req, u, 'live_leave', { detail: { code, during: 'lobby', game: g.cfg.game } });
    }
    return send(res, 200, { ok: true });
  }

  if (action === 'rematch') {
    if (g.status !== 'done') return fail(res, 409, 'Finish this game first.');
    if (g.rematch_code) return send(res, 200, { code: g.rematch_code });
    await leaveLobbies(sql, u);
    const inv = seatsOf(g).map(s => s.id).filter(id => id !== uid);
    const extra = JSON.stringify(newPartyExtra(u, nowMs, inv));
    let row = null;
    for (let i = 0; i < 6 && !row; i++) {
      [row] = await sql`insert into live_games (code, name, host_id, is_private, pass_hash, cfg, host_idx, host_extra)
                        values (${newCode()}, ${g.name}, ${u.id}, ${g.is_private}, ${g.pass_hash}, ${JSON.stringify(g.cfg)}::jsonb, 1, ${extra}::jsonb)
                        on conflict (code) do nothing returning code`;
    }
    if (!row) return fail(res, 500, 'Could not create a game, try again');
    const set = await sql`update live_games set rematch_code = ${row.code} where id = ${g.id} and rematch_code is null returning rematch_code`;
    if (!set.length) { // someone else beat us to it: use theirs, drop ours
      await sql`update live_games set status = 'cancelled' where code = ${row.code}`;
      const [again] = await sql`select rematch_code from live_games where id = ${g.id}`;
      return send(res, 200, { code: again.rematch_code });
    }
    await logEvent(req, u, 'live_create', { detail: { code: row.code, rematch_of: code, game: g.cfg.game } });
    return send(res, 200, { code: row.code });
  }

  if (action === 'claim') return fail(res, 409, 'Divers who go quiet are dropped by themselves.');
  if (action === 'progress') return fail(res, 400, 'Party games use calls, not progress.');
  return fail(res, 400, 'Unknown action');
}
