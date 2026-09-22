// Browser test of the menu admin: magic-link login, the allergen chip cycle,
// the unverified-dish warning, draft save and reload, the signature gate, and
// that publishing archives the previous version instead of destroying it.
//
// Needs Playwright and a running dev server seeded from db/seed.mjs:
//   node db/seed.mjs
//   SESSION_SECRET=$(openssl rand -base64 32) PORT=4340 node tools/dev-server.mjs &
//   curl -s -X POST localhost:4340/api/login -H 'Content-Type: application/json' \
//        -d '{"email":"kjokken@brygge-og-bord.no"}'
//   # copy the token the server prints, then:
//   PORT=4340 TOKEN=<token> node tools/admin-test.mjs
//
// Kept out of `npm test` because it needs a browser and a live server; the two
// suites that gate every change run with neither.
import { chromium } from 'playwright';
const SP = process.env.SP || '/tmp';
const TOKEN = process.env.TOKEN;
if (!TOKEN) { console.error('Sett TOKEN — se toppen av denne fila.'); process.exit(2); }
const B = 'http://localhost:' + (process.env.PORT || 4340);
let fail = 0;
const t = (n, c, x = '') => { console.log(`${c ? '  ok  ' : ' FAIL '} ${n}${c ? '' : ' — ' + x}`); if (!c) fail++; };

const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const ctx = await b.newContext({ viewport: { width: 1380, height: 1000 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const errs = [];
// The 400 from submitting the publish form without the confirmation box is a
// refusal this test deliberately triggers, so it is not a page defect.
p.on('console', (m) => { if (m.type() === 'error' && !/400 \(Bad Request\)/.test(m.text())) errs.push(m.text()); });
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

console.log('\nInnlogging via magisk lenke');
await p.goto(`${B}/api/session?token=${TOKEN}`, { waitUntil: 'networkidle' });
t('havner på admin', p.url().includes('/admin.html'), p.url());
await p.waitForSelector('#app.on', { timeout: 8000 });
t('admin lastet', await p.isVisible('#app'));
t('lokalet vises', (await p.textContent('#venue-name')) === 'Brygge & Bord');
const cards = await p.locator('#dishes .card').count();
t('14 retter lastet fra lageret', cards === 14, String(cards));
// The seed ships r-12 ('Dagens fangst') deliberately unverified.
t('statuslinje teller den usignerte retten', /1 av 14 retter mangler/.test(await p.textContent('#pill-verify')), await p.textContent('#pill-verify'));

console.log('\nAllergen-chip syklus: ingen → inneholder → spor');
const chip = p.locator('#dishes .card').first().locator('.chip', { hasText: 'lupin' }).first();
t('starter tom', (await chip.getAttribute('data-state')) === '');
await chip.click();
t('ett klikk = inneholder', (await p.locator('#dishes .card').first().locator('.chip', { hasText: 'lupin' }).first().getAttribute('data-state')) === 'contains');
await p.locator('#dishes .card').first().locator('.chip', { hasText: 'lupin' }).first().click();
t('to klikk = spor av', (await p.locator('#dishes .card').first().locator('.chip', { hasText: 'lupin' }).first().getAttribute('data-state')) === 'may');
await p.locator('#dishes .card').first().locator('.chip', { hasText: 'lupin' }).first().click();
t('tre klikk = tom igjen', (await p.locator('#dishes .card').first().locator('.chip', { hasText: 'lupin' }).first().getAttribute('data-state')) === '');

console.log('\nUbekreftet rett endrer UI og advarsel');
await p.locator('#dishes .card').first().locator('input[type=checkbox]').uncheck();
t('kortet markeres', await p.locator('#dishes .card').first().evaluate((e) => e.classList.contains('unverified')));
t('statuslinjen teller opp til 2', /2 av 14 retter mangler/.test(await p.textContent('#pill-verify')), await p.textContent('#pill-verify'));
t('varsel i kortet', await p.locator('#dishes .card').first().locator('.hint').first().isVisible());

console.log('\nLagre utkast');
await p.click('#save');
await p.waitForSelector('#msg.on.ok', { timeout: 8000 });
t('utkast lagret', /Utkast lagret/.test(await p.textContent('#msg')));
t('gjesten ser fortsatt publisert meny', /Gjester ser fortsatt/.test(await p.textContent('#msg')));

console.log('\nUtkastet overlever ny innlasting');
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('#app.on');
t('utkast lastet, ikke publisert versjon', /2 av 14 retter mangler/.test(await p.textContent('#pill-verify')), await p.textContent('#pill-verify'));
t('utkast-merke synlig', await p.locator('#pill-draft').isVisible());

console.log('\nPublisering krever signatur');
await p.click('#publish');
await p.waitForTimeout(300);
t('dialogen advarer om ubekreftet rett', /mangler bekreftet allergeninfo/.test(await p.textContent('#dlg-warn')));
await p.fill('#by-name', 'Ingrid Hauge');
await p.fill('#by-role', 'Kjøkkensjef');
await p.click('#dlg-go');                       // uten avkrysning
await p.waitForSelector('#dlg-msg.on.bad', { timeout: 8000 });
t('nektes uten bekreftelse', /bekrefte/.test(await p.textContent('#dlg-msg')));
await p.check('#confirmed');
await p.screenshot({ path: `${SP}/admin-publish.png` });
await p.click('#dlg-go');
await p.waitForSelector('#msg.on.ok', { timeout: 10000 });
const published = await p.textContent('#msg');
t('publisert', /Publisert:/.test(published), published);
t('signatur låst til digest', /signatur låst/.test(published));
t('melder om ubekreftet rett', /sendes til personalet/.test(published), published);

await p.screenshot({ path: `${SP}/admin-main.png`, fullPage: true });

console.log('\nHistorikk');
await p.click('.tabs button[data-tab=history]');
await p.waitForTimeout(300);
const hist = await p.textContent('#history');
t('viser signert av', /Ingrid Hauge/.test(hist));
t('viser arkivert forrige versjon', /Arkivert/.test(hist), hist.slice(0, 200));
await p.screenshot({ path: `${SP}/admin-history.png` });

const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
t('ingen horisontal overflyt', over === 0, over + 'px');
t('ingen konsollfeil', errs.length === 0, errs.join(' | '));

console.log('\nEngangs-lenke');
const ctx2 = await b.newContext();
const p2 = await ctx2.newPage();
await p2.goto(`${B}/api/session?token=${TOKEN}`, { waitUntil: 'networkidle' });
t('brukt lenke avvises', p2.url().includes('feil=lenke'), p2.url());
await p2.waitForTimeout(200);
t('sier at lenken er brukt', /brukt eller utløpt/.test(await p2.textContent('#login-msg')));

await b.close();
console.log(fail ? `\n${fail} FAILED\n` : '\nAlle adminsjekker passerte.\n');
process.exit(fail ? 1 : 0);
