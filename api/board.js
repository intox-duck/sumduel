// Leaderboards.
// GET  /api/board?b=sprint | daily[&d=YYYY-MM-DD]  -> { board, rows:[{rank,name,score,me}], mine }
// POST /api/board {b:'sprint', score}              -> keeps personal best (higher is better)
// POST /api/board {b:'daily', d, score}            -> first attempt of the day counts (lower seconds is better)
// GET  /api/board?b=players                         -> signed-in players only: every player's report (v2.7 dashboard).
//      Display names and game stats only: never emails, roles, IPs or chat. Shape:
//      { totals:{players,battles,week,today}, days:[{d,n}] (last 14 UTC days), players:[{id,name,since,battles,
//        games:{duel,live,tol,sprint,daily,vs}, w,l,d, bestSprint, bestDaily, climb, stars, lastAt, me}] }
//      v2.8: live games of every kind count as "live"; Daily VS ghost races as "vs"; climb = highest Climb level reached.
import { route, send, fail, db, currentUser, requireUser, utcDay, logEvent } from './_lib.js';

const TOP = 25;
// Plausibility bounds: stops trivially forged scores without pretending to be anti-cheat.
const SPRINT_MAX = 150;          // correct answers in 60 s
const DAILY_Q = 20, DAILY_MIN = DAILY_Q * 0.35; // seconds

function boardKey(b, d) {
  if (b === 'sprint') return 'sprint';
  if (b === 'daily') {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : utcDay();
    return 'daily:' + day;
  }
  return null;
}

export default route(['GET', 'POST'], async (req, res) => {
  const sql = db();

  if (req.method === 'GET' && req.query?.b === 'players') return playersReport(req, res, sql);

  if (req.method === 'GET') {
    const b = String(req.query?.b || 'sprint');
    const key = boardKey(b, req.query?.d);
    if (!key) return fail(res, 400, 'Unknown board');
    const asc = b === 'daily';
    const me = await currentUser(req).catch(() => null);
    const rows = asc
      ? await sql`select s.user_id, u.name, s.score, rank() over (order by s.score asc, s.created_at asc) as rank
                  from scores s join users u on u.id = s.user_id where s.board = ${key}
                  order by s.score asc, s.created_at asc limit ${TOP}`
      : await sql`select s.user_id, u.name, s.score, rank() over (order by s.score desc, s.created_at asc) as rank
                  from scores s join users u on u.id = s.user_id where s.board = ${key}
                  order by s.score desc, s.created_at asc limit ${TOP}`;
    let mine = null;
    if (me) {
      const [m] = asc
        ? await sql`select score, (select count(*) from scores x where x.board = ${key} and x.score < s.score)::int + 1 as rank
                    from scores s where s.board = ${key} and s.user_id = ${me.id}`
        : await sql`select score, (select count(*) from scores x where x.board = ${key} and x.score > s.score)::int + 1 as rank
                    from scores s where s.board = ${key} and s.user_id = ${me.id}`;
      if (m) mine = { score: m.score, rank: m.rank };
    }
    const [{ total }] = await sql`select count(*)::int as total from scores where board = ${key}`;
    return send(res, 200, {
      board: key, total, mine,
      rows: rows.map(r => ({ rank: Number(r.rank), name: r.name, score: r.score, me: !!me && String(r.user_id) === String(me.id) })),
    });
  }

  const u = await requireUser(req, res); if (!u) return;
  const { b } = req.body;
  const score = Number(req.body.score);
  if (!Number.isFinite(score)) return fail(res, 400, 'Bad score');

  if (b === 'sprint') {
    if (score < 0 || score > SPRINT_MAX || !Number.isInteger(score)) return fail(res, 400, 'Implausible score');
    await sql`insert into scores (user_id, board, score) values (${u.id}, 'sprint', ${score})
              on conflict (board, user_id) do update set score = excluded.score, created_at = now()
              where scores.score < excluded.score`;
    await logEvent(req, u, 'score_posted', { detail: { board: 'sprint', score } });
    return send(res, 200, { ok: true });
  }

  if (b === 'daily') {
    const d = String(req.body.d || '');
    if (d !== utcDay() && d !== utcDay(-1)) return fail(res, 400, 'That daily has closed');
    if (score < DAILY_MIN || score > 3600) return fail(res, 400, 'Implausible time');
    const rows = await sql`insert into scores (user_id, board, score) values (${u.id}, ${'daily:' + d}, ${score})
                           on conflict (board, user_id) do nothing returning score`;
    await logEvent(req, u, 'score_posted', { detail: { board: 'daily:' + d, score, counted: rows.length > 0 } });
    return send(res, 200, { ok: true, counted: rows.length > 0 });
  }

  fail(res, 400, 'Unknown board');
});

// v2.7: the players dashboard. Anyone signed in can read it; it lists every player's game report.
async function playersReport(req, res, sql) {
  const u = await requireUser(req, res); if (!u) return;
  const rows = await sql`
    select u.id::text as id, u.name, u.created_at as since,
      count(b.id)::int as battles,
      count(*) filter (where b.game = 'duel' and coalesce(b.data->>'mode','') not in ('live','ghost'))::int as duel,
      count(*) filter (where b.data->>'mode' = 'live')::int as live,
      count(*) filter (where b.data->>'mode' = 'ghost')::int as vs,
      count(*) filter (where b.game = 'tol' and coalesce(b.data->>'mode','') <> 'live')::int as tol,
      count(*) filter (where b.game = 'sprint' and coalesce(b.data->>'mode','') <> 'live')::int as sprint,
      count(*) filter (where b.game = 'daily')::int as daily,
      count(*) filter (where (b.game in ('duel','tol') or b.data->>'mode' = 'live') and b.data->>'winner' = '0')::int as w,
      count(*) filter (where (b.game in ('duel','tol') or b.data->>'mode' = 'live') and b.data->>'winner' = '1')::int as l,
      count(*) filter (where (b.game in ('duel','tol') or b.data->>'mode' = 'live') and b.data->>'winner' = '-1')::int as d,
      max(b.played_at) as last_at,
      (select max(score) from scores s where s.user_id = u.id and s.board = 'sprint') as best_sprint,
      (select min(score) from scores s where s.user_id = u.id and s.board like 'daily:%') as best_daily,
      (select w.climb_level from wallets w where w.user_id = u.id) as climb,
      (select coalesce(sum(value::int), 0) from wallets w, jsonb_each_text(w.climb_stars) where w.user_id = u.id) as stars
    from users u left join battles b on b.user_id = u.id
    group by u.id order by count(b.id) desc, u.created_at asc limit 500`;
  const days = await sql`
    select to_char(d::date, 'YYYY-MM-DD') as d, coalesce(n, 0)::int as n
    from generate_series((now() at time zone 'utc')::date - 13, (now() at time zone 'utc')::date, interval '1 day') d
    left join (select (played_at at time zone 'utc')::date as day, count(*) as n from battles
               where played_at > now() - interval '15 days' group by 1) x on x.day = d::date
    order by d`;
  const [t] = await sql`select
      (select count(*) from users)::int as players,
      (select count(*) from battles)::int as battles,
      (select count(*) from battles where played_at > now() - interval '7 days')::int as week,
      (select count(distinct user_id) from battles where played_at >= (now() at time zone 'utc')::date)::int as today`;
  send(res, 200, {
    totals: t, days,
    players: rows.map(r => ({
      id: r.id, name: r.name, since: r.since, battles: r.battles,
      games: { duel: r.duel, live: r.live, tol: r.tol, sprint: r.sprint, daily: r.daily, vs: r.vs },
      w: r.w, l: r.l, d: r.d,
      climb: r.climb == null ? 1 : Number(r.climb), stars: Number(r.stars) || 0,
      bestSprint: r.best_sprint == null ? null : Number(r.best_sprint),
      bestDaily: r.best_daily == null ? null : Number(r.best_daily),
      lastAt: r.last_at, me: r.id === String(u.id),
    })),
  });
}
