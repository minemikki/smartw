// Validation for menu payloads submitted by the admin UI.
//
// Its own module because it is a security boundary, not a convenience: the
// browser can send anything, and an allergen id that slips through here becomes
// an allergen that is silently never filtered on. Everything is allow-listed
// and every field is bounded.

import { ALLERGEN_IDS, DIETS } from './allergens.js';

const MAX_DISHES = 300;
const MAX_DRINKS = 200;
const LIMITS = { ref: 40, name: 160, desc: 600, label: 60, why: 160, kind: 40 };

const str = (v, n) => String(v ?? '').trim().slice(0, n);
const ok = (v) => typeof v === 'string' && v.length > 0;

function cleanAllergens(list, where, errors) {
  const out = [];
  for (const a of Array.isArray(list) ? list : []) {
    if (ALLERGEN_IDS.includes(a)) out.push(a);
    else errors.push(`${where}: ukjent allergen «${String(a).slice(0, 30)}»`);
  }
  return [...new Set(out)];
}

export function validateMenu(payload) {
  const errors = [];
  const label = str(payload?.label, LIMITS.label);
  if (!ok(label)) errors.push('Menyversjonen mangler navn.');
  if (!/^[\w\-. æøåÆØÅ]+$/u.test(label || 'x')) errors.push('Versjonsnavnet kan bare inneholde bokstaver, tall, mellomrom, bindestrek og punktum.');

  const rawDishes = Array.isArray(payload?.dishes) ? payload.dishes : [];
  const rawDrinks = Array.isArray(payload?.drinks) ? payload.drinks : [];
  if (rawDishes.length > MAX_DISHES) errors.push(`Maks ${MAX_DISHES} retter.`);
  if (rawDrinks.length > MAX_DRINKS) errors.push(`Maks ${MAX_DRINKS} drikker.`);

  const drinkRefs = new Set();
  const drinks = rawDrinks.slice(0, MAX_DRINKS).map((d, i) => {
    const where = `Drikke ${i + 1}`;
    const ref = str(d?.ref, LIMITS.ref);
    if (!ok(ref)) errors.push(`${where}: mangler id.`);
    else if (drinkRefs.has(ref)) errors.push(`${where}: id «${ref}» er brukt flere ganger.`);
    drinkRefs.add(ref);

    const name = str(d?.name, LIMITS.name);
    if (!ok(name)) errors.push(`${where}: mangler navn.`);

    const price = Number(d?.price);
    if (!Number.isInteger(price) || price < 0) errors.push(`${where} (${name || ref}): pris må være et helt tall.`);

    const abv = Number(d?.abv);
    return {
      ref, name, kind: str(d?.kind, LIMITS.kind) || 'annet',
      abv: Number.isFinite(abv) && abv >= 0 && abv <= 100 ? abv : 0,
      price: Number.isInteger(price) && price >= 0 ? price : 0,
      allergens: cleanAllergens(d?.allergens, `${where} (${name || ref})`, errors),
    };
  });

  const dishRefs = new Set();
  const dishes = rawDishes.slice(0, MAX_DISHES).map((d, i) => {
    const where = `Rett ${i + 1}`;
    const ref = str(d?.ref, LIMITS.ref);
    if (!ok(ref)) errors.push(`${where}: mangler id.`);
    else if (dishRefs.has(ref)) errors.push(`${where}: id «${ref}» er brukt flere ganger.`);
    dishRefs.add(ref);

    const name = str(d?.name, LIMITS.name);
    if (!ok(name)) errors.push(`${where}: mangler navn.`);

    const price = Number(d?.price);
    if (!Number.isInteger(price) || price < 0) errors.push(`${where} (${name || ref}): pris må være et helt tall.`);

    // Anything but an explicit 'verified' is treated as unverified. Defaulting
    // the unknown case to unsafe is the whole posture of this codebase.
    const allergenStatus = d?.allergenStatus === 'verified' ? 'verified' : 'unverified';

    const diets = (Array.isArray(d?.diets) ? d.diets : []).filter((x) => DIETS.includes(x));
    const allergens = cleanAllergens(d?.allergens, `${where} (${name || ref})`, errors);
    const mayContain = cleanAllergens(d?.mayContain, `${where} (${name || ref})`, errors);

    // A dish cannot both declare an allergen and merely maybe-contain it; the
    // stronger claim wins, silently, because the guest-facing effect is the same.
    const mayClean = mayContain.filter((a) => !allergens.includes(a));

    const pairings = (Array.isArray(d?.pairings) ? d.pairings : []).slice(0, 8).map((pp) => ({
      drink: str(pp?.drink, LIMITS.ref),
      why: str(pp?.why, LIMITS.why),
    })).filter((pp) => {
      if (!pp.drink) return false;
      if (!drinkRefs.has(pp.drink)) {
        errors.push(`${where} (${name || ref}): paring peker på ukjent drikke «${pp.drink}».`);
        return false;
      }
      return true;
    });

    return {
      ref, name, desc: str(d?.desc, LIMITS.desc),
      price: Number.isInteger(price) && price >= 0 ? price : 0,
      allergens, mayContain: mayClean, diets, allergenStatus, pairings,
    };
  });

  return { ok: errors.length === 0, errors, menu: { label, dishes, drinks } };
}

// Publishing is a stricter gate than saving a draft: it puts a menu in front of
// guests and binds a named person's signature to it.
export function validateAttestation(payload) {
  const errors = [];
  const byName = str(payload?.byName, 120);
  const byRole = str(payload?.byRole, 120);
  if (!ok(byName)) errors.push('Signaturen mangler navn på den som bekrefter.');
  if (!ok(byRole)) errors.push('Signaturen mangler rolle (f.eks. kjøkkensjef).');
  if (payload?.confirmed !== true) {
    errors.push('Du må bekrefte at allergeninformasjonen er gjennomgått og stemmer.');
  }
  return {
    ok: errors.length === 0,
    errors,
    attestation: {
      byName, byRole,
      statement: str(payload?.statement, 500)
        || 'Jeg bekrefter at allergeninformasjonen i denne menyversjonen er gjennomgått og stemmer.',
    },
  };
}
