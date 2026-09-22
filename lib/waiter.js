// The AI waiter's engine.
//
// The split that makes this shippable: the model does language, code does
// safety. Anything a guest could be harmed by getting wrong — allergens, price,
// what is actually on the menu — is decided by deterministic code before the
// model is allowed to write a sentence. The model never sees a dish it is not
// allowed to recommend, and a post-check rejects the answer if it names one
// anyway.
//
// Every function takes the venue's `menu` (from lib/store.js) rather than
// importing one, so a single deployment serves many venues.

import Anthropic from '@anthropic-ai/sdk';
import {
  ALLERGEN_IDS, allergenLabel, allergenLabels, detectAllergens, detectPriceCap,
} from './allergens.js';

export const MODEL = 'claude-opus-5';
const norm = (s) => String(s || '').toLowerCase();

// ---------------------------------------------------------------------------
// Deterministic evaluation of one dish against the guest's constraints.
//
// Verdicts:
//   ok          — may be recommended
//   contains    — declared allergen conflict, excluded
//   trace       — "kan inneholde spor av", treated exactly like contains
//   unverified  — no valid signature covers this dish's allergen data, so no
//                 allergen claim is possible; excluded and sent to staff
// ---------------------------------------------------------------------------
export function evaluateDish(dish, c) {
  if (c.maxPrice && dish.price > c.maxPrice) {
    return { verdict: 'price', reason: `${dish.price} kr er over ${c.maxPrice} kr` };
  }
  if (c.minPrice && dish.price < c.minPrice) {
    return { verdict: 'price', reason: `${dish.price} kr er under ${c.minPrice} kr` };
  }
  if (c.diets?.length && !c.diets.every((d) => dish.diets.includes(d))) {
    return { verdict: 'diet', reason: `ikke merket ${c.diets.join(' + ')}` };
  }

  // With no allergen restriction there is no allergen claim to make, so an
  // unattested dish is still fine to suggest.
  if (!c.allergens?.length) return { verdict: 'ok' };

  if (dish.allergenStatus !== 'verified') {
    return { verdict: 'unverified', reason: 'allergeninfo ikke bekreftet av kjøkkenet' };
  }
  const direct = c.allergens.filter((a) => dish.allergens.includes(a));
  if (direct.length) {
    return { verdict: 'contains', reason: `inneholder ${allergenLabels(direct)}` };
  }
  const trace = c.allergens.filter((a) => (dish.mayContain || []).includes(a));
  if (trace.length) {
    return { verdict: 'trace', reason: `kan inneholde spor av ${allergenLabels(trace)}` };
  }
  return { verdict: 'ok' };
}

export function filterMenu(menu, c) {
  const ok = [], excluded = [], needsStaff = [];
  for (const dish of menu.dishes) {
    const r = evaluateDish(dish, c);
    if (r.verdict === 'ok') ok.push(dish);
    else if (r.verdict === 'unverified') needsStaff.push({ dish, reason: r.reason });
    else excluded.push({ dish, reason: r.reason, verdict: r.verdict });
  }
  return { ok, excluded, needsStaff };
}

// Drinks are filtered against the same allergen rules — a coeliac guest asking
// which beer fits must not be handed a wheat beer. Drinks are only ever
// returned when the guest asked: under alkoholloven § 9-2 an unprompted alcohol
// recommendation is a risk the venue does not need.
export function filterDrinks(menu, c, dishes) {
  if (!c.wantsDrinkPairing) return [];
  const byRef = new Map(menu.drinks.map((d) => [d.ref, d]));
  const blocked = (d) => (c.allergens || []).some((a) => d.allergens.includes(a));

  const wanted = new Set();
  for (const dish of dishes) for (const p of dish.pairings || []) wanted.add(p.drink);
  const pool = [...wanted].map((r) => byRef.get(r)).filter(Boolean).filter((d) => !blocked(d));

  // If every suggested pairing is blocked by an allergen, fall back to anything
  // on the drinks list that is actually safe rather than returning nothing.
  return pool.length ? pool : menu.drinks.filter((d) => !blocked(d));
}

// ---------------------------------------------------------------------------
// Model call one: turn free text into constraints.
// ---------------------------------------------------------------------------
const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    allergens: { type: 'array', items: { type: 'string', enum: ALLERGEN_IDS } },
    diets: { type: 'array', items: { type: 'string', enum: ['vegetar', 'vegansk'] } },
    maxPrice: { type: ['integer', 'null'] },
    minPrice: { type: ['integer', 'null'] },
    wantsDrinkPairing: { type: 'boolean' },
    language: { type: 'string', description: 'BCP-47-ish tag for the language the guest wrote in, e.g. nb, en, de' },
  },
  required: ['allergens', 'diets', 'maxPrice', 'minPrice', 'wantsDrinkPairing', 'language'],
  additionalProperties: false,
};

const EXTRACT_SYSTEM = `Du trekker ut bestillingskriterier fra en restaurantgjests melding.
Returner kun det gjesten faktisk har sagt eller tydelig antyder.

- allergens: allergener gjesten må unngå. Ta med alt som antydes — "jeg reagerer på nøtter" => notter.
- diets: bare hvis gjesten ber om vegetar eller vegansk.
- maxPrice/minPrice: kronebeløp gjesten nevner som ramme. "rett til 300 kr" => maxPrice 300. Ellers null.
- wantsDrinkPairing: true hvis gjesten spør om drikke, øl, vin eller hva som passer til maten.
- language: språket gjesten skrev på.

Ved tvil om et allergen: ta det MED. En for streng filtrering er ufarlig, en for løs er det ikke.`;

export async function extractConstraints(client, history) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    system: [{ type: 'text', text: EXTRACT_SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { format: { type: 'json_schema', schema: EXTRACT_SCHEMA }, effort: 'low' },
    messages: history,
  });
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let out = {};
  try { out = JSON.parse(text); } catch { out = {}; }
  return {
    allergens: Array.isArray(out.allergens) ? out.allergens.filter((a) => ALLERGEN_IDS.includes(a)) : [],
    diets: Array.isArray(out.diets) ? out.diets : [],
    maxPrice: Number.isInteger(out.maxPrice) ? out.maxPrice : null,
    minPrice: Number.isInteger(out.minPrice) ? out.minPrice : null,
    wantsDrinkPairing: !!out.wantsDrinkPairing,
    language: typeof out.language === 'string' ? out.language.slice(0, 12) : 'nb',
    usage: res.usage,
  };
}

// Union the two reads, always in the stricter direction.
export function mergeConstraints(modelSide, text) {
  const kw = detectAllergens(text);
  const cap = detectPriceCap(text);
  const allergens = [...new Set([...(modelSide.allergens || []), ...kw])];
  const caps = [modelSide.maxPrice, cap].filter((n) => Number.isInteger(n));
  return {
    ...modelSide,
    allergens,
    maxPrice: caps.length ? Math.min(...caps) : null,
    keywordOnly: kw.filter((a) => !(modelSide.allergens || []).includes(a)),
  };
}

// ---------------------------------------------------------------------------
// Model call two: write the answer, from the surviving candidates only.
// ---------------------------------------------------------------------------
export function composeSystem(menu) {
  const where = menu.venue.city ? ` i ${menu.venue.city}` : '';
  return `Du er kelner på ${menu.venue.name}${where}. Tonen er ${menu.venue.tone}: varm, kort, uten salgsspråk.

ABSOLUTTE REGLER:
1. Du kan BARE nevne retter og drikke som står under KANDIDATER. Aldri noe annet — ikke fra hukommelsen, ikke oppdiktet.
2. Du skal ALDRI si at noe er trygt, fritt for, eller uten et allergen. Systemet legger på sin egen sikkerhetsformulering. Du skriver ingen forbehold selv.
3. Anbefal aldri drikke uoppfordret. Bare hvis DRIKKE-listen finnes under KANDIDATER.
4. Er KANDIDATER tom: si det ærlig i én setning og be gjesten spørre personalet. Ikke foreslå noe.
5. Svar på samme språk som gjesten skrev på.

Form: 2–4 setninger. Nevn pris på retten du anbefaler. Maks to retter, maks to drikker. Ingen lister, ingen overskrifter — snakk som en kelner ved bordet.`;
}

export function candidateBlock(dishes, drinks, c) {
  const lines = ['KANDIDATER', '', 'RETTER (de eneste du kan nevne):'];
  if (!dishes.length) lines.push('  (ingen)');
  for (const d of dishes.slice(0, 8)) lines.push(`  - ${d.name} — ${d.price} kr. ${d.desc}`);

  if (drinks.length) {
    lines.push('', 'DRIKKE (gjesten spurte om dette):');
    const why = new Map();
    for (const d of dishes) for (const p of d.pairings || []) if (!why.has(p.drink)) why.set(p.drink, p.why);
    for (const d of drinks.slice(0, 5)) {
      lines.push(`  - ${d.name} — ${d.price} kr${why.get(d.ref) ? ` (${why.get(d.ref)})` : ''}`);
    }
  }
  if (c.allergens?.length) {
    lines.push('', `Gjesten unngår: ${allergenLabels(c.allergens)}. Listen over er allerede filtrert på det — ikke kommenter det selv.`);
  }
  if (c.maxPrice) lines.push(`Prisramme: maks ${c.maxPrice} kr. Allerede filtrert.`);
  return lines.join('\n');
}

export async function compose(client, menu, history, dishes, drinks, c) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    system: [
      // Stable per venue, so it sits in front of the cache breakpoint.
      { type: 'text', text: composeSystem(menu), cache_control: { type: 'ephemeral' } },
      { type: 'text', text: candidateBlock(dishes, drinks, c) },
    ],
    output_config: { effort: 'low' },
    messages: history,
  });
  return {
    text: res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim(),
    stopReason: res.stop_reason,
    usage: res.usage,
  };
}

// ---------------------------------------------------------------------------
// Post-check and deterministic fallback.
//
// The model is instructed not to name a dish outside the candidate set. This
// verifies it, because an instruction is not a guarantee. If it names an
// excluded dish — the actual dangerous failure — the model's sentence is thrown
// away and a plain rendering of the filtered list is sent instead.
// ---------------------------------------------------------------------------
export function guardReply(menu, text, allowedRefs) {
  const t = norm(text);
  const allowed = new Set(allowedRefs);
  const leaked = menu.dishes
    .filter((d) => !allowed.has(d.ref))
    .filter((d) => t.includes(norm(d.name)) || t.includes(norm(d.name.split(',')[0])))
    .map((d) => d.ref);
  return { ok: leaked.length === 0, leaked };
}

export function renderFallback(dishes, drinks) {
  if (!dishes.length) {
    return 'Jeg finner ingen rett på menyen som treffer det du ber om. Spør personalet — de kan sjekke med kjøkkenet.';
  }
  const d = dishes.slice(0, 2).map((x) => `${x.name} (${x.price} kr)`).join(' og ');
  const dr = drinks.length ? ` Til det passer ${drinks.slice(0, 2).map((x) => x.name).join(' eller ')}.` : '';
  return `Fra menyen passer ${d}.${dr}`;
}

// The safety line is written by code, on every answer where an allergen
// restriction was in play — never left to the model to remember.
export function safetyLine(menu, c, needsStaff) {
  if (!c.allergens?.length) return null;
  const names = allergenLabels(c.allergens);

  // No valid signature covers this menu, so there is nothing to have filtered
  // against. Say that plainly instead of implying a check that did not happen.
  if (!menu.attestationOk) {
    return `Vi kan ikke bekrefte allergeninfo for denne menyen digitalt (${menu.attestationProblem}). Snakk med personalet om ${names} før du bestiller — de sjekker med kjøkkenet.`;
  }

  const signed = menu.attestation.signedAt
    ? String(menu.attestation.signedAt).slice(0, 10)
    : menu.version.label;
  let s = `Filtrert på ${names} mot kjøkkenets allergenliste (bekreftet ${signed} av ${menu.attestation.byRole || menu.attestation.byName}). Gi alltid beskjed til personalet om allergien — kjøkkenet bekrefter ved bestilling.`;
  if (needsStaff.length) {
    s += ` ${needsStaff.length === 1 ? 'Én rett' : `${needsStaff.length} retter`} mangler bekreftet allergeninfo og er holdt utenfor: ${needsStaff.map((n) => n.dish.name).join(', ')}.`;
  }
  return s;
}

export function makeClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  // Bounded on purpose. The SDK retries connection errors twice by default,
  // which can stack into a ~30 s wait — at a table that is worse than dropping
  // to the deterministic fallback list. One retry, and a hard ceiling per
  // attempt; timeout is milliseconds in the TS SDK.
  return new Anthropic({ maxRetries: 1, timeout: 12_000 });
}

export { detectAllergens, detectPriceCap, allergenLabel };
