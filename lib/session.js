// Signed, stateless sessions for the admin.
//
// HMAC over a compact payload, so a session survives a serverless cold start
// without a session table, and a tampered cookie fails closed. Nothing secret
// is stored in the cookie — only which venue and user it is for.

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

const TTL_MS = 12 * 60 * 60 * 1000;          // a work shift
export const COOKIE = 'sw_session';

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 24) {
    throw new Error('SESSION_SECRET mangler (minst 24 tegn). Sett den før admin kan brukes.');
  }
  return s;
}

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (body) => createHmac('sha256', secret()).update(body).digest('base64url');

export function issue({ venueSlug, email, role }) {
  const body = b64(JSON.stringify({ v: venueSlug, e: email, r: role || '', x: Date.now() + TTL_MS }));
  return `${body}.${sign(body)}`;
}

export function verify(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.', 2);
  if (!body || !mac) return null;

  const expected = sign(body);
  // Constant-time compare; lengths must match before timingSafeEqual.
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!p || typeof p.x !== 'number' || Date.now() > p.x) return null;
  return { venueSlug: p.v, email: p.e, role: p.r };
}

export const newLoginToken = () => randomBytes(32).toString('base64url');

export function cookieHeader(token) {
  const parts = [
    `${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${Math.floor(TTL_MS / 1000)}`,
  ];
  // Vercel terminates TLS, so Secure is right in production but breaks
  // http://localhost during development.
  if (process.env.VERCEL) parts.push('Secure');
  return parts.join('; ');
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export function readCookie(req) {
  const raw = req.headers?.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return null;
}

// Returns the session or sends the right refusal. Every admin endpoint starts
// with this, so there is one place that decides who may edit a menu.
export function requireSession(req, res) {
  let s = null;
  try { s = verify(readCookie(req)); }
  catch (e) { res.status(500).json({ error: e.message }); return null; }
  if (!s) { res.status(401).json({ error: 'Ikke innlogget.' }); return null; }
  return s;
}
