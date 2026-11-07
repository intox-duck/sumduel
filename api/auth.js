// GET  /api/auth                      -> { user | null }
// POST /api/auth {action:'enter', email, password}  -> sign in, or create the account if the email is new
// POST /api/auth {action:'logout'}
// POST /api/auth {action:'rename', name}
import {
  route, send, fail, db, hashPassword, verifyPassword, createSession, destroySession,
  currentUser, requireUser, publicUser, clientIp, cleanName,
} from './_lib.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_FAILS = 10, FAIL_WINDOW_MIN = 15;

export default route(['GET', 'POST'], async (req, res) => {
  if (req.method === 'GET') return send(res, 200, { user: publicUser(await currentUser(req)) });

  const { action } = req.body;

  if (action === 'logout') {
    await destroySession(req, res);
    return send(res, 200, { ok: true });
  }

  if (action === 'rename') {
    const u = await requireUser(req, res); if (!u) return;
    const name = cleanName(req.body.name);
    if (!name) return fail(res, 400, 'Name can’t be empty');
    await db()`update users set name = ${name} where id = ${u.id}`;
    return send(res, 200, { user: publicUser({ ...u, name }) });
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
  if (n >= MAX_FAILS) return fail(res, 429, 'Too many attempts. Try again in 15 minutes.');

  let [user] = await sql`select id, email, name, pw_hash, created_at from users where email = ${email}`;
  let created = false;

  if (user) {
    if (!(await verifyPassword(password, user.pw_hash))) {
      await sql`insert into auth_fails (key) values (${failKey})`;
      // Opportunistic cleanup of stale rows
      if (Math.random() < 0.05) await sql`delete from auth_fails where at < now() - interval '1 day'`;
      return fail(res, 401, 'Wrong password for that email');
    }
  } else {
    const name = cleanName(email.split('@')[0].split('+')[0].replace(/[._-]+/g, ' ')) || 'Player';
    const pw_hash = await hashPassword(password);
    const rows = await sql`insert into users (email, name, pw_hash) values (${email}, ${name}, ${pw_hash})
                           on conflict (email) do nothing
                           returning id, email, name, created_at`;
    if (!rows[0]) return fail(res, 409, 'That email was just registered. Try signing in.');
    user = rows[0]; created = true;
  }

  await createSession(req, res, user.id);
  send(res, 200, { user: publicUser(user), created });
});
