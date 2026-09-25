# Flohmarkt-Finder

Findet **Flohmärkte, Hof- und Garagenflohmärkte, Haushaltsauflösungen, Trödelmärkte und Kinderbasare** in der Nähe.
Die App läuft auf dem eigenen Homeserver und ist auf dem Handy und am PC gut bedienbar. Man braucht **keinen API-Key**.

## Was die App kann

- **Zeitraum mit einem Tipp**: Heute · Dieses Wochenende · Nächstes Wochenende · Nächste 14 Tage · Alle
- **Nur Samstag & Sonntag** als zusätzlicher Filter
- **Umkreis-Filter** (Standard 50 km) um den eigenen Wohnort (PLZ oder Ort), mit Entfernung in km; innerhalb eines Tages steht das Nächstgelegene oben
- **Kategorien** mit Farben: Flohmarkt, Hof- & Garagenflohmarkt, Haushaltsauflösung, Kinder & Basar, Trödel- & Antikmarkt
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

## Variante 1: Ohne eigenen Server (GitHub Pages, empfohlen)

GitHub sucht alle 3 Stunden automatisch nach neuen Terminen und veröffentlicht die Webseite. Das ist kostenlos, und man
braucht keinen eigenen Computer, der läuft.

**Einmalig einrichten:**

1. Auf GitHub im Repository: **Settings → Pages → Build and deployment → Source: „GitHub Actions“** auswählen.
2. Die Datei **`config.json`** öffnen (auf GitHub mit dem Stift-Symbol bearbeiten) und bei `"home"` die eigene
   **Postleitzahl** eintragen, bei `"radius_km"` den Umkreis (z.B. `50`). Speichern („Commit changes“).
3. Nach ca. 5–10 Minuten ist die Seite erreichbar unter:
   **https://anonym239.github.io/Kleinanzeigen/**

Die Seite dann auf dem Handy öffnen und über „Zum Startbildschirm hinzufügen“ wie eine App ablegen.
Favoriten, Notizen und eigene Termine speichert das jeweilige Gerät (Handy und PC getrennt).
Den Wohnort für die Entfernungsberechnung kann man in der Seite unter „Einstellungen“ ändern;
das **Suchgebiet** selbst legt die `config.json` fest.

Ob die letzte Suche geklappt hat, steht unter Einstellungen → „Zustand der Quellen“ oder auf GitHub unter **Actions**.
Eine Suche sofort starten: **Actions → „Termine suchen & Webseite veröffentlichen“ → „Run workflow“**.

> Hinweis: Die Suche läuft nach Zeitplan nur auf dem Standard-Branch des Repositories.

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
| `app/build_site.py` | Sucht und baut die statische Webseite für GitHub Pages |
| `.github/workflows/site.yml` | Automatische Suche alle 3 Stunden + Veröffentlichung |
| `app/dateparse.py` | Erkennt Datum und Uhrzeit in deutschem Text |
| `app/classify.py` | Ordnet Kategorien zu und erkennt Firmen-Werbung |
| `app/geo.py` | Orte in Koordinaten umrechnen, Entfernung berechnen |
| `app/db.py` | SQLite-Datenbank |
| `app/static/` | Oberfläche (HTML/CSS/JS ohne Build-Schritt, Leaflet für die Karte) |
