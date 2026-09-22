// The menu admin's data endpoint. Session-gated; the session decides which
// venue is being edited, never the request body — otherwise one venue's login
// could edit another's allergen data.
//
//   GET  /api/menu   → draft, published, version history
//   PUT  /api/menu   → save the draft (no signature needed; guests never see it)
//   POST /api/menu   → publish + sign (validated harder, and binds a signature)

import { store } from '../lib/store.js';
import { requireSession } from '../lib/session.js';
import { validateMenu, validateAttestation } from '../lib/validate.js';
import { ALLERGENS, DIETS } from '../lib/allergens.js';

const editable = (m) => m && ({
  label: m.version?.label ?? m.label,
  dishes: m.dishes, drinks: m.drinks,
});

export default async function handler(req, res) {
  const s = requireSession(req, res);
  if (!s) return;
  const slug = s.venueSlug;

  try {
    if (req.method === 'GET') {
      const [venue, draft, published, versions] = await Promise.all([
        store.getVenue(slug), store.getDraft(slug),
        store.getPublishedMenu(slug), store.listVersions(slug),
      ]);
      if (!venue) return res.status(404).json({ error: 'Lokalet finnes ikke lenger.' });
      return res.json({
        venue, draft, versions,
        published: published ? editable(published) : null,
        publishedState: published
          ? { label: published.version.label, attestationOk: published.attestationOk,
              attestation: published.attestation, problem: published.attestationProblem || null }
          : null,
        // The UI renders checkboxes from this, so the two can never drift.
        allergens: ALLERGENS, diets: DIETS,
        session: s,
      });
    }

    if (req.method === 'PUT') {
      const v = validateMenu(req.body);
      if (!v.ok) return res.status(400).json({ error: 'Menyen kan ikke lagres.', errors: v.errors });
      const saved = await store.saveDraft(slug, v.menu);
      return res.json({ ok: true, saved: saved.label, dishes: v.menu.dishes.length });
    }

    if (req.method === 'POST') {
      const v = validateMenu(req.body?.menu);
      const a = validateAttestation(req.body?.attestation);
      const errors = [...v.errors, ...a.errors];
      if (!v.menu.dishes.length) errors.push('En publisert meny må ha minst én rett.');
      if (errors.length) return res.status(400).json({ error: 'Menyen kan ikke publiseres.', errors });

      const venue = await store.getVenue(slug);
      if (!venue) return res.status(404).json({ error: 'Lokalet finnes ikke lenger.' });

      // publishMenu computes and stores the allergen digest, so the signature
      // is bound to exactly these rows.
      const result = await store.publishMenu({
        venue: { slug: venue.slug, name: venue.name, city: venue.city, tone: venue.tone },
        label: v.menu.label,
        dishes: v.menu.dishes,
        drinks: v.menu.drinks,
        attestation: { ...a.attestation, signedAt: new Date().toISOString() },
      });
      await store.discardDraft(slug);

      // Read back through the guest-facing loader: if the digest we just wrote
      // does not verify, the publish is broken and the venue must hear it now,
      // not from a guest.
      const live = await store.getPublishedMenu(slug);
      if (!live?.attestationOk) {
        return res.status(500).json({
          error: 'Publisert, men attesteringen verifiserer ikke. Kontakt support før dette vises til gjester.',
          problem: live?.attestationProblem || 'ukjent',
        });
      }

      return res.json({
        ok: true, label: result.versionLabel, digest: result.digest.slice(0, 16),
        dishes: live.dishes.length,
        unverified: live.dishes.filter((d) => d.allergenStatus !== 'verified').length,
      });
    }

    res.status(405).json({ error: 'GET, PUT or POST' });
  } catch (e) {
    console.error('[menu]', e);
    res.status(500).json({ error: e.message || 'Noe gikk galt.' });
  }
}
