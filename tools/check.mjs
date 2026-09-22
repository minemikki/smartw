// Checks the safety-critical half of the AI waiter — everything that must hold
// without the model being involved at all. Run: node tools/waiter-check.mjs
import {
  detectAllergens, detectPriceCap, evaluateDish, filterMenu, filterDrinks,
  mergeConstraints, guardReply, safetyLine,
} from '../lib/waiter.js';
import { DISHES, dishById } from '../lib/menu.js';

let fail = 0;
const t = (name, cond, extra = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${cond ? '' : ' — ' + extra}`);
  if (!cond) fail++;
};

console.log('\nKeyword read of the guest\'s own words');
t('peanøtter detected', detectAllergens('jeg har allergi mot peanætter').includes('peanotter'));
t('misspelling "peanott" detected', detectAllergens('peanott allergi').includes('peanotter'));
t('coeliac maps to gluten', detectAllergens('jeg har cøliaki').includes('gluten'));
t('laktose maps to melk', detectAllergens('laktoseintolerant').includes('melk'));
t('no false positive on clean text', detectAllergens('hva anbefaler du i dag?').length === 0);

console.log('\nPrice cap from free text');
t('"rett til 300 kr" => 300', detectPriceCap('en rett til 300 kr') === 300);
t('"under 250" => 250', detectPriceCap('noe under 250') === 250);
t('strictest cap wins', detectPriceCap('maks 400, helst under 250') === 250);
t('no number => null', detectPriceCap('noe godt') === null);

console.log('\nThe exact question from the brief');
const c = mergeConstraints(
  { allergens: [], diets: [], maxPrice: null, minPrice: null, wantsDrinkPairing: true, language: 'nb' },
  'jeg vil ha en rett til 300 kr men jeg har allergi mot peanætter, og hvilken øl passer?',
);
t('peanut picked up by keyword read alone', c.allergens.includes('peanotter'), JSON.stringify(c.allergens));
t('price cap 300', c.maxPrice === 300);
const res = filterMenu(c);
t('satay (contains peanuts) excluded', !res.ok.some((d) => d.id === 'r-03'));
t('dessert with peanut traces excluded', !res.ok.some((d) => d.id === 'r-14'));
t('unattested daily catch not recommended', !res.ok.some((d) => d.id === 'r-12'));
t('unattested daily catch routed to staff', res.needsStaff.some((n) => n.dish.id === 'r-12'));
t('nothing over 300 kr survives', res.ok.every((d) => d.price <= 300), res.ok.map((d) => d.price).join(','));
t('some dishes do survive', res.ok.length > 0);
console.log(`       survivors: ${res.ok.map((d) => `${d.name} ${d.price}kr`).join(' · ')}`);

console.log('\nDrinks');
const drinks = filterDrinks(c, res.ok);
t('beer offered because the guest asked', drinks.length > 0);
t('never offered when unasked', filterDrinks({ ...c, wantsDrinkPairing: false }, res.ok).length === 0);
const coeliac = { allergens: ['gluten'], diets: [], maxPrice: null, wantsDrinkPairing: true };
const cDrinks = filterDrinks(coeliac, filterMenu(coeliac).ok);
t('no wheat beer for a coeliac guest', cDrinks.every((d) => !d.allergens.includes('gluten')), cDrinks.map((d) => d.name).join(','));
t('a safe drink is still found', cDrinks.length > 0);

console.log('\nUnverified dishes make no allergen claim');
t('daily catch is fine with no restriction', evaluateDish(dishById('r-12'), { allergens: [] }).verdict === 'ok');
t('daily catch blocked the moment an allergy exists',
  evaluateDish(dishById('r-12'), { allergens: ['melk'] }).verdict === 'unverified');

console.log('\nPost-check on the model\'s sentence');
const allowed = res.ok.map((d) => d.id);
t('clean answer passes', guardReply(`Prøv ${res.ok[0].name} til ${res.ok[0].price} kr.`, allowed).ok);
t('answer naming the peanut dish is rejected',
  !guardReply('Satay av kylling med agurksalat er et godt valg.', allowed).ok);
t('rejection names the leaked dish',
  guardReply('Jeg anbefaler Entrecôte, pommes anna og peppersaus.', allowed).leaked.includes('r-04'));

console.log('\nSafety line is written by code, not the model');
t('present when an allergy is in play', (safetyLine(c, res.needsStaff) || '').includes('peanøtter'));
t('mentions the attestation date', (safetyLine(c, res.needsStaff) || '').includes('2026-09-18'));
t('absent when there is no allergy', safetyLine({ allergens: [] }, []) === null);

console.log(fail ? `\n${fail} FAILED\n` : `\nAll checks passed.\n`);
process.exit(fail ? 1 : 0);
