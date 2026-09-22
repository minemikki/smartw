// End-to-end smoke test of /api/waiter against a real (temporary) store, with
// the Anthropic HTTP layer stubbed, so the whole chain can be verified without
// an API key or a database.
// Run: node tools/smoke.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Runs against either backend. Point SMOKE_DATABASE_URL at a THROWAWAY database
// to exercise the Postgres path (it publishes menus, so never aim it at real
// data); with it unset the suite uses a temporary file store.
const PG = process.env.SMOKE_DATABASE_URL;
let tmp = null;
if (PG) {
  process.env.DATABASE_URL = PG;
} else {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bordvert-'));
  process.env.BORDVERT_STORE = path.join(tmp, 'store.json');
  delete process.env.DATABASE_URL;
}
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-stub';
console.log(`Backend: ${PG ? 'Postgres' : 'fil'}`);

const canned = [];
const calls = [];
let failFetch = false;   // fails every attempt while set, so SDK retries cannot rescue it
globalThis.fetch = async (url, init) => {
  if (failFetch) throw new Error('simulated network failure');
  calls.push(JSON.parse(init.body));
  const text = canned.shift() ?? '{}';
  return new Response(JSON.stringify({
    id: 'msg_stub', type: 'message', role: 'assistant', model: 'claude-opus-5',
    content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const { store } = await import('../lib/store.js');
const { DEMO_VENUE, DEMO_DISHES, DEMO_DRINKS, DEMO_ATTESTATION, DEMO_LABEL } =
  await import('../db/demo-menu.js');
const { default: handler } = await import('../api/waiter.js');

await store.publishMenu({
  venue: DEMO_VENUE, label: DEMO_LABEL, dishes: DEMO_DISHES,
  drinks: DEMO_DRINKS, attestation: DEMO_ATTESTATION,
});

function fakeRes() {
  const r = { code: 200, body: null };
  r.status = (x) => { r.code = x; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const ask = async (q, replies, venue = DEMO_VENUE.slug) => {
  canned.length = 0; calls.length = 0;
  canned.push(...replies);
  const res = fakeRes();
  await handler({ method: 'POST', headers: {}, body: { venue, messages: [{ role: 'user', content: q }] } }, res);
  return res;
};

let fail = 0;
const t = (n, cond, extra = '') => { console.log(`${cond ? '  ok  ' : ' FAIL '} ${n}${cond ? '' : ' — ' + extra}`); if (!cond) fail++; };
const section = (s) => console.log(`\n${s}`);

const EXTRACT_OK = JSON.stringify({
  allergens: ['peanotter'], diets: [], maxPrice: 300, minPrice: null,
  wantsDrinkPairing: true, language: 'nb',
});

section('Happy path — the question from the brief');
let r = await ask(
  'Jeg vil ha en rett til 300 kr, men jeg har allergi mot peanætter. Og hvilken øl passer?',
  [EXTRACT_OK, 'Da vil jeg foreslå Kylling med urtesmør og knuste poteter til 285 kr. Til den passer Brygge Pils fint.'],
);
t('200 OK', r.code === 200, String(r.code));
t('menu came from the store, not an import', r.body.venue.slug === DEMO_VENUE.slug);
t('guest gets the model sentence', /Kylling med urtesmør/.test(r.body.reply), r.body.reply);
t('safety line added by code', /peanøtter/.test(r.body.safety || ''));
t('attestation verified', r.body.meta.attestationOk === true);
t('guard did not trip', r.body.meta.guarded === false);
t('not degraded', r.body.meta.degraded === false);
t('no dish over 300 kr', r.body.dishes.every((d) => d.price <= 300));
t('satay never reached the model', !JSON.stringify(calls[1]).includes('Satay'));
t('unattested dish routed to staff', r.body.needsStaff.some((n) => /Dagens fangst/.test(n.name)));
t('two model calls', calls.length === 2, String(calls.length));
t('model id is opus 5', calls[0].model === 'claude-opus-5', calls[0].model);

section('Guard — model names a dish the filter removed');
r = await ask('Rett til 300 kr, allergisk mot peanøtter',
  [EXTRACT_OK, 'Satay av kylling med agurksalat er nydelig, den anbefaler jeg!']);
t('guard tripped', r.body.meta.guarded === true);
t('the unsafe sentence is gone', !/Satay/.test(r.body.reply), r.body.reply);
t('guest still gets a usable answer', r.body.reply.length > 20);

section('Backstop — model extraction misses the allergy entirely');
r = await ask('noe godt til 300 kr, jeg tåler ikke peanætter',
  [JSON.stringify({ allergens: [], diets: [], maxPrice: 300, minPrice: null, wantsDrinkPairing: false, language: 'nb' }),
   'Jeg anbefaler Fiskesuppe fra Hitra til 235 kr.']);
t('keyword read rescued the restriction', r.body.constraints.allergens.includes('peanotter'));
t('flagged as caught by the backstop', r.body.constraints.caughtByKeywordOnly.includes('peanotter'));
t('peanut dish still excluded', !r.body.dishes.some((d) => d.ref === 'r-03'));

section('Degraded — the model is unreachable');
failFetch = true;
r = await ask('rett under 300 kr, allergisk mot peanøtter, hvilken øl passer?', []);
failFetch = false;
t('request still succeeds', r.code === 200, String(r.code));
t('marked degraded', r.body.meta.degraded === true);
t('allergy still enforced by code alone', !r.body.dishes.some((d) => d.ref === 'r-03'));
t('price still enforced', r.body.dishes.every((d) => d.price <= 300));
t('guest gets a real answer, not an error', r.body.reply.length > 20, r.body.reply);
t('safety line still present', /peanøtter/.test(r.body.safety || ''));
t('no drinks volunteered in a degraded answer', r.body.drinks.length === 0);

section('No drinks unless asked');
r = await ask('hva har dere til under 250 kr?',
  [JSON.stringify({ allergens: [], diets: [], maxPrice: 250, minPrice: null, wantsDrinkPairing: false, language: 'nb' }),
   'Pasta med tomat, basilikum og chili til 225 kr er en god start.']);
t('drinks list empty', r.body.drinks.length === 0);
const candidateBlock = calls[1].system[1].text;
t('no drinks block in the candidate list', !candidateBlock.includes('DRIKKE:'));
t('candidate list does hold dishes', candidateBlock.includes('RETTER'));

section('Tenancy and request hygiene');
r = await ask('hei', [EXTRACT_OK, 'hei'], 'finnes-ikke');
t('unknown venue → 404', r.code === 404, String(r.code));
r = fakeRes(); await handler({ method: 'POST', headers: {}, body: { messages: [{ role: 'user', content: 'hei' }] } }, r);
t('missing venue → 400', r.code === 400, String(r.code));
r = fakeRes(); await handler({ method: 'GET', headers: {}, body: {} }, r);
t('GET rejected', r.code === 405);
r = fakeRes(); await handler({ method: 'POST', headers: {}, body: { venue: DEMO_VENUE.slug, messages: [{ role: 'assistant', content: 'hei' }] } }, r);
t('history not ending in a guest turn rejected', r.code === 400);

section('Conversation log');
// Logging never blocks a guest's answer, so wait for the queue before reading.
await store.flush();
const logged = await store.recentConversations(DEMO_VENUE.slug, 50);
t('conversations were logged', logged.length > 0, String(logged.length));
t('a guard trip is on the record', logged.some((x) => x.guardTripped === true));
t('a degraded answer is on the record', logged.some((x) => x.degraded === true));
t('log records which dishes were shown', logged.every((x) => Array.isArray(x.shownRefs)));

if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `\n${fail} FAILED\n` : '\nAll checks passed.\n');
process.exit(fail ? 1 : 0);
