import os
import tempfile
from pathlib import Path

os.environ["FLOHMARKT_NO_SCHEDULER"] = "1"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import db, geo  # noqa: E402


@pytest.fixture()
def client(monkeypatch):
    tmp = Path(tempfile.mkdtemp()) / "t.db"
    monkeypatch.setattr(db, "DB_PATH", tmp)
    monkeypatch.setattr(geo, "_query", lambda params: (50.94, 6.96, "Köln, Deutschland"))
    from app.main import app
    with TestClient(app) as c:
        yield c


def test_settings_geocode(client):
    r = client.put("/api/settings", json={"home_query": "50667", "radius_km": 25})
    assert r.status_code == 200
    s = r.json()
    assert s["home_lat"] == 50.94 and s["radius_km"] == 25 and s["home_label"].startswith("Köln")


def test_manual_event_flow(client):
    client.put("/api/settings", json={"home_query": "50667"})
    from datetime import date, timedelta
    day = (date.today() + timedelta(days=3)).isoformat()
    r = client.post("/api/events", json={"title": "Hofflohmarkt Test", "start_date": day, "address": "Köln",
                                         "category": "hof", "time_text": "9–14 Uhr"})
    assert r.status_code == 200, r.text
    ev = r.json()
    assert ev["distance_km"] == 0.0 and ev["category_label"].startswith("Hof")

    events = client.get("/api/events").json()["events"]
    assert [e["id"] for e in events] == [ev["id"]]

    r = client.patch(f"/api/events/{ev['id']}/state", json={"favorite": True, "note": "Werkzeug"})
    assert r.json()["favorite"] == 1
    ics = client.get("/api/favorites.ics")
    assert ics.status_code == 200 and "SUMMARY:Hofflohmarkt Test (9–14 Uhr)" in ics.text
    assert client.get(f"/api/events/{ev['id']}/ics").status_code == 200

    assert client.delete(f"/api/events/{ev['id']}").json() == {"ok": True}
    assert client.get("/api/events").json()["events"] == []


def test_scraped_event_cannot_be_deleted(client):
    db.upsert_event({"id": "ka:1", "source": "kleinanzeigen", "title": "Flohmarkt", "start_date": None})
    assert client.delete("/api/events/ka:1").status_code == 400


def test_index_served(client):
    r = client.get("/")
    assert r.status_code == 200 and "Flohmarkt-Finder" in r.text


def test_password(monkeypatch, client):
    import app.main as m
    monkeypatch.setattr(m, "PASSWORD", "geheim")
    assert client.get("/api/events").status_code == 401
    assert client.get("/api/events", auth=("papa", "geheim")).status_code == 200
