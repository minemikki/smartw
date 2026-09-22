// AI-kelner — the conversational menu assistant.
//   POST /api/waiter { messages: [{ role: 'user'|'assistant', content }] }
//
// Two model calls with deterministic filtering between them: the first turns the
// guest's sentence into constraints, code decides which dishes are allowed, and
// the second writes the answer from that list only. A post-check throws the
// answer away if it names a dish the filter excluded.

import {
  extractConstraints, mergeConstraints, filterMenu, filterDrinks,
  compose, guardReply, renderFallback, safetyLine, makeClient, MODEL,
} from '../lib/waiter.js';
import { RESTAURANT } from '../lib/menu.js';

const MAX_TURNS = 10;
const MAX_CHARS = 600;

// Crude per-instance throttle. Serverless instances come and go, so this is a
// speed bump against a single tab hammering the endpoint, not real abuse
// protection — that belongs at the edge before this ever carries live traffic.
const seen = new Map();
function throttled(ip) {
  const now = Date.now();
  const hits = (seen.get(ip) || []).filter((t) => now - t < 60_000);
  hits.push(now);
  seen.set(ip, hits);
  if (seen.size > 500) for (const [k, v] of seen) if (!v.some((t) => now - t < 60_000)) seen.delete(k);
  return hits.length > 20;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'ukjent';
  if (throttled(ip)) return res.status(429).json({ error: 'For mange spørsmål på kort tid. Vent litt.' });

  const client = makeClient();
  if (!client) {
    return res.status(503).json({ error: 'AI-kelneren er ikke konfigurert (ANTHROPIC_API_KEY mangler).' });
  }

  try {
    const raw = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const history = raw
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-MAX_TURNS)
      .map((m) => ({ role: m.role, content: m.content.trim().slice(0, MAX_CHARS) }))
      .filter((m) => m.content);

    if (!history.length || history[history.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'Siste melding må komme fra gjesten.' });
    }
    const lastUser = history[history.length - 1].content;

    // 1 — understand, 2 — decide in code, 3 — speak.
    const extracted = await extractConstraints(client, history);
    const c = mergeConstraints(extracted, lastUser);
    const { ok, excluded, needsStaff } = filterMenu(c);
    const drinks = filterDrinks(c, ok);

    let reply, guarded = false;
    if (!ok.length) {
      // Nothing survived the filter. There is no answer to compose, and letting
      // the model improvise here is exactly how an excluded dish gets served.
      reply = renderFallback(ok, drinks);
    } else {
      const spoken = await compose(client, history, ok, drinks, c);
      const check = guardReply(spoken.text, ok.map((d) => d.id));
      if (check.ok && spoken.text && spoken.stopReason !== 'refusal') {
        reply = spoken.text;
      } else {
        // The model named something the filter had removed. Discard the sentence.
        console.error('[waiter] guard tripped', { leaked: check.leaked, stop: spoken.stopReason });
        reply = renderFallback(ok, drinks);
        guarded = true;
      }
    }

    res.json({
      reply,
      safety: safetyLine(c, needsStaff),
      constraints: {
        allergens: c.allergens,
        diets: c.diets,
        maxPrice: c.maxPrice,
        wantsDrinkPairing: c.wantsDrinkPairing,
        // Which restrictions only the keyword backstop caught — worth seeing in
        // the demo, because it shows the two reads doing independent work.
        caughtByKeywordOnly: c.keywordOnly,
      },
      dishes: ok.map((d) => ({ id: d.id, name: d.name, price: d.price })),
      drinks: drinks.map((d) => ({ id: d.id, name: d.name, price: d.price })),
      excluded: excluded.map((e) => ({ name: e.dish.name, reason: e.reason, verdict: e.verdict })),
      needsStaff: needsStaff.map((n) => ({ name: n.dish.name, reason: n.reason })),
      meta: { model: MODEL, guarded, menuVersion: RESTAURANT.attestation.version, attestedAt: RESTAURANT.attestation.at },
    });
  } catch (e) {
    console.error('[waiter]', e);
    res.status(500).json({ error: 'Kelneren klarte ikke å svare. Prøv igjen.' });
  }
}
