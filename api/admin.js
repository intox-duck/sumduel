// Admin portal API. Separate from player auth: admins sign in with Google (proves Gmail ownership),
// and only emails listed in ADMIN_EMAILS are let in. Admin sessions use their own cookie and table.
//
// GET  /api/admin                                   -> { configured, clientId, admin: email|null }
// POST /api/admin {action:'login', credential}      -> verify Google ID token, start admin session
// POST /api/admin {action:'logout'}
// POST /api/admin {action:'users', q?}              -> search users (newest first, max 100)
// POST /api/admin {action:'setPassword', userId, password}
//                                                   -> new password, signs the user out everywhere,
//                                                      clears their lockout, writes an audit row
// POST /api/admin {action:'audit'}                  -> last 50 admin actions
import { randomBytes, createHash } from 'node:crypto';
import { route, send, fail, db, hashPassword, clientIp } from './_lib.js';
import { verifyGoogleIdToken } from './_google.js';

const COOKIE = 'sd_a';
const HOURS = 8;
const sha = t => createHash('sha256').update(t).digest('hex');

const clientId = () => String(process.env.GOOGLE_CLIENT_ID || '').trim();
const adminEmails = () => String(process.env.ADMIN_EMAILS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const isAdminEmail = e => adminEmails().includes(String(e || '').toLowerCase());
const configured = () => Boolean(clientId() && adminEmails().length);

function cookie(req, value, maxAge) {
  const host = String(req.headers.host || '');
  const local = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  return `${COOKIE}=${value}; Max-Age=${maxAge}; Path=/api/admin; HttpOnly; SameSite=Strict${local ? '' : '; Secure'}`;
}

function readCookie(req) {
  for (const p of String(req.headers.cookie || '').split(';')) {
    const i = p.indexOf('=');
    if (i > 0 && p.slice(0, i).trim() === COOKIE) return decodeURIComponent(p.slice(i + 1).trim());
  }
  return null;
}

async function currentAdmin(req) {
  const t = readCookie(req);
  if (!t || t.length > 100) return null;
  const [row] = await db()`select email from admin_sessions where token_hash = ${sha(t)} and expires_at > now()`;
  // Re-check the allowlist every request, so removing an email from ADMIN_EMAILS revokes access at once.
  return row && isAdminEmail(row.email) ? row.email : null;
}

const audit = (admin, action, user, req) => db()`
  insert into admin_audit (admin_email, action, target_user_id, target_email, ip)
  values (${admin}, ${action}, ${user ? user.id : null}, ${user ? user.email : null}, ${clientIp(req)})`;

export default route(['GET', 'POST'], async (req, res) => {
  if (req.method === 'GET') {
    return send(res, 200, {
      configured: configured(),
      clientId: clientId() || null,
      admin: configured() ? await currentAdmin(req) : null,
    });
  }

  if (!configured()) return fail(res, 503, 'Admin portal is not configured');
  const { action } = req.body;
  const sql = db();

  if (action === 'login') {
    const payload = await verifyGoogleIdToken(req.body.credential, clientId());
    if (!payload) return fail(res, 401, 'Google sign-in could not be verified');
    const email = payload.email.toLowerCase();
    if (!isAdminEmail(email)) {
      await audit(email, 'login_denied', null, req);
      return fail(res, 403, `${email} is not an admin`);
    }
    const token = randomBytes(32).toString('base64url');
    await sql`insert into admin_sessions (token_hash, email, expires_at)
              values (${sha(token)}, ${email}, now() + make_interval(hours => ${HOURS}))`;
    await sql`delete from admin_sessions where expires_at < now()`;
    await audit(email, 'login', null, req);
    res.setHeader('Set-Cookie', cookie(req, token, HOURS * 3600));
    return send(res, 200, { admin: email });
  }

  if (action === 'logout') {
    const t = readCookie(req);
    if (t) await sql`delete from admin_sessions where token_hash = ${sha(t)}`;
    res.setHeader('Set-Cookie', cookie(req, '', 0));
    return send(res, 200, { ok: true });
  }

  const admin = await currentAdmin(req);
  if (!admin) return fail(res, 401, 'Admin sign-in required');

  if (action === 'users') {
    const q = String(req.body.q || '').trim().slice(0, 100);
    const like = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
    const users = await sql`
      select u.id::text as id, u.email, u.name, u.created_at,
             (select count(*)::int from battles b where b.user_id = u.id) as battles,
             (select max(s.created_at) from sessions s where s.user_id = u.id) as last_sign_in,
             (select count(*)::int from sessions s where s.user_id = u.id and s.expires_at > now()) as sessions
      from users u
      where ${q}::text = '' or u.email ilike ${like} or u.name ilike ${like}
      order by u.created_at desc
      limit 100`;
    const [{ total }] = await sql`select count(*)::int as total from users`;
    return send(res, 200, { users, total });
  }

  if (action === 'setPassword') {
    const userId = String(req.body.userId || '');
    const password = String(req.body.password || '');
    if (!/^\d{1,18}$/.test(userId)) return fail(res, 400, 'Bad user id');
    if (password.length < 6) return fail(res, 400, 'Password needs at least 6 characters');
    if (password.length > 200) return fail(res, 400, 'Password is too long');
    const [user] = await sql`select id, email from users where id = ${userId}`;
    if (!user) return fail(res, 404, 'User not found');
    const pw_hash = await hashPassword(password);
    await sql`update users set pw_hash = ${pw_hash} where id = ${user.id}`;
    const ended = await sql`delete from sessions where user_id = ${user.id} returning 1`;
    // auth_fails keys are "email|ip": clear every lockout row for this email.
    await sql`delete from auth_fails where key like ${user.email.replace(/[\\%_]/g, '\\$&') + '|%'}`;
    await audit(admin, 'set_password', user, req);
    return send(res, 200, { ok: true, email: user.email, sessionsEnded: ended.length });
  }

  if (action === 'audit') {
    const rows = await sql`select admin_email, action, target_email, ip, at
                           from admin_audit order by at desc limit 50`;
    return send(res, 200, { rows });
  }

  fail(res, 400, 'Unknown action');
});
