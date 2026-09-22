// Applies db/schema.sql to DATABASE_URL.
//   DATABASE_URL=postgresql://… node db/migrate.mjs
//
// The schema is a first-time setup, not a migration chain: it uses plain CREATE
// TABLE, so running it twice would fail. This checks first and says so instead
// of dumping a wall of "already exists" errors.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL mangler. Eksempel:\n  DATABASE_URL=postgresql://bruker:passord@host/db node db/migrate.mjs');
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = await fs.readFile(path.join(here, 'schema.sql'), 'utf8');

const { Client } = await import('pg');
// Hosted Postgres (Neon, Supabase, Vercel Postgres) requires TLS; local usually
// has none, and node-postgres rejects self-signed certs by default.
const client = new Client({
  connectionString: url,
  ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
});
await client.connect();

try {
  const { rows } = await client.query(
    `SELECT to_regclass('public.venue') IS NOT NULL AS exists`);
  if (rows[0].exists) {
    const { rows: counts } = await client.query(
      `SELECT (SELECT count(*) FROM venue)::int AS venues,
              (SELECT count(*) FROM menu_version)::int AS versions`);
    console.log(`Skjemaet er allerede lagt inn (${counts[0].venues} lokale(r), ${counts[0].versions} menyversjon(er)).`);
    console.log('Ingenting gjort. Vil du starte på nytt, dropp og opprett databasen først.');
    process.exit(0);
  }

  await client.query(sql);          // schema.sql wraps itself in BEGIN/COMMIT
  const { rows: tables } = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`);
  const { rows: allergens } = await client.query('SELECT count(*)::int AS n FROM allergen');
  console.log(`Skjema lagt inn: ${tables[0].n} tabeller, ${allergens[0].n} allergener.`);
  console.log('Neste steg: node db/seed.mjs');
} finally {
  await client.end();
}
