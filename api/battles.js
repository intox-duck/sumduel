// GET  /api/battles?limit=500   -> { battles: [...] } newest first
// POST /api/battles {battles:[...]}  -> idempotent insert by client id (cid); returns { saved }
import { route, send, fail, db, requireUser } from './_lib.js';

const GAMES = new Set(['duel', 'tol', 'sprint', 'daily']);
const MAX_BATCH = 200;

export default route(['GET', 'POST'], async (req, res) => {
  const u = await requireUser(req, res); if (!u) return;
  const sql = db();

  if (req.method === 'GET') {
    const limit = Math.max(1, Math.min(1000, parseInt(req.query?.limit, 10) || 500));
    const rows = await sql`select data from battles where user_id = ${u.id}
                           order by played_at desc limit ${limit}`;
    return send(res, 200, { battles: rows.map(r => r.data) });
  }

  const list = Array.isArray(req.body.battles) ? req.body.battles.slice(0, MAX_BATCH) : [];
  const clean = [];
  for (const b of list) {
    if (!b || typeof b !== 'object') continue;
    const cid = String(b.cid || '').slice(0, 40);
    if (!cid || !GAMES.has(b.game)) continue;
    const t = Date.parse(b.at);
    if (!Number.isFinite(t) || t > Date.now() + 86400000) continue;
    const json = JSON.stringify(b);
    if (json.length > 8000) continue;
    clean.push({ cid, game: b.game, at: new Date(t).toISOString(), json });
  }
  if (!clean.length) return fail(res, 400, 'Nothing valid to save');

  const rows = await sql`
    insert into battles (user_id, client_id, game, played_at, data)
    select ${u.id}, x.cid, x.game, x.at::timestamptz, x.json::jsonb
    from jsonb_to_recordset(${JSON.stringify(clean)}::jsonb) as x(cid text, game text, at text, json text)
    on conflict (user_id, client_id) do nothing
    returning id`;
  send(res, 200, { saved: rows.length, received: clean.length });
});
