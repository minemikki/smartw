// Session lifecycle.
//   GET  /api/session?token=…   consume a magic link, set the cookie, go to admin
//   GET  /api/session           who am I (for the admin page to bootstrap)
//   POST /api/session           { action: 'logout' }

import { store } from '../lib/store.js';
import { issue, cookieHeader, clearCookie, requireSession } from '../lib/session.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      if (req.body?.action !== 'logout') return res.status(400).json({ error: 'Ukjent handling.' });
      res.setHeader('Set-Cookie', clearCookie());
      return res.json({ ok: true });
    }
    if (req.method !== 'GET') return res.status(405).json({ error: 'GET or POST' });

    const token = String(req.query?.token || '');
    if (token) {
      const found = await store.consumeLoginToken(token);
      if (!found) {
        // Expired, already used, or never existed — all the same to the visitor.
        return res.status(303).setHeader('Location', '/admin.html?feil=lenke').end();
      }
      const user = await store.findUserByEmail(found.email);
      res.setHeader('Set-Cookie', cookieHeader(issue({
        venueSlug: found.venueSlug, email: found.email, role: user?.role || '',
      })));
      return res.status(303).setHeader('Location', '/admin.html').end();
    }

    const s = requireSession(req, res);
    if (!s) return;
    res.json({ ok: true, session: s });
  } catch (e) {
    console.error('[session]', e);
    res.status(500).json({ error: 'Noe gikk galt med innloggingen.' });
  }
}
