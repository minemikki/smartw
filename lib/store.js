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
import { createHash } from 'node:crypto';
import { allergenDigest } from './digest.js';

// Only the hash of a login token is ever stored, so a leaked table grants no
// logins.
const hashToken = (raw) => createHash('sha256').update(String(raw)).digest('hex');

const DEV_FILE = process.env.BORDVERT_STORE || path.join(process.cwd(), '.data', 'store.json');
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

// A published version is never overwritten: its attestation is the record of
// what a named person signed, and deleting it destroys the audit trail the
// schema exists to protect. If the label is already taken, the new version gets
// a suffix. Only the seed passes replaceSameLabel, so re-seeding stays
// idempotent without weakening this rule for real publishes.
function uniqueLabel(taken, label) {
  if (!taken.includes(label)) return label;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${label}-${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${label}-${Date.now()}`;
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



  // Backs both the audit trail and the report a venue actually reads: "this is
  // what your guests asked about". Newest first.
  async recentConversations(slug, limit = 50) {
    const data = await readDevFile();
    const v = (data.venues || []).find((x) => x.slug === slug);
    if (!v) return [];
    return (data.conversations || [])
      .filter((c) => c.venueId === v.id)
      .slice(-limit)
      .reverse();
  },

  // --- admin: users and magic-link login ---------------------------------
  async addVenueUser({ slug, email, name, role }) {
    return withLock(async () => {
      const data = await readDevFile();
      const v = data.venues.find((x) => x.slug === slug);
      if (!v) throw new Error(`Ukjent lokale: ${slug}`);
      v.users = (v.users || []).filter((u) => u.email !== email);
      v.users.push({ email, name: name || '', role: role || 'eier' });
      await writeDevFile(data);
      return { slug, email };
    });
  },

  async findUserByEmail(email) {
    const { venues } = await readDevFile();
    for (const v of venues) {
      const u = (v.users || []).find((x) => x.email === email);
      if (u) return { venueSlug: v.slug, venueName: v.name, ...u };
    }
    return null;
  },

  async createLoginToken({ email, venueSlug, raw, ttlMinutes = 20 }) {
    return withLock(async () => {
      const data = await readDevFile();
      data.loginTokens = (data.loginTokens || [])
        .filter((t) => new Date(t.expiresAt) > new Date());   // drop expired
      data.loginTokens.push({
        hash: hashToken(raw), email, venueSlug,
        expiresAt: new Date(Date.now() + ttlMinutes * 60_000).toISOString(),
      });
      await writeDevFile(data);
    });
  },

  // Single-use: the row is removed as it is read, so a forwarded link cannot be
  // replayed.
  async consumeLoginToken(raw) {
    return withLock(async () => {
      const data = await readDevFile();
      const hash = hashToken(raw);
      const i = (data.loginTokens || []).findIndex(
        (t) => t.hash === hash && new Date(t.expiresAt) > new Date());
      if (i < 0) return null;
      const [t] = data.loginTokens.splice(i, 1);
      await writeDevFile(data);
      return { email: t.email, venueSlug: t.venueSlug };
    });
  },

  // --- admin: drafts and history -----------------------------------------
  async getDraft(slug) {
    const { venues } = await readDevFile();
    const v = venues.find((x) => x.slug === slug);
    if (!v) return null;
    const d = (v.versions || []).find((x) => x.status === 'draft');
    return d ? { label: d.label, dishes: d.dishes, drinks: d.drinks } : null;
  },

  async saveDraft(slug, { label, dishes, drinks }) {
    return withLock(async () => {
      const data = await readDevFile();
      const v = data.venues.find((x) => x.slug === slug);
      if (!v) throw new Error(`Ukjent lokale: ${slug}`);
      v.versions = (v.versions || []).filter((x) => x.status !== 'draft');
      v.versions.push({ id: `${slug}:draft`, label, status: 'draft', dishes, drinks });
      await writeDevFile(data);
      return { label };
    });
  },

  async discardDraft(slug) {
    return withLock(async () => {
      const data = await readDevFile();
      const v = data.venues.find((x) => x.slug === slug);
      if (!v) return;
      v.versions = (v.versions || []).filter((x) => x.status !== 'draft');
      await writeDevFile(data);
    });
  },

  async listVersions(slug) {
    const { venues } = await readDevFile();
    const v = venues.find((x) => x.slug === slug);
    if (!v) return [];
    return (v.versions || [])
      .map((x) => ({
        label: x.label, status: x.status, publishedAt: x.publishedAt || null,
        signedBy: x.attestation?.byName || null, signedAt: x.attestation?.signedAt || null,
        dishCount: (x.dishes || []).length,
      }))
      .sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));
  },

  // Publishes a complete menu version and signs it in one step. Both the seed
  // and the admin UI go through here so there is exactly one code path that can
  // put a menu in front of a guest.
  //
  // The digest is computed from the shaped data, so what gets signed is exactly
  // what the engine will later read back and verify.
  async publishMenu({ venue, label, dishes, drinks, attestation, replaceSameLabel = false }) {
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
    // log points at it, and its signature is a record.
    for (const old of v.versions) if (old.status === 'published') old.status = 'archived';

    if (replaceSameLabel) v.versions = v.versions.filter((x) => x.label !== label);
    // Drafts are working state, not a record, so the draft being published goes
    // and never counts as a taken label.
    v.versions = v.versions.filter((x) => x.status !== 'draft');
    label = uniqueLabel(v.versions.filter((x) => x.status !== 'draft').map((x) => x.label), label);

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

// Inserts the dish/drink/pairing rows for one menu version. Shared by saveDraft
// and publishMenu so a draft and a published version are built by identical
// code — a draft that inserts differently is a draft you cannot trust to
// publish.
async function insertMenuRows(c, versionId, dishes, drinks) {
  const dishIds = new Map();
  for (const [i, d] of dishes.entries()) {
    const { rows } = await c.query(
      `INSERT INTO dish (menu_version_id, ref, name, description, price_kr, sort,
                         allergen_status, diets)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [versionId, d.ref, d.name, d.desc || '', d.price, i,
       d.allergenStatus || 'unverified', d.diets || []]);
    dishIds.set(d.ref, rows[0].id);
    for (const a of d.allergens || []) {
      await c.query(`INSERT INTO dish_allergen (dish_id, allergen_id, kind) VALUES ($1,$2,'contains')`,
        [rows[0].id, a]);
    }
    for (const a of d.mayContain || []) {
      await c.query(`INSERT INTO dish_allergen (dish_id, allergen_id, kind) VALUES ($1,$2,'may_contain')`,
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
      if (!drinkId) continue;          // pairing to a drink not on this version
      await c.query('INSERT INTO pairing (dish_id, drink_id, why, sort) VALUES ($1,$2,$3,$4)',
        [dishIds.get(d.ref), drinkId, pair.why || '', i]);
    }
  }
  return { dishIds, drinkIds };
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



  async recentConversations(slug, limit = 50) {
    const p = await pool();
    const { rows } = await p.query(
      `SELECT c.created_at AS at, c.lang, c.question, c.reply, c.constraints,
              c.shown_refs AS "shownRefs", c.guard_tripped AS "guardTripped",
              c.sent_to_staff AS "sentToStaff", c.degraded
         FROM conversation c JOIN venue v ON v.id = c.venue_id
        WHERE v.slug = $1
        ORDER BY c.created_at DESC
        LIMIT $2`, [slug, Math.min(Number(limit) || 50, 500)]);
    return rows;
  },

  // --- admin: users and magic-link login ---------------------------------
  async addVenueUser({ slug, email, name, role }) {
    const p = await pool();
    const { rows } = await p.query(
      `INSERT INTO venue_user (venue_id, email, name, role)
       SELECT id, $2, $3, $4 FROM venue WHERE slug = $1
       ON CONFLICT (venue_id, email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role
       RETURNING email`, [slug, email, name || '', role || 'eier']);
    if (!rows.length) throw new Error(`Ukjent lokale: ${slug}`);
    return { slug, email };
  },

  async findUserByEmail(email) {
    const p = await pool();
    const { rows } = await p.query(
      `SELECT v.slug AS "venueSlug", v.name AS "venueName", u.email, u.name, u.role
         FROM venue_user u JOIN venue v ON v.id = u.venue_id
        WHERE u.email = $1 AND v.active LIMIT 1`, [email]);
    return rows[0] || null;
  },

  async createLoginToken({ email, venueSlug, raw, ttlMinutes = 20 }) {
    const p = await pool();
    await p.query('DELETE FROM login_token WHERE expires_at < now()');
    await p.query(
      `INSERT INTO login_token (token_hash, email, venue_id, expires_at)
       SELECT $1, $2, id, now() + ($4 || ' minutes')::interval FROM venue WHERE slug = $3`,
      [hashToken(raw), email, venueSlug, String(ttlMinutes)]);
  },

  // Single-use: deleted as it is read, so a forwarded link cannot be replayed.
  async consumeLoginToken(raw) {
    const p = await pool();
    const { rows } = await p.query(
      `DELETE FROM login_token t USING venue v
        WHERE t.token_hash = $1 AND t.expires_at > now() AND v.id = t.venue_id
        RETURNING t.email, v.slug AS "venueSlug"`, [hashToken(raw)]);
    return rows[0] || null;
  },

  // --- admin: drafts and history -----------------------------------------
  async getDraft(slug) {
    const p = await pool();
    const { rows } = await p.query(
      `SELECT m.id, m.label FROM menu_version m JOIN venue v ON v.id = m.venue_id
        WHERE v.slug = $1 AND m.status = 'draft' ORDER BY m.created_at DESC LIMIT 1`, [slug]);
    if (!rows.length) return null;
    const versionId = rows[0].id;

    const { rows: dishes } = await p.query(
      `SELECT d.ref, d.name, d.description AS desc, d.price_kr AS price, d.diets,
              d.allergen_status AS "allergenStatus",
              COALESCE(ARRAY_AGG(DISTINCT da.allergen_id)
                       FILTER (WHERE da.kind = 'contains'), '{}') AS allergens,
              COALESCE(ARRAY_AGG(DISTINCT da.allergen_id)
                       FILTER (WHERE da.kind = 'may_contain'), '{}') AS "mayContain"
         FROM dish d LEFT JOIN dish_allergen da ON da.dish_id = d.id
        WHERE d.menu_version_id = $1 GROUP BY d.id ORDER BY d.sort, d.ref`, [versionId]);
    const { rows: drinks } = await p.query(
      `SELECT k.ref, k.name, k.kind, k.abv, k.price_kr AS price,
              COALESCE(ARRAY_AGG(DISTINCT ka.allergen_id)
                       FILTER (WHERE ka.allergen_id IS NOT NULL), '{}') AS allergens
         FROM drink k LEFT JOIN drink_allergen ka ON ka.drink_id = k.id
        WHERE k.menu_version_id = $1 GROUP BY k.id ORDER BY k.sort, k.ref`, [versionId]);
    const { rows: pairs } = await p.query(
      `SELECT d.ref AS dish_ref, k.ref AS drink_ref, pr.why
         FROM pairing pr JOIN dish d ON d.id = pr.dish_id JOIN drink k ON k.id = pr.drink_id
        WHERE d.menu_version_id = $1 ORDER BY pr.sort`, [versionId]);
    const byDish = new Map();
    for (const x of pairs) {
      if (!byDish.has(x.dish_ref)) byDish.set(x.dish_ref, []);
      byDish.get(x.dish_ref).push({ drink: x.drink_ref, why: x.why });
    }
    for (const d of dishes) d.pairings = byDish.get(d.ref) || [];
    return { label: rows[0].label, dishes, drinks };
  },

  async saveDraft(slug, { label, dishes, drinks }) {
    const p = await pool();
    const c = await p.connect();
    try {
      await c.query('BEGIN');
      const { rows: vr } = await c.query('SELECT id FROM venue WHERE slug = $1', [slug]);
      if (!vr.length) throw new Error(`Ukjent lokale: ${slug}`);
      const venueId = vr[0].id;

      // One draft at a time: replacing it wholesale is simpler and safer than
      // diffing rows, and a draft has no audit obligations yet.
      await c.query(`DELETE FROM menu_version WHERE venue_id = $1 AND status = 'draft'`, [venueId]);
      const { rows: mr } = await c.query(
        `INSERT INTO menu_version (venue_id, label, status) VALUES ($1,$2,'draft') RETURNING id`,
        [venueId, label]);
      await insertMenuRows(c, mr[0].id, dishes, drinks);
      await c.query('COMMIT');
      return { label };
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  },

  async discardDraft(slug) {
    const p = await pool();
    await p.query(
      `DELETE FROM menu_version m USING venue v
        WHERE m.venue_id = v.id AND v.slug = $1 AND m.status = 'draft'`, [slug]);
  },

  async listVersions(slug) {
    const p = await pool();
    const { rows } = await p.query(
      `SELECT m.label, m.status, m.published_at AS "publishedAt",
              a.by_name AS "signedBy", a.signed_at AS "signedAt",
              (SELECT count(*) FROM dish d WHERE d.menu_version_id = m.id)::int AS "dishCount"
         FROM menu_version m
         JOIN venue v ON v.id = m.venue_id
         LEFT JOIN attestation a ON a.menu_version_id = m.id
        WHERE v.slug = $1
        ORDER BY m.published_at DESC NULLS FIRST, m.created_at DESC`, [slug]);
    return rows;
  },

  async publishMenu({ venue, label, dishes, drinks, attestation, replaceSameLabel = false }) {
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

      if (replaceSameLabel) {
        await c.query('DELETE FROM menu_version WHERE venue_id = $1 AND label = $2', [venueId, label]);
      }
      // The draft being published is working state, not a record.
      await c.query(`DELETE FROM menu_version WHERE venue_id = $1 AND status = 'draft'`, [venueId]);
      // Only one version may be published at a time; the old one is archived
      // rather than dropped — the conversation log references it and its
      // attestation is the record of what was signed.
      await c.query(
        `UPDATE menu_version SET status = 'archived', published_at = NULL
          WHERE venue_id = $1 AND status = 'published'`, [venueId]);

      // Only records count as taken; drafts are working state and share the
      // published version's name by design.
      const { rows: taken } = await c.query(
        `SELECT label FROM menu_version WHERE venue_id = $1 AND status <> 'draft'`, [venueId]);
      label = uniqueLabel(taken.map((r) => r.label), label);

      const { rows: mr } = await c.query(
        `INSERT INTO menu_version (venue_id, label, status, published_at, created_by)
         VALUES ($1,$2,'published', now(), $3) RETURNING id`,
        [venueId, label, attestation.byName || '']);
      const versionId = mr[0].id;
      await insertMenuRows(c, versionId, dishes, drinks);

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
// The file backend writes to disk. On Vercel the filesystem is read-only apart
// from /tmp, and /tmp is per-instance and disposable — so a deploy without
// DATABASE_URL would look like it worked, serve one menu, and silently lose every
// edit and every conversation. Fail loudly instead of plausibly.
if (process.env.VERCEL && !process.env.DATABASE_URL) {
  console.error(
    '[store] DATABASE_URL mangler. Fil-lageret kan ikke brukes i produksjon — ' +
    'data forsvinner mellom kall. Sett DATABASE_URL (Postgres) og kjør db/schema.sql.');
}

export const store = new Proxy({}, {
  get(_t, key) {
    if (process.env.VERCEL && !process.env.DATABASE_URL) {
      throw new Error(
        'DATABASE_URL mangler. Bordvert krever Postgres i produksjon; fil-lageret er bare for utvikling.');
    }
    const backend = usingPostgres() ? pgStore : devStore;
    return backend[key];
  },
});

export { shapeMenu, devStore, pgStore };
