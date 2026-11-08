// Verify a Google Identity Services ID token (RS256 JWT) with node:crypto only, no deps.
// Checks signature against Google's published JWKS, plus iss, aud, exp and email_verified.
import { createPublicKey, verify } from 'node:crypto';

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
let cache = { at: 0, keys: [] };

async function googleKeys(force = false) {
  if (!force && cache.keys.length && Date.now() - cache.at < 3600e3) return cache.keys;
  const r = await fetch(CERTS_URL);
  if (!r.ok) throw Object.assign(new Error('Could not reach Google to verify sign-in'), { status: 502 });
  const { keys } = await r.json();
  cache = { at: Date.now(), keys: Array.isArray(keys) ? keys : [] };
  return cache.keys;
}

const part = s => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

// Returns the token payload, or null if the token is not valid for this client id.
export async function verifyGoogleIdToken(token, clientId) {
  const bits = String(token || '').split('.');
  if (bits.length !== 3 || token.length > 4096) return null;
  const [h, p, s] = bits;
  let header, payload;
  try { header = part(h); payload = part(p); } catch { return null; }
  if (header.alg !== 'RS256' || !header.kid) return null;

  let jwk = (await googleKeys()).find(k => k.kid === header.kid);
  if (!jwk) jwk = (await googleKeys(true)).find(k => k.kid === header.kid); // key rotation
  if (!jwk) return null;

  let ok = false;
  try {
    ok = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'));
  } catch { return null; }
  if (!ok) return null;

  const now = Math.floor(Date.now() / 1000);
  if (!ISSUERS.includes(payload.iss)) return null;
  if (payload.aud !== clientId) return null;
  if (!(typeof payload.exp === 'number' && payload.exp > now - 30)) return null;
  if (payload.email_verified !== true || typeof payload.email !== 'string') return null;
  return payload;
}

// Test hook: lets a local harness inject keys instead of hitting Google.
export function _setKeysForTest(keys) { cache = { at: Date.now(), keys }; }
