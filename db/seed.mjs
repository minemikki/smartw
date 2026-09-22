// Publishes the demo venue's menu into whichever store is configured.
//   node db/seed.mjs
// With DATABASE_URL set it seeds Postgres (run db/schema.sql first);
// without it, the file-backed dev store.

import { store, usingPostgres } from '../lib/store.js';
import { DEMO_VENUE, DEMO_DISHES, DEMO_DRINKS, DEMO_ATTESTATION, DEMO_LABEL } from './demo-menu.js';

const res = await store.publishMenu({
  venue: DEMO_VENUE,
  label: DEMO_LABEL,
  dishes: DEMO_DISHES,
  drinks: DEMO_DRINKS,
  attestation: DEMO_ATTESTATION,
  // Re-seeding should be idempotent; a real publish never replaces a version.
  replaceSameLabel: true,
});

console.log(`Seeded ${usingPostgres() ? 'Postgres' : 'dev store'}: ${DEMO_VENUE.slug} / ${res.versionLabel}`);
console.log(`Allergen digest: ${res.digest.slice(0, 16)}…`);

// A user to log in as. SEED_EMAIL lets you seed your own address instead.
const email = (process.env.SEED_EMAIL || 'kjokken@brygge-og-bord.no').toLowerCase();
await store.addVenueUser({ slug: DEMO_VENUE.slug, email, name: 'Ingrid Hauge', role: 'kjøkkensjef' });
console.log(`Admin-bruker: ${email}`);

// Read it straight back so a broken write fails the seed, not a guest.
const menu = await store.getPublishedMenu(DEMO_VENUE.slug);
if (!menu) throw new Error('seed wrote nothing readable');
console.log(`Read back: ${menu.dishes.length} dishes, ${menu.drinks.length} drinks`);
console.log(`Attestation verifies: ${menu.attestationOk ? 'yes' : 'NO — ' + menu.attestationProblem}`);
if (!menu.attestationOk) process.exit(1);
process.exit(0);
