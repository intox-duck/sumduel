// Safeguarding audit: summarises everything since the previous report (max 7 days) and stores it in audit_reports.
// Run daily by Vercel cron (/api/audit-cron) and on demand by the super_admin.
import { db, logEvent } from './_lib.js';

export async function runAudit(req, actor, trigger) {
  const sql = db();
  // Use the database clock for the window: activity rows are stamped with Postgres now(), and the
  // function host's clock can drift from it (seen in QA), which would silently drop recent events.
  const [last] = await sql`select period_end from audit_reports order by period_end desc limit 1`;
  const [{ end }] = await sql`select now() as end`;
  const floor = new Date(new Date(end).getTime() - 7 * 864e5);
  let start = last ? new Date(last.period_end) : new Date(new Date(end).getTime() - 864e5);
  if (start < floor) start = floor;

  const counts = Object.fromEntries((await sql`
    select action, count(*)::int as n from activity_log where at > ${start} and at <= ${end} group by action`).map(r => [r.action, r.n]));
  const [{ new_users }] = await sql`select count(*)::int as new_users from users where created_at > ${start} and created_at <= ${end}`;
  const [{ flagged_new }] = await sql`select count(*)::int as flagged_new from chat_messages where flagged and at > ${start} and at <= ${end}`;
  const [{ unreviewed }] = await sql`select count(*)::int as unreviewed from chat_messages where flagged and reviewed_at is null`;
  const [{ open_reports }] = await sql`select count(*)::int as open_reports from chat_reports where resolved_at is null`;
  const reasons = await sql`select reason, count(*)::int as n from (
                              select unnest(string_to_array(flag_reason, ',')) as reason from chat_messages
                              where flagged and at > ${start} and at <= ${end}) x group by reason order by n desc`;
  const chatters = await sql`select nick, count(*)::int as n from chat_messages where at > ${start} and at <= ${end}
                             group by nick order by n desc limit 5`;
  const blocked = await sql`select actor_email, detail->>'reason' as reason, detail->>'text' as text, at from activity_log
                            where action = 'chat_blocked' and at > ${start} and at <= ${end} order by at desc limit 20`;
  // Oversight of moderators: everything done by users with the plain admin role.
  const adminActions = await sql`select at, actor_email, action, target_email, detail from activity_log
                                 where actor_role = 'admin' and at > ${start} and at <= ${end}
                                   and (action in ('chat_delete','chat_mute','chat_unmute') or (action like 'admin\\_%' and action <> 'admin_open'))
                                 order by at desc limit 50`;
  const muted = await sql`select name, email, muted_until from users where muted_until > now() order by muted_until desc`;

  const attention = [];
  if (unreviewed) attention.push(`${unreviewed} flagged chat message(s) waiting for review`);
  if (open_reports) attention.push(`${open_reports} open player report(s)`);
  if (blocked.length) attention.push(`${blocked.length} blocked attempt(s) to share personal details or links`);
  if ((counts.sign_in_locked || 0) > 0) attention.push(`${counts.sign_in_locked} account lockout(s) from repeated wrong passwords`);
  if (reasons.some(r => r.reason === 'wellbeing')) attention.push('Wellbeing words were flagged: check those messages first');

  const data = {
    period: { start, end }, attention,
    totals: {
      new_users, sign_ins: counts.sign_in || 0, sign_ups: counts.sign_up || 0, failed_sign_ins: counts.sign_in_failed || 0,
      lockouts: counts.sign_in_locked || 0, battles: counts.battle_saved || 0, scores: counts.score_posted || 0,
      live_games: counts.live_finish || 0, live_wrong_passwords: counts.live_join_failed || 0,
      chat_messages: counts.chat_message || 0, chat_blocked: counts.chat_blocked || 0, chat_flagged: flagged_new,
      chat_reports: counts.chat_report || 0, chat_deletes: counts.chat_delete || 0, chat_mutes: counts.chat_mute || 0,
      password_resets: counts.admin_password_reset || 0, role_changes: counts.admin_role_change || 0,
      unreviewed_flags_total: unreviewed, open_reports_total: open_reports,
    },
    flag_reasons: reasons, top_chatters: chatters, blocked, admin_actions: adminActions, muted,
  };
  const [rep] = await sql`insert into audit_reports (trigger, period_start, period_end, data)
                          values (${trigger}, ${start}, ${end}, ${JSON.stringify(data)}::jsonb)
                          returning id, created_at, trigger, period_start, period_end, data, reviewed_at`;
  await logEvent(req, actor, 'audit_run', { detail: { id: String(rep.id), trigger, attention: attention.length } });
  return rep;
}
