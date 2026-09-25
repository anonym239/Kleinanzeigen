"""Sucht Termine und baut daraus eine statische Webseite (für Netlify & Co., ohne eigenen Server).

    python -m app.build_site --config config.json --out site

Die Datenbank (FLOHMARKT_DB) bleibt zwischen den Läufen erhalten (im Workflow per Cache),
damit bereits gelesene Anzeigen, Geo-Daten und die "NEU"-Markierung erhalten bleiben.
"""
from __future__ import annotations

import argparse
import json
import logging
import shutil
import time
from pathlib import Path

from . import db, geo, scraper
from .classify import CATEGORY_LABELS

log = logging.getLogger("build_site")
STATIC = Path(__file__).resolve().parent / "static"

# Netlify: nichts bauen, nur veröffentlichen; Termin-Daten und Service-Worker nie zwischenspeichern
NETLIFY_TOML = """[build]
  publish = "."
  command = ""

[[headers]]
  for = "/data/*"
  [headers.values]
    Cache-Control = "no-cache"

[[headers]]
  for = "/sw.js"
  [headers.values]
    Cache-Control = "no-cache"

[[headers]]
  for = "/index.html"
  [headers.values]
    Cache-Control = "no-cache"
"""


def apply_config(cfg: dict) -> dict:
    values = {
        "home_query": str(cfg.get("home", "")).strip(),
        "radius_km": float(cfg.get("radius_km", 50)),
        "days_ahead": int(cfg.get("days_ahead", 14)),
        "search_terms": list(cfg.get("search_terms") or db.DEFAULT_SETTINGS["search_terms"]),
        "kleinanzeigen_enabled": bool(cfg.get("kleinanzeigen_enabled", True)),
        "calendars_enabled": bool(cfg.get("calendars_enabled", True)),
        "kleinanzeigen_pages": int(cfg.get("kleinanzeigen_pages", 3)),
        "detail_fetch_limit": int(cfg.get("detail_fetch_limit", 80)),
        "extra_urls": list(cfg.get("extra_urls") or []),
    }
    previous = db.get_settings()
    if (previous.get("home_query"), float(previous.get("radius_km") or 0)) != (values["home_query"], values["radius_km"]):
        removed = db.delete_scraped_events()
        log.info("Suchgebiet geändert – %d alte Einträge entfernt", removed)
    if values["home_query"]:
        res = geo.geocode(values["home_query"])
        if res:
            values.update(home_lat=res[0], home_lon=res[1], home_label=res[2])
        else:
            log.warning("Wohnort %r nicht gefunden", values["home_query"])
    return db.save_settings(values)


def export(out: Path, settings: dict) -> int:
    out.mkdir(parents=True, exist_ok=True)
    root_files = ("index.html", "sw.js", "manifest.webmanifest", "icon.svg")
    shutil.copytree(STATIC, out / "static", dirs_exist_ok=True, ignore=shutil.ignore_patterns(*root_files))
    for name in root_files:
        shutil.copy(STATIC / name, out / name)
    (out / "static" / "mode.js").write_text("window.FLOHMARKT_STATIC = true;\n")
    (out / ".nojekyll").write_text("")
    (out / "netlify.toml").write_text(NETLIFY_TOML)
    (out / "README.md").write_text(
        "# Flohmarkt-Finder – veröffentlichte Webseite\n\n"
        "Dieser Branch wird automatisch alle 3 Stunden von GitHub Actions erzeugt (siehe `.github/workflows/site.yml`\n"
        "im Haupt-Branch). Bitte hier nichts von Hand ändern. Netlify veröffentlicht diesen Branch.\n")

    keep = ("id", "source", "title", "description", "url", "image", "category", "start_date", "end_date",
            "date_certain", "time_text", "location", "address", "lat", "lon", "price", "is_service",
            "posted_at", "first_seen")
    events = []
    home = (settings.get("home_lat"), settings.get("home_lon"))
    radius = float(settings.get("radius_km") or 50)
    for e in db.list_events():
        # Nur Termine im Umkreis veröffentlichen (ohne Koordinaten: nur Kleinanzeigen, die ja schon im Umkreis gesucht wurden)
        if home[0] is not None and e.get("lat") is not None:
            if geo.haversine_km(home[0], home[1], e["lat"], e["lon"]) > radius + 5:
                continue
        elif e.get("source") != "kleinanzeigen":
            continue
        item = {k: e.get(k) for k in keep}
        item["description"] = (item["description"] or "")[:1500]
        item["date_certain"] = bool(item["date_certain"])
        item["is_service"] = bool(item["is_service"])
        events.append(item)
    data = {
        "generated_at": time.time(),
        "region": {k: settings.get(k) for k in ("home_query", "home_label", "home_lat", "home_lon", "radius_km",
                                                  "days_ahead")},
        "categories": CATEGORY_LABELS,
        "runs": db.last_runs(),
        "events": events,
    }
    (out / "data").mkdir(exist_ok=True)
    (out / "data" / "events.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    return len(events)


def export_app_assets(out: Path, data_url: str) -> None:
    """Oberfläche für die Android-App: gleiche Seite, Termine kommen aus dem GitHub-Branch "live"."""
    if out.exists():
        shutil.rmtree(out)
    root_files = ("index.html", "manifest.webmanifest", "icon.svg")
    shutil.copytree(STATIC, out / "static", ignore=shutil.ignore_patterns(*root_files, "sw.js"))
    for name in root_files:
        shutil.copy(STATIC / name, out / name)
    (out / "static" / "mode.js").write_text(
        "window.FLOHMARKT_STATIC = true;\n"
        "window.FLOHMARKT_APP = true;\n"
        f"window.FLOHMARKT_DATA_URL = {json.dumps(data_url)};\n"
    )


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config.json")
    ap.add_argument("--out", default="site")
    ap.add_argument("--no-scrape", action="store_true", help="nur Seite aus vorhandenen Daten bauen")
    ap.add_argument("--app-assets", help="nur die Oberfläche für die Android-App in diesen Ordner legen")
    ap.add_argument("--data-url", default="https://raw.githubusercontent.com/anonym239/Kleinanzeigen/live/data/events.json")
    args = ap.parse_args()
    if args.app_assets:
        export_app_assets(Path(args.app_assets), args.data_url)
        log.info("App-Oberfläche nach %s gelegt (Daten: %s)", args.app_assets, args.data_url)
        return
    settings = apply_config(json.loads(Path(args.config).read_text(encoding="utf-8")))
    if not args.no_scrape:
        scraper.run_all()
    n = export(Path(args.out), settings)
    with db.connect() as c:  # Stichprobe zur Kontrolle der Filter im Log
        for rel, label in ((1, "als Termin erkannt"), (0, "aussortiert (Einzelartikel)")):
            rows = c.execute("SELECT title, price, start_date FROM events WHERE source='kleinanzeigen' AND relevant=? "
                             "AND is_service=0 ORDER BY RANDOM() LIMIT 25", (rel,)).fetchall()
            log.info("Kleinanzeigen %s – Beispiele:", label)
            for r in rows:
                log.info("   %-70.70s | %-10.10s | %s", r["title"], r["price"] or "", r["start_date"] or "-")
        n = c.execute("SELECT COUNT(*) FROM events WHERE source='kleinanzeigen' AND is_service=1").fetchone()[0]
        log.info("Kleinanzeigen Firmen-Werbung (ausgeblendet): %d", n)
    for r in db.last_runs():
        log.info("Quelle %-20s ok=%s gefunden=%s %s", r["source"], r["ok"], r["found"], r["message"])
    log.info("%d Termine exportiert nach %s", n, args.out)


if __name__ == "__main__":
    main()
