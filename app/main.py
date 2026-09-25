"""Flohmarkt-Finder – Webserver (FastAPI).

Start:  uvicorn app.main:app --host 0.0.0.0 --port 8080
"""
from __future__ import annotations

import base64
import hashlib
import logging
import os
import secrets
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import db, geo, scraper
from .classify import CATEGORY_LABELS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
STATIC = Path(__file__).resolve().parent / "static"
PASSWORD = os.environ.get("FLOHMARKT_PASSWORD", "")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    stop = threading.Event()
    if os.environ.get("FLOHMARKT_NO_SCHEDULER") != "1":
        threading.Thread(target=scraper.scheduler_loop, args=(stop,), name="scheduler", daemon=True).start()
    yield
    stop.set()


app = FastAPI(title="Flohmarkt-Finder", lifespan=lifespan, docs_url=None, redoc_url=None)


@app.middleware("http")
async def basic_auth(request: Request, call_next):
    """Optionaler Passwortschutz (Umgebungsvariable FLOHMARKT_PASSWORD, Benutzername beliebig)."""
    if PASSWORD and request.url.path not in ("/manifest.webmanifest", "/icon.svg"):
        header = request.headers.get("authorization", "")
        ok = False
        if header.lower().startswith("basic "):
            try:
                _, _, pw = base64.b64decode(header[6:]).decode().partition(":")
                ok = secrets.compare_digest(pw, PASSWORD)
            except Exception:  # noqa: BLE001
                ok = False
        if not ok:
            return Response(status_code=401, headers={"WWW-Authenticate": 'Basic realm="Flohmarkt-Finder"'})
    return await call_next(request)


# ---------- Termine ----------

def _decorate(ev: dict, home: tuple[float, float] | None) -> dict:
    ev["distance_km"] = None
    if home and ev.get("lat") is not None and ev.get("lon") is not None:
        ev["distance_km"] = round(geo.haversine_km(home[0], home[1], ev["lat"], ev["lon"]), 1)
    ev["category_label"] = CATEGORY_LABELS.get(ev.get("category") or "sonstiges", "Sonstiges")
    ev["favorite"] = bool(ev.get("favorite"))
    ev["hidden"] = bool(ev.get("hidden"))
    ev["is_service"] = bool(ev.get("is_service"))
    ev["date_certain"] = bool(ev.get("date_certain"))
    ev["manual"] = bool(ev.get("manual"))
    return ev


def _home(settings: dict):
    if settings.get("home_lat") is not None and settings.get("home_lon") is not None:
        return settings["home_lat"], settings["home_lon"]
    return None


@app.get("/api/events")
def api_events():
    settings = db.get_settings()
    home = _home(settings)
    events = [_decorate(e, home) for e in db.list_events()]
    return {"events": events, "categories": CATEGORY_LABELS, "today": date.today().isoformat()}


class StateIn(BaseModel):
    favorite: bool | None = None
    hidden: bool | None = None
    note: str | None = Field(default=None, max_length=2000)


@app.patch("/api/events/{event_id}/state")
def api_state(event_id: str, body: StateIn):
    if not db.get_event(event_id):
        raise HTTPException(404, "Termin nicht gefunden")
    return db.set_user_state(
        event_id,
        favorite=None if body.favorite is None else int(body.favorite),
        hidden=None if body.hidden is None else int(body.hidden),
        note=body.note,
    )


class ManualEventIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    start_date: date
    end_date: date | None = None
    time_text: str = Field(default="", max_length=80)
    address: str = Field(default="", max_length=300)
    category: str = "flohmarkt"
    description: str = Field(default="", max_length=5000)
    url: str = Field(default="", max_length=500)


@app.post("/api/events")
def api_add_event(body: ManualEventIn):
    end = body.end_date if body.end_date and body.end_date >= body.start_date else body.start_date
    ev = {
        "id": f"manual:{uuid.uuid4().hex[:12]}",
        "source": "eigener Eintrag",
        "title": body.title.strip(),
        "description": body.description.strip(),
        "url": body.url.strip() if body.url.strip().startswith(("http://", "https://")) else "",
        "image": "",
        "category": body.category if body.category in CATEGORY_LABELS else "sonstiges",
        "start_date": body.start_date.isoformat(),
        "end_date": end.isoformat(),
        "date_certain": 1,
        "time_text": body.time_text.strip(),
        "location": body.address.strip(),
        "address": body.address.strip(),
        "manual": 1,
        "detail_fetched": 1,
    }
    if ev["address"]:
        res = geo.geocode(ev["address"])
        if res:
            ev["lat"], ev["lon"] = res[0], res[1]
    db.upsert_event(ev)
    return _decorate(db.get_event(ev["id"]), _home(db.get_settings()))


@app.delete("/api/events/{event_id}")
def api_delete_event(event_id: str):
    ev = db.get_event(event_id)
    if not ev:
        raise HTTPException(404, "Termin nicht gefunden")
    if not ev["manual"]:
        raise HTTPException(400, "Nur selbst eingetragene Termine können gelöscht werden – andere bitte ausblenden")
    db.delete_event(event_id)
    return {"ok": True}


@app.post("/api/hidden/reset")
def api_reset_hidden():
    return {"restored": db.reset_hidden()}


# ---------- Kalender-Export (.ics) ----------

def _ics_escape(s: str) -> str:
    return (s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _ics_fold(line: str) -> str:
    out, cur = [], line
    while len(cur.encode()) > 74:
        cut = 74
        while len(cur[:cut].encode()) > 74:
            cut -= 1
        out.append(cur[:cut])
        cur = " " + cur[cut:]
    out.append(cur)
    return "\r\n".join(out)


def _vevent(ev: dict) -> list[str]:
    start = date.fromisoformat(ev["start_date"])
    end = date.fromisoformat(ev.get("end_date") or ev["start_date"]) + timedelta(days=1)
    desc = "\n".join(filter(None, [ev.get("time_text"), ev.get("description", "")[:1500], ev.get("url")]))
    uid = hashlib.sha1(ev["id"].encode()).hexdigest()
    lines = [
        "BEGIN:VEVENT",
        f"UID:{uid}@flohmarkt-finder",
        f"DTSTAMP:{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}",
        f"DTSTART;VALUE=DATE:{start.strftime('%Y%m%d')}",
        f"DTEND;VALUE=DATE:{end.strftime('%Y%m%d')}",
        f"SUMMARY:{_ics_escape(ev['title'] + (' (' + ev['time_text'] + ')' if ev.get('time_text') else ''))}",
        f"DESCRIPTION:{_ics_escape(desc)}",
        f"LOCATION:{_ics_escape(ev.get('address') or ev.get('location') or '')}",
    ]
    if ev.get("url"):
        lines.append(f"URL:{ev['url']}")
    if ev.get("lat") is not None:
        lines.append(f"GEO:{ev['lat']};{ev['lon']}")
    lines.append("END:VEVENT")
    return lines


def _ics_response(events: list[dict], filename: str) -> Response:
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Flohmarkt-Finder//DE", "CALSCALE:GREGORIAN",
             "X-WR-CALNAME:Flohmärkte"]
    for ev in events:
        if ev.get("start_date"):
            lines += _vevent(ev)
    lines.append("END:VCALENDAR")
    body = "\r\n".join(_ics_fold(line) for line in lines) + "\r\n"
    return Response(body, media_type="text/calendar; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.get("/api/events/{event_id}/ics")
def api_event_ics(event_id: str):
    ev = db.get_event(event_id)
    if not ev or not ev.get("start_date"):
        raise HTTPException(404, "Termin hat kein Datum")
    return _ics_response([ev], "termin.ics")


@app.get("/api/favorites.ics")
def api_favorites_ics():
    """Abonnierbarer Kalender mit allen gemerkten Terminen."""
    return _ics_response([e for e in db.list_events() if e["favorite"]], "flohmarkt-favoriten.ics")


# ---------- Einstellungen & Status ----------

class SettingsIn(BaseModel):
    home_query: str | None = Field(default=None, max_length=120)
    radius_km: float | None = Field(default=None, ge=1, le=500)
    days_ahead: int | None = Field(default=None, ge=1, le=90)
    refresh_hours: float | None = Field(default=None, ge=0.5, le=48)
    search_terms: list[str] | None = None
    kleinanzeigen_enabled: bool | None = None
    calendars_enabled: bool | None = None
    kleinanzeigen_pages: int | None = Field(default=None, ge=1, le=5)
    detail_fetch_limit: int | None = Field(default=None, ge=0, le=200)
    extra_urls: list[str] | None = None


@app.get("/api/settings")
def api_get_settings():
    return db.get_settings()


@app.put("/api/settings")
def api_put_settings(body: SettingsIn):
    values = body.model_dump(exclude_none=True)
    if "search_terms" in values:
        values["search_terms"] = [t.strip() for t in values["search_terms"] if t.strip()][:30]
    if "extra_urls" in values:
        values["extra_urls"] = [u.strip() for u in values["extra_urls"]
                                if u.strip().startswith(("http://", "https://"))][:30]
    current = db.get_settings()
    if "home_query" in values and values["home_query"].strip() != (current.get("home_query") or ""):
        q = values["home_query"].strip()
        if q:
            res = geo.geocode(q)
            if not res:
                raise HTTPException(400, f"Ort „{q}“ wurde nicht gefunden. Bitte PLZ oder Ortsnamen prüfen.")
            values.update(home_query=q, home_lat=res[0], home_lon=res[1], home_label=res[2])
        else:
            values.update(home_query="", home_lat=None, home_lon=None, home_label="")
    return db.save_settings(values)


@app.post("/api/refresh")
def api_refresh():
    started = scraper.run_in_background()
    return {"started": started, "running": True}


@app.get("/api/status")
def api_status():
    return {
        "running": scraper.state["running"],
        "message": scraper.state["message"],
        "last_finished": scraper.state["last_finished"],
        "runs": db.last_runs(),
        "total_events": db.count_events(),
        "server_time": time.time(),
    }


# ---------- Oberfläche ----------

@app.get("/")
def index():
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/sw.js")
def service_worker():
    return FileResponse(STATIC / "sw.js", media_type="application/javascript", headers={"Cache-Control": "no-cache"})


@app.get("/manifest.webmanifest")
def manifest():
    return FileResponse(STATIC / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/icon.svg")
def icon():
    return FileResponse(STATIC / "icon.svg", media_type="image/svg+xml")


app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.exception_handler(ValueError)
def value_error(_req: Request, exc: ValueError):
    return JSONResponse({"detail": str(exc)}, status_code=400)
