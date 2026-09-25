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


def reverse_postcode(lat: float, lon: float) -> str | None:
    """Postleitzahl an einer Koordinate (Nominatim reverse, gecacht)."""
    key = f"rev:{lat:.3f},{lon:.3f}"
    cached = db.geocache_get(key)
    if cached is not None:
        return cached[2] or None
    global _last_call
    with _lock:
        wait = 1.1 - (time.monotonic() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.monotonic()
        try:
            r = httpx.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={"lat": lat, "lon": lon, "format": "json", "zoom": 16, "addressdetails": 1},
                headers={"User-Agent": USER_AGENT, "Accept-Language": "de"},
                timeout=15,
            )
            r.raise_for_status()
            plz = (r.json().get("address") or {}).get("postcode")
        except Exception as e:  # noqa: BLE001
            log.warning("Reverse-Geokodierung fehlgeschlagen: %s", e)
            return None
    plz = plz if plz and re.fullmatch(r"\d{5}", plz) else None
    db.geocache_put(key, (lat, lon, plz or ""))
    return plz


def plz_prefixes_near(lat: float, lon: float, radius_km: float) -> list[str]:
    """Zweistellige PLZ-Gebiete (z.B. "50", "51", "53"), die im Umkreis liegen.

    Dazu werden Punkte in 8 Richtungen auf halbem und vollem Radius abgefragt.
    """
    points = [(lat, lon)]
    for frac in (0.5, 1.0):
        d = radius_km * frac
        for bearing in range(0, 360, 45):
            b = math.radians(bearing)
            dlat = d / 111.2 * math.cos(b)
            dlon = d / (111.2 * math.cos(math.radians(lat))) * math.sin(b)
            points.append((lat + dlat, lon + dlon))
    prefixes: list[str] = []
    for p in points:
        plz = reverse_postcode(*p)
        if plz and plz[:2] not in prefixes:
            prefixes.append(plz[:2])
    return prefixes
