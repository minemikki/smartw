-- Smartwaiter schema (PostgreSQL 14+).
--
-- Two rules drive the whole design, and both exist because of allergens:
--
--  1. A dish belongs to a MENU VERSION, never to the venue directly. Without
--     that you cannot answer "what did the menu say last Tuesday", which is the
--     only question that matters if a guest reacts to something.
--
--  2. A PUBLISHED menu version is IMMUTABLE. Editing a published menu creates a
--     new draft (copy-on-write). This is what makes an attestation truthful: the
--     signature covers a set of rows that can no longer change underneath it.
--     Without it, "kjøkkensjefen signerte denne listen" is a lie the moment
--     someone fixes a typo.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- The 14 allergens that must be declared under matinformasjonsforskriften.
-- A lookup table rather than a CHECK constraint so the app cannot invent a
-- fifteenth allergen id through a typo, and so labels live in one place.
-- ---------------------------------------------------------------------------
CREATE TABLE allergen (
  id     text PRIMARY KEY,
  label  text NOT NULL,
  sort   int  NOT NULL
);

INSERT INTO allergen (id, label, sort) VALUES
  ('gluten','gluten',1), ('skalldyr','skalldyr',2), ('egg','egg',3),
  ('fisk','fisk',4), ('peanotter','peanøtter',5), ('soya','soya',6),
  ('melk','melk',7), ('notter','nøtter',8), ('selleri','selleri',9),
  ('sennep','sennep',10), ('sesam','sesam',11), ('sulfitt','sulfitt',12),
  ('lupin','lupin',13), ('blotdyr','bløtdyr',14);

-- ---------------------------------------------------------------------------
-- Venues
-- ---------------------------------------------------------------------------
CREATE TABLE venue (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,          -- /v/<slug>
  name        text NOT NULL,
  city        text NOT NULL DEFAULT '',
  tone        text NOT NULL DEFAULT 'uformell, kort, uten salgsspråk',
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX venue_active_idx ON venue (active) WHERE active;

CREATE TABLE venue_user (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    uuid NOT NULL REFERENCES venue(id) ON DELETE CASCADE,
  email       text NOT NULL,
  name        text NOT NULL DEFAULT '',
  role        text NOT NULL DEFAULT 'eier',  -- free text: eier, kjøkkensjef, ...
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, email)
);

-- Magic-link login. Only the hash is stored, so a leaked table grants nothing.
CREATE TABLE login_token (
  token_hash  text PRIMARY KEY,
  email       text NOT NULL,
  venue_id    uuid NOT NULL REFERENCES venue(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_token_expiry_idx ON login_token (expires_at);

-- ---------------------------------------------------------------------------
-- Menu versions
-- ---------------------------------------------------------------------------
CREATE TABLE menu_version (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id      uuid NOT NULL REFERENCES venue(id) ON DELETE CASCADE,
  label         text NOT NULL,                -- e.g. 'meny-2026-09-18'
  status        text NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','published','archived')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  created_by    text NOT NULL DEFAULT '',
  UNIQUE (venue_id, label),
  -- A published version must record when, and a draft must not pretend to.
  CONSTRAINT published_has_timestamp
    CHECK ((status = 'published') = (published_at IS NOT NULL))
);

-- At most one published version per venue: the guest-facing menu is unambiguous.
CREATE UNIQUE INDEX menu_version_one_published_per_venue
  ON menu_version (venue_id) WHERE status = 'published';

CREATE INDEX menu_version_venue_idx ON menu_version (venue_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Dishes and drinks
-- ---------------------------------------------------------------------------
CREATE TABLE dish (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_version_id  uuid NOT NULL REFERENCES menu_version(id) ON DELETE CASCADE,
  ref              text NOT NULL,             -- stable per version, e.g. 'r-01'
  name             text NOT NULL,
  description      text NOT NULL DEFAULT '',
  price_kr         integer NOT NULL CHECK (price_kr >= 0),
  sort             integer NOT NULL DEFAULT 0,
  -- 'unverified' means the kitchen has NOT signed off on this dish's allergen
  -- data. The engine refuses to make any allergen claim about it and routes the
  -- guest to staff. Defaulting to unverified is deliberate: a new dish is
  -- unsafe until someone says otherwise.
  allergen_status  text NOT NULL DEFAULT 'unverified'
                   CHECK (allergen_status IN ('verified','unverified')),
  diets            text[] NOT NULL DEFAULT '{}',
  UNIQUE (menu_version_id, ref)
);
CREATE INDEX dish_version_idx ON dish (menu_version_id, sort);

CREATE TABLE dish_allergen (
  dish_id      uuid NOT NULL REFERENCES dish(id) ON DELETE CASCADE,
  allergen_id  text NOT NULL REFERENCES allergen(id),
  -- 'contains' is a declared ingredient; 'may_contain' is kitchen cross-contact.
  -- The engine treats may_contain exactly like contains once a guest has
  -- flagged that allergen.
  kind         text NOT NULL CHECK (kind IN ('contains','may_contain')),
  PRIMARY KEY (dish_id, allergen_id, kind)
);

CREATE TABLE drink (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_version_id  uuid NOT NULL REFERENCES menu_version(id) ON DELETE CASCADE,
  ref              text NOT NULL,
  name             text NOT NULL,
  kind             text NOT NULL DEFAULT 'annet',   -- øl, vin, alkoholfri, ...
  abv              numeric(4,1) NOT NULL DEFAULT 0 CHECK (abv >= 0),
  price_kr         integer NOT NULL CHECK (price_kr >= 0),
  sort             integer NOT NULL DEFAULT 0,
  UNIQUE (menu_version_id, ref)
);
CREATE INDEX drink_version_idx ON drink (menu_version_id, sort);

CREATE TABLE drink_allergen (
  drink_id     uuid NOT NULL REFERENCES drink(id) ON DELETE CASCADE,
  allergen_id  text NOT NULL REFERENCES allergen(id),
  PRIMARY KEY (drink_id, allergen_id)
);

CREATE TABLE pairing (
  dish_id   uuid NOT NULL REFERENCES dish(id) ON DELETE CASCADE,
  drink_id  uuid NOT NULL REFERENCES drink(id) ON DELETE CASCADE,
  why       text NOT NULL DEFAULT '',
  sort      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (dish_id, drink_id)
);

-- ---------------------------------------------------------------------------
-- Attestation — the legal spine
--
-- One per menu version, insert-only. `allergen_digest` is a hash of the exact
-- allergen payload at signing time; the app recomputes it when loading a
-- published menu and refuses to serve allergen claims on a mismatch. Combined
-- with published-version immutability that makes the signature verifiable
-- rather than decorative.
-- ---------------------------------------------------------------------------
CREATE TABLE attestation (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_version_id  uuid NOT NULL UNIQUE REFERENCES menu_version(id) ON DELETE CASCADE,
  by_name          text NOT NULL,
  by_role          text NOT NULL,
  statement        text NOT NULL,
  signed_at        timestamptz NOT NULL DEFAULT now(),
  allergen_digest  text NOT NULL,
  signed_ip        inet
);

-- Attestations are never edited or deleted: a correction is a new menu version
-- with its own signature. Enforced here rather than trusted to the app.
CREATE RULE attestation_no_update AS ON UPDATE TO attestation DO INSTEAD NOTHING;
CREATE RULE attestation_no_delete AS ON DELETE TO attestation DO INSTEAD NOTHING;

-- ---------------------------------------------------------------------------
-- Conversation log
--
-- Both the audit trail if something goes wrong and the report the venue
-- actually reads ("this is what your guests asked about last month").
-- `question` is guest-typed free text: treat it as personal data, keep the
-- retention window short, and say so in the privacy notice.
-- ---------------------------------------------------------------------------
CREATE TABLE conversation (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id         uuid NOT NULL REFERENCES venue(id) ON DELETE CASCADE,
  menu_version_id  uuid REFERENCES menu_version(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  lang             text NOT NULL DEFAULT '',
  question         text NOT NULL,
  reply            text NOT NULL DEFAULT '',
  constraints      jsonb NOT NULL DEFAULT '{}'::jsonb,
  shown_refs       text[] NOT NULL DEFAULT '{}',
  guard_tripped    boolean NOT NULL DEFAULT false,
  sent_to_staff    boolean NOT NULL DEFAULT false,
  degraded         boolean NOT NULL DEFAULT false,  -- model unavailable, served fallback
  usage            jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX conversation_venue_idx ON conversation (venue_id, created_at DESC);
-- Feeds the alert when the guard fires, which should be rare and always looked at.
CREATE INDEX conversation_guard_idx ON conversation (created_at DESC) WHERE guard_tripped;

COMMIT;
