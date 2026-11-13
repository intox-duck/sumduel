// GET  /api/battles?limit=500   -> { battles: [...] } newest first
// POST /api/battles {battles:[...]}  -> idempotent insert by client id (cid); returns { saved, coins }
//      v2.8: each newly saved battle from the last 24 h, played since the account was made, pays coins into the wallet
//      (see _economy.js battleCoins). A guest's earlier games were paid into the guest wallet, which adopt carries over.
import { route, send, fail, db, requireUser, logEvent } from './_lib.js';
import { battleCoins, awardBattles } from './_economy.js';

// Every game a battle can be. Live games are written by api/live.js and re-saved by the client (deduped on cid).
const GAMES = new Set(['duel', 'tol', 'sprint', 'daily', 'climb', 'missing', 'target', 'bigger']);
const TIMED = new Set(['duel', 'climb', 'missing', 'target', 'bigger']);   // fastest time wins
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
    returning id, client_id`;
  // One activity row per newly saved battle, with a compact score summary, and its coins.
  // Old battles, and a guest's games from before the account existed (already paid into the guest wallet, which
  // adopt carries over), are saved but don't pay. All the coins go into the wallet in one write.
  const fresh = new Set(rows.map(r => r.client_id));
  const since = Math.max(Date.now() - 86400000, new Date(u.created_at).getTime() || 0), pay = [];
  for (const b of list) {
    if (!b || !fresh.has(String(b.cid || '').slice(0, 40))) continue;
    fresh.delete(String(b.cid).slice(0, 40));
    await logEvent(req, u, 'battle_saved', { detail: summarise(b) });
    if (b.mode !== 'live' && Date.parse(b.at) >= since) pay.push(battleCoins(b));
  }
  const coins = await awardBattles(sql, u.id, pay);
  send(res, 200, { saved: rows.length, received: clean.length, coins });
});

function summarise(b) {
  const P = Array.isArray(b.players) ? b.players : [];
  const p = i => P[i] || {};
  const out = { game: b.game, at: b.at };
  if (TIMED.has(b.game)) Object.assign(out, { mode: b.mode, winner: b.winner, vs: p(1).name, times: [p(0).time, p(1).time], wrong: [p(0).wrong, p(1).wrong] });
  else if (b.game === 'tol') Object.assign(out, { mode: b.mode, winner: b.winner, vs: p(1).name, score: [p(0).score, p(1).score] });
  else if (b.game === 'sprint' && P.length > 1) Object.assign(out, { mode: b.mode, winner: b.winner, vs: p(1).name, score: [p(0).score, p(1).score] });
  else if (b.game === 'sprint') Object.assign(out, { score: p(0).score, wrong: p(0).wrong });
  else if (b.game === 'daily') Object.assign(out, { day: b.day, time: p(0).time, wrong: p(0).wrong, practice: !!b.practice });
  return out;
}
