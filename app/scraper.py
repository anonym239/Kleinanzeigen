"""Holt regelmäßig neue Termine aus allen Quellen und speichert sie."""
from __future__ import annotations

import logging
import re
import threading
import time
from datetime import date, timedelta

from . import db, geo
from .classify import _EVENT_WORDS, classify, is_event_ad, is_service_ad
from .dateparse import parse_event_date, parse_time_text
from .sources import calendars, events_page, kleinanzeigen, kn
from .sources.base import SourceError, make_client

log = logging.getLogger(__name__)

_run_lock = threading.Lock()
state = {"running": False, "started": None, "message": "", "last_finished": None}


def _geocode_event(ev: dict) -> None:
    """Koordinaten ergänzen: genaue Adresse, sonst Ort, sonst nur die Postleitzahl."""
    if ev.get("lat") is not None:
        return
    queries = [ev.get("address")]
    for text in (ev.get("address"), ev.get("location")):
        m = re.search(r"\b(\d{5})\b", text or "")
        if m:
            queries.append(m.group(1))
    queries.append(ev.get("location"))  # reiner Ortsname zuletzt ("Marktplatz" gibt es überall)
    for q in queries:
        if q:
            res = geo.geocode(q)
            if res:
                ev["lat"], ev["lon"] = res[0], res[1]
                return


def _kleinanzeigen_event(ad: dict) -> dict:
    text = f"{ad['title']}\n{ad.get('description', '')}"
    parsed = parse_event_date(text, ad["posted"])
    time_text = parse_time_text(text) or ""
    relevant = is_event_ad(ad["title"], ad.get("description", ""), ad.get("price", ""),
                           bool(parsed and parsed.certain), bool(time_text))
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
        "time_text": time_text,
        "location": ad.get("location", ""),
        "address": ad.get("address") or ad.get("location", ""),
        "lat": ad.get("lat"),
        "lon": ad.get("lon"),
        "price": ad.get("price", ""),
        "is_service": int(is_service_ad(ad["title"], ad.get("description", ""))),
        "posted_at": ad["posted"].isoformat(),
        "detail_fetched": int(bool(ad.get("detail_fetched"))),
        "relevant": int(relevant),
    }


def _run_kleinanzeigen(settings: dict) -> tuple[int, int]:
    found = new = 0
    with make_client() as client:
        def needs_detail(ad: dict) -> bool:
            if f"ka:{ad['ad_id']}" in db.known_detail_ids([f"ka:{ad['ad_id']}"]):
                return False  # schon vollständig gelesen
            # Firmen-Werbung und offensichtliche Einzelartikel überspringen;
            # sonst Detailseite für volle Beschreibung und genaue Adresse laden
            if not _EVENT_WORDS.search(f"{ad['title']} {ad['description']}"):
                return False
            return not is_service_ad(ad["title"], ad["description"])

        for ad in kleinanzeigen.scrape(client, settings, needs_detail, lambda m: log.warning(m)):
            ev = _kleinanzeigen_event(ad)
            existing = db.get_event(ev["id"])
            if existing and existing["detail_fetched"] and not ev["detail_fetched"]:
                # Bereits aus der Detailseite gelesene Daten nicht durch die gekürzte Vorschau überschreiben
                for k in ("description", "address", "lat", "lon", "start_date", "end_date", "date_certain",
                          "time_text", "detail_fetched", "image", "is_service", "category"):
                    ev[k] = existing[k]
                # Mit den aktuellen Regeln neu bewerten (Regeln können sich seit dem letzten Lauf geändert haben)
                ev["relevant"] = int(is_event_ad(ev["title"], ev["description"], ev["price"],
                                                 bool(ev["start_date"] and ev["date_certain"]), bool(ev["time_text"])))
            if ev["relevant"]:
                _geocode_event(ev)  # Einzelartikel werden nur gemerkt, nicht verortet
            found += ev["relevant"]
            new += db.upsert_event(ev) and ev["relevant"]
            state["message"] = f"Kleinanzeigen: {found} Anzeigen gelesen …"
    return found, new


def _store_web_item(it: dict, source: str, ev_id: str, settings: dict) -> tuple[int, int]:
    """Speichert einen Kalender-Termin, wenn er ein Floh-/Trödel-/Kindermarkt im Umkreis ist."""
    today = date.today()
    horizon = today + timedelta(days=120)
    if it["end"] < today - timedelta(days=1) or it["start"] > horizon:
        return 0, 0
    category = classify(it["title"], it["description"])
    if category == "sonstiges":
        return 0, 0  # z.B. Streetfood-Festival, Weinfest, Feierabendmarkt
    text = f"{it['title']} {it['description']}"
    ev = {
        "id": ev_id,
        "source": source,
        "title": it["title"],
        "description": it["description"],
        "url": it["url"],
        "image": it["image"],
        "category": category,
        "start_date": it["start"].isoformat(),
        "end_date": it["end"].isoformat(),
        "date_certain": int(it.get("certain", True)),
        "time_text": it["time_text"] or parse_time_text(text) or "",
        "location": it["location"],
        "address": it["address"],
        "lat": it["lat"],
        "lon": it["lon"],
        "is_service": 0,
        "posted_at": None,
        "detail_fetched": 1,
        "relevant": 1,
    }
    home = (settings.get("home_lat"), settings.get("home_lon"))
    radius = float(settings.get("radius_km") or 50)
    # Erst grob über die PLZ prüfen (ein Abruf pro PLZ), nur Termine im Umkreis genau verorten
    m = re.search(r"\b(\d{5})\b", ev["address"] or "")
    if ev["lat"] is None and m and home[0] is not None:
        rough = geo.geocode(m.group(1))
        if rough and geo.haversine_km(*home, rough[0], rough[1]) > radius + 10:
            return 0, 0
    _geocode_event(ev)
    if home[0] is not None and ev["lat"] is not None and geo.haversine_km(*home, ev["lat"], ev["lon"]) > radius + 5:
        return 0, 0
    return 1, int(db.upsert_event(ev))


def _run_url(url: str, settings: dict) -> tuple[int, int]:
    found = new = 0
    with make_client() as client:
        items = events_page.scrape_url(client, url)
    name = events_page.source_name(url)
    for it in items:
        f, n = _store_web_item(it, name, f"web:{name}:{it['ext_id']}", settings)
        found, new = found + f, new + n
    return found, new


def _run_kn(settings: dict) -> tuple[int, int]:
    found = new = 0
    with make_client() as client:
        items = kn.scrape(client)
    for it in items:
        f, n = _store_web_item(it, kn.NAME, f"kn:{it['ext_id']}", settings)
        found, new = found + f, new + n
    return found, new


def _run_calendars(settings: dict) -> tuple[int, int, str]:
    if settings.get("home_lat") is None:
        return 0, 0, "kein Wohnort"
    prefixes = geo.plz_prefixes_near(settings["home_lat"], settings["home_lon"], float(settings.get("radius_km") or 50))
    until = date.today() + timedelta(days=int(settings.get("days_ahead") or 14) + 7)
    found = new = 0
    seen: set[str] = set()
    errors = []
    with make_client() as client:
        for plz in prefixes:
            state["message"] = f"Flohmarkt-Kalender: PLZ-Gebiet {plz} …"
            try:
                for site, it in calendars.scrape_prefix(client, plz, until, log_msg=log.warning):
                    key = calendars.event_key(it["url"]) or it["ext_id"]
                    if key in seen:
                        continue
                    seen.add(key)
                    f, n = _store_web_item(it, site, f"cal:{key}", settings)
                    found, new = found + f, new + n
            except SourceError as e:
                errors.append(str(e))
    msg = f"{new} neu, PLZ-Gebiete {', '.join(prefixes)}"
    if errors:
        msg += f" – Fehler: {'; '.join(errors)[:200]}"
    return found, new, msg


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
        if settings.get("calendars_enabled", True) and settings.get("home_query"):
            t0 = time.time()
            try:
                found, new, msg = _run_calendars(settings)
                db.log_run("Flohmarkt-Kalender", t0, True, found, msg)
            except Exception as e:  # noqa: BLE001
                log.exception("Flohmarkt-Kalender fehlgeschlagen")
                db.log_run("Flohmarkt-Kalender", t0, False, 0, str(e))
        if settings.get("kn_enabled", True) and settings.get("home_query"):
            t0 = time.time()
            state["message"] = "Kieler Nachrichten …"
            try:
                found, new = _run_kn(settings)
                db.log_run(kn.NAME, t0, True, found, f"{new} neu" if found else "zurzeit keine Termine in den Feeds")
            except Exception as e:  # noqa: BLE001
                log.warning("Kieler Nachrichten fehlgeschlagen: %s", e)
                db.log_run(kn.NAME, t0, False, 0, str(e))
        for url in settings.get("extra_urls") or []:
            t0 = time.time()
            state["message"] = f"Lese {events_page.source_name(url)} …"
            try:
                found, new = _run_url(url, settings)
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
