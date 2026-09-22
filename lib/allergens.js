// The 14 allergens that must be declared under matinformasjonsforskriften, and
// the guest-language matching used to spot them in free text.
//
// No menu data here on purpose: this module is pure, so the same matching runs
// for every venue and can be tested on its own.

export const ALLERGENS = {
  gluten:    'gluten',
  skalldyr:  'skalldyr',
  egg:       'egg',
  fisk:      'fisk',
  peanotter: 'peanøtter',
  soya:      'soya',
  melk:      'melk',
  notter:    'nøtter',
  selleri:   'selleri',
  sennep:    'sennep',
  sesam:     'sesam',
  sulfitt:   'sulfitt',
  lupin:     'lupin',
  blotdyr:   'bløtdyr',
};

export const ALLERGEN_IDS = Object.keys(ALLERGENS);

export const DIETS = ['vegetar', 'vegansk'];

// Words a guest actually types, mapped to allergen ids. Used as a second,
// independent read of the guest's message so a restriction the model missed is
// still enforced.
//
// Entries are STEMS matched at a left word boundary, so "pean" catches
// "peanøtter", "peanætter", "peanut" and "peanøttolje" — real guests misspell
// the thing they are allergic to, and a spelling the list didn't anticipate must
// not turn into a served allergen. The boundary keeps "ost" from firing on
// "koster" and keeps "nøtt" from firing inside "peanøtter" (a peanut allergy is
// not a tree-nut allergy).
export const ALLERGEN_SYNONYMS = {
  peanotter: ['pean', 'jordnøt', 'jordnot', 'groundnut'],
  notter:    ['nøtt', 'nott', 'nött', 'mandel', 'valnøtt', 'hasselnøtt', 'cashew', 'pistasj', 'pekan', 'paranøtt', 'marsipan', 'tree nut'],
  gluten:    ['gluten', 'hvete', 'cøliaki', 'coliaki', 'celiaki', 'spelt', 'bygg', 'rug', 'durum', 'semulegryn', 'wheat'],
  melk:      ['melk', 'mjølk', 'mjolk', 'laktose', 'meieri', 'ost', 'fløte', 'flote', 'smør', 'smor', 'kasein', 'dairy', 'milk'],
  egg:       ['egg', 'eggehvite', 'eggeplomme', 'majones'],
  fisk:      ['fisk', 'laks', 'torsk', 'ansjos', 'sild', 'kveite', 'fish'],
  skalldyr:  ['skalldyr', 'reke', 'krabbe', 'hummer', 'kreps', 'sjømat', 'shellfish', 'shrimp'],
  blotdyr:   ['bløtdyr', 'blotdyr', 'blåskjell', 'skjell', 'kamskjell', 'blekksprut', 'østers', 'snegle'],
  soya:      ['soya', 'soja', 'tofu', 'edamame'],
  selleri:   ['selleri', 'sellerirot', 'celery'],
  sennep:    ['sennep', 'dijon', 'mustard'],
  sesam:     ['sesam', 'tahini', 'tahin', 'sesame'],
  sulfitt:   ['sulfitt', 'sulfat', 'svoveldioksid', 'sulphite', 'sulfite'],
  lupin:     ['lupin'],
};

// A left word boundary that understands Norwegian letters. JS \b treats ø/æ/å as
// non-word characters, so \bøsters would never match "østers" — this uses a
// unicode-aware lookbehind instead. Suffixes stay open so a stem matches
// inflections.
const stemRe = (stem) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'iu');

const STEM_PATTERNS = Object.entries(ALLERGEN_SYNONYMS).map(([id, stems]) => [id, stems.map(stemRe)]);

export function detectAllergens(text) {
  const t = String(text || '');
  const hits = [];
  for (const [id, patterns] of STEM_PATTERNS) {
    if (patterns.some((re) => re.test(t))) hits.push(id);
  }
  return hits;
}

export function detectPriceCap(text) {
  const t = String(text || '').toLowerCase().replace(/\s/g, ' ');
  const found = [];
  const push = (v) => { const n = Number(v); if (n >= 50 && n <= 5000) found.push(n); };
  for (const m of t.matchAll(/(?:under|maks|maksimalt|maksimum|opptil|inntil|til|rundt|ca\.?)\s*(\d{2,4})/g)) push(m[1]);
  for (const m of t.matchAll(/(\d{2,4})\s*(?:kr|kroner|,-|nok)/g)) push(m[1]);
  return found.length ? Math.min(...found) : null;
}

export const allergenLabel = (id) => ALLERGENS[id] || id;
export const allergenLabels = (ids) => (ids || []).map(allergenLabel).join(', ');
