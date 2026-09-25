"""Geokodierung über OpenStreetMap Nominatim (kostenlos, ohne API-Key) mit Cache."""
from __future__ import annotations

import logging
import math
import re
import threading
import time

import httpx

from . import db

log = logging.getLogger(__name__)
NOMINATIM = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "Flohmarkt-Finder/1.0 (privater Homeserver)"
_lock = threading.Lock()
_last_call = 0.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _query(params: dict) -> tuple[float, float, str] | None:
    global _last_call
    with _lock:  # Nominatim erlaubt max. 1 Anfrage pro Sekunde
        wait = 1.1 - (time.monotonic() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.monotonic()
        try:
            r = httpx.get(
                NOMINATIM,
                params={**params, "format": "json", "limit": 1, "countrycodes": "de,at,ch"},
                headers={"User-Agent": USER_AGENT, "Accept-Language": "de"},
                timeout=15,
            )
            r.raise_for_status()
            data = r.json()
        except Exception as e:  # noqa: BLE001
            log.warning("Geokodierung fehlgeschlagen für %s: %s", params, e)
            return None
    if not data:
        return None
    return float(data[0]["lat"]), float(data[0]["lon"]), data[0].get("display_name", "")


def geocode(location: str) -> tuple[float, float, str] | None:
    """Liefert (lat, lon, Name) für PLZ, Ort oder Adresse. Ergebnisse werden dauerhaft gecacht."""
    key = re.sub(r"\s+", " ", (location or "").strip().lower())
    if not key:
        return None
    cached = db.geocache_get(key)
    if cached is not None:
        return cached if cached[0] is not None else None
    m = re.fullmatch(r"(\d{5})(?:\s+(.*))?", key)
    res = None
    if m:
        res = _query({"postalcode": m.group(1), "country": "Deutschland"})
    if res is None:
        res = _query({"q": location})
    db.geocache_put(key, res)
    return res
