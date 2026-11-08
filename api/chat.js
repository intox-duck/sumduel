// mIRC-style chat, polled (Vercel functions can't hold websockets). Signed-in players only.
// GET  /api/chat?c=lobby&after=<id>          -> { topic, messages, removed, online, me }
// POST /api/chat {action:'send', c, body}      -> posts (after the safeguarding filter); "/me ..." = action line
// POST /api/chat {action:'report', id, reason} -> any player; flags the message for super_admin review
// POST /api/chat {action:'delete', id}         -> admin / super_admin (soft delete; kept for review)
// POST /api/chat {action:'mute', userId, minutes} -> admin / super_admin; minutes 0 = unmute
import { route, send, fail, db, requireUser, logEvent, isMod, isSuper } from './_lib.js';
import { screen } from './_safety.js';
import { CHAT_ENABLED } from './_features.js';

export const CHANNELS = {
  lobby: 'Be kind. No phone numbers, emails, addresses or links. Every message is logged and checked by moderators.',
  duels: 'Looking for a rematch? Ask here. Same rules as #lobby.',
};
const RATE_N = 5, RATE_SECS = 10, ONLINE_SECS = 40;
const MUTE_MAX_MIN = 60 * 24 * 365;

export default route(['GET', 'POST'], async (req, res) => {
  if (!CHAT_ENABLED) return fail(res, 404, 'Chat is turned off');
  const u = await requireUser(req, res); if (!u) return;
  const sql = db();
  const mod = isMod(u);

  if (req.method === 'GET') {
    const c = String(req.query?.c || 'lobby');
    if (!CHANNELS[c]) return fail(res, 400, 'Unknown channel');
    const after = Math.max(0, parseInt(req.query?.after, 10) || 0);
    await sql`insert into chat_presence (user_id, channel, seen_at) values (${u.id}, ${c}, now())
              on conflict (user_id, channel) do update set seen_at = now()`;
    const rows = after
      ? await sql`select id, at, user_id, nick, kind, body, deleted_at from chat_messages
                  where channel = ${c} and id > ${after} order by id asc limit 100`
      : (await sql`select id, at, user_id, nick, kind, body, deleted_at from chat_messages
                   where channel = ${c} order by id desc limit 60`).reverse();
    const removed = after
      ? (await sql`select id from chat_messages where channel = ${c} and id <= ${after}
                   and deleted_at > now() - interval '3 minutes'`).map(r => String(r.id))
      : [];
    const online = await sql`select u.id, u.name, u.role from chat_presence p join users u on u.id = p.user_id
                             where p.channel = ${c} and p.seen_at > now() - make_interval(secs => ${ONLINE_SECS})
                             order by (u.role = 'admin') desc, lower(u.name)`;
    return send(res, 200, {
      channel: c, topic: CHANNELS[c],
      messages: rows.map(m => ({
        id: String(m.id), at: m.at, nick: m.nick, kind: m.kind,
        body: m.deleted_at ? null : m.body, removed: !!m.deleted_at, mine: String(m.user_id) === String(u.id),
        ...(mod ? { uid: String(m.user_id) } : {}),
      })),
      removed,
      // Only the plain admin role gets the "@" op marker; super_admin looks like any other player.
      online: online.map(o => ({ nick: o.name, op: o.role === 'admin', ...(mod ? { uid: String(o.id) } : {}) })),
      me: { nick: u.name, mod, muted_until: u.muted_until && new Date(u.muted_until) > new Date() ? u.muted_until : null },
    });
  }

  const { action } = req.body;

  if (action === 'send') {
    const c = String(req.body.c || 'lobby');
    if (!CHANNELS[c]) return fail(res, 400, 'Unknown channel');
    if (u.muted_until && new Date(u.muted_until) > new Date()) {
      return fail(res, 403, 'You’re muted until ' + new Date(u.muted_until).toISOString().slice(11, 16) + ' UTC.');
    }
    const [{ n }] = await sql`select count(*)::int as n from chat_messages
                              where user_id = ${u.id} and at > now() - make_interval(secs => ${RATE_SECS})`;
    if (n >= RATE_N) return fail(res, 429, 'Slow down a bit.');
    let raw = String(req.body.body || '');
    let kind = 'msg';
    if (/^\/me\s+/i.test(raw)) { kind = 'action'; raw = raw.replace(/^\/me\s+/i, ''); }
    const s = screen(raw);
    if (!s.ok) {
      if (s.reason !== 'empty') await logEvent(req, u, 'chat_blocked', { detail: { channel: c, reason: s.reason, text: raw.slice(0, 500) } });
      return fail(res, 422, s.message);
    }
    const flagged = s.flags.length > 0;
    const [m] = await sql`insert into chat_messages (channel, user_id, nick, kind, body, flagged, flag_reason)
                          values (${c}, ${u.id}, ${u.name}, ${kind}, ${s.text}, ${flagged}, ${flagged ? s.flags.join(',') : null})
                          returning id, at`;
    await logEvent(req, u, 'chat_message', { detail: { channel: c, id: String(m.id), kind, text: s.text, ...(flagged ? { flags: s.flags, original: raw.slice(0, 500) } : {}) } });
    return send(res, 200, { message: { id: String(m.id), at: m.at, nick: u.name, kind, body: s.text, mine: true } });
  }

  if (action === 'report') {
    const id = String(req.body.id || '');
    if (!/^\d{1,18}$/.test(id)) return fail(res, 400, 'Bad message id');
    const [m] = await sql`select id, user_id, nick, body, channel from chat_messages where id = ${id}`;
    if (!m) return fail(res, 404, 'Message not found');
    const reason = String(req.body.reason || '').slice(0, 200);
    await sql`insert into chat_reports (message_id, reporter_id, reason) values (${m.id}, ${u.id}, ${reason})`;
    await sql`update chat_messages set flagged = true, reviewed_at = null,
              flag_reason = case when coalesce(flag_reason, '') like '%reported%' then flag_reason
                                 else concat_ws(',', nullif(flag_reason, ''), 'reported') end
              where id = ${m.id}`;
    await logEvent(req, u, 'chat_report', { target: { id: m.user_id, email: null }, detail: { id: String(m.id), channel: m.channel, nick: m.nick, text: m.body, reason } });
    return send(res, 200, { ok: true });
  }

  if (!mod) return fail(res, 403, 'Moderators only');

  if (action === 'delete') {
    const id = String(req.body.id || '');
    if (!/^\d{1,18}$/.test(id)) return fail(res, 400, 'Bad message id');
    const [m] = await sql`update chat_messages set deleted_at = now(), deleted_by = ${u.id}
                          where id = ${id} and deleted_at is null returning id, user_id, nick, body, channel`;
    if (!m) return fail(res, 404, 'Message not found or already removed');
    await logEvent(req, u, 'chat_delete', { target: { id: m.user_id, email: null }, detail: { id: String(m.id), channel: m.channel, nick: m.nick, text: m.body } });
    return send(res, 200, { ok: true });
  }

  if (action === 'mute') {
    const userId = String(req.body.userId || '');
    const minutes = Math.max(0, Math.min(MUTE_MAX_MIN, parseInt(req.body.minutes, 10) || 0));
    if (!/^\d{1,18}$/.test(userId)) return fail(res, 400, 'Bad user id');
    const [t] = await sql`select id, email, name, role from users where id = ${userId}`;
    if (!t) return fail(res, 404, 'Player not found');
    if (String(t.id) === String(u.id)) return fail(res, 400, 'You can’t mute yourself');
    // Admins can only mute players. The super_admin is reported with the same message as any protected account.
    if (!isSuper(u) && t.role !== 'player') return fail(res, 403, 'You can’t mute this player.');
    const until = minutes ? new Date(Date.now() + minutes * 60000).toISOString() : null;
    await sql`update users set muted_until = ${until} where id = ${t.id}`;
    await logEvent(req, u, minutes ? 'chat_mute' : 'chat_unmute', { target: t, detail: { minutes, until, nick: t.name } });
    return send(res, 200, { ok: true, until });
  }

  fail(res, 400, 'Unknown action');
});
