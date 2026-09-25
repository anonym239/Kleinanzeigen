"""Sucht Termine und baut daraus eine statische Webseite (für GitHub Pages, ohne eigenen Server).

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


def apply_config(cfg: dict) -> dict:
    values = {
        "home_query": str(cfg.get("home", "")).strip(),
        "radius_km": float(cfg.get("radius_km", 50)),
        "days_ahead": int(cfg.get("days_ahead", 14)),
        "search_terms": list(cfg.get("search_terms") or db.DEFAULT_SETTINGS["search_terms"]),
        "kleinanzeigen_enabled": bool(cfg.get("kleinanzeigen_enabled", True)),
        "kleinanzeigen_pages": int(cfg.get("kleinanzeigen_pages", 3)),
        "detail_fetch_limit": int(cfg.get("detail_fetch_limit", 80)),
        "extra_urls": list(cfg.get("extra_urls") or []),
    }
    if values["home_query"]:
        res = geo.geocode(values["home_query"])
        if res:
            values.update(home_lat=res[0], home_lon=res[1], home_label=res[2])
        else:
            log.warning("Wohnort %r nicht gefunden", values["home_query"])
    return db.save_settings(values)


def export(out: Path, settings: dict) -> int:
    out.mkdir(parents=True, exist_ok=True)
    shutil.copytree(STATIC, out / "static", dirs_exist_ok=True)
    for name in ("index.html", "sw.js", "manifest.webmanifest", "icon.svg"):
        shutil.copy(STATIC / name, out / name)
    (out / "static" / "mode.js").write_text("window.FLOHMARKT_STATIC = true;\n")
    (out / ".nojekyll").write_text("")

    keep = ("id", "source", "title", "description", "url", "image", "category", "start_date", "end_date",
            "date_certain", "time_text", "location", "address", "lat", "lon", "price", "is_service",
            "posted_at", "first_seen")
    events = []
    for e in db.list_events():
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


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config.json")
    ap.add_argument("--out", default="site")
    ap.add_argument("--no-scrape", action="store_true", help="nur Seite aus vorhandenen Daten bauen")
    args = ap.parse_args()
    settings = apply_config(json.loads(Path(args.config).read_text(encoding="utf-8")))
    if not args.no_scrape:
        scraper.run_all()
    n = export(Path(args.out), settings)
    for r in db.last_runs():
        log.info("Quelle %-20s ok=%s gefunden=%s %s", r["source"], r["ok"], r["found"], r["message"])
    log.info("%d Termine exportiert nach %s", n, args.out)


if __name__ == "__main__":
    main()
