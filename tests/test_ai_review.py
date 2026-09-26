"""Claude-Prüfung mit nachgebauten Antworten (kein echter API-Aufruf)."""
import tempfile
from datetime import date, timedelta
from pathlib import Path

import httpx

from app import ai_review, db, geo, scraper
from app.sources import base


def _setup(monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", Path(tempfile.mkdtemp()) / "ai.db")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    monkeypatch.setattr(geo, "_query", lambda params: (54.30, 10.19, "Kiel"))


def test_review_rejects_and_corrects(monkeypatch):
    _setup(monkeypatch)
    d = (date.today() + timedelta(days=3)).isoformat()
    db.upsert_event({"id": "ka:1", "source": "kleinanzeigen", "title": "Haushaltsauflösung Samstag",
                     "description": "Alles muss raus, Lindenweg 3, 24146 Kiel", "address": "24146 Kiel",
                     "start_date": None, "relevant": 1})
    db.upsert_event({"id": "ka:2", "source": "kleinanzeigen", "title": "Flohmarkt Kiste", "relevant": 1,
                     "start_date": d})
    calls = []

    def fake_call(settings, system, user, schema):
        calls.append(user)
        return ai_review.Verdicts(items=[
            ai_review.Verdict(id="ka:1", is_event=True, category="haushalt", start_date=d, end_date=d,
                              time_text="10–14 Uhr", address="Lindenweg 3, 24146 Kiel", reason="Verkauf vor Ort"),
            ai_review.Verdict(id="ka:2", is_event=False, category="sonstiges", reason="Einzelartikel"),
        ])

    monkeypatch.setattr(ai_review, "_call", fake_call)
    st = ai_review.review_new_events({})
    assert st == {"checked": 2, "rejected": 1, "corrected": 2}
    one, two = db.get_event("ka:1"), db.get_event("ka:2")
    assert one["start_date"] == d and one["time_text"] == "10–14 Uhr" and one["address"] == "Lindenweg 3, 24146 Kiel"
    assert one["ai_checked"] == 1 and one["ai_verdict"] == 1
    assert two["relevant"] == 0 and two["ai_verdict"] == 0
    # Beim nächsten Mal wird nichts erneut geprüft (kostet nichts)
    assert ai_review.review_new_events({})["checked"] == 0 and len(calls) == 1


def test_page_extraction_used_when_nothing_found(monkeypatch):
    _setup(monkeypatch)
    monkeypatch.setattr(geo, "plz_prefixes_near", lambda *a: [])
    d = date.today() + timedelta(days=5)
    page = "<html><body><h1>Hochberg</h1><table><tr><td>So</td><td>04.10.</td><td>7-15</td></tr></table></body></html>"
    monkeypatch.setattr(scraper, "make_client", lambda: httpx.Client(
        transport=httpx.MockTransport(lambda r: httpx.Response(200, text=page)), headers=base.BROWSER_HEADERS))
    n_calls = []

    def fake_call(settings, system, user, schema):
        n_calls.append(1)
        return ai_review.PageEvents(events=[ai_review.PageEvent(
            title="Flohmarkt Hochberg", category="flohmarkt", start_date=d.isoformat(), time_text="7–15 Uhr",
            address="24146 Kiel")])

    monkeypatch.setattr(ai_review, "_call", fake_call)
    db.save_settings({"home_query": "24146", "home_lat": 54.30, "home_lon": 10.19, "radius_km": 100,
                      "kleinanzeigen_enabled": False, "calendars_enabled": False, "kn_enabled": False,
                      "extra_urls": ["https://www.hochberg-flohmarkt.de/index_start.php"]})
    scraper.run_all()
    titles = [e["title"] for e in db.list_events()]
    assert titles == ["Flohmarkt Hochberg"]
    scraper.run_all()  # Seite unverändert -> Claude wird nicht erneut gefragt
    assert len(n_calls) == 1
