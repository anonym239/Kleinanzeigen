# Flohmarkt-Finder

Findet **Flohmärkte, Hof- und Garagenflohmärkte, Haushaltsauflösungen, Trödelmärkte und Kinderbasare** in der Nähe.
Die App läuft auf dem eigenen Homeserver und ist auf dem Handy und am PC gut bedienbar. Man braucht **keinen API-Key**.

## Was die App kann

- **Zeitraum mit einem Tipp**: Heute · Dieses Wochenende · Nächstes Wochenende · Nächste 14 Tage · Alle
- **Nur Samstag & Sonntag** als zusätzlicher Filter
- **Umkreis-Filter** (Standard 50 km) um den eigenen Wohnort (PLZ oder Ort), mit Entfernung in km; innerhalb eines Tages steht das Nächstgelegene oben
- **Kategorien** mit Farben: **Dorf-Flohmärkte** und **Straßen-Flohmärkte** (als „★ Top-Tipp“ gold hervorgehoben, stehen je Tag oben), Flohmarkt, Hof- & Garagenflohmarkt, Haushaltsauflösung, Kinder & Basar, Trödel- & Antikmarkt
- **Suche** im Text, z.B. „Werkzeug“ oder „Schallplatten“
- **Firmen-Werbung ausblenden**: Anzeigen von Entrümpelungsfirmen, Ankäufern und Gesuchen werden erkannt und standardmäßig versteckt
- **Liste nach Tagen sortiert** oder **Karte** (OpenStreetMap). Auf großen Bildschirmen stehen Liste und Karte nebeneinander
- **Merken** (Favoriten), **Ausblenden**, **eigene Notizen** zu jedem Termin
- **Route** in Google Maps, **In den Kalender** (.ics), **Teilen** (z.B. per WhatsApp)
- **Kalender-Abo** aller gemerkten Termine (Adresse steht in den Einstellungen)
- **Selbst Termine eintragen**, z.B. aus der Zeitung oder vom Aushang
- **„NEU“-Markierung** für Termine, die seit dem letzten Besuch dazugekommen sind
- **Große Schrift** und **dunkles Design** umschaltbar
- **Als App installierbar** (auf dem Handy im Browser-Menü „Zum Startbildschirm hinzufügen“)
- Sucht **automatisch alle 3 Stunden** nach neuen Terminen (einstellbar)

## Woher kommen die Termine?

| Quelle | Was | Wie |
|---|---|---|
| **Kleinanzeigen.de** (früher eBay Kleinanzeigen) | Haushaltsauflösungen, Hof- und Garagenflohmärkte von Privatleuten | normale Suchseite im Umkreis, Datum wird aus dem Anzeigentext erkannt |
| **krencky24.de** / **meine-flohmarkt-termine.de** | Floh-, Trödel-, Antik- und Kinderflohmärkte mit festem Termin | Terminkalender der PLZ-Gebiete im Umkreis |
| **KÄNGURU** (nur Region Köln/Bonn) | Kinderflohmärkte und Basare | Terminkalender |
| **eigene Einträge** | z.B. aus der Zeitung | Knopf „Termin eintragen“ |

Alles ohne API-Key und kostenlos. **Einzelartikel werden aussortiert**: Anzeigen wie „Vase aus Haushaltsauflösung 5 €“,
„Trödel Flohmarkt Konvolut 10 €“ oder „iPhone wegen Umzug“ erscheinen nicht, nur echte Termine/Verkäufe vor Ort.
Werbung von Entrümpelungsfirmen und Ankäufern ist standardmäßig ausgeblendet (Filter „Firmen-Werbung“).

Auf **eBay.de** selbst gibt es keine Haushaltsauflösungs-Termine, nur einzelne Artikel. Deshalb wird eBay nicht durchsucht.
markt.de lädt seine Anzeigen erst im Browser per JavaScript nach und lässt sich deshalb nicht einfach auslesen.

## Variante 1: Ohne eigenen Server (Netlify, empfohlen)

**So funktioniert es:** GitHub Actions sucht alle 3 Stunden nach neuen Terminen (kostenlos) und legt die fertige
Webseite in den Branch **`live`**. Netlify ist mit diesem Branch verknüpft und veröffentlicht jede Änderung
automatisch. Netlify muss nichts bauen und verbraucht deshalb keine Build-Minuten.

**Einmalig einrichten (bei Netlify):**

1. Auf https://app.netlify.com anmelden → **„Add new site“ → „Import an existing project“ → „GitHub“**.
2. Repository **anonym239/Kleinanzeigen** auswählen.
3. **Branch to deploy: `live`**. „Build command“ leer lassen, „Publish directory“ leer lassen (bzw. `.`).
4. **„Deploy“** klicken. Die Adresse (z.B. `https://flohmarkt-papa.netlify.app`) kann man unter
   „Site configuration → Change site name“ anpassen.

Den Branch `live` legt der erste Suchlauf automatisch an. Falls er in Schritt 3 noch nicht auswählbar ist,
kurz warten, bis unter **Actions** der Lauf „Termine suchen & Webseite veröffentlichen“ grün ist.

**Suchgebiet ändern:** Datei **`config.json`** auf GitHub öffnen (Stift-Symbol), bei `"home"` die Postleitzahl und bei
`"radius_km"` den Umkreis eintragen (eingestellt: `24146` = Kiel-Elmschenhagen, `100` km), „Commit changes“.
Danach sucht GitHub automatisch neu (erster Lauf ca. 10–15 Minuten, danach schneller).

Die Seite auf dem Handy öffnen und über „Zum Startbildschirm hinzufügen“ wie eine App ablegen.
Favoriten, Notizen und eigene Termine speichert das jeweilige Gerät (Handy und PC getrennt).
Ob die letzte Suche geklappt hat, steht in der Seite unter Einstellungen → „Zustand der Quellen“ oder auf GitHub unter **Actions**.

> Hinweis: Der Zeitplan (alle 3 Stunden) läuft bei GitHub nur auf dem **Standard-Branch** des Repositories.
> Die Webseite funktioniert genauso mit GitHub Pages oder jedem anderen Webspace: einfach den Inhalt des Branches `live` ausliefern.

### Eigene Quellen hinzufügen (z.B. Kieler Express, Kirchengemeinde)

In der Seite oder App: **Einstellungen → Quellen → Webadresse eintragen → „Quelle hinzufügen“**. Fertig –
nach etwa 10 Minuten sind die Termine da. Entfernen über „Entfernen“ neben der Quelle.

Dahinter steckt ein kleiner Helfer auf Netlify (`netlify/functions/sources.mjs`), der die Adresse in `config.json`
einträgt; das startet automatisch einen Suchlauf. **Einmalig einrichten:**

1. Auf GitHub ein Token erstellen: *Settings → Developer settings → Personal access tokens → Fine-grained tokens →
   Generate new token*. Repository access: nur **anonym239/Kleinanzeigen**. Permissions: **Contents: Read and write**.
2. In Netlify: *Project configuration → Environment variables → Add a variable*: Name `GITHUB_TOKEN`, Wert = Token.
   Optional `SOURCE_PIN` (z.B. `1234`), dann fragt die Seite beim Hinzufügen einmal nach dieser PIN.
3. In `config.json` bei `"site_url"` die Netlify-Adresse eintragen (z.B. `https://name.netlify.app`), damit auch die
   App den Helfer findet.

Solange das nicht eingerichtet ist, öffnet „Quelle hinzufügen“ ersatzweise GitHub mit einer vorbereiteten Nachricht.

Gelesen werden Seiten mit maschinenlesbaren Terminen (schema.org, iCal) und – falls es die nicht gibt – Textblöcke,
die „Flohmarkt“, „Haushaltsauflösung“ o.ä. und ein Datum enthalten. Es gilt immer der eingestellte Umkreis.

### Kieler Nachrichten

Fest eingebaut über die **offiziellen RSS-Feeds** (Kiel, Plön, Hauptfeed) – kostenlos, ohne Abo. Übernommen werden nur
Termine (z.B. aus „Flohmarkt-Termine am Wochenende …“), keine Nachrichten oder Berichte. Die Webseite kn-online.de
selbst sperrt automatische Abrufe; Kleinanzeigen aus der gedruckten Zeitung sind dort nicht öffentlich abrufbar.

### Claude-Prüfung (optional, kostenpflichtig)

Mit einem Claude-API-Key prüft Claude bei jedem Suchlauf jede **neue** Anzeige genau einmal (echte Veranstaltung?
Datum, Uhrzeit, Adresse richtig?) und liest Termine aus Webseiten, bei denen der einfache Leser nichts findet
(eine Seite wird nur neu gelesen, wenn sie sich geändert hat). Einrichtung: API-Key unter https://platform.claude.com
erstellen → auf GitHub *Settings → Secrets and variables → Actions → New repository secret*, Name `ANTHROPIC_API_KEY`.
Modell in `config.json` bei `claude_model` (leer = `claude-opus-5`, günstiger: `claude-haiku-4-5`).
Unter Einstellungen → Quellen steht, wie viele Anzeigen geprüft und aussortiert wurden.

### Android-App

Download: https://github.com/anonym239/Kleinanzeigen/releases/latest/download/Flohmarkt-Finder.apk (ab Android 8).
Die App zeigt die veröffentlichte Webseite aus dem Branch `live` – jede Änderung an der Seite ist also automatisch
auch in der App. Ohne Netz zeigt sie den zuletzt geladenen Stand.

## Variante 2: Auf dem eigenen Homeserver

### Mit Docker

```bash
git clone <dieses Repository> flohmarkt-finder
cd flohmarkt-finder
docker compose up -d --build
```

Danach im Browser öffnen: `http://<IP-des-Servers>:8080`. Beim ersten Öffnen fragt die App nach PLZ oder Ort
und startet die erste Suche. Die dauert ein paar Minuten.

Die Daten liegen im Ordner `./data`. Ein Update geht mit `git pull && docker compose up -d --build`.

### Ohne Docker

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8080
```

Als Dienst, der beim Hochfahren startet: siehe `flohmarkt-finder.service`.

### Passwortschutz (optional)

Wenn der Server aus dem Internet erreichbar ist, die Umgebungsvariable `FLOHMARKT_PASSWORD` setzen
(in `docker-compose.yml` ist die Zeile schon vorbereitet). Der Browser fragt dann nach Benutzername (beliebig) und Passwort.

## Auf dem Handy als App

- **Android (Chrome)**: Seite öffnen → Menü ⋮ → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“
- **iPhone (Safari)**: Seite öffnen → Teilen-Symbol → „Zum Home-Bildschirm“

## Entwicklung

```bash
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest
```

Aufbau:

| Datei | Aufgabe |
|---|---|
| `app/main.py` | Webserver und Schnittstellen (FastAPI) |
| `app/scraper.py` | Regelmäßige Suche in allen Quellen |
| `app/sources/kleinanzeigen.py` | Liest Kleinanzeigen-Suchergebnisse und Detailseiten |
| `app/sources/events_page.py` | Liest schema.org-Events und iCal-Kalender von beliebigen Webseiten |
| `app/sources/calendars.py` | Flohmarkt-Terminkalender nach PLZ-Gebiet (krencky24.de, meine-flohmarkt-termine.de) |
| `app/build_site.py` | Sucht und baut die statische Webseite (für Netlify) |
| `.github/workflows/site.yml` | Automatische Suche alle 3 Stunden, Ergebnis in Branch `live` |
| `app/dateparse.py` | Erkennt Datum und Uhrzeit in deutschem Text |
| `app/classify.py` | Ordnet Kategorien zu und erkennt Firmen-Werbung |
| `app/geo.py` | Orte in Koordinaten umrechnen, Entfernung berechnen |
| `app/db.py` | SQLite-Datenbank |
| `app/static/` | Oberfläche (HTML/CSS/JS ohne Build-Schritt, Leaflet für die Karte) |
