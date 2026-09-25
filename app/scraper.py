"""Holt regelmäßig neue Termine aus allen Quellen und speichert sie."""
from __future__ import annotations

import logging
import threading
import time
from datetime import date, timedelta

from . import db, geo
from .classify import classify, is_service_ad
from .dateparse import parse_event_date, parse_time_text
from .sources import events_page, kleinanzeigen
from .sources.base import make_client

log = logging.getLogger(__name__)

_run_lock = threading.Lock()
state = {"running": False, "started": None, "message": "", "last_finished": None}


def _geocode_event(ev: dict) -> None:
    if ev.get("lat") is not None:
        return
    for q in (ev.get("address"), ev.get("location")):
        if q:
            res = geo.geocode(q)
            if res:
                ev["lat"], ev["lon"] = res[0], res[1]
                return


def _kleinanzeigen_event(ad: dict) -> dict:
    text = f"{ad['title']}\n{ad.get('description', '')}"
    parsed = parse_event_date(text, ad["posted"])
    return {
        "id": f"ka:{ad['ad_id']}",
        "source": "kleinanzeigen",
        "title": ad["title"],
        "description": ad.get("description", ""),
        "url": ad["url"],
        "image": ad.get("image", ""),
        "category": classify(ad["title"], ad.get("description", "") + " " + ad.get("search_term", "")),
        "start_date": parsed.start.isoformat() if parsed else None,
        "end_date": parsed.end.isoformat() if parsed else None,
        "date_certain": int(bool(parsed and parsed.certain)),
        "time_text": parse_time_text(text) or "",
        "location": ad.get("location", ""),
        "address": ad.get("address") or ad.get("location", ""),
        "lat": ad.get("lat"),
        "lon": ad.get("lon"),
        "price": ad.get("price", ""),
        "is_service": int(is_service_ad(ad["title"], ad.get("description", ""))),
        "posted_at": ad["posted"].isoformat(),
        "detail_fetched": int(bool(ad.get("detail_fetched"))),
    }


def _run_kleinanzeigen(settings: dict) -> tuple[int, int]:
    found = new = 0
    with make_client() as client:
        def needs_detail(ad: dict) -> bool:
            if f"ka:{ad['ad_id']}" in db.known_detail_ids([f"ka:{ad['ad_id']}"]):
                return False  # schon vollständig gelesen
            # Firmen-Werbung überspringen; sonst Detailseite für volle Beschreibung und genaue Adresse laden
            return not is_service_ad(ad["title"], ad["description"])

        for ad in kleinanzeigen.scrape(client, settings, needs_detail, lambda m: log.warning(m)):
            ev = _kleinanzeigen_event(ad)
            existing = db.get_event(ev["id"])
            if existing and existing["detail_fetched"] and not ev["detail_fetched"]:
                # Bereits aus der Detailseite gelesene Daten nicht durch die gekürzte Vorschau überschreiben
                for k in ("description", "address", "lat", "lon", "start_date", "end_date", "date_certain",
                          "time_text", "detail_fetched", "image", "is_service", "category"):
                    ev[k] = existing[k]
            _geocode_event(ev)
            found += 1
            new += db.upsert_event(ev)
            state["message"] = f"Kleinanzeigen: {found} Anzeigen gelesen …"
    return found, new


def _run_url(url: str) -> tuple[int, int]:
    found = new = 0
    with make_client() as client:
        items = events_page.scrape_url(client, url)
    horizon = date.today() + timedelta(days=120)
    for it in items:
        if it["end"] < date.today() - timedelta(days=1) or it["start"] > horizon:
            continue
        text = f"{it['title']} {it['description']}"
        ev = {
            "id": f"web:{events_page.source_name(url)}:{it['ext_id']}",
            "source": events_page.source_name(url),
            "title": it["title"],
            "description": it["description"],
            "url": it["url"],
            "image": it["image"],
            "category": classify(it["title"], it["description"]),
            "start_date": it["start"].isoformat(),
            "end_date": it["end"].isoformat(),
            "date_certain": 1,
            "time_text": it["time_text"] or parse_time_text(text) or "",
            "location": it["location"],
            "address": it["address"],
            "lat": it["lat"],
            "lon": it["lon"],
            "is_service": 0,
            "posted_at": None,
            "detail_fetched": 1,
        }
        _geocode_event(ev)
        found += 1
        new += db.upsert_event(ev)
    return found, new


def run_all() -> bool:
    """Führt eine komplette Aktualisierung aus. Gibt False zurück, wenn schon eine läuft."""
    if not _run_lock.acquire(blocking=False):
        return False
    state.update(running=True, started=time.time(), message="Aktualisierung gestartet …")
    try:
        settings = db.get_settings()
        if settings.get("kleinanzeigen_enabled") and settings.get("home_query"):
            t0 = time.time()
            try:
                found, new = _run_kleinanzeigen(settings)
                db.log_run("kleinanzeigen", t0, True, found, f"{new} neu")
            except Exception as e:  # noqa: BLE001
                log.exception("Kleinanzeigen fehlgeschlagen")
                db.log_run("kleinanzeigen", t0, False, 0, str(e))
        for url in settings.get("extra_urls") or []:
            t0 = time.time()
            state["message"] = f"Lese {events_page.source_name(url)} …"
            try:
                found, new = _run_url(url)
                db.log_run(events_page.source_name(url), t0, True, found,
                           f"{new} neu" if found else "keine Termine (schema.org/Event oder iCal) gefunden")
            except Exception as e:  # noqa: BLE001
                log.warning("Quelle %s fehlgeschlagen: %s", url, e)
                db.log_run(events_page.source_name(url), t0, False, 0, str(e))
        removed = db.cleanup(int(settings.get("keep_past_days") or 3))
        state["message"] = f"Fertig ({removed} alte Einträge entfernt)"
        return True
    finally:
        state.update(running=False, last_finished=time.time())
        _run_lock.release()


def run_in_background() -> bool:
    if state["running"]:
        return False
    threading.Thread(target=run_all, name="scrape", daemon=True).start()
    return True


def scheduler_loop(stop: threading.Event) -> None:
    """Startet die Aktualisierung automatisch alle ``refresh_hours`` Stunden."""
    if state["last_finished"] is None:
        state["last_finished"] = max((r["finished"] or 0 for r in db.last_runs()), default=None)
    stop.wait(5)
    while not stop.is_set():
        settings = db.get_settings()
        interval = max(0.5, float(settings.get("refresh_hours") or 3)) * 3600
        last = state["last_finished"] or 0
        if not state["running"] and time.time() - last >= interval:
            try:
                run_all()
            except Exception:  # noqa: BLE001
                log.exception("Automatische Aktualisierung fehlgeschlagen")
        stop.wait(60)
