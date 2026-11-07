// Leaderboards.
// GET  /api/board?b=sprint | daily[&d=YYYY-MM-DD]  -> { board, rows:[{rank,name,score,me}], mine }
// POST /api/board {b:'sprint', score}              -> keeps personal best (higher is better)
// POST /api/board {b:'daily', d, score}            -> first attempt of the day counts (lower seconds is better)
import { route, send, fail, db, currentUser, requireUser, utcDay } from './_lib.js';

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
    return send(res, 200, { ok: true });
  }

  if (b === 'daily') {
    const d = String(req.body.d || '');
    if (d !== utcDay() && d !== utcDay(-1)) return fail(res, 400, 'That daily has closed');
    if (score < DAILY_MIN || score > 3600) return fail(res, 400, 'Implausible time');
    const rows = await sql`insert into scores (user_id, board, score) values (${u.id}, ${'daily:' + d}, ${score})
                           on conflict (board, user_id) do nothing returning score`;
    return send(res, 200, { ok: true, counted: rows.length > 0 });
  }

  fail(res, 400, 'Unknown board');
});
