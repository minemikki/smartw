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

## Kjøre lokalt

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npx vercel dev            # eller hvilken som helst statisk server + serverless-runtime
```

Uten `ANTHROPIC_API_KEY` svarer `/api/waiter` med 503, og demosiden sier det.

## Tester

```bash
npm test
```

Begge suitene kjører **uten API-nøkkel og uten nett**:

- `tools/check.mjs` — sikkerhetslogikken isolert: ordstammene, prisuttrekk, filtervedtakene,
  vaktposten, at usignerte retter ikke får en allergenpåstand.
- `tools/smoke.mjs` — hele kjeden gjennom API-handleren med HTTP-laget stubbet, inkludert at
  vaktposten faktisk slår inn når modellen nevner en utelukket rett.

## Filer

| Fil | Rolle |
|---|---|
| `lib/menu.js` | Menydata + de 14 allergenene. Datastrukturen *er* produktspesifikasjonen: står ikke et faktum her, kan ikke modellen påstå det. |
| `lib/waiter.js` | Motoren — uttrekk, dobbeltlesing, filtrering, vaktpost, sikkerhetslinje. |
| `api/waiter.js` | `POST /api/waiter` — to modellkall med deterministisk filtrering imellom. |
| `index.html` | Demosiden. Innsynspanelet viser hvilke retter som ble luket ut og hvorfor. |

Modell: `claude-opus-5`, `effort: low` på begge kall (~2–4 s svartid — verdt å måle mot ekte gjester).

## Det harde problemet, for ordens skyld

AI-laget er en ettermiddags arbeid. Jobben er **menydataene**: pris, full ingrediensliste, alle 14
allergener per rett, drikkeparinger — og at det holdes oppdatert når menyen endres ukentlig. Norske
restauranter har dette i en PDF og i hodet til kjøkkensjefen. Den som løser datainnsamlingen eier
produktet; resten er en demo.
