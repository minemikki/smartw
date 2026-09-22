// Checks the safety-critical half of the engine — everything that must hold
// with no model and no database involved. Run: node tools/check.mjs
import {
  detectAllergens, detectPriceCap, evaluateDish, filterMenu, filterDrinks,
  mergeConstraints, guardReply, safetyLine,
} from '../lib/waiter.js';
import { allergenDigest } from '../lib/digest.js';
import { shapeMenu } from '../lib/store.js';
import { DEMO_VENUE, DEMO_DISHES, DEMO_DRINKS, DEMO_ATTESTATION, DEMO_LABEL } from '../db/demo-menu.js';

let fail = 0;
const t = (name, cond, extra = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${cond ? '' : ' — ' + extra}`);
  if (!cond) fail++;
};
const section = (s) => console.log(`\n${s}`);

// Hermetic fixtures: no store file, no network.
const build = (dishes = DEMO_DISHES, digestOverride) => shapeMenu({
  venue: { id: 'v1', ...DEMO_VENUE },
  version: { id: 'ver1', label: DEMO_LABEL, publishedAt: '2026-09-18T09:00:00Z' },
  attestation: {
    ...DEMO_ATTESTATION,
    digest: digestOverride ?? allergenDigest({ dishes, drinks: DEMO_DRINKS }),
  },
  dishes, drinks: DEMO_DRINKS,
});
const menu = build();
const dishByRef = (r) => menu.dishes.find((d) => d.ref === r);

section("Keyword read of the guest's own words");
t('peanøtter detected', detectAllergens('jeg har allergi mot peanætter').includes('peanotter'));
t('misspelling "peanott" detected', detectAllergens('peanott allergi').includes('peanotter'));
t('coeliac maps to gluten', detectAllergens('jeg har cøliaki').includes('gluten'));
t('laktose maps to melk', detectAllergens('laktoseintolerant').includes('melk'));
t('"koster" does not fire on melk', !detectAllergens('hva koster det').includes('melk'));
t('peanut allergy is not a tree-nut allergy', !detectAllergens('peanøtter').includes('notter'));
t('no false positive on clean text', detectAllergens('hva anbefaler du i dag?').length === 0);

section('Price cap from free text');
t('"rett til 300 kr" => 300', detectPriceCap('en rett til 300 kr') === 300);
t('"under 250" => 250', detectPriceCap('noe under 250') === 250);
t('strictest cap wins', detectPriceCap('maks 400, helst under 250') === 250);
t('no number => null', detectPriceCap('noe godt') === null);

section('The exact question from the brief');
const c = mergeConstraints(
  { allergens: [], diets: [], maxPrice: null, minPrice: null, wantsDrinkPairing: true, language: 'nb' },
  'jeg vil ha en rett til 300 kr men jeg har allergi mot peanætter, og hvilken øl passer?',
);
t('peanut picked up by keyword read alone', c.allergens.includes('peanotter'), JSON.stringify(c.allergens));
t('price cap 300', c.maxPrice === 300);
const res = filterMenu(menu, c);
t('satay (contains peanuts) excluded', !res.ok.some((d) => d.ref === 'r-03'));
t('dessert with peanut traces excluded', !res.ok.some((d) => d.ref === 'r-14'));
t('unattested daily catch not recommended', !res.ok.some((d) => d.ref === 'r-12'));
t('unattested daily catch routed to staff', res.needsStaff.some((n) => n.dish.ref === 'r-12'));
t('nothing over 300 kr survives', res.ok.every((d) => d.price <= 300));
t('some dishes do survive', res.ok.length > 0);
console.log(`       survivors: ${res.ok.map((d) => `${d.name} ${d.price}kr`).join(' · ')}`);

section('Drinks');
const drinks = filterDrinks(menu, c, res.ok);
t('beer offered because the guest asked', drinks.length > 0);
t('never offered when unasked', filterDrinks(menu, { ...c, wantsDrinkPairing: false }, res.ok).length === 0);
const coeliac = { allergens: ['gluten'], diets: [], maxPrice: null, wantsDrinkPairing: true };
const cDrinks = filterDrinks(menu, coeliac, filterMenu(menu, coeliac).ok);
t('no wheat beer for a coeliac guest', cDrinks.every((d) => !d.allergens.includes('gluten')));
t('a safe drink is still found', cDrinks.length > 0);

section('Unverified dishes make no allergen claim');
t('daily catch is fine with no restriction', evaluateDish(dishByRef('r-12'), { allergens: [] }).verdict === 'ok');
t('daily catch blocked the moment an allergy exists',
  evaluateDish(dishByRef('r-12'), { allergens: ['melk'] }).verdict === 'unverified');

section('Attestation must actually cover the data');
t('honest attestation verifies', menu.attestationOk);
const tampered = build(DEMO_DISHES, 'deadbeef'.repeat(8));
t('wrong digest fails verification', !tampered.attestationOk);
t('every dish downgraded to unverified on mismatch',
  tampered.dishes.every((d) => d.allergenStatus === 'unverified'));
t('no dish survives an allergy filter on a broken attestation',
  filterMenu(tampered, { allergens: ['melk'] }).ok.length === 0);
const unsigned = shapeMenu({
  venue: { id: 'v1', ...DEMO_VENUE }, version: { id: 'v', label: 'x' },
  attestation: null, dishes: DEMO_DISHES, drinks: DEMO_DRINKS,
});
t('unsigned menu fails verification', !unsigned.attestationOk);
t('unsigned menu says why', /ikke attestert/.test(unsigned.attestationProblem));
t('editing one allergen changes the digest', allergenDigest({ dishes: DEMO_DISHES, drinks: DEMO_DRINKS })
  !== allergenDigest({
    dishes: DEMO_DISHES.map((d) => d.ref === 'r-08' ? { ...d, allergens: [] } : d),
    drinks: DEMO_DRINKS,
  }));
t('digest is order-independent', allergenDigest({ dishes: DEMO_DISHES, drinks: DEMO_DRINKS })
  === allergenDigest({ dishes: [...DEMO_DISHES].reverse(), drinks: [...DEMO_DRINKS].reverse() }));

section("Post-check on the model's sentence");
const allowed = res.ok.map((d) => d.ref);
t('clean answer passes', guardReply(menu, `Prøv ${res.ok[0].name} til ${res.ok[0].price} kr.`, allowed).ok);
t('answer naming the peanut dish is rejected',
  !guardReply(menu, 'Satay av kylling med agurksalat er et godt valg.', allowed).ok);
t('rejection names the leaked dish',
  guardReply(menu, 'Jeg anbefaler Entrecôte, pommes anna og peppersaus.', allowed).leaked.includes('r-04'));

section('Safety line is written by code, not the model');
t('present when an allergy is in play', (safetyLine(menu, c, res.needsStaff) || '').includes('peanøtter'));
t('names who signed and when', /2026-09-18/.test(safetyLine(menu, c, res.needsStaff) || ''));
t('absent when there is no allergy', safetyLine(menu, { allergens: [] }, []) === null);
t('broken attestation says it cannot confirm, not that it filtered',
  /kan ikke bekrefte/.test(safetyLine(tampered, c, []) || ''));

console.log(fail ? `\n${fail} FAILED\n` : '\nAll checks passed.\n');
process.exit(fail ? 1 : 0);
