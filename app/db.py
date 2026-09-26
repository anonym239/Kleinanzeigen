"""SQLite-Speicher für Termine, Favoriten, Einstellungen und Geo-Cache."""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import date, timedelta
from pathlib import Path

DB_PATH = Path(os.environ.get("FLOHMARKT_DB", Path(__file__).resolve().parent.parent / "data" / "flohmarkt.db"))
_init_lock = threading.Lock()
_initialized: set[str] = set()

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    url TEXT DEFAULT '',
    image TEXT DEFAULT '',
    category TEXT DEFAULT 'sonstiges',
    start_date TEXT,
    end_date TEXT,
    date_certain INTEGER DEFAULT 0,
    time_text TEXT DEFAULT '',
    location TEXT DEFAULT '',
    address TEXT DEFAULT '',
    lat REAL,
    lon REAL,
    price TEXT DEFAULT '',
    is_service INTEGER DEFAULT 0,
    posted_at TEXT,
    first_seen REAL NOT NULL,
    last_seen REAL NOT NULL,
    manual INTEGER DEFAULT 0,
    detail_fetched INTEGER DEFAULT 0,
    relevant INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_date);
CREATE TABLE IF NOT EXISTS user_state (
    event_id TEXT PRIMARY KEY,
    favorite INTEGER DEFAULT 0,
    hidden INTEGER DEFAULT 0,
    note TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS geocache (query TEXT PRIMARY KEY, lat REAL, lon REAL, name TEXT, ts REAL);
CREATE TABLE IF NOT EXISTS ai_pages (url TEXT PRIMARY KEY, digest TEXT, items TEXT, ts REAL);
CREATE TABLE IF NOT EXISTS ai_usage (day TEXT PRIMARY KEY, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT, started REAL, finished REAL, ok INTEGER, found INTEGER, message TEXT
);
"""

DEFAULT_SETTINGS = {
    "home_query": "",          # PLZ oder Ort, z.B. "50667" oder "Köln"
    "home_label": "",
    "start_query": "",         # Standard-Startpunkt für Entfernungen/Routen (nur Anzeige, Suchgebiet bleibt "home")
    "start_lat": None,
    "start_lon": None,
    "home_lat": None,
    "home_lon": None,
    "radius_km": 50,
    "days_ahead": 14,
    "refresh_hours": 3,
    "search_terms": [
        "Flohmarkt", "Hofflohmarkt", "Garagenflohmarkt", "Haushaltsauflösung",
        "Wohnungsauflösung", "Nachlass Verkauf", "Trödelmarkt", "Kinderflohmarkt", "Dorfflohmarkt", "Straßenflohmarkt",
    ],
    "kleinanzeigen_enabled": True,
    "calendars_enabled": True,
    "kn_enabled": True,         # Kieler Nachrichten (RSS-Feeds, nur Termine)  # Flohmarkt-Terminkalender (krencky24.de / meine-flohmarkt-termine.de)
    "kleinanzeigen_pages": 2,
    "detail_fetch_limit": 40,
    "extra_urls": [],          # Webseiten mit Veranstaltungskalender (schema.org/Event)
    "keep_past_days": 3,
    "site_url": "",
    "claude_model": "",        # leer = Standardmodell (siehe app/ai_review.py)            # Adresse der veröffentlichten Webseite (Netlify), für die App
}


@contextmanager
def connect():
    path = str(DB_PATH)
    if path not in _initialized:
        with _init_lock:
            if path not in _initialized:
                DB_PATH.parent.mkdir(parents=True, exist_ok=True)
                c = sqlite3.connect(path)
                c.executescript(SCHEMA)
                cols = {r[1] for r in c.execute("PRAGMA table_info(events)")}
                for col, decl in (("relevant", "INTEGER DEFAULT 1"), ("ai_checked", "INTEGER DEFAULT 0"),
                                  ("ai_verdict", "INTEGER"), ("ai_note", "TEXT DEFAULT ''")):
                    if col not in cols:  # ältere Datenbanken nachrüsten
                        c.execute(f"ALTER TABLE events ADD COLUMN {col} {decl}")
                c.execute("PRAGMA journal_mode=WAL")
                c.commit()
                c.close()
                _initialized.add(path)
    conn = sqlite3.connect(path, timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


# ---------- Einstellungen ----------

def get_settings() -> dict:
    with connect() as c:
        rows = c.execute("SELECT key, value FROM settings").fetchall()
    s = dict(DEFAULT_SETTINGS)
    for r in rows:
        if r["key"] in DEFAULT_SETTINGS:
            s[r["key"]] = json.loads(r["value"])
    return s


def save_settings(values: dict) -> dict:
    with connect() as c:
        for k, v in values.items():
            if k in DEFAULT_SETTINGS:
                c.execute("INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)", (k, json.dumps(v)))
    return get_settings()


# ---------- Geo-Cache ----------

def geocache_get(query: str):
    with connect() as c:
        r = c.execute("SELECT lat, lon, name FROM geocache WHERE query = ?", (query,)).fetchone()
    if r is None:
        return None
    return (r["lat"], r["lon"], r["name"])


def geocache_put(query: str, res) -> None:
    lat, lon, name = res if res else (None, None, None)
    with connect() as c:
        c.execute("INSERT OR REPLACE INTO geocache VALUES (?, ?, ?, ?, ?)", (query, lat, lon, name, time.time()))


# ---------- Termine ----------

EVENT_FIELDS = [
    "title", "description", "url", "image", "category", "start_date", "end_date", "date_certain",
    "time_text", "location", "address", "lat", "lon", "price", "is_service", "posted_at", "manual",
    "detail_fetched", "relevant",
]


def upsert_event(ev: dict) -> bool:
    """Speichert einen Termin. Gibt True zurück, wenn er neu ist."""
    now = time.time()
    with connect() as c:
        exists = c.execute("SELECT 1 FROM events WHERE id = ?", (ev["id"],)).fetchone()
        if exists:
            fields = [f for f in EVENT_FIELDS if f in ev]
            c.execute(
                f"UPDATE events SET {', '.join(f + ' = ?' for f in fields)}, last_seen = ? WHERE id = ?",
                [ev[f] for f in fields] + [now, ev["id"]],
            )
            return False
        fields = [f for f in EVENT_FIELDS if f in ev]
        c.execute(
            f"INSERT INTO events (id, source, first_seen, last_seen, {', '.join(fields)}) "
            f"VALUES (?, ?, ?, ?, {', '.join('?' for _ in fields)})",
            [ev["id"], ev["source"], now, now] + [ev[f] for f in fields],
        )
        return True


def get_event(event_id: str) -> dict | None:
    with connect() as c:
        r = c.execute(
            "SELECT e.*, COALESCE(u.favorite,0) favorite, COALESCE(u.hidden,0) hidden, COALESCE(u.note,'') note "
            "FROM events e LEFT JOIN user_state u ON u.event_id = e.id WHERE e.id = ?",
            (event_id,),
        ).fetchone()
    return dict(r) if r else None


def known_detail_ids(ids: list[str]) -> set[str]:
    if not ids:
        return set()
    with connect() as c:
        rows = c.execute(
            f"SELECT id FROM events WHERE detail_fetched = 1 AND id IN ({','.join('?' for _ in ids)})", ids
        ).fetchall()
    return {r["id"] for r in rows}


def list_events(undated_max_age_days: int = 21) -> list[dict]:
    """Alle aktuellen Termine: ab gestern, plus Anzeigen ohne erkanntes Datum, die noch frisch sind."""
    today = date.today()
    min_seen = time.time() - undated_max_age_days * 86400
    with connect() as c:
        rows = c.execute(
            "SELECT e.*, COALESCE(u.favorite,0) favorite, COALESCE(u.hidden,0) hidden, COALESCE(u.note,'') note "
            "FROM events e LEFT JOIN user_state u ON u.event_id = e.id "
            "WHERE e.relevant = 1 AND ((COALESCE(e.end_date, e.start_date) >= ?) "
            "   OR (e.start_date IS NULL AND e.last_seen >= ?) "
            "   OR COALESCE(u.favorite,0) = 1) "
            "ORDER BY e.start_date IS NULL, e.start_date, e.first_seen DESC",
            ((today - timedelta(days=1)).isoformat(), min_seen),
        ).fetchall()
    return dedupe([dict(r) for r in rows])


def _norm_title(t: str) -> str:
    import re
    t = re.sub(r"[^a-z0-9äöüß]+", " ", (t or "").lower())
    return re.sub(r"\b(der|die|das|in|im|am|an|auf|und|mit|von)\b", " ", t).split().__str__()[:60]


def dedupe(events: list[dict]) -> list[dict]:
    """Derselbe Termin steht oft auf mehreren Kalender-Seiten – nur einmal zeigen.

    Gleich = gleicher Tag und gleicher (normalisierter) Titel; Favoriten/Notizen haben Vorrang.
    """
    seen: dict[tuple, int] = {}
    out: list[dict] = []
    for e in events:
        if not e.get("start_date") or e.get("source") == "kleinanzeigen" or e.get("manual"):
            out.append(e)
            continue
        key = (e["start_date"], _norm_title(e["title"]))
        if key in seen:
            prev = out[seen[key]]
            if (e.get("favorite") or e.get("note")) and not (prev.get("favorite") or prev.get("note")):
                out[seen[key]] = e
            continue
        seen[key] = len(out)
        out.append(e)
    return out


def set_user_state(event_id: str, **values) -> dict:
    allowed = {k: v for k, v in values.items() if k in ("favorite", "hidden", "note") and v is not None}
    with connect() as c:
        c.execute("INSERT OR IGNORE INTO user_state(event_id) VALUES (?)", (event_id,))
        for k, v in allowed.items():
            c.execute(f"UPDATE user_state SET {k} = ? WHERE event_id = ?", (v, event_id))
        r = c.execute("SELECT * FROM user_state WHERE event_id = ?", (event_id,)).fetchone()
    return dict(r)


def reset_hidden() -> int:
    with connect() as c:
        return c.execute("UPDATE user_state SET hidden = 0 WHERE hidden = 1").rowcount


def delete_scraped_events() -> int:
    """Entfernt alle gefundenen (nicht selbst eingetragenen) Termine, z.B. nach Wechsel des Suchgebiets."""
    with connect() as c:
        n = c.execute("DELETE FROM events WHERE manual = 0").rowcount
        c.execute("DELETE FROM user_state WHERE event_id NOT IN (SELECT id FROM events)")
        c.execute("DELETE FROM runs")  # Statistik des alten Gebiets ist nicht mehr aussagekräftig
    return n


def delete_event(event_id: str) -> bool:
    with connect() as c:
        n = c.execute("DELETE FROM events WHERE id = ?", (event_id,)).rowcount
        c.execute("DELETE FROM user_state WHERE event_id = ?", (event_id,))
    return n > 0


def cleanup(keep_past_days: int) -> int:
    """Löscht vergangene Termine (außer Favoriten) und alte Anzeigen ohne Datum."""
    cutoff = (date.today() - timedelta(days=keep_past_days)).isoformat()
    old_seen = time.time() - 30 * 86400
    with connect() as c:
        n = c.execute(
            "DELETE FROM events WHERE id NOT IN (SELECT event_id FROM user_state WHERE favorite = 1) AND ("
            " (start_date IS NOT NULL AND COALESCE(end_date, start_date) < ?)"
            " OR (start_date IS NULL AND last_seen < ?))",
            (cutoff, old_seen),
        ).rowcount
        c.execute("DELETE FROM user_state WHERE event_id NOT IN (SELECT id FROM events)")
        c.execute("DELETE FROM runs WHERE id NOT IN (SELECT id FROM runs ORDER BY id DESC LIMIT 200)")
    return n


# ---------- Läufe / Status ----------

def log_run(source: str, started: float, ok: bool, found: int, message: str = "") -> None:
    with connect() as c:
        c.execute(
            "INSERT INTO runs(source, started, finished, ok, found, message) VALUES (?, ?, ?, ?, ?, ?)",
            (source, started, time.time(), int(ok), found, message[:500]),
        )


def last_runs() -> list[dict]:
    with connect() as c:
        rows = c.execute(
            "SELECT r.* FROM runs r JOIN (SELECT source, MAX(id) mid FROM runs GROUP BY source) x ON x.mid = r.id "
            "ORDER BY r.source"
        ).fetchall()
    return [dict(r) for r in rows]


def count_events() -> int:
    with connect() as c:
        return c.execute("SELECT COUNT(*) FROM events").fetchone()[0]


# ---------- Claude-Prüfung ----------

AI_FIELDS = {"ai_checked", "ai_verdict", "ai_note", "relevant", "category", "start_date", "end_date",
             "date_certain", "time_text", "address", "lat", "lon"}


def events_for_ai_review(limit: int) -> list[dict]:
    """Noch nicht geprüfte Anzeigen (Kleinanzeigen, Kieler Nachrichten, eigene Quellen), neueste zuerst.

    Die Flohmarkt-Kalender liefern strukturierte Termine und werden nicht geprüft.
    """
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    with connect() as c:
        rows = c.execute(
            "SELECT * FROM events WHERE ai_checked = 0 AND manual = 0 AND is_service = 0 AND relevant = 1 "
            "AND source NOT IN ('krencky24.de', 'meine-flohmarkt-termine.de') "
            "AND (start_date IS NULL OR COALESCE(end_date, start_date) >= ?) "
            "ORDER BY first_seen DESC LIMIT ?",
            (yesterday, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def update_event_fields(event_id: str, values: dict) -> None:
    values = {k: v for k, v in values.items() if k in AI_FIELDS}
    if not values:
        return
    with connect() as c:
        c.execute(f"UPDATE events SET {', '.join(k + ' = ?' for k in values)} WHERE id = ?",
                  [*values.values(), event_id])


def events_without_coords() -> list[dict]:
    with connect() as c:
        rows = c.execute("SELECT * FROM events WHERE relevant = 1 AND lat IS NULL AND manual = 0").fetchall()
    return [dict(r) for r in rows]


def ai_page_get(url: str, digest: str):
    with connect() as c:
        r = c.execute("SELECT items FROM ai_pages WHERE url = ? AND digest = ?", (url, digest)).fetchone()
    if r is None:
        return None
    items = json.loads(r["items"])
    for it in items:
        it["start"] = date.fromisoformat(it["start"])
        it["end"] = date.fromisoformat(it["end"])
    return items


def ai_page_put(url: str, digest: str, items: list[dict]) -> None:
    data = json.dumps([{**it, "start": it["start"].isoformat(), "end": it["end"].isoformat()} for it in items])
    with connect() as c:
        c.execute("INSERT OR REPLACE INTO ai_pages VALUES (?, ?, ?, ?)", (url, digest, data, time.time()))


def add_ai_usage(input_tokens: int, output_tokens: int) -> None:
    day = date.today().isoformat()
    with connect() as c:
        c.execute("INSERT OR IGNORE INTO ai_usage(day) VALUES (?)", (day,))
        c.execute("UPDATE ai_usage SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ? WHERE day = ?",
                  (input_tokens, output_tokens, day))


def ai_summary() -> dict:
    """Kleine Übersicht für die Einstellungen: geprüfte/aussortierte Anzeigen und Verbrauch (30 Tage)."""
    since = (date.today() - timedelta(days=30)).isoformat()
    with connect() as c:
        checked = c.execute("SELECT COUNT(*) FROM events WHERE ai_checked = 1").fetchone()[0]
        rejected = c.execute("SELECT COUNT(*) FROM events WHERE ai_checked = 1 AND ai_verdict = 0").fetchone()[0]
        u = c.execute("SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0) FROM ai_usage WHERE day >= ?",
                      (since,)).fetchone()
    return {"checked": checked, "rejected": rejected, "input_tokens_30d": u[0], "output_tokens_30d": u[1]}
