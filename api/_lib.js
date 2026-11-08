// Shared helpers for Vercel functions. Files starting with "_" are not deployed as routes.
import { neon } from '@neondatabase/serverless';
import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

let _sql;
export function db() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw Object.assign(new Error('Database not configured'), { status: 503 });
    _sql = neon(url);
  }
  return _sql;
}

export const COOKIE = 'sd_s';
const SESSION_DAYS = 365;

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function fail(res, status, error) { send(res, status, { error }); }

// Wrap a handler: method gate, JSON-only POSTs (cheap CSRF guard alongside SameSite=Lax), error mapping.
export function route(methods, fn) {
  return async (req, res) => {
    try {
      if (!methods.includes(req.method)) return fail(res, 405, 'Method not allowed');
      if (req.method === 'POST') {
        const ct = String(req.headers['content-type'] || '');
        if (!ct.includes('application/json')) return fail(res, 415, 'JSON only');
        if (typeof req.body === 'string') { try { req.body = JSON.parse(req.body); } catch { return fail(res, 400, 'Bad JSON'); } }
        if (!req.body || typeof req.body !== 'object') req.body = {};
      }
      await fn(req, res);
    } catch (e) {
      console.error(e);
      fail(res, e.status || 500, e.status ? e.message : 'Server error');
    }
  };
}

// ---------- passwords (scrypt, no deps) ----------
const N = 16384, R = 8, P = 1, KEYLEN = 64;
const scryptAsync = (pw, salt) => new Promise((ok, no) =>
  scrypt(pw, salt, KEYLEN, { N, r: R, p: P }, (err, key) => err ? no(err) : ok(key)));

export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt);
  return `s1$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(pw, stored) {
  const [v, s, k] = String(stored).split('$');
  if (v !== 's1' || !s || !k) return false;
  const key = await scryptAsync(pw, Buffer.from(s, 'base64'));
  const want = Buffer.from(k, 'base64');
  return want.length === key.length && timingSafeEqual(want, key);
}

// ---------- sessions ----------
const sha = t => createHash('sha256').update(t).digest('hex');

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function cookieAttrs(req) {
  const host = String(req.headers.host || '');
  const local = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  return `Path=/; HttpOnly; SameSite=Lax${local ? '' : '; Secure'}`;
}

export async function createSession(req, res, userId) {
  const token = randomBytes(32).toString('base64url');
  await db()`insert into sessions (token_hash, user_id, expires_at)
             values (${sha(token)}, ${userId}, now() + make_interval(days => ${SESSION_DAYS}))`;
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Max-Age=${SESSION_DAYS * 86400}; ${cookieAttrs(req)}`);
}

export async function destroySession(req, res) {
  const t = parseCookies(req)[COOKIE];
  if (t) await db()`delete from sessions where token_hash = ${sha(t)}`;
  res.setHeader('Set-Cookie', `${COOKIE}=; Max-Age=0; ${cookieAttrs(req)}`);
}

export async function currentUser(req) {
  const t = parseCookies(req)[COOKIE];
  if (!t || t.length > 100) return null;
  const rows = await db()`select u.id, u.email, u.name, u.created_at, u.role, u.muted_until
                          from sessions s join users u on u.id = s.user_id
                          where s.token_hash = ${sha(t)} and s.expires_at > now()`;
  return rows[0] || null;
}

export async function requireUser(req, res) {
  const u = await currentUser(req);
  if (!u) { fail(res, 401, 'Sign in first'); return null; }
  return u;
}

// `admin:true` is only exposed for the plain admin role (it drives the "Admin tools" link).
// super_admin is deliberately indistinguishable from a player in every player-facing response.
export const publicUser = u => u && ({
  id: String(u.id), email: u.email, name: u.name, since: u.created_at,
  ...(u.role === 'admin' ? { admin: true } : {}),
});

export const isMod = u => !!u && (u.role === 'admin' || u.role === 'super_admin');
export const isSuper = u => !!u && u.role === 'super_admin';

// Append-only site activity log (read only by super_admin). Never throws: logging must not break gameplay.
export async function logEvent(req, actor, action, { target = null, detail = null } = {}) {
  try {
    await db()`insert into activity_log (actor_user_id, actor_email, actor_role, action, target_user_id, target_email, detail, ip, ua)
               values (${actor ? actor.id : null}, ${actor ? actor.email : null}, ${actor ? (actor.role || 'player') : null}, ${action},
                       ${target ? target.id : null}, ${target ? target.email : null},
                       ${detail == null ? null : JSON.stringify(detail)}::jsonb, ${req ? clientIp(req) : null},
                       ${req ? String(req.headers['user-agent'] || '').slice(0, 200) : null})`;
  } catch (e) { console.error('logEvent failed', action, e.message); }
}

export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() || 'unknown';
}

export const cleanName = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);

export function utcDay(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}
