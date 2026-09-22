// The guest-facing endpoint.
//   POST /api/waiter { venue: '<slug>', messages: [{ role, content }] }
//
// Two model calls with deterministic filtering between them: the first turns the
// guest's sentence into constraints, code decides which dishes are allowed, and
// the second writes the answer from that list only. A post-check throws the
// answer away if it names a dish the filter excluded.
//
// If the model is unavailable the request still succeeds. Constraints fall back
// to the keyword read, code does the same filtering, and the guest gets a plain
// list instead of a sentence — never a blank screen, and never an unfiltered
// menu.

import {
  extractConstraints, mergeConstraints, filterMenu, filterDrinks, compose,
  guardReply, renderFallback, safetyLine, makeClient, detectAllergens,
  detectPriceCap, MODEL,
} from '../lib/waiter.js';
import { store } from '../lib/store.js';

const MAX_TURNS = 10;
const MAX_CHARS = 600;

// Crude per-instance throttle. Serverless instances come and go, so this is a
// speed bump against a single tab hammering the endpoint, not real abuse
// protection — that belongs at the edge, and a per-venue budget belongs in the
// store before this carries live traffic.
const seen = new Map();
function throttled(key) {
  const now = Date.now();
  const hits = (seen.get(key) || []).filter((t) => now - t < 60_000);
  hits.push(now);
  seen.set(key, hits);
  if (seen.size > 500) for (const [k, v] of seen) if (!v.some((t) => now - t < 60_000)) seen.delete(k);
  return hits.length > 20;
}

// What the guest's own words alone imply. Used when the model is unreachable, so
// an allergy still filters the menu even with no AI in the loop at all.
function keywordOnlyConstraints(text) {
  return {
    allergens: detectAllergens(text),
    diets: [],
    maxPrice: detectPriceCap(text),
    minPrice: null,
    // Never volunteer drinks in a degraded answer; the guest's intent is
    // exactly what we just lost the ability to read properly.
    wantsDrinkPairing: false,
    language: 'nb',
    keywordOnly: detectAllergens(text),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'ukjent';
  const slug = String(req.body?.venue || req.query?.venue || '').trim().slice(0, 80);
  if (!slug) return res.status(400).json({ error: 'Mangler venue.' });
  if (throttled(`${slug}:${ip}`)) {
    return res.status(429).json({ error: 'For mange spørsmål på kort tid. Vent litt.' });
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

    const menu = await store.getPublishedMenu(slug);
    if (!menu) return res.status(404).json({ error: 'Ingen publisert meny for dette stedet.' });

    const client = makeClient();
    let c, degraded = false;

    // --- understand -------------------------------------------------------
    if (client) {
      try {
        c = mergeConstraints(await extractConstraints(client, history), lastUser);
      } catch (e) {
        console.error('[waiter] extract failed', e.message);
        c = keywordOnlyConstraints(lastUser);
        degraded = true;
      }
    } else {
      c = keywordOnlyConstraints(lastUser);
      degraded = true;
    }

    // --- decide, in code --------------------------------------------------
    const { ok, excluded, needsStaff } = filterMenu(menu, c);
    const drinks = filterDrinks(menu, c, ok);

    // --- speak ------------------------------------------------------------
    let reply, guarded = false;
    if (!ok.length || degraded || !client) {
      // Nothing survived the filter, or we have no model to trust. Letting a
      // model improvise here is how an excluded dish gets recommended.
      reply = renderFallback(ok, drinks);
    } else {
      try {
        const spoken = await compose(client, menu, history, ok, drinks, c);
        const check = guardReply(menu, spoken.text, ok.map((d) => d.ref));
        if (check.ok && spoken.text && spoken.stopReason !== 'refusal') {
          reply = spoken.text;
        } else {
          console.error('[waiter] guard tripped', { venue: slug, leaked: check.leaked, stop: spoken.stopReason });
          reply = renderFallback(ok, drinks);
          guarded = true;
        }
      } catch (e) {
        console.error('[waiter] compose failed', e.message);
        reply = renderFallback(ok, drinks);
        degraded = true;
      }
    }

    const safety = safetyLine(menu, c, needsStaff);

    // Audit trail and the report the venue actually reads. Never blocks the
    // guest's answer.
    store.logConversation({
      venueId: menu.venue.id,
      menuVersionId: menu.version.id,
      lang: c.language,
      question: lastUser,
      reply,
      constraints: { allergens: c.allergens, diets: c.diets, maxPrice: c.maxPrice },
      shownRefs: ok.map((d) => d.ref),
      guardTripped: guarded,
      sentToStaff: needsStaff.length > 0,
      degraded,
    }).catch((e) => console.error('[waiter] log failed', e.message));

    res.json({
      reply,
      safety,
      constraints: {
        allergens: c.allergens,
        diets: c.diets,
        maxPrice: c.maxPrice,
        wantsDrinkPairing: c.wantsDrinkPairing,
        // Which restrictions only the keyword backstop caught — worth surfacing,
        // because it shows the two reads doing independent work.
        caughtByKeywordOnly: c.keywordOnly || [],
      },
      dishes: ok.map((d) => ({ ref: d.ref, name: d.name, price: d.price })),
      drinks: drinks.map((d) => ({ ref: d.ref, name: d.name, price: d.price })),
      excluded: excluded.map((e) => ({ name: e.dish.name, reason: e.reason, verdict: e.verdict })),
      needsStaff: needsStaff.map((n) => ({ name: n.dish.name, reason: n.reason })),
      venue: { slug: menu.venue.slug, name: menu.venue.name },
      meta: {
        model: MODEL,
        guarded,
        degraded,
        menuVersion: menu.version.label,
        attestedAt: menu.attestation?.signedAt || null,
        attestationOk: menu.attestationOk,
      },
    });
  } catch (e) {
    console.error('[waiter]', e);
    res.status(500).json({ error: 'Kelneren klarte ikke å svare. Prøv igjen.' });
  }
}
