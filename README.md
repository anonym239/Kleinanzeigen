# Flohmarkt-Finder

Findet **Flohmärkte, Hof- und Garagenflohmärkte, Haushaltsauflösungen, Trödelmärkte und Kinderbasare** in der Nähe.
Die App läuft auf dem eigenen Homeserver und ist auf dem Handy und am PC gut bedienbar. Man braucht **keinen API-Key**.

## Was die App kann

- **Zeitraum mit einem Tipp**: Heute · Dieses Wochenende · Nächstes Wochenende · Nächste 14 Tage · Alle
- **Nur Samstag & Sonntag** als zusätzlicher Filter
- **Umkreis-Filter** um den eigenen Wohnort (PLZ oder Ort), mit Entfernung in km bei jedem Termin
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

1. **Kleinanzeigen.de**: Die App ruft die normale Suchseite für die Suchbegriffe auf (Flohmarkt, Hofflohmarkt,
   Haushaltsauflösung usw.) und liest die Anzeigen aus. Da Kleinanzeigen kein Veranstaltungsdatum kennt,
   **erkennt die App das Datum im Text**, z.B. „Sa. 27.09. 10–16 Uhr“, „3. und 4. Oktober“ oder „diesen Samstag“.
   Anzeigen ohne erkennbares Datum erscheinen unten unter „Ohne erkanntes Datum“.
2. **Weitere Webseiten** (in den Einstellungen eintragbar): Veranstaltungskalender von Stadt, Kirchengemeinde,
   Veranstaltern usw., wenn sie ihre Termine als *schema.org-Event* anbieten, und iCal-Adressen (`.ics`).
3. **Eigene Einträge** über den Knopf „Termin eintragen“.

Die Umrechnung von Orten in Koordinaten (für Entfernung und Karte) läuft über OpenStreetMap Nominatim. Das ist kostenlos
und braucht keinen Key. Die Ergebnisse werden gespeichert, damit jede Adresse nur einmal abgefragt wird.

> Hinweis: Die App liest öffentliche Webseiten wie ein Browser, mit Pausen zwischen den Abrufen.
> Wenn Kleinanzeigen etwas an seiner Seite ändert, muss eventuell `app/sources/kleinanzeigen.py` angepasst werden.
> Ob die letzte Suche geklappt hat, steht unter Einstellungen → „Zustand der Quellen“.

## Installation auf dem Homeserver

### Mit Docker (empfohlen)

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
| `app/dateparse.py` | Erkennt Datum und Uhrzeit in deutschem Text |
| `app/classify.py` | Ordnet Kategorien zu und erkennt Firmen-Werbung |
| `app/geo.py` | Orte in Koordinaten umrechnen, Entfernung berechnen |
| `app/db.py` | SQLite-Datenbank |
| `app/static/` | Oberfläche (HTML/CSS/JS ohne Build-Schritt, Leaflet für die Karte) |
