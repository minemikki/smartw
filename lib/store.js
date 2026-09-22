// Storage for venues and their menu versions.
//
// Two backends behind one API: Postgres when DATABASE_URL is set, and a
// file-backed store otherwise so the app and its tests run with no database at
// all. The read path is identical, which is the point — the engine never knows
// which one it got.
//
// The loader is where safety is enforced rather than hoped for:
//   - only a PUBLISHED menu version is ever served to a guest
//   - the attestation digest is recomputed and compared on every load
//   - a digest mismatch, or a missing attestation, downgrades EVERY dish to
//     'unverified', so the engine makes no allergen claims at all

import fs from 'node:fs/promises';
import path from 'node:path';
import { allergenDigest } from './digest.js';

const DEV_FILE = process.env.SMARTWAITER_STORE || path.join(process.cwd(), '.data', 'store.json');
export const usingPostgres = () => !!process.env.DATABASE_URL;

// ---------------------------------------------------------------------------
// Shared shaping: both backends produce this, and only this, for the engine.
// `ref` is the version-stable id ('r-01'), not a database uuid — a menu object
// is always scoped to one version, so refs are unambiguous within it.
// ---------------------------------------------------------------------------
function shapeMenu({ venue, version, attestation, dishes, drinks }) {
  const menu = {
    venue,
    version,
    attestation: attestation || null,
    dishes: dishes.map((d) => ({
      ref: d.ref,
      name: d.name,
      desc: d.desc || '',
      price: d.price,
      allergens: d.allergens || [],
      mayContain: d.mayContain || [],
      diets: d.diets || [],
      allergenStatus: d.allergenStatus || 'unverified',
      pairings: d.pairings || [],
    })),
    drinks: drinks.map((d) => ({
      ref: d.ref,
      name: d.name,
      kind: d.kind || 'annet',
      abv: Number(d.abv || 0),
      price: d.price,
      allergens: d.allergens || [],
    })),
  };

  // Verify the signature actually covers this data.
  const digest = allergenDigest(menu);
  const signed = attestation?.digest;
  menu.attestationOk = !!signed && signed === digest;
  menu.computedDigest = digest;

  if (!menu.attestationOk) {
    // No valid signature → no allergen claims about anything. Every dish is
    // routed to staff the moment a guest mentions an allergy.
    for (const d of menu.dishes) d.allergenStatus = 'unverified';
    menu.attestationProblem = !signed
      ? 'menyversjonen er ikke attestert'
      : 'attesteringen dekker ikke dagens data (digest stemmer ikke)';
  }
  return menu;
}

// ---------------------------------------------------------------------------
// File backend (dev, tests, and a single-venue pilot before a DB exists)
// ---------------------------------------------------------------------------
async function readDevFile() {
  try {
    return JSON.parse(await fs.readFile(DEV_FILE, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return { venues: [] };
    if (e instanceof SyntaxError) {
      throw new Error(`Dev-lageret er korrupt (${DEV_FILE}). Kjør db/seed.mjs på nytt.`);
    }
    throw e;
  }
}

// Written to a temp file and renamed, because rename is atomic: a concurrent
// reader sees either the old file or the new one, never a half-written one.
async function writeDevFile(data) {
  await fs.mkdir(path.dirname(DEV_FILE), { recursive: true });
  const tmp = `${DEV_FILE}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, DEV_FILE);
}

// Every read-modify-write on the file runs one at a time. Without this, two
// overlapping updates each read the same starting state and the second silently
// discards the first — and a conversation log write racing a publish can drop a
// menu. Postgres has transactions for this; the file backend needs a queue.
let writeTail = Promise.resolve();
function withLock(fn) {
  const run = writeTail.then(fn);
  writeTail = run.then(() => {}, () => {});
  return run;
}

const devStore = {
  // Conversation logging is deliberately fire-and-forget so it can never delay
  // a guest's answer. flush() waits for the queue to drain — for tests, and for
  // anything that needs the log on disk before it exits.
  async flush() { return withLock(async () => {}); },

  async getVenue(slug) {
    const { venues } = await readDevFile();
    const v = venues.find((x) => x.slug === slug && x.active !== false);
    return v ? { id: v.id, slug: v.slug, name: v.name, city: v.city, tone: v.tone } : null;
  },

  async getPublishedMenu(slug) {
    const { venues } = await readDevFile();
    const v = venues.find((x) => x.slug === slug && x.active !== false);
    if (!v) return null;
    const ver = (v.versions || []).find((x) => x.status === 'published');
    if (!ver) return null;
    return shapeMenu({
      venue: { id: v.id, slug: v.slug, name: v.name, city: v.city, tone: v.tone },
      version: { id: ver.id, label: ver.label, publishedAt: ver.publishedAt },
      attestation: ver.attestation || null,
      dishes: ver.dishes || [],
      drinks: ver.drinks || [],
    });
  },

  async listVenues() {
    const { venues } = await readDevFile();
    return venues.map((v) => ({ slug: v.slug, name: v.name, city: v.city }));
  },

  async saveVenue(venue) {
    return withLock(async () => {
      const data = await readDevFile();
      const i = data.venues.findIndex((x) => x.slug === venue.slug);
      if (i >= 0) data.venues[i] = venue; else data.venues.push(venue);
      await writeDevFile(data);
      return venue;
    });
  },


  // Publishes a complete menu version and signs it in one step. Both the seed
  // and the admin UI go through here so there is exactly one code path that can
  // put a menu in front of a guest.
  //
  // The digest is computed from the shaped data, so what gets signed is exactly
  // what the engine will later read back and verify.
  async publishMenu({ venue, label, dishes, drinks, attestation }) {
    return withLock(async () => {
    const data = await readDevFile();
    let v = data.venues.find((x) => x.slug === venue.slug);
    if (!v) {
      v = { id: `venue-${venue.slug}`, ...venue, active: true, versions: [] };
      data.venues.push(v);
    } else {
      Object.assign(v, venue);
      v.versions = v.versions || [];
    }

    const digest = allergenDigest({ dishes, drinks });
    // Previous published version is archived, never deleted: the conversation
    // log points at it.
    for (const old of v.versions) if (old.status === 'published') old.status = 'archived';

    v.versions = v.versions.filter((x) => x.label !== label);
    v.versions.push({
      id: `${venue.slug}:${label}`,
      label,
      status: 'published',
      publishedAt: new Date().toISOString(),
      attestation: { ...attestation, digest, signedAt: attestation.signedAt || new Date().toISOString() },
      dishes, drinks,
    });
    await writeDevFile(data);
    return { versionLabel: label, digest };
    });
  },

  async logConversation(row) {
    return withLock(async () => {
      const data = await readDevFile();
      data.conversations = (data.conversations || []).concat([{ ...row, at: new Date().toISOString() }]);
      // Keep the dev log bounded; the real backend has a retention policy instead.
      if (data.conversations.length > 500) data.conversations = data.conversations.slice(-500);
      await writeDevFile(data);
    });
  },
};

// ---------------------------------------------------------------------------
// Postgres backend
//
// `pg` is imported lazily so the file backend needs no database driver present.
// ---------------------------------------------------------------------------
let poolPromise = null;
async function pool() {
  if (!poolPromise) {
    poolPromise = (async () => {
      const { Pool } = await import('pg');
      return new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 3,                       // serverless: keep the footprint small
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 5_000,
      });
    })();
  }
  return poolPromise;
}

const pgStore = {
  // Postgres writes are committed by the time their promise resolves.
  async flush() {},

  async getVenue(slug) {
    const p = await pool();
    const { rows } = await p.query(
      'SELECT id, slug, name, city, tone FROM venue WHERE slug = $1 AND active LIMIT 1', [slug]);
    return rows[0] || null;
  },

  async getPublishedMenu(slug) {
    const p = await pool();
    const { rows: vr } = await p.query(
      `SELECT v.id, v.slug, v.name, v.city, v.tone,
              m.id AS version_id, m.label, m.published_at,
              a.by_name, a.by_role, a.signed_at, a.statement, a.allergen_digest
         FROM venue v
         JOIN menu_version m ON m.venue_id = v.id AND m.status = 'published'
         LEFT JOIN attestation a ON a.menu_version_id = m.id
        WHERE v.slug = $1 AND v.active
        LIMIT 1`, [slug]);
    if (!vr.length) return null;
    const r = vr[0];

    // One round trip per collection, aggregating allergens in SQL so we don't
    // fan out a query per dish.
    const { rows: dishes } = await p.query(
      `SELECT d.ref, d.name, d.description AS desc, d.price_kr AS price, d.diets,
              d.allergen_status AS "allergenStatus",
              COALESCE(ARRAY_AGG(DISTINCT da.allergen_id)
                       FILTER (WHERE da.kind = 'contains'), '{}') AS allergens,
              COALESCE(ARRAY_AGG(DISTINCT da.allergen_id)
                       FILTER (WHERE da.kind = 'may_contain'), '{}') AS "mayContain"
         FROM dish d
         LEFT JOIN dish_allergen da ON da.dish_id = d.id
        WHERE d.menu_version_id = $1
        GROUP BY d.id
        ORDER BY d.sort, d.ref`, [r.version_id]);

    const { rows: drinks } = await p.query(
      `SELECT k.ref, k.name, k.kind, k.abv, k.price_kr AS price,
              COALESCE(ARRAY_AGG(DISTINCT ka.allergen_id)
                       FILTER (WHERE ka.allergen_id IS NOT NULL), '{}') AS allergens
         FROM drink k
         LEFT JOIN drink_allergen ka ON ka.drink_id = k.id
        WHERE k.menu_version_id = $1
        GROUP BY k.id
        ORDER BY k.sort, k.ref`, [r.version_id]);

    const { rows: pairs } = await p.query(
      `SELECT d.ref AS dish_ref, k.ref AS drink_ref, p.why
         FROM pairing p
         JOIN dish d ON d.id = p.dish_id
         JOIN drink k ON k.id = p.drink_id
        WHERE d.menu_version_id = $1
        ORDER BY p.sort`, [r.version_id]);

    const byDish = new Map();
    for (const x of pairs) {
      if (!byDish.has(x.dish_ref)) byDish.set(x.dish_ref, []);
      byDish.get(x.dish_ref).push({ drink: x.drink_ref, why: x.why });
    }
    for (const d of dishes) d.pairings = byDish.get(d.ref) || [];

    return shapeMenu({
      venue: { id: r.id, slug: r.slug, name: r.name, city: r.city, tone: r.tone },
      version: { id: r.version_id, label: r.label, publishedAt: r.published_at },
      attestation: r.by_name
        ? { byName: r.by_name, byRole: r.by_role, signedAt: r.signed_at,
            statement: r.statement, digest: r.allergen_digest }
        : null,
      dishes, drinks,
    });
  },

  async listVenues() {
    const p = await pool();
    const { rows } = await p.query('SELECT slug, name, city FROM venue WHERE active ORDER BY name');
    return rows;
  },


  async publishMenu({ venue, label, dishes, drinks, attestation }) {
    const p = await pool();
    const c = await p.connect();
    try {
      await c.query('BEGIN');

      const { rows: vr } = await c.query(
        `INSERT INTO venue (slug, name, city, tone) VALUES ($1,$2,$3,$4)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, city = EXCLUDED.city,
                                          tone = EXCLUDED.tone, active = true
         RETURNING id`,
        [venue.slug, venue.name, venue.city || '', venue.tone || 'uformell, kort, uten salgsspråk']);
      const venueId = vr[0].id;

      // A label is unique per venue, so re-publishing the same label replaces it.
      await c.query('DELETE FROM menu_version WHERE venue_id = $1 AND label = $2', [venueId, label]);
      // Only one version may be published at a time; the old one is archived
      // rather than dropped because the conversation log references it.
      await c.query(
        `UPDATE menu_version SET status = 'archived', published_at = NULL
          WHERE venue_id = $1 AND status = 'published'`, [venueId]);

      const { rows: mr } = await c.query(
        `INSERT INTO menu_version (venue_id, label, status, published_at, created_by)
         VALUES ($1,$2,'published', now(), $3) RETURNING id`,
        [venueId, label, attestation.byName || '']);
      const versionId = mr[0].id;

      const dishIds = new Map();
      for (const [i, d] of dishes.entries()) {
        const { rows } = await c.query(
          `INSERT INTO dish (menu_version_id, ref, name, description, price_kr, sort,
                             allergen_status, diets)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [versionId, d.ref, d.name, d.desc || '', d.price, i, d.allergenStatus || 'unverified',
           d.diets || []]);
        dishIds.set(d.ref, rows[0].id);
        for (const a of d.allergens || []) {
          await c.query(
            `INSERT INTO dish_allergen (dish_id, allergen_id, kind) VALUES ($1,$2,'contains')`,
            [rows[0].id, a]);
        }
        for (const a of d.mayContain || []) {
          await c.query(
            `INSERT INTO dish_allergen (dish_id, allergen_id, kind) VALUES ($1,$2,'may_contain')`,
            [rows[0].id, a]);
        }
      }

      const drinkIds = new Map();
      for (const [i, k] of drinks.entries()) {
        const { rows } = await c.query(
          `INSERT INTO drink (menu_version_id, ref, name, kind, abv, price_kr, sort)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [versionId, k.ref, k.name, k.kind || 'annet', k.abv || 0, k.price, i]);
        drinkIds.set(k.ref, rows[0].id);
        for (const a of k.allergens || []) {
          await c.query('INSERT INTO drink_allergen (drink_id, allergen_id) VALUES ($1,$2)',
            [rows[0].id, a]);
        }
      }

      for (const d of dishes) {
        for (const [i, pair] of (d.pairings || []).entries()) {
          const drinkId = drinkIds.get(pair.drink);
          if (!drinkId) continue;   // pairing to a drink not on this version
          await c.query(
            'INSERT INTO pairing (dish_id, drink_id, why, sort) VALUES ($1,$2,$3,$4)',
            [dishIds.get(d.ref), drinkId, pair.why || '', i]);
        }
      }

      const digest = allergenDigest({ dishes, drinks });
      await c.query(
        `INSERT INTO attestation (menu_version_id, by_name, by_role, statement, allergen_digest, signed_at)
         VALUES ($1,$2,$3,$4,$5, COALESCE($6::timestamptz, now()))`,
        [versionId, attestation.byName, attestation.byRole || '',
         attestation.statement || '', digest, attestation.signedAt || null]);

      await c.query('COMMIT');
      return { versionLabel: label, digest };
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  },

  async logConversation(row) {
    const p = await pool();
    await p.query(
      `INSERT INTO conversation
         (venue_id, menu_version_id, lang, question, reply, constraints,
          shown_refs, guard_tripped, sent_to_staff, degraded, usage)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [row.venueId, row.menuVersionId, row.lang || '', row.question, row.reply || '',
       JSON.stringify(row.constraints || {}), row.shownRefs || [], !!row.guardTripped,
       !!row.sentToStaff, !!row.degraded, JSON.stringify(row.usage || {})]);
  },
};

// ---------------------------------------------------------------------------
export const store = new Proxy({}, {
  get(_t, key) {
    const backend = usingPostgres() ? pgStore : devStore;
    return backend[key];
  },
});

export { shapeMenu, devStore, pgStore };
