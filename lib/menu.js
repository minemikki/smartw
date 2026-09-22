// Demo menu for the AI waiter — a fictional restaurant, deliberately not a real
// StayMotion client: putting invented allergen data under a real venue's name is
// exactly the mistake this product exists to prevent.
//
// The shape here is the actual product spec. Everything the assistant is allowed
// to claim has to be a field in this file. If a fact isn't here, the answer is
// "spør personalet" — never a guess.

// The 14 allergens that must be declared under matinformasjonsforskriften.
// Keys are stable ids; labels are what a guest sees.
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

// Norwegian words a guest actually types, mapped to allergen ids. Used as a
// second, independent read of the guest's message so a missed extraction by the
// model can't silently drop a restriction.
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

// Diet tags are a convenience filter, never a safety claim.
export const DIETS = { vegetar: 'vegetar', vegansk: 'vegansk' };

export const RESTAURANT = {
  name: 'Brygge & Bord',
  city: 'Oslo',
  tone: 'nordisk, uformelt, kortreiste råvarer',
  // The attestation is the whole legal spine: a named person at the venue signed
  // off on this exact version of the allergen data, on this date. The UI shows it
  // and the assistant refuses allergen claims on anything not covered by it.
  attestation: {
    by: 'Kjøkkensjef, Brygge & Bord',
    at: '2026-09-18',
    version: 'meny-2026-09-18',
  },
};

// allergenStatus: 'verified'  → allergens[] is complete and signed off
//                 'unverified' → allergens[] is indicative only; no allergen
//                                claim may be made about this dish at all
export const DISHES = [
  { id: 'r-01', name: 'Kamskjell, jordskokk og brunet smør', price: 245,
    desc: 'Pannestekte kamskjell, puré av jordskokk, brunet smør og sitron.',
    allergens: ['blotdyr', 'melk'], mayContain: [], diets: [], allergenStatus: 'verified',
    pairings: [{ drink: 'd-06', why: 'syrlig riesling mot det søte i kamskjellet' }, { drink: 'd-03', why: 'hveteøl tar brunet smør uten å overdøve' }] },

  { id: 'r-02', name: 'Kveite med syltet fennikel', price: 315,
    desc: 'Smørstekt kveite, syltet fennikel, dillolje og nypoteter.',
    allergens: ['fisk', 'melk', 'sulfitt'], mayContain: [], diets: [], allergenStatus: 'verified',
    pairings: [{ drink: 'd-06', why: 'klassisk til hvit fisk' }, { drink: 'd-05', why: 'glutenfri lager, nøytral og kald' }] },

  { id: 'r-03', name: 'Satay av kylling med agurksalat', price: 265,
    desc: 'Grillet kyllingspyd i peanøttsaus, agurksalat og ristet sesam.',
    allergens: ['peanotter', 'soya', 'sesam'], mayContain: [], diets: [], allergenStatus: 'verified',
    pairings: [{ drink: 'd-02', why: 'IPA-bitterhet mot søt peanøttsaus' }] },

  { id: 'r-04', name: 'Entrecôte, pommes anna og peppersaus', price: 395,
    desc: 'Entrecôte fra Grøndalen gård, pommes anna og grønn pepper.',
    allergens: ['melk'], mayContain: [], diets: [], allergenStatus: 'verified',
    pairings: [{ drink: 'd-07', why: 'pinot noir har nok syre til fettet' }, { drink: 'd-04', why: 'stout mot stekeskorpen' }] },

  { id: 'r-05', name: 'Ovnsbakte rotgrønnsaker med hasselnøttkrem', price: 255,
    desc: 'Gulrot, persillerot og pastinakk, krem av hasselnøtt, urteolje.',
    allergens: ['notter', 'melk'], mayContain: [], diets: ['vegetar'], allergenStatus: 'verified',
    pairings: [{ drink: 'd-03', why: 'hveteøl mot det søte i rotgrønnsakene' }] },

  { id: 'r-06', name: 'Fiskesuppe fra Hitra', price: 235,
    desc: 'Kremet fiskesuppe med torsk, reker, gulrot og sellerirot.',
    allergens: ['fisk', 'melk', 'skalldyr', 'selleri'], mayContain: [], diets: [], allergenStatus: 'verified',
    pairings: [{ drink: 'd-06', why: 'riesling kutter kremen' }] },

  { id: 'r-07', name: 'Pasta med tomat, basilikum og chili', price: 225,
    desc: 'Fersk pasta, langkokt tomat, basilikum og litt chili.',
    allergens: ['gluten', 'egg'], mayContain: [], diets: ['vegetar'], allergenStatus: 'verified',
    pairings: [{ drink: 'd-01', why: 'pils er nøytral mot chili' }, { drink: 'd-08', why: 'eplemost uten alkohol' }] },

  { id: 'r-08', name: 'Kylling med urtesmør og knuste poteter', price: 285,
    desc: 'Helstekt kyllingbryst, urtesmør, knuste poteter og stekesjy.',
    allergens: ['melk'], mayContain: [], diets: [], allergenStatus: 'verified',
    pairings: [{ drink: 'd-01', why: 'lokal pils, enkel og tørst' }, { drink: 'd-07', why: 'pinot noir til urtesmøret' }] },

  { id: 'r-09', name: 'Ovnsbakt blomkål med tahinikrem', price: 240,
    desc: 'Hel blomkål bakt i ovn, tahinikrem, granateple og persille.',
    allergens: ['sesam'], mayContain: [], diets: ['vegetar', 'vegansk'], allergenStatus: 'verified',
    pairings: [{ drink: 'd-05', why: 'glutenfri lager, lett og kald' }, { drink: 'd-10', why: 'kombucha til det nøttete i tahini' }] },

  { id: 'r-10', name: 'Lammeskank med hvitløkspoteter', price: 340,
    desc: 'Langkokt lammeskank, hvitløkspoteter, rotsaker og kraft.',
    allergens: ['melk', 'selleri'], mayContain: [], diets: [], allergenStatus: 'verified',
    pairings: [{ drink: 'd-07', why: 'pinot noir til kraften' }, { drink: 'd-04', why: 'stout til det langkokte' }] },

  { id: 'r-11', name: 'Burger med cheddar og syltet løk', price: 275,
    desc: 'Kvernet høyrygg, cheddar, syltet rødløk, sennepsdressing, brioche.',
    allergens: ['gluten', 'melk', 'egg', 'sennep', 'sesam'], mayContain: [], diets: [], allergenStatus: 'verified',
    pairings: [{ drink: 'd-01', why: 'pils til burger, alltid' }, { drink: 'd-02', why: 'IPA mot cheddaren' }] },

  // The honest case: a daily special the kitchen hasn't signed off on yet. The
  // engine must refuse to make any allergen claim about this one.
  { id: 'r-12', name: 'Dagens fangst', price: 290,
    desc: 'Dagens fisk fra Fiskehallen — tilberedning varierer, spør personalet.',
    allergens: ['fisk'], mayContain: [], diets: [], allergenStatus: 'unverified',
    pairings: [{ drink: 'd-06', why: 'riesling til det meste av hvit fisk' }] },

  { id: 'r-13', name: 'Grønn risotto med parmesan', price: 265,
    desc: 'Risotto med erter, spinat, parmesan og sitronskall.',
    allergens: ['melk', 'selleri', 'sulfitt'], mayContain: [], diets: ['vegetar'], allergenStatus: 'verified',
    pairings: [{ drink: 'd-06', why: 'riesling mot parmesanen' }] },

  // The trace case: safe by ingredient, not safe by kitchen. Treated as contains
  // whenever the guest has flagged that allergen.
  { id: 'r-14', name: 'Sjokolade og havsalt', price: 145,
    desc: 'Mørk sjokoladekrem, havsalt og sprøtt kakebunn.',
    allergens: ['melk', 'egg', 'gluten'], mayContain: ['notter', 'peanotter'], diets: ['vegetar'], allergenStatus: 'verified',
    pairings: [{ drink: 'd-04', why: 'stout til mørk sjokolade' }] },
];

export const DRINKS = [
  { id: 'd-01', name: 'Brygge Pils',            kind: 'øl',          abv: 4.7, price: 109, allergens: ['gluten'] },
  { id: 'd-02', name: 'Nordvest IPA',           kind: 'øl',          abv: 6.2, price: 119, allergens: ['gluten'] },
  { id: 'd-03', name: 'Hveteøl fra Grünerløkka',kind: 'øl',          abv: 5.0, price: 115, allergens: ['gluten'] },
  { id: 'd-04', name: 'Havn Stout',             kind: 'øl',          abv: 7.0, price: 125, allergens: ['gluten'] },
  { id: 'd-05', name: 'Glutenfri Lager',        kind: 'øl',          abv: 4.5, price: 119, allergens: [] },
  { id: 'd-06', name: 'Riesling (glass)',       kind: 'vin',         abv: 11.5, price: 145, allergens: ['sulfitt'] },
  { id: 'd-07', name: 'Pinot Noir (glass)',     kind: 'vin',         abv: 13.0, price: 155, allergens: ['sulfitt'] },
  { id: 'd-08', name: 'Eplemost fra Hardanger', kind: 'alkoholfri',  abv: 0,   price: 65,  allergens: [] },
  { id: 'd-09', name: 'Alkoholfri pils',        kind: 'alkoholfri',  abv: 0.4, price: 85,  allergens: ['gluten'] },
  { id: 'd-10', name: 'Kombucha, bringebær',    kind: 'alkoholfri',  abv: 0,   price: 75,  allergens: [] },
];

export const dishById  = (id) => DISHES.find((d) => d.id === id);
export const drinkById = (id) => DRINKS.find((d) => d.id === id);
