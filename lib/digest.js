// The allergen digest is what makes an attestation verifiable instead of
// decorative.
//
// When a kitchen signs a menu version, we hash the exact allergen payload they
// signed. Every time that menu is loaded we recompute the hash. If it differs,
// the signature no longer covers the data and the engine drops to "no allergen
// claims at all" — the same posture as an unsigned dish.
//
// Published menu versions are immutable, so a mismatch means something went
// wrong (a bad migration, a direct DB edit, a bug). That is exactly when you
// want the system to get quieter, not to keep answering confidently.

import { createHash } from 'node:crypto';

const list = (xs) => [...new Set(xs || [])].sort().join(',');

export function allergenDigest({ dishes = [], drinks = [] }) {
  const lines = [];
  for (const d of [...dishes].sort((a, b) => a.ref.localeCompare(b.ref))) {
    lines.push(`dish|${d.ref}|${d.allergenStatus}|${list(d.allergens)}|${list(d.mayContain)}`);
  }
  for (const d of [...drinks].sort((a, b) => a.ref.localeCompare(b.ref))) {
    lines.push(`drink|${d.ref}|${list(d.allergens)}`);
  }
  return createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}
