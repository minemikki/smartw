// End-to-end smoke test of /api/waiter with the Anthropic HTTP layer stubbed,
// so the wiring (extraction -> filter -> compose -> guard -> response) can be
// verified without an API key or a live model call.
// Run: node tools/waiter-smoke.mjs
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-stub';

const canned = [];
const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push(JSON.parse(init.body));
  const text = canned.shift() ?? '{}';
  return new Response(JSON.stringify({
    id: 'msg_stub', type: 'message', role: 'assistant', model: 'claude-opus-5',
    content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const { default: handler } = await import('../api/waiter.js');

function fakeRes() {
  const r = { code: 200, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const ask = async (q, replies) => {
  canned.length = 0; calls.length = 0;
  canned.push(...replies);
  const res = fakeRes();
  await handler({ method: 'POST', headers: {}, body: { messages: [{ role: 'user', content: q }] } }, res);
  return res;
};

let fail = 0;
const t = (n, cond, extra = '') => { console.log(`${cond ? '  ok  ' : ' FAIL '} ${n}${cond ? '' : ' — ' + extra}`); if (!cond) fail++; };

const EXTRACT_OK = JSON.stringify({
  allergens: ['peanotter'], diets: [], maxPrice: 300, minPrice: null,
  wantsDrinkPairing: true, language: 'nb',
});

console.log('\nHappy path — the question from the brief');
let r = await ask(
  'Jeg vil ha en rett til 300 kr, men jeg har allergi mot peanætter. Og hvilken øl passer?',
  [EXTRACT_OK, 'Da vil jeg foreslå Kylling med urtesmør og knuste poteter til 285 kr. Til den passer Brygge Pils fint.'],
);
t('200 OK', r.code === 200, String(r.code));
t('guest gets the model sentence', /Kylling med urtesmør/.test(r.body.reply), r.body.reply);
t('safety line added by code', /peanøtter/.test(r.body.safety || ''), r.body.safety);
t('guard did not trip', r.body.meta.guarded === false);
t('no dish over 300 kr in the candidate set', r.body.dishes.every((d) => d.price <= 300));
t('satay never reached the model', !JSON.stringify(calls[1]).includes('Satay'));
t('excluded list explains why', r.body.excluded.some((e) => /peanøtter/.test(e.reason)));
t('unattested dish routed to staff', r.body.needsStaff.some((n) => /Dagens fangst/.test(n.name)));
t('two model calls, not one', calls.length === 2, String(calls.length));
t('model id is opus 5', calls[0].model === 'claude-opus-5', calls[0].model);

console.log('\nGuard — model names a dish the filter removed');
r = await ask(
  'Rett til 300 kr, allergisk mot peanøtter',
  [EXTRACT_OK, 'Satay av kylling med agurksalat er nydelig, den anbefaler jeg!'],
);
t('guard tripped', r.body.meta.guarded === true);
t('the unsafe sentence is gone', !/Satay/.test(r.body.reply), r.body.reply);
t('guest still gets a usable answer', r.body.reply.length > 20, r.body.reply);

console.log('\nBackstop — model extraction misses the allergy entirely');
r = await ask(
  'noe godt til 300 kr, jeg tåler ikke peanætter',
  [JSON.stringify({ allergens: [], diets: [], maxPrice: 300, minPrice: null, wantsDrinkPairing: false, language: 'nb' }),
   'Jeg anbefaler Fiskesuppe fra Hitra til 235 kr.'],
);
t('keyword read rescued the restriction', r.body.constraints.allergens.includes('peanotter'));
t('flagged as caught by the backstop', r.body.constraints.caughtByKeywordOnly.includes('peanotter'));
t('peanut dish still excluded', !r.body.dishes.some((d) => d.id === 'r-03'));

console.log('\nNo drinks unless asked');
r = await ask(
  'hva har dere til under 250 kr?',
  [JSON.stringify({ allergens: [], diets: [], maxPrice: 250, minPrice: null, wantsDrinkPairing: false, language: 'nb' }),
   'Pasta med tomat, basilikum og chili til 225 kr er en god start.'],
);
t('drinks list empty', r.body.drinks.length === 0);
// The system rules mention DRIKKE by name, so check the candidate block itself.
const candidateBlock = calls[1].system[1].text;
t('no drinks block in the candidate list', !candidateBlock.includes('DRIKKE:'), candidateBlock.slice(0, 120));
t('candidate list does hold dishes', candidateBlock.includes('RETTER'));

console.log('\nRequest hygiene');
r = fakeRes(); await handler({ method: 'GET', headers: {}, body: {} }, r);
t('GET rejected', r.code === 405);
r = fakeRes(); await handler({ method: 'POST', headers: {}, body: { messages: [{ role: 'assistant', content: 'hei' }] } }, r);
t('history not ending in a guest turn rejected', r.code === 400);

console.log(fail ? `\n${fail} FAILED\n` : '\nAll checks passed.\n');
process.exit(fail ? 1 : 0);
