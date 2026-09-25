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
    assert any("k0l945r30" in u for u in requested)
    # Zweiter Lauf lädt die Detailseite nicht erneut
    requested.clear()
    scraper.run_all()
    assert not any("/s-anzeige/" in u for u in requested)
    assert db.last_runs()[0]["ok"] == 1
