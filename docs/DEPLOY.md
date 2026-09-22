# Deploy — få den testbar på en URL

Appen er ikke deployet noe sted ennå. Dette er stegene, og de tar rundt tjue minutter.

**Én ting du ikke kan hoppe over: Bordvert krever Postgres i produksjon.** Fil-lageret skriver til disk,
og på Vercel er filsystemet skrivebeskyttet bortsett fra `/tmp`, som er per-instans og forsvinner. Uten
`DATABASE_URL` kaster appen en tydelig feil i stedet for å se ut som den virker og miste alt du taster inn.

## 1. Database

Gratis nivå holder langt forbi første pilotkunde. [Neon](https://neon.tech) eller
[Supabase](https://supabase.com) — begge gir deg en `postgresql://…`-streng. Vercel Postgres virker også.

```bash
export DATABASE_URL="postgresql://…"    # fra leverandøren
npm run migrate                          # legger inn db/schema.sql
npm run seed                             # demomeny + admin-bruker
```

`migrate` sjekker først om skjemaet finnes, så den er trygg å kjøre to ganger.

Vil du ha ditt eget navn som admin-bruker: `SEED_EMAIL=deg@domene.no npm run seed`.

## 2. Vercel

1. [vercel.com/new](https://vercel.com/new) → importer `minemikki/smartw`.
2. Framework: **Other**. Ingen build-kommando, ingen output-katalog — det er statiske filer pluss
   funksjoner i `api/`.
3. Legg inn miljøvariablene under, så **Deploy**.

| Variabel | Påkrevd | Hva |
|---|---|---|
| `DATABASE_URL` | **ja** | Postgres-strengen fra steg 1 |
| `SESSION_SECRET` | **ja** | Minst 24 tegn. `openssl rand -base64 32` |
| `ANTHROPIC_API_KEY` | nei | Uten den kjører kelneren i degradert modus: koden filtrerer menyen alene og svarer med den filtrerte listen i stedet for en setning |
| `PUBLIC_BASE_URL` | nei | Settes til ditt endelige domene, ellers utledes innloggingslenken fra `Host`-headeren |
| `RESEND_API_KEY` | nei | Uten den skrives den magiske lenken til Vercel-loggen i stedet for å sendes på e-post |
| `MAIL_FROM` | nei | Avsender, f.eks. `Bordvert <ingen-svar@dittdomene.no>`. Krever verifisert domene i Resend |

## 3. Test at det virker

- **Gjesten:** `https://<ditt-domene>/?venue=brygge-og-bord`
- **Admin:** `https://<ditt-domene>/admin.html` — logg inn med adressen du seedet.
  Uten `RESEND_API_KEY` finner du lenken i Vercel → Logs.

Spør kelneren om noe sammensatt: *«en rett til 300 kr, men jeg har allergi mot peanøtter — og hvilken øl
passer?»* Panelet til høyre viser hvilke retter koden luket ut og hvorfor.

## Før en ekte restaurant bruker den

Dette er en pilotoppsett, ikke et ferdig produkt. Se `docs/ROADMAP.md` for hele listen. Det som er
blokkerende her:

- **Slett demomenyen.** `brygge-og-bord` er en oppdiktet restaurant med oppdiktede allergendata. Den skal
  ikke ligge på et domene en ekte gjest kan nå.
- **Kostnadstak.** Det finnes ingen månedlig token-grense per lokale ennå. Sett et utgiftstak i
  Anthropic-konsollen før noen kan spørre fritt.
- **Databehandleravtale og personvernerklæring.** Du behandler gjestenes spørsmål på restaurantens vegne,
  og samtalene lagres i `conversation`-tabellen. Sett en sletteperiode og skriv den ned.
- **Egen database per miljø.** Ikke la preview-deployer skrive i samme database som produksjon.

## Kjøre lokalt i stedet

```bash
npm install
npm run seed                                       # uten DATABASE_URL: .data/store.json
SESSION_SECRET=$(openssl rand -base64 32) npm run dev
```

Gjesten på `localhost:4340/?venue=brygge-og-bord`, admin på `localhost:4340/admin.html`.
Innloggingslenken skrives i terminalen.
