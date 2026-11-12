// Admin portal API. Uses the normal player session; access comes from users.role in Neon.
//   admin        -> players list, password resets for players, chat moderation
//   super_admin  -> everything, plus activity log, flag review queue, audits, roles, player detail
// Everyone else (including signed-out visitors) gets a plain 404, so the portal's existence isn't revealed.
// To admins, the super_admin account is indistinguishable from a player.
//
// GET  /api/admin                                  -> { role, me }
// POST {action:'users', q?}                        (admin+)
// POST {action:'setPassword', userId, password}    (admin+; admins: players only)
// POST {action:'chat', c, before?}                 (admin+)  recent messages incl. removed
// POST {action:'mutes'}                            (admin+)
// POST {action:'setRole', userId, role}            (super)   player <-> admin
// POST {action:'activity', kind?, q?, before?}     (super)
// POST {action:'flags'}                            (super)
// POST {action:'review', id}                       (super)
// POST {action:'player', userId}                   (super)
// POST {action:'audits'} / {action:'runAudit'} / {action:'auditReviewed', id}   (super)
import { route, send, fail, db, currentUser, hashPassword, logEvent, isMod, isSuper } from './_lib.js';
import { runAudit } from './_audit.js';
import { CHANNELS } from './chat.js';
import { CHAT_ENABLED } from './_features.js';

const ID = /^\d{1,18}$/;
const likeEsc = s => s.replace(/[\\%_]/g, '\\$&');
const KINDS = {
  auth: ['sign_up', 'sign_in', 'sign_out', 'sign_in_failed', 'sign_in_locked', 'rename'],
  games: ['battle_saved', 'score_posted', 'live_create', 'live_join', 'live_join_failed', 'live_start', 'live_finish', 'live_leave',
          'climb_finish', 'vs_finish', 'gift_claimed', 'coins_spent', 'progress_adopted'],
  chat: ['chat_message', 'chat_blocked', 'chat_report', 'chat_delete', 'chat_mute', 'chat_unmute'],
  admin: ['admin_open', 'admin_password_reset', 'admin_role_change', 'admin_review', 'audit_run', 'audit_reviewed', 'role_set_cli'],
};

export default route(['GET', 'POST'], async (req, res) => {
  const u = await currentUser(req).catch(() => null);
  if (!isMod(u) || u.must_change_pw) return fail(res, 404, 'Not found');
  const sup = isSuper(u);
  const sql = db();

  if (req.method === 'GET') {
    await logEvent(req, u, 'admin_open');
    return send(res, 200, { role: u.role, me: { name: u.name, email: u.email }, features: { chat: CHAT_ENABLED } });
  }

  const { action } = req.body;
  if (!CHAT_ENABLED && ['chat', 'mutes', 'flags', 'review'].includes(action)) return fail(res, 404, 'Chat is turned off');
  const maskRole = r => (sup ? r : (r === 'super_admin' ? 'player' : r));

  if (action === 'users') {
    const q = String(req.body.q || '').trim().slice(0, 100);
    const like = '%' + likeEsc(q) + '%';
    const users = await sql`
      select u.id::text as id, u.email, u.name, u.role, u.created_at, u.muted_until,
             (select count(*)::int from battles b where b.user_id = u.id) as battles,
             (select max(s.created_at) from sessions s where s.user_id = u.id) as last_sign_in,
             (select count(*)::int from sessions s where s.user_id = u.id and s.expires_at > now()) as sessions,
             (select count(*)::int from chat_messages m where m.user_id = u.id) as messages
      from users u
      where ${q}::text = '' or u.email ilike ${like} or u.name ilike ${like}
      order by u.created_at desc limit 200`;
    const [{ total }] = await sql`select count(*)::int as total from users`;
    return send(res, 200, { total, users: users.map(x => ({ ...x, role: maskRole(x.role), self: x.id === String(u.id) })) });
  }

  if (action === 'setPassword') {
    const userId = String(req.body.userId || ''), password = String(req.body.password || '');
    if (!ID.test(userId)) return fail(res, 400, 'Bad user id');
    if (password.length < 6) return fail(res, 400, 'Password needs at least 6 characters');
    if (password.length > 200) return fail(res, 400, 'Password is too long');
    const [t] = await sql`select id, email, role from users where id = ${userId}`;
    if (!t) return fail(res, 404, 'Player not found');
    if (!sup && t.role !== 'player' && String(t.id) !== String(u.id)) return fail(res, 403, 'This account can’t be changed from here.');
    // A reset password is temporary: the player must choose their own at next sign-in (not when you reset your own).
    await sql`update users set pw_hash = ${await hashPassword(password)}, must_change_pw = ${String(t.id) !== String(u.id)} where id = ${t.id}`;
    const ended = await sql`delete from sessions where user_id = ${t.id} and user_id <> ${u.id} returning 1`;
    await sql`delete from auth_fails where key like ${likeEsc(t.email) + '|%'}`;
    await logEvent(req, u, 'admin_password_reset', { target: t, detail: { sessionsEnded: ended.length } });
    return send(res, 200, { ok: true, email: t.email, sessionsEnded: ended.length });
  }

  if (action === 'chat') {
    const c = String(req.body.c || 'lobby');
    if (!CHANNELS[c]) return fail(res, 400, 'Unknown channel');
    const before = ID.test(String(req.body.before || '')) ? String(req.body.before) : null;
    const rows = before
      ? await sql`select m.*, u.role from chat_messages m join users u on u.id = m.user_id where channel = ${c} and m.id < ${before} order by m.id desc limit 100`
      : await sql`select m.*, u.role from chat_messages m join users u on u.id = m.user_id where channel = ${c} order by m.id desc limit 100`;
    return send(res, 200, {
      channels: Object.keys(CHANNELS),
      messages: rows.map(m => ({
        id: String(m.id), at: m.at, nick: m.nick, uid: String(m.user_id), kind: m.kind, role: maskRole(m.role),
        removed: !!m.deleted_at,
        // Admins don't see removed text; the super_admin sees everything, including filter flags.
        body: m.deleted_at && !sup ? null : m.body,
        ...(sup ? { flagged: m.flagged, flag_reason: m.flag_reason, reviewed: !!m.reviewed_at } : {}),
      })),
    });
  }

  if (action === 'mutes') {
    const rows = await sql`select id::text as id, name, email, role, muted_until from users where muted_until > now() order by muted_until desc`;
    return send(res, 200, { mutes: rows.map(r => ({ ...r, role: maskRole(r.role) })) });
  }

  // ---------------- super_admin only ----------------
  if (!sup) return fail(res, 403, 'Not allowed');

  if (action === 'setRole') {
    const userId = String(req.body.userId || ''), role = String(req.body.role || '');
    if (!ID.test(userId) || !['player', 'admin'].includes(role)) return fail(res, 400, 'Bad request');
    const [t] = await sql`select id, email, role from users where id = ${userId}`;
    if (!t) return fail(res, 404, 'Player not found');
    if (t.role === 'super_admin') return fail(res, 400, 'Change super admins with `npm run role` only');
    await sql`update users set role = ${role} where id = ${t.id}`;
    await logEvent(req, u, 'admin_role_change', { target: t, detail: { from: t.role, to: role } });
    return send(res, 200, { ok: true });
  }

  if (action === 'activity') {
    const kind = String(req.body.kind || '');
    const q = String(req.body.q || '').trim().slice(0, 100);
    const like = '%' + likeEsc(q) + '%';
    const before = ID.test(String(req.body.before || '')) ? String(req.body.before) : '9223372036854775807';
    const actions = KINDS[kind] || null;
    const rows = await sql`
      select id::text as id, at, actor_user_id::text as actor_id, actor_email, actor_role, action,
             target_user_id::text as target_id, target_email, detail, ip, ua
      from activity_log
      where id < ${before}
        and (${actions}::text[] is null or action = any(${actions}::text[]))
        and (${q}::text = '' or actor_email ilike ${like} or target_email ilike ${like} or detail::text ilike ${like} or ip ilike ${like})
      order by id desc limit 100`;
    return send(res, 200, { rows });
  }

  if (action === 'flags') {
    const rows = await sql`
      select m.id::text as id, m.at, m.channel, m.nick, m.user_id::text as uid, m.kind, m.body, m.flag_reason, m.deleted_at,
             u.email, u.muted_until,
             coalesce((select json_agg(json_build_object('at', r.at, 'reason', r.reason, 'by', ru.name) order by r.at)
                       from chat_reports r join users ru on ru.id = r.reporter_id
                       where r.message_id = m.id and r.resolved_at is null), '[]') as reports
      from chat_messages m join users u on u.id = m.user_id
      where m.flagged and m.reviewed_at is null
      order by (m.flag_reason like '%wellbeing%') desc, (m.flag_reason like '%personal_info%') desc, m.id desc
      limit 200`;
    // A little context around each flagged message (2 before, 2 after, same channel).
    for (const r of rows) {
      r.context = (await sql`select id::text as id, nick, body, kind, at from chat_messages
                             where channel = ${r.channel} and id between ${Number(r.id) - 40} and ${Number(r.id) + 40}
                             order by abs(id - ${Number(r.id)}) limit 5`).sort((a, b) => Number(a.id) - Number(b.id));
    }
    return send(res, 200, { rows });
  }

  if (action === 'review') {
    const id = String(req.body.id || '');
    if (!ID.test(id)) return fail(res, 400, 'Bad id');
    const [m] = await sql`update chat_messages set reviewed_at = now(), reviewed_by = ${u.id} where id = ${id}
                          returning id, user_id, nick, body, flag_reason`;
    if (!m) return fail(res, 404, 'Not found');
    await sql`update chat_reports set resolved_at = now() where message_id = ${id} and resolved_at is null`;
    await logEvent(req, u, 'admin_review', { target: { id: m.user_id, email: null }, detail: { id, nick: m.nick, text: m.body, flags: m.flag_reason } });
    return send(res, 200, { ok: true });
  }

  if (action === 'player') {
    const userId = String(req.body.userId || '');
    if (!ID.test(userId)) return fail(res, 400, 'Bad user id');
    const [p] = await sql`select id::text as id, email, name, role, created_at, muted_until from users where id = ${userId}`;
    if (!p) return fail(res, 404, 'Player not found');
    const battles = await sql`select data from battles where user_id = ${userId} order by played_at desc limit 200`;
    const scores = await sql`select board, score, created_at from scores where user_id = ${userId} order by created_at desc limit 100`;
    const messages = await sql`select id::text as id, at, channel, kind, body, flagged, flag_reason, deleted_at from chat_messages
                               where user_id = ${userId} order by id desc limit 100`;
    const activity = await sql`select id::text as id, at, action, detail, ip from activity_log
                               where actor_user_id = ${userId} or target_user_id = ${userId} order by id desc limit 100`;
    return send(res, 200, { player: p, battles: battles.map(b => b.data), scores, messages, activity });
  }

  if (action === 'audits') {
    const rows = await sql`select id::text as id, created_at, trigger, period_start, period_end, data, reviewed_at
                           from audit_reports order by id desc limit 30`;
    return send(res, 200, { rows });
  }

  if (action === 'runAudit') {
    const rep = await runAudit(req, u, 'manual');
    return send(res, 200, { report: { ...rep, id: String(rep.id) } });
  }

  if (action === 'auditReviewed') {
    const id = String(req.body.id || '');
    if (!ID.test(id)) return fail(res, 400, 'Bad id');
    const [r] = await sql`update audit_reports set reviewed_at = now(), reviewed_by = ${u.id} where id = ${id} returning id`;
    if (!r) return fail(res, 404, 'Not found');
    await logEvent(req, u, 'audit_reviewed', { detail: { id } });
    return send(res, 200, { ok: true });
  }

  fail(res, 400, 'Unknown action');
});
