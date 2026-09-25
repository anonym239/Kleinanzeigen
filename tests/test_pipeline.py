"""Kompletter Suchlauf mit simulierten Kleinanzeigen-Antworten (ohne Internet)."""
import tempfile
from pathlib import Path

import httpx

from app import db, geo, scraper
from app.sources import base, kleinanzeigen
from tests.test_sources import DETAIL_HTML, SEARCH_HTML


def test_full_run(monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", Path(tempfile.mkdtemp()) / "p.db")
    monkeypatch.setattr(geo, "_query", lambda params: (50.94, 6.96, "Köln"))
    monkeypatch.setattr(kleinanzeigen, "polite_pause", lambda *a: None)
    monkeypatch.setattr(geo, "plz_prefixes_near", lambda *a: [])
    requested = []

    def handler(req: httpx.Request):
        requested.append(str(req.url))
        if "ort-empfehlungen" in req.url.path:
            return httpx.Response(200, json={"_0": "Alle", "_945": "Köln"})
        if "/s-anzeige/" in req.url.path:
            return httpx.Response(200, text=DETAIL_HTML)
        return httpx.Response(200, text=SEARCH_HTML)

    monkeypatch.setattr(scraper, "make_client",
                        lambda: httpx.Client(transport=httpx.MockTransport(handler), headers=base.BROWSER_HEADERS))
    db.save_settings({"home_query": "Köln", "search_terms": ["Flohmarkt", "Hofflohmarkt"], "kleinanzeigen_pages": 1})

    assert scraper.run_all() is True
    ev = db.get_event("ka:3012345678")
    assert ev is not None
    assert ev["category"] == "hof"
    assert ev["start_date"] is not None
    assert "Lindenstraße" in ev["address"]
    assert ev["lat"] == 50.94  # Koordinaten aus der Detailseite
    assert ev["detail_fetched"] == 1
    assert any("k0l945r50" in u for u in requested)
    # Zweiter Lauf lädt die Detailseite nicht erneut
    requested.clear()
    scraper.run_all()
    assert not any("/s-anzeige/" in u for u in requested)
    assert db.last_runs()[0]["ok"] == 1


KRENCKY_HTML = """<html><body>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"Flohmarkt K&ouml;lner Altstadt auf der Rheinpromenade",
 "startDate":"%(d1)s","url":"https://krencky24.de/troedelmarkt-flohmarkt_26-09-2026_koeln_23601389.html",
 "location":{"@type":"Place","name":"Rheinpromenade","address":{"@type":"PostalAddress","streetAddress":"Konrad Adenauer Ufer","addressLocality":"K&ouml;ln","postalCode":"50668"}}}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"Streetfood Drink &amp; Music Festival Baesweiler",
 "startDate":"%(d1)s","url":"https://krencky24.de/troedelmarkt-flohmarkt_25-09-2026_baesweiler_23812025.html",
 "location":{"@type":"Place","name":"Kirchplatz","address":{"@type":"PostalAddress","addressLocality":"Baesweiler","postalCode":"52499"}}}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"Trödelmarkt weit weg",
 "startDate":"%(d1)s","url":"https://krencky24.de/troedelmarkt-flohmarkt_26-09-2026_trier_23000001.html",
 "location":{"@type":"Place","name":"Markt","address":{"@type":"PostalAddress","addressLocality":"Trier","postalCode":"54290"}}}</script>
</body></html>"""


def test_calendar_run(monkeypatch):
    from datetime import date, timedelta

    from app.sources import calendars
    monkeypatch.setattr(db, "DB_PATH", Path(tempfile.mkdtemp()) / "c.db")
    coords = {"54290": (49.75, 6.64)}
    monkeypatch.setattr(geo, "_query", lambda params: next(
        ((*v, k) for k, v in coords.items() if k in str(params).lower()), (50.94, 6.96, "Köln")))
    monkeypatch.setattr(geo, "plz_prefixes_near", lambda *a: ["50"])
    monkeypatch.setattr(calendars, "polite_pause", lambda *a: None)
    d1 = (date.today() + timedelta(days=1)).isoformat()
    pages = []

    def handler(req: httpx.Request):
        pages.append(str(req.url))
        if "krencky24.de" in req.url.host and "page=" not in str(req.url):
            return httpx.Response(200, text=KRENCKY_HTML % {"d1": d1})
        return httpx.Response(200, text="<html></html>")

    monkeypatch.setattr(scraper, "make_client",
                        lambda: httpx.Client(transport=httpx.MockTransport(handler), headers=base.BROWSER_HEADERS))
    db.save_settings({"home_query": "50667", "home_lat": 50.94, "home_lon": 6.96, "radius_km": 50,
                      "kleinanzeigen_enabled": False})
    scraper.run_all()
    titles = {e["title"]: e for e in db.list_events()}
    assert list(titles) == ["Flohmarkt Kölner Altstadt auf der Rheinpromenade"]
    ev = titles["Flohmarkt Kölner Altstadt auf der Rheinpromenade"]
    assert ev["id"] == "cal:23601389" and ev["source"] == "krencky24.de" and ev["category"] == "flohmarkt"
    assert any("plzgebiet_50.html?page=2" in p for p in pages)
    run = next(r for r in db.last_runs() if r["source"] == "Flohmarkt-Kalender")
    assert run["ok"] == 1 and run["found"] == 1
