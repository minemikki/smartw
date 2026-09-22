// Sends a magic link to a venue's registered email.
//   POST /api/login { email }
//
// Always answers the same way whether or not the address is registered, so the
// endpoint cannot be used to discover who our customers are.

import { store } from '../lib/store.js';
import { newLoginToken } from '../lib/session.js';
import { sendMail } from '../lib/mail.js';

const attempts = new Map();
function throttled(key) {
  const now = Date.now();
  const hits = (attempts.get(key) || []).filter((t) => now - t < 600_000);
  hits.push(now);
  attempts.set(key, hits);
  if (attempts.size > 500) for (const [k, v] of attempts) if (!v.some((t) => now - t < 600_000)) attempts.delete(k);
  return hits.length > 5;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 160);
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'ukjent';
  const sent = { ok: true, message: 'Er adressen registrert, ligger det en lenke i innboksen om et øyeblikk.' };

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Skriv inn en gyldig e-postadresse.' });
  }
  if (throttled(`${ip}:${email}`)) {
    return res.status(429).json({ error: 'For mange forsøk. Prøv igjen om noen minutter.' });
  }

  try {
    const user = await store.findUserByEmail(email);
    if (!user) return res.json(sent);          // same answer as success, on purpose

    const raw = newLoginToken();
    await store.createLoginToken({ email, venueSlug: user.venueSlug, raw, ttlMinutes: 20 });

    const base = process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;
    const link = `${base}/api/session?token=${encodeURIComponent(raw)}`;
    await sendMail({
      to: email,
      subject: 'Logg inn i menyadmin',
      text: `Hei${user.name ? ' ' + user.name : ''},

Trykk her for å logge inn i menyadmin for ${user.venueName || user.venueSlug}:

${link}

Lenken virker i 20 minutter og kan brukes én gang. Har du ikke bedt om den, kan du ignorere denne e-posten.`,
    });
    res.json(sent);
  } catch (e) {
    console.error('[login]', e);
    res.status(500).json({ error: 'Kunne ikke sende innloggingslenken.' });
  }
}
