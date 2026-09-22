// Seed data for the demo venue — a fictional restaurant, deliberately not a real
// client: putting invented allergen data under a real venue's name is exactly
// the mistake this product exists to prevent.
//
// Shape matches what store.publishMenu() takes, which is also what the admin UI
// will submit. 'unverified' on a dish means the kitchen has not signed off on
// its allergen data; the engine then makes no allergen claim about it.

export const DEMO_VENUE = {
  "slug": "brygge-og-bord",
  "name": "Brygge & Bord",
  "city": "Oslo",
  "tone": "nordisk, uformelt, kortreiste råvarer"
};

export const DEMO_ATTESTATION = {
  byName: 'Ingrid Hauge',
  byRole: 'Kjøkkensjef, Brygge & Bord',
  statement: 'Jeg bekrefter at allergeninformasjonen i denne menyversjonen er gjennomgått og stemmer.',
  signedAt: '2026-09-18T09:00:00Z',
};

export const DEMO_LABEL = 'meny-2026-09-18';

export const DEMO_DISHES = [
  {
    "ref": "r-01",
    "name": "Kamskjell, jordskokk og brunet smør",
    "desc": "Pannestekte kamskjell, puré av jordskokk, brunet smør og sitron.",
    "price": 245,
    "allergens": [
      "blotdyr",
      "melk"
    ],
    "mayContain": [],
    "diets": [],
    "allergenStatus": "verified",
    "pairings": [
      {
        "drink": "d-06",
        "why": "syrlig riesling mot det søte i kamskjellet"
      },
      {
        "drink": "d-03",
        "why": "hveteøl tar brunet smør uten å overdøve"
      }
    ]
  },
  {
    "ref": "r-02",
    "name": "Kveite med syltet fennikel",
    "desc": "Smørstekt kveite, syltet fennikel, dillolje og nypoteter.",
    "price": 315,
    "allergens": [
      "fisk",
      "melk",
      "sulfitt"
    ],
    "mayContain": [],
    "diets": [],
    "allergenStatus": "verified",
    "pairings": [
      {
        "drink": "d-06",
        "why": "klassisk til hvit fisk"
      },
      {
        "drink": "d-05",
        "why": "glutenfri lager, nøytral og kald"
      }
    ]
  },
  {
    "ref": "r-03",
    "name": "Satay av kylling med agurksalat",
    "desc": "Grillet kyllingspyd i peanøttsaus, agurksalat og ristet sesam.",
    "price": 265,
    "allergens": [
      "peanotter",
      "soya",
      "sesam"
    ],
    "mayContain": [],
    "diets": [],
    "allergenStatus": "verified",
    "pairings": [
      {
        "drink": "d-02",
        "why": "IPA-bitterhet mot søt peanøttsaus"
      }
    ]
  },
  {
    "ref": "r-04",
    "name": "Entrecôte, pommes anna og peppersaus",
    "desc": "Entrecôte fra Grøndalen gård, pommes anna og grønn pepper.",
    "price": 395,
    "allergens": [
      "melk"
    ],
    "mayContain": [],
    "diets": [],
    "allergenStatus": "verified",
    "pairings": [
      {
        "drink": "d-07",
        "why": "pinot noir har nok syre til fettet"
      },
      {
        "drink": "d-04",
        "why": "stout mot stekeskorpen"
      }
    ]
  },
  {
    "ref": "r-05",
    "name": "Ovnsbakte rotgrønnsaker med hasselnøttkrem",
    "desc": "Gulrot, persillerot og pastinakk, krem av hasselnøtt, urteolje.",
    "price": 255,
    "allergens": [
      "notter",
      "melk"
    ],
    "mayContain": [],
    "diets": [
      "vegetar"
    ],
    "allergenStatus": "verified",
    "pairings": [
      {
        "drink": "d-03",
        "why": "hveteøl mot det søte i rotgrønnsakene"
      }
    ]
  },
  {
    "ref": "r-06",
    "name": "Fiskesuppe fra Hitra",
    "desc": "Kremet fiskesuppe med torsk, reker, gulrot og sellerirot.",
    "price": 235,
    "allergens": [
      "fisk",
      "melk",
      "skalldyr",
      "selleri"
    ],
    "mayContain": [],
    "diets": [],
    "allergenStatus": "verified",
    "pairings": [
      {
        "drink": "d-06",
        "why": "riesling kutter kremen"
      }
    ]
  },
  {
    "ref": "r-07",
    "name": "Pasta med tomat, basilikum og chili",
    "desc": "Fersk pasta, langkokt tomat, basilikum og litt chili.",
    "price": 225,
    "allergens": [
      "gluten",
      "egg"
    ],
    "mayContain": [],
    "diets": [
      "vegetar"
    ],
    "allergenStatus": "verified",
    "pairings": [
      {
        "drink": "d-01",
        "why": "pils er nøytral mot chili"
      },
      {
        "drink": "d-08",
        "why": "eplemost uten alkohol"
      }
    ]
  },
  {
    "ref": "r-08",
    "name": "Kylling med urtesmør og knuste poteter",
    "desc": "Helstekt kyllingbryst, urtesmør, knuste poteter og stekesjy.",
    "price": 285,
    "allergens": [
      "melk"
    ],
    "mayContain": [],
    "diets": [],
    "allergenStatus": "verified",
    "pairings": [
      {
        "drink": "d-01",
        "why": "lokal pils, enkel og tørst"
      },
      {
        "drink": "d-07",
        "why": "pinot noir til urtesmøret"
      }
    ]
  },
  {
    "ref": "r-09",
    "name": "Ovnsbakt blomkål med tahinikrem",
    "desc": "Hel blomkål bakt i ovn, tahinikrem, granateple og persille.",
    "price": 240,
    "allergens": [
      "sesam"
    ],
    "mayContain": [],
    "diets": [
      "vegetar",
      "vegansk"
    ],
    "allergenStatus": "verified",
    "pairings": [
      {
        "drink": "d-05",
        "why": "glutenfri lager, lett og kald"
      },
      {
        "drink": "d-10",
        "why": "kombucha til det nøttete i tahini"
      }
    ]
  },
  {
    "ref": "r-10",
    "name": "Lammeskank med hvitløkspoteter",
    "desc": "Langkokt lammeskank, hvitløkspoteter, rotsaker og kraft.",
    "price": 340,
    "allergens": [
      "melk",
      "selleri"
    ],
    "mayContain": [],
    "diets": [],
    "allergenStatus": "verified",
    "pairings": [
      {
        "drink": "d-07",
        "why": "pinot noir til kraften"
      },
      {
        "drink": "d-04",
        "why": "stout til det langkokte"
      }
    ]
  },
  {
    "ref": "r-11",
    "name": "Burger med cheddar og syltet løk",
    "desc": "Kvernet høyrygg, cheddar, syltet rødløk, sennepsdressing, brioche.",
    "price": 275,
    "allergens": [
      "gluten",
      "melk",
      "egg",
      "sennep",
      "sesam"
    ],
    "mayContain": [],
    "diets": [],
    "allergenStatus": "verified",
    "pairings": [
      {
        "drink": "d-01",
        "why": "pils til burger, alltid"
      },
      {
        "drink": "d-02",
        "why": "IPA mot cheddaren"
      }
    ]
  },
  {
    "ref": "r-12",
    "name": "Dagens fangst",
    "desc": "Dagens fisk fra Fiskehallen — tilberedning varierer, spør personalet.",
    "price": 290,
    "allergens": [
      "fisk"
    ],
    "mayContain": [],
    "diets": [],
    "allergenStatus": "unverified",
    "pairings": [
      {
        "drink": "d-06",
        "why": "riesling til det meste av hvit fisk"
      }
    ]
  },
  {
    "ref": "r-13",
    "name": "Grønn risotto med parmesan",
    "desc": "Risotto med erter, spinat, parmesan og sitronskall.",
    "price": 265,
    "allergens": [
      "melk",
      "selleri",
      "sulfitt"
    ],
    "mayContain": [],
    "diets": [
      "vegetar"
    ],
    "allergenStatus": "verified",
    "pairings": [
      {
        "drink": "d-06",
        "why": "riesling mot parmesanen"
      }
    ]
  },
  {
    "ref": "r-14",
    "name": "Sjokolade og havsalt",
    "desc": "Mørk sjokoladekrem, havsalt og sprøtt kakebunn.",
    "price": 145,
    "allergens": [
      "melk",
      "egg",
      "gluten"
    ],
    "mayContain": [
      "notter",
      "peanotter"
    ],
    "diets": [
      "vegetar"
    ],
    "allergenStatus": "verified",
    "pairings": [
      {
        "drink": "d-04",
        "why": "stout til mørk sjokolade"
      }
    ]
  }
];

export const DEMO_DRINKS = [
  {
    "ref": "d-01",
    "name": "Brygge Pils",
    "kind": "øl",
    "abv": 4.7,
    "price": 109,
    "allergens": [
      "gluten"
    ]
  },
  {
    "ref": "d-02",
    "name": "Nordvest IPA",
    "kind": "øl",
    "abv": 6.2,
    "price": 119,
    "allergens": [
      "gluten"
    ]
  },
  {
    "ref": "d-03",
    "name": "Hveteøl fra Grünerløkka",
    "kind": "øl",
    "abv": 5,
    "price": 115,
    "allergens": [
      "gluten"
    ]
  },
  {
    "ref": "d-04",
    "name": "Havn Stout",
    "kind": "øl",
    "abv": 7,
    "price": 125,
    "allergens": [
      "gluten"
    ]
  },
  {
    "ref": "d-05",
    "name": "Glutenfri Lager",
    "kind": "øl",
    "abv": 4.5,
    "price": 119,
    "allergens": []
  },
  {
    "ref": "d-06",
    "name": "Riesling (glass)",
    "kind": "vin",
    "abv": 11.5,
    "price": 145,
    "allergens": [
      "sulfitt"
    ]
  },
  {
    "ref": "d-07",
    "name": "Pinot Noir (glass)",
    "kind": "vin",
    "abv": 13,
    "price": 155,
    "allergens": [
      "sulfitt"
    ]
  },
  {
    "ref": "d-08",
    "name": "Eplemost fra Hardanger",
    "kind": "alkoholfri",
    "abv": 0,
    "price": 65,
    "allergens": []
  },
  {
    "ref": "d-09",
    "name": "Alkoholfri pils",
    "kind": "alkoholfri",
    "abv": 0.4,
    "price": 85,
    "allergens": [
      "gluten"
    ]
  },
  {
    "ref": "d-10",
    "name": "Kombucha, bringebær",
    "kind": "alkoholfri",
    "abv": 0,
    "price": 75,
    "allergens": []
  }
];
