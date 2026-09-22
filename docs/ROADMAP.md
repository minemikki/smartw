# Fra demo til solgt produkt

Ærlig status, og hva som faktisk må bygges. Skrevet fordi det som finnes nå **ikke kan selges**:
menyen er hardkodet i `lib/menu.js`, det finnes ingen kunder, ingen innlogging, og ingen måte for en
kjøkkensjef å legge inn en rett.

---

## Hva som finnes i dag

| Del | Status |
|---|---|
| Samtalemotor (uttrekk → filtrering → svar) | **Ferdig og testet.** Dette er den vanskelige tenkingen, og den er gjort. |
| Deterministisk allergenfiltrering | **Ferdig.** 14 allergener, spor behandlet som innhold, usignert data gir ingen påstand. |
| Vaktpost på modellens svar | **Ferdig.** Kaster setningen hvis en utelukket rett nevnes. |
| Dobbeltlesing av gjestens tekst | **Ferdig.** Ordstammer med unicode-ordgrense. |
| Testdekning på sikkerhetslogikken | **Ferdig.** 47 sjekker, kjører uten API-nøkkel. |
| Demoside | **Ferdig**, men viser én hardkodet meny. |
| Alt annet | **Finnes ikke.** |

Motoren er kanskje 15 % av produktet. Resten er det kjedelige, og det kjedelige er der pengene ligger.

---

## Minimum for å selge til én betalende kunde

Dette er baren. Ikke hele produktet — det minste som gjør at du kan ta imot 9 900 kr uten å love noe du
ikke kan holde.

### 1. Flerkunde-datalag
**Problem:** menyen er en `.js`-fil. Én fil = én kunde, og hver endring krever en deploy.

Trengs: `venue`, `menu_version`, `dish`, `drink`, `pairing`, `attestation`. En rett hører til en
menyversjon, aldri til lokalet direkte — ellers kan du ikke bevise hva som sto på menyen i forrige uke.

Valg: Postgres (Supabase eller Neon) — relasjonene er ekte, og du trenger versjonshistorikk og
revisjonsspor. Vercel Blob/KV holder ikke her; det er derfor StayMotion-kodebasen ikke er en mal for dette.

Lokalet identifiseres av URL (`/v/brygge-og-bord` eller eget subdomene), ikke av en hardkodet import.

### 2. Menyadmin — dette *er* produktet
Kjøkkensjefen redigerer ikke JavaScript. Uten dette finnes ikke produktet, bare demoen.

- Retter: navn, beskrivelse, pris, de 14 allergenene som avkryssing, «kan inneholde spor av», vegetar/vegansk
- Drikke og paringer
- Utkast vs. publisert. Endring i allergenfelt → **må attesteres på nytt før den går live**
- Versjonshistorikk: hvem endret hva, når
- Ett skjermbilde som viser «disse rettene mangler bekreftet allergeninfo» — det er den listen som
  faktisk får en kjøkkensjef til å fylle den ut

**Importflyten er der AI-en tjener sin plass:** lim inn menyen som PDF eller tekst, modellen foreslår
struktur og allergener, mennesket **retter og bekrefter hver rad**. Aldri auto-publisering av et
allergenfelt en modell har gjettet. Det sparer timer på onboarding og er forskjellen mellom at du bruker
én dag eller én time per kunde.

### 3. Attestering som juridisk artefakt
Dette er moaten, ikke en formalitet.

- Navngitt person + rolle + dato + menyversjon, lagret uforanderlig
- Eksporterbar PDF av den signerte allergenlisten — noe å legge fram for Mattilsynet
- Usignert versjon kan aldri gi et allergensvar. Koden håndhever det alt (`allergenStatus`), databasen må
  gjøre det samme

### 4. Innlogging
Magisk lenke på e-post er nok. Ett lokale = én konto, med mulighet for flere brukere senere.
Ikke bygg roller og tilganger nå.

### 5. Innbygging på kundens egen nettside
Kundene sitter på Wix, Squarespace, WordPress og StayMotion-sider. Trengs:
- `<script>`-snutt som åpner kelneren i et panel, eller en iframe
- Én lenke som virker alene (til QR-koder på bordene, hvis kunden vil det)
- QR-generering per bord er *valgfritt* — ikke bygg det før en kunde ber om det

### 6. Kostnadskontroll
Per lokale: takstgrense og månedlig token-budsjett, ellers kan én bot spise marginen på et abonnement.

Promptcaching er den store gevinsten her: systemprompten og menyblokken er stabile mellom alle gjester
på samme lokale, så de bør ligge bak et cache-brekkpunkt. Verifiser med `usage.cache_read_input_tokens` —
er den null mellom like forespørsler, er noe ustabilt i prefiksen.

**Må regnes ut før prisen settes:** kostnad per samtale × forventet antall samtaler per måned. Kommer den
nær 1 490 kr, er prisen feil, ikke kostnaden.

### 7. Logging og innsyn
Hver samtale lagres: spørsmål, uttrukne betingelser, hvilke retter som ble vist, om vaktposten slo inn,
om gjesten ble sendt til personalet.

To grunner: det er revisjonssporet ditt hvis noe går galt, **og** det er en funksjon kunden betaler for —
«dette spurte gjestene dine om i forrige måned» er den eneste rapporten en restauranteier faktisk leser.
Varsling til deg når vaktposten slår inn.

### 8. Hva som skjer når det svikter
Modellen kan være nede, treg, eller nekte. Da skal gjesten få den filtrerte menylisten rått — aldri en
blank skjerm og aldri en spinner som står. Koden har fallback-rendering alt; den må dekke API-feil og
tidsavbrudd også, ikke bare vaktposten.

### 9. Evalsett — før du selger, ikke etter
Det som gjør at du kan si «vi har testet det» uten å lyve.

50–100 realistiske gjestespørsmål med kjent riktig svar, som måler tre ting:
1. Fanget uttrekket allergenet? (inkludert feilstavinger, dialekt, engelsk, tysk)
2. Gjorde filteret det riktige?
3. Holdt svaret seg innenfor kandidatlisten?

Kjøres på hver promptendring. Uten dette vet du ikke om en «forbedring» gjorde det farligere.
De 47 enhetstestene dekker logikken — de dekker ikke om modellen forstår norsk.

---

## Det som ikke er kode

Like blokkerende, og lettere å glemme.

| Ting | Hvorfor |
|---|---|
| **Databehandleravtale** med hvert lokale | Du behandler gjestenes spørsmål på deres vegne. GDPR krever avtalen. Standardmal finnes. |
| **Personvernerklæring** for gjesten | Hva lagres, hvor lenge, hvorfor. Sett en kort sletteperiode på samtaler. |
| **Vilkår med tydelig ansvarsplassering** | Lokalet eier og garanterer allergendataene; du leverer filtreringen. Dette må en advokat se på. Ikke kopier en SaaS-mal. |
| **Ansvarsforsikring** | Snakk med forsikringsmegler om hva som dekkes hvis en gjest reagerer. Svaret påvirker om du bør selge dette i det hele tatt. |
| **Avklaring på alkoholloven § 9-2** | Drikkeanbefaling på forespørsel er sannsynligvis innenfor som produktinformasjon på salgsstedet, men få det bekreftet før det blir hovedfeaturen. |
| **Dokumenter hvorfor det ikke er et kassasystem** | Så lenge den ikke tar betaling, faller den utenfor kassasystemloven. Skriv ned begrunnelsen nå, mens det er sant. |

---

## Faser

**Fase 1 — pilot (baren over).** Én ekte restaurant, gratis eller sterkt rabattert, i bytte for å bruke
navnet. Målet er ikke inntekt, det er å oppdage hva du ikke visste. Regn med at menyvedlikehold viser seg
å være vanskeligere enn du tror.

**Fase 2 — selgbart.** Selvbetjent onboarding, PDF-import, flere lokaler per konto, gjesterapport,
fakturering. Først her er 9 900 + 1 490/mnd forsvarlig å ta imot fra noen du ikke kjenner.

**Fase 3 — hvis det funker.** Kasseintegrasjon, faktisk bestilling, flere lokaler/kjede. Ikke planlegg
denne nå; fase 1 kommer til å endre den.

---

## De tre risikoene som faktisk avgjør

1. **Menyvedlikehold.** Menyen endres ukentlig. Hvis kunden ikke gidder å oppdatere, forfaller produktet
   til feil data — som er verre enn ingen data når det gjelder allergener. Løsningen er sannsynligvis at
   *du* vedlikeholder den som en del av abonnementet, ikke kunden. Det endrer enheten: da selger du en
   tjeneste med marginal, ikke programvare som skalerer. Regn på det før du lover 1 490 kr.

2. **Spør gjestene i det hele tatt?** Hele produktet står på at gjester stiller sammensatte spørsmål.
   Det tror jeg, men jeg vet det ikke — og ingen mengde kode finner det ut. Logging i fase 1 gjør.

3. **Favrit shipper det samme.** De har 2 000 norske restauranter, menyen i kassa og betalingen i appen.
   Kommer de først, konkurrerer du på noe de har distribusjon på. Forspranget ditt er attesteringen og
   den strukturerte allergendataen — ikke chatten. Bygg dypt der, ikke bredt.

---

## Rekkefølge jeg ville tatt det i

1. **Snakk med tre restauranter først.** Vis demoen på deres egen meny (hardkod den manuelt — det tar en
   time og krever ingenting av dette dokumentet). Spør: vil gjestene deres bruke dette, og vil du
   vedlikeholde menyen?
2. Er svaret nei → du har spart måneder.
3. Er svaret ja → datalag og menyadmin, i den rekkefølgen. Ingenting annet betyr noe før en kjøkkensjef
   har lagt inn sin egen meny uten at du satt ved siden av.
