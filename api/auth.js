// GET  /api/auth                      -> { user | null }
// POST /api/auth {action:'enter', email, password}  -> sign in, or create the account if the email is new
// POST /api/auth {action:'logout'}
// POST /api/auth {action:'rename', name}
// POST /api/auth {action:'changePassword', current, password}  -> also clears a forced change; signs out other devices
import {
  route, send, fail, db, hashPassword, verifyPassword, createSession, destroySession,
  currentUser, requireUser, publicUser, clientIp, cleanName, logEvent,
} from './_lib.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_FAILS = 10, FAIL_WINDOW_MIN = 15;

export default route(['GET', 'POST'], async (req, res) => {
  if (req.method === 'GET') return send(res, 200, { user: publicUser(await currentUser(req)) });

  const { action } = req.body;

  if (action === 'logout') {
    const who = await currentUser(req).catch(() => null);
    if (who) await logEvent(req, who, 'sign_out');
    await destroySession(req, res);
    return send(res, 200, { ok: true });
  }

  if (action === 'rename') {
    const u = await requireUser(req, res); if (!u) return;
    const name = cleanName(req.body.name);
    if (!name) return fail(res, 400, 'Name can’t be empty');
    await db()`update users set name = ${name} where id = ${u.id}`;
    await logEvent(req, u, 'rename', { detail: { from: u.name, to: name } });
    return send(res, 200, { user: publicUser({ ...u, name }) });
  }

  if (action === 'changePassword') {
    const u = await currentUser(req);
    if (!u) return fail(res, 401, 'Sign in first');
    const current = String(req.body.current || ''), next = String(req.body.password || '');
    const [row] = await db()`select pw_hash from users where id = ${u.id}`;
    if (!(await verifyPassword(current, row.pw_hash))) return fail(res, 401, 'Your current password isn’t right.');
    if (next.length < 8) return fail(res, 400, 'Pick a password with at least 8 characters.');
    if (next.length > 200) return fail(res, 400, 'That password is too long.');
    if (next === current) return fail(res, 400, 'Pick a different password from the old one.');
    if (/^(password|12345678|123456789|qwertyui|sumduel)/i.test(next)) return fail(res, 400, 'That one’s too easy to guess. Try a few words together.');
    await db()`update users set pw_hash = ${await hashPassword(next)}, must_change_pw = false where id = ${u.id}`;
    // Keep this device signed in; sign out everywhere else.
    const t = String(req.headers.cookie || '').match(/(?:^|;\s*)sd_s=([^;]+)/);
    const keep = t ? (await import('node:crypto')).createHash('sha256').update(decodeURIComponent(t[1])).digest('hex') : '';
    await db()`delete from sessions where user_id = ${u.id} and token_hash <> ${keep}`;
    await logEvent(req, u, 'password_changed', { detail: { forced: !!u.must_change_pw } });
    return send(res, 200, { user: publicUser({ ...u, must_change_pw: false }) });
  }

  if (action !== 'enter') return fail(res, 400, 'Unknown action');

  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!EMAIL_RE.test(email) || email.length > 254) return fail(res, 400, 'That doesn’t look like an email');
  if (password.length < 6) return fail(res, 400, 'Password needs at least 6 characters');
  if (password.length > 200) return fail(res, 400, 'Password is too long');

  const sql = db();
  const failKey = email + '|' + clientIp(req);
  const [{ n }] = await sql`select count(*)::int as n from auth_fails
                            where key = ${failKey} and at > now() - make_interval(mins => ${FAIL_WINDOW_MIN})`;
  if (n >= MAX_FAILS) {
    await logEvent(req, { id: null, email, role: null }, 'sign_in_locked');
    return fail(res, 429, 'Too many attempts. Try again in 15 minutes.');
  }

  let [user] = await sql`select id, email, name, pw_hash, created_at, role, must_change_pw from users where email = ${email}`;
  let created = false;

  if (user) {
    if (!(await verifyPassword(password, user.pw_hash))) {
      await sql`insert into auth_fails (key) values (${failKey})`;
      await logEvent(req, user, 'sign_in_failed');
      // Opportunistic cleanup of stale rows
      if (Math.random() < 0.05) await sql`delete from auth_fails where at < now() - interval '1 day'`;
      return fail(res, 401, 'Wrong password for that email');
    }
  } else {
    const name = cleanName(email.split('@')[0].split('+')[0].replace(/[._-]+/g, ' ')) || 'Player';
    const pw_hash = await hashPassword(password);
    const rows = await sql`insert into users (email, name, pw_hash) values (${email}, ${name}, ${pw_hash})
                           on conflict (email) do nothing
                           returning id, email, name, created_at, role`;
    if (!rows[0]) return fail(res, 409, 'That email was just registered. Try signing in.');
    user = rows[0]; created = true;
  }

  await createSession(req, res, user.id);
  await logEvent(req, user, created ? 'sign_up' : 'sign_in');
  send(res, 200, { user: publicUser(user), created });
});
