# Samenwerkingsplatform Merwede Utrecht — v1 (09-09-2026)

Los online platform van Schraven BV om met de opdrachtgever en de leverancier samen te werken: bestanden (ook grote, ook DWG) met versies en een logboek per bestand, opmerkingen, actiepunten, afspraken/besluiten, mail-log en een kleine planning met balkenschema.

- **Twee gescheiden ruimtes**: *Opdrachtgever ↔ Schraven* en *Schraven ↔ Leverancier*. Schraven ziet en wisselt tussen beide; externen zien alleen hun eigen ruimte (afgedwongen in de database, niet alleen in het scherm).
- **Rollen**: Schraven (alles, incl. verwijderen, planning bewerken, gebruikers beheren) · Opdrachtgever · Leverancier (uploaden, opmerkingen, actiepunten, afspraken, mail loggen, status van bestanden zetten; niets verwijderen).
- **Opslag**: Supabase (EU/Frankfurt) + automatisch een kopie naar jouw Dropbox.

## Wat staat waar
| Dienst | Naam | Gebruik |
|---|---|---|
| Supabase | project **utrecht-samenwerk** (`nfjhtvrhdqejustcpvmm`, Frankfurt, $10/mnd) | database, logins, bestandsopslag (bucket `bestanden`) |
| GitHub | nieuwe repo, bijv. `utrecht-samenwerk` | code (deze zip) |
| Vercel | nieuw project gekoppeld aan die repo | de website + serverfuncties (`/api/...`) |
| Dropbox | map naar keuze, bijv. `/werk/Merwede Utrecht/05 Samenwerking` | archiefkopie van alle bestanden |

## Stappenplan (eenmalig)

### 1. Code online zetten
1. Maak op GitHub een nieuwe repo (bijv. `utrecht-samenwerk`) en upload de inhoud van deze zip (alle bestanden, incl. de mappen `api/` en `lib/`).
2. Vercel → *Add New Project* → kies die repo → Framework "Other" → Deploy. Je krijgt een adres als `https://utrecht-samenwerk.vercel.app`.

### 2. Sleutels in Vercel zetten (Settings → Environment Variables)
Nooit in de code of via chat — alleen hier plakken. Na het toevoegen: *Deployments → Redeploy*.

| Variabele | Waarde | Waar te vinden |
|---|---|---|
| `SUPABASE_URL` | `https://nfjhtvrhdqejustcpvmm.supabase.co` | vast |
| `SUPABASE_SERVICE_KEY` | de **service_role**-sleutel (geheim!) | Supabase → project utrecht-samenwerk → Project Settings → API Keys |
| `MAIL_IN_TOKEN` | zelf verzinnen, lang en willekeurig (bijv. 30 tekens) | — |
| `SCHRAVEN_DOMEINEN` | `kozijnenglas.nl,schraven.nl` (jullie eigen maildomeinen) | bepaalt "verstuurd" vs "ontvangen" |
| `CRON_SECRET` | zelf verzinnen (lang en willekeurig) | beveiligt de nachtelijke Dropbox-ronde |
| `DROPBOX_APP_KEY` / `DROPBOX_APP_SECRET` | van je Dropbox-app (mag dezelfde app als BouwProject Pro: `5fxzk46ezx2wac3`) | Dropbox App Console → Settings |
| `DROPBOX_MAP` | bijv. `/werk/Merwede Utrecht/05 Samenwerking` | map in jouw Dropbox waar de kopieën komen |
| `DROPBOX_REFRESH_TOKEN` | komt uit stap 4 | — |
| `RESEND_API_KEY` | alleen als je Resend gebruikt voor het BCC-adres (stap 5) | resend.com → API Keys |

### 3. Jouw eigen login
Supabase → Authentication → Users → **Add user** → e-mail `kozijnenglas@gmail.com` + wachtwoord, *Auto Confirm* aan. Dit adres wordt automatisch Schraven-beheerder. Daarna inloggen op de site en via **Team** de anderen aanmaken (naam, bedrijf, e-mail, rol, wachtwoord — je geeft het wachtwoord persoonlijk door; zij kunnen het zelf wijzigen via "Wachtwoord vergeten").

Wil je een 2e Schraven-account (bijv. Cella)? Ook via Team, rol "Schraven".

### 4. Dropbox koppelen (kopie van alle bestanden)
1. Dropbox App Console → jouw app → Settings → OAuth 2 → Redirect URIs: voeg toe `https://<jouw-site>.vercel.app/api/dropbox-koppelen`.
2. Zet `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET` en `DROPBOX_MAP` in Vercel en redeploy.
3. Open `https://<jouw-site>.vercel.app/api/dropbox-koppelen` → klik *Koppel met Dropbox* → je krijgt een lange code (refresh token).
4. Plak die in Vercel als `DROPBOX_REFRESH_TOKEN` → redeploy. Vanaf dan gaat elk geüpload bestand direct óók naar Dropbox (`<DROPBOX_MAP>/1 Opdrachtgever/<map>/bestand.ext`, nieuwe versies als `bestand (v2).ext`). Elke nacht om 02:00 loopt er een controleronde die vergeten kopieën alsnog maakt.

### 5. BCC-adres voor de mail-log
Handmatig loggen werkt meteen (Mail → *+ Mail loggen*, bijlagen erbij). Voor automatisch loggen zet je een mail-ontvangdienst op die inkomende mail als bericht naar `https://<jouw-site>.vercel.app/api/mail-in?token=<MAIL_IN_TOKEN>` stuurt.

Aanbevolen: **Resend** (gratis pakket) met een subdomein, bijv. `log.kozijnenglas.nl`:
1. resend.com → Domains → subdomein `log.kozijnenglas.nl` toevoegen → de MX/TXT-records bij TransIP zetten (Resend toont ze).
2. Resend → Webhooks → *Add* → URL hierboven, event `email.received`.
3. Zet `RESEND_API_KEY` in Vercel, redeploy.
4. Zet voortaan in BCC: `utrecht@log.kozijnenglas.nl` (opdrachtgever-ruimte) of `utrecht-lev@log.kozijnenglas.nl` (leverancier-ruimte; alles met "lev" in het adres komt in de leverancier-ruimte). Bijlagen komen mee. Verkeerd terechtgekomen? In de app kan Schraven een mail naar de andere ruimte verplaatsen.

Andere diensten (Postmark, CloudMailin, Zapier/Make "inbound mail") werken ook: dezelfde URL, mail als JSON met base64-bijlagen.

### 6. Grote bestanden (60 MB+)
Uploads gaan in stukken en hervatten vanzelf bij een hapering. Zet in Supabase → Storage → Settings de **Global file size limit** op bijv. 1 GB (staat standaard op 50 MB). De bucket zelf staat al op 1 GB per bestand.

## Dagelijks gebruik (kort)
- **Overzicht**: tellers, laatste activiteit, deadlines, mijlpalen, bestanden ter controle.
- **Bestanden**: mappen, slepen/uploaden, per bestand een lade met status (Nieuw → Ter controle → Goedgekeurd/Afgekeurd → Definitief), versies (download per versie), nieuwe versie uploaden (status springt automatisch naar "Ter controle"), en het **logboek + opmerkingen** per bestand. DWG's: downloaden, in CAD aanpassen, als nieuwe versie terugzetten — alles blijft bij elkaar.
- **Actiepunten**: genummerd, verantwoordelijke (gebruiker of vrije naam), deadline (rood als te laat), prioriteit, status via de lijst; filters Open / Voor mij / Afgerond / Alles.
- **Afspraken**: overleg, afspraak of besluit met datum en tekst; vanuit een afspraak direct actiepunten maken (blijven gekoppeld).
- **Mail**: automatisch (BCC) of handmatig; vanuit een mail een actiepunt maken.
- **Planning**: balkenschema per week, groepen/fases, mijlpalen, voortgang, in/uitzoomen, printen (A3 liggend werkt het best). Alleen Schraven bewerkt; iedereen kan er opmerkingen bij zetten.
- **Team/Contacten**: Schraven beheert accounts; externen zien de contactgegevens van hun ruimte.
- Wijzigingen van anderen verschijnen live (binnen een seconde) zonder verversen.
- Licht/donker via ◐.

## Techniek (voor later inschuiven in BouwProject Pro)
Zelfde fundament: statische site + Supabase (tabellen `profielen, bestanden, bestand_versies, bestand_log, opmerkingen, acties, afspraken, mails, planning`, RLS op `ruimte`) + Vercel-functies (`api/gebruikers.js`, `api/mail-in.js`, `api/dropbox.js`, `api/dropbox-koppelen.js`). Tests: `tests/test_v1.js` (Playwright, 87 controles, tegen een nagebootste Supabase in `tests/mock.js`); de database-beveiliging is apart met SQL getest.

Niet in de sandbox te testen (Koen test): echte Supabase-verbinding vanuit de browser, echte Dropbox-kopie, echte BCC-webhook. Bij problemen: Vercel → project → Logs.
