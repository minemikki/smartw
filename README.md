# Smartwaiter

AI-kelner for restauranter. Gjesten spør fritt — «en rett til 300 kr, men jeg har allergi mot
peanøtter, og hvilken øl passer?» — og får ett svar. Tre betingelser i én setning; ingen filterknapp
løser det.

*Arbeidsnavn. Demo med oppdiktet restaurant og oppdiktet meny.*

## Modellen gjør språk. Koden gjør sikkerhet.

Rekkefølgen er hele produktet. En språkmodell som selv vurderer om en rett er peanøttfri er ikke en
funksjon — det er et erstatningsansvar. Derfor avgjøres alt gjesten kan bli skadet av i kode, før
modellen får si et ord:

1. **`extractConstraints`** — fritekst → allergener, prisramme, språk, om drikke ble etterspurt
   (structured output).
2. **`detectAllergens`** — koden leser samme setning uavhengig, med unicode-bevisste ordstammer på
   ordgrense. `pean` treffer «peanøtter», «peanætter», «peanut» og «peanøttolje»; ordgrensen hindrer
   at `ost` fyrer på «koster». De to lesingene unioneres, **alltid i strengeste retning** — en
   restriksjon modellen overså blir likevel håndhevet.
3. **`filterMenu`** — kode, aldri modellen, fjerner allergenkonflikt, «kan inneholde spor av», og alt
   kjøkkenet ikke har signert (`allergenStatus`). Modellen får aldri se de rettene.
4. **`guardReply`** — nevner svaret likevel en utelukket rett, forkastes setningen og gjesten får den
   filtrerte listen rått. En instruks er ikke en garanti.
5. **`safetyLine`** — sikkerhetsformuleringen skrives av koden på hvert svar der en restriksjon var i
   spill, ikke av modellen.

## Regelverket det er bygget rundt

| Krav | Hvordan det er håndtert |
|---|---|
| **Matinformasjonsforskriften** — de 14 allergenene skal oppgis korrekt | Allergenfeltene er versjonert og attestert av en navngitt person på huset (`RESTAURANT.attestation`). Retter uten bekreftet data anbefales ikke — de sendes til personalet. |
| **Alkoholloven § 9-2** — markedsføring av alkohol | Drikke returneres bare når gjesten selv spør. Aldri uoppfordret oppsalg. Skjenke- og aldersansvar ligger hos personalet. |
| **Spor og krysskontaminering** | «Kan inneholde spor av» behandles identisk med «inneholder» så snart gjesten har flagget allergenet. |

## Datalag

En rett hører til en **menyversjon**, aldri til lokalet direkte — ellers kan du ikke svare på hva menyen
sa i forrige uke, som er det eneste spørsmålet som betyr noe hvis en gjest reagerer.

En **publisert menyversjon er uforanderlig.** Redigering lager en ny versjon. Det er det som gjør
attesteringen sann: signaturen dekker rader som ikke kan endres under den. Ved publisering hashes
allergendataene (`lib/digest.js`), og hashen sjekkes på nytt **hver gang** menyen lastes. Stemmer den
ikke — eller mangler signaturen — nedgraderes *alle* retter til `unverified`, og kelneren gir ingen
allergenpåstand i det hele tatt.

To backender bak samme API (`lib/store.js`): **Postgres** når `DATABASE_URL` er satt, ellers en
**filbasert** for utvikling og test. Lesestien er identisk, så motoren vet ikke hvilken den fikk.

```bash
psql "$DATABASE_URL" -f db/schema.sql   # bare for Postgres
node db/seed.mjs                        # publiserer demomenyen
```

## Kjøre lokalt

```bash
npm install
node db/seed.mjs                        # uten DATABASE_URL: skriver .data/store.json
export ANTHROPIC_API_KEY=sk-ant-...
npx vercel dev
```

Åpne `/?venue=brygge-og-bord`. Én installasjon betjener mange lokaler; slug'en velger menyen.

**Uten `ANTHROPIC_API_KEY`, eller når modellen er utilgjengelig,** svarer endepunktet fortsatt: gjestens
egne ord leses med ordstammene, koden filtrerer menyen på akkurat samme måte, og svaret blir den filtrerte
listen rått i stedet for en setning. Aldri blank skjerm, og aldri en ufiltrert meny.

## Tester

```bash
npm test
```

Begge suitene kjører **uten API-nøkkel og uten nett**:

- `tools/check.mjs` — sikkerhetslogikken isolert: ordstammene, prisuttrekk, filtervedtakene,
  vaktposten, at usignerte retter ikke får en allergenpåstand.
- `tools/smoke.mjs` — hele kjeden gjennom API-handleren mot et ekte (midlertidig) lager med HTTP-laget
  stubbet: vaktposten som slår inn, degradert modus når modellen er nede, at ukjent lokale gir 404, og at
  samtaleloggen faktisk skrives.

## Filer

| Fil | Rolle |
|---|---|
| `lib/allergens.js` | De 14 allergenene + ordstammene som leser gjestens egne ord. Ren modul, ingen menydata. |
| `lib/digest.js` | Hashen som gjør attesteringen verifiserbar i stedet for dekorativ. |
| `lib/store.js` | Lagring. Postgres eller fil, samme API. Lesestien håndhever attesteringen. |
| `lib/waiter.js` | Motoren — uttrekk, dobbeltlesing, filtrering, vaktpost, sikkerhetslinje. Tar `menu` som argument, så én installasjon betjener mange lokaler. |
| `api/waiter.js` | `POST /api/waiter { venue, messages }` — to modellkall med deterministisk filtrering imellom, og degradert modus når modellen svikter. |
| `db/schema.sql` | Skjemaet. Attesteringer er insert-only, håndhevet med regler i databasen. |
| `index.html` | Demosiden. Innsynspanelet viser hvilke retter som ble luket ut og hvorfor. |

Modell: `claude-opus-5`, `effort: low` på begge kall (~2–4 s svartid — verdt å måle mot ekte gjester).

## Det harde problemet, for ordens skyld

AI-laget er en ettermiddags arbeid. Jobben er **menydataene**: pris, full ingrediensliste, alle 14
allergener per rett, drikkeparinger — og at det holdes oppdatert når menyen endres ukentlig. Norske
restauranter har dette i en PDF og i hodet til kjøkkensjefen. Den som løser datainnsamlingen eier
produktet; resten er en demo.
