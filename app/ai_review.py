"""Claude als Prüfer (optional, braucht ANTHROPIC_API_KEY).

1. review_new_events(): Prüft jede neue Anzeige genau einmal – ist es wirklich ein Flohmarkt /
   eine Haushaltsauflösung o.ä. mit Termin (keine Einzelartikel, Firmenwerbung, Nachrichten)?
   Stimmen Datum, Uhrzeit und Adresse? Korrigierte Adressen werden neu verortet; der Umkreis
   (z.B. 100 km um Kiel-Elmschenhagen) wird danach wie immer nachgerechnet.
2. extract_events_from_page(): Liest Termine aus Webseiten, bei denen der einfache Leser nichts
   findet. Das Ergebnis wird pro Seiteninhalt zwischengespeichert – Claude liest eine Seite nur
   neu, wenn sie sich geändert hat.

Ohne API-Key läuft alles wie bisher, nur ohne diese Prüfung.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from datetime import date, datetime
from typing import Literal, Optional

from bs4 import BeautifulSoup
from pydantic import BaseModel, Field

from . import db

log = logging.getLogger(__name__)

DEFAULT_MODEL = "claude-sonnet-5"   # gute Genauigkeit zu vernünftigem Preis
FALLBACK_MODEL = "claude-haiku-4-5"  # falls das eingestellte Modell nicht verfügbar ist
BATCH = 15               # Anzeigen pro Anfrage
MAX_REVIEWS_PER_RUN = 90  # Obergrenze pro Suchlauf (Kosten)
MAX_PAGE_CHARS = 60_000  # sehr lange Seiten werden gekürzt (wird im Log vermerkt)

Category = Literal["dorf", "strasse", "flohmarkt", "hof", "haushalt", "kinder", "antik", "sonstiges"]


class Verdict(BaseModel):
    id: str
    is_event: bool = Field(description="True nur bei echter Veranstaltung/Verkauf vor Ort mit Termin")
    category: Category
    start_date: Optional[str] = Field(None, description="YYYY-MM-DD, nur wenn im Text eindeutig")
    end_date: Optional[str] = Field(None, description="YYYY-MM-DD")
    time_text: Optional[str] = Field(None, description='z.B. "10–16 Uhr" oder "ab 9 Uhr"')
    address: Optional[str] = Field(None, description="Straße, PLZ Ort – so genau wie im Text angegeben")
    reason: str = Field(description="kurze Begründung auf Deutsch")


class Verdicts(BaseModel):
    items: list[Verdict]


class PageEvent(BaseModel):
    title: str
    category: Category
    start_date: str = Field(description="YYYY-MM-DD")
    end_date: Optional[str] = None
    time_text: Optional[str] = None
    address: Optional[str] = Field(None, description="Straße, PLZ Ort, falls angegeben")
    description: Optional[str] = None
    url: Optional[str] = Field(None, description="Link zum Termin, falls auf der Seite vorhanden")


class PageEvents(BaseModel):
    events: list[PageEvent]


REVIEW_SYSTEM = """Du prüfst Anzeigen für eine Flohmarkt-App eines älteren Herrn in Kiel-Elmschenhagen.
In die App gehören NUR Veranstaltungen bzw. Verkäufe vor Ort mit Termin: Flohmärkte, Hof-/Garagen-/Hausflohmärkte,
Haushalts-/Wohnungsauflösungen mit Verkauf vor Ort, Trödel-/Antikmärkte, Kinderflohmärkte und Basare.
NICHT hinein gehören: einzelne Artikel oder Konvolute zum Kauf ("Vase aus Haushaltsauflösung", "Karton Flohmarktartikel"),
Werbung von Entrümpelungs-/Ankauf-Firmen, Gesuche, Nachrichten oder Berichte über vergangene Märkte, Stände zu verkaufen.
Kategorien: "dorf" = Dorf-Flohmarkt (ein ganzes Dorf macht mit), "strasse" = Straßen-Flohmarkt (Anwohner einer
Straße/eines Viertels verkaufen vor ihren Häusern), "hof" = einzelner Hof-/Garagenflohmarkt, "haushalt" = Haushaltsauflösung,
"kinder" = Kinderflohmarkt/Basar, "antik" = Trödel-/Antikmarkt, "flohmarkt" = sonstiger Flohmarkt.
Prüfe außerdem Datum (Bezugsdatum steht dabei), Uhrzeit und Adresse und gib sie korrigiert zurück, wenn der Text sie
eindeutig nennt. Erfinde nichts: Was nicht im Text steht, bleibt leer (null)."""

EXTRACT_SYSTEM = """Du liest Termine aus dem Text einer Webseite für eine Flohmarkt-App (Region Kiel / Schleswig-Holstein).
Gib nur Termine zurück, die ab dem Bezugsdatum stattfinden: Flohmärkte, Hof-/Garagenflohmärkte, Haushaltsauflösungen mit
Verkauf vor Ort, Trödel-/Antikmärkte, Kinderflohmärkte, Basare. Keine Nachrichten, keine Werbung, keine vergangenen Termine.
Kategorien: "dorf" = Dorf-Flohmarkt, "strasse" = Straßen-Flohmarkt, "hof", "haushalt", "kinder", "antik", "flohmarkt".
Datum immer als YYYY-MM-DD (fehlt das Jahr, das nächste passende ab dem Bezugsdatum). Erfinde nichts."""


# Letzter Fehler von Claude in verständlichen Worten (wird in der App unter "Quellen" angezeigt)
last_error: str = ""


def enabled() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY", "").strip())


def _explain(status: int, message: str) -> str:
    m = (message or "").lower()
    if status == 401:
        return "API-Key ungültig – bitte neuen Key erstellen und bei GitHub als Secret ANTHROPIC_API_KEY eintragen"
    if status == 403:
        return "API-Key hat keine Berechtigung (Workspace/Organisation prüfen)"
    if "credit" in m or "balance" in m or "billing" in m:
        return "Kein Guthaben – bitte unter platform.claude.com → Abrechnung Credits kaufen bzw. Karte verifizieren"
    if status == 404 or "model" in m:
        return f"Modell nicht verfügbar ({message})"
    return f"Fehler {status}: {message}"


def _client():
    import anthropic
    return anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"].strip())


def _model(settings: dict) -> str:
    return str(settings.get("claude_model") or DEFAULT_MODEL)


def _call(settings: dict, system: str, user: str, schema):
    """Eine Anfrage mit strukturierter Antwort; gibt das geprüfte Objekt zurück (oder None)."""
    import anthropic
    model = _model(settings)
    extra = {}
    if "haiku" not in model:
        extra["output_config"] = {"effort": "low"}  # Einordnen/Auslesen braucht wenig Denkaufwand (Haiku kennt kein effort)
    try:
        try:
            resp = _client().messages.parse(
                model=model,
                max_tokens=16000,
                system=system,
                messages=[{"role": "user", "content": user}],
                output_format=schema,
                **extra,
            )
        except anthropic.NotFoundError:
            if model == FALLBACK_MODEL:
                raise
            log.warning("Claude: Modell %s nicht verfügbar – nehme %s", model, FALLBACK_MODEL)
            resp = _client().messages.parse(
                model=FALLBACK_MODEL,
                max_tokens=16000,
                system=system,
                messages=[{"role": "user", "content": user}],
                output_format=schema,
            )
    except anthropic.RateLimitError as e:
        _fail(f"Anfragelimit erreicht – nächster Lauf versucht es wieder ({e.message})")
        return None
    except anthropic.APIStatusError as e:
        _fail(_explain(e.status_code, e.message))
        return None
    except anthropic.APIConnectionError as e:
        _fail(f"keine Verbindung zu Claude ({e})")
        return None
    if resp.stop_reason == "refusal":
        log.warning("Claude hat die Anfrage abgelehnt")
        return None
    if resp.stop_reason == "max_tokens":
        log.warning("Claude: Antwort zu lang, abgeschnitten")
        return None
    global last_error
    last_error = ""
    usage = resp.usage
    db.add_ai_usage(usage.input_tokens, usage.output_tokens)
    return resp.parsed_output


def _fail(msg: str) -> None:
    global last_error
    last_error = msg[:300]
    log.warning("Claude: %s", msg)


# ---------- 1. Anzeigen prüfen ----------

def review_new_events(settings: dict) -> dict:
    """Prüft noch nicht geprüfte Anzeigen. Gibt eine kleine Statistik zurück."""
    stats = {"checked": 0, "rejected": 0, "corrected": 0, "error": ""}
    todo = db.events_for_ai_review(MAX_REVIEWS_PER_RUN)
    for i in range(0, len(todo), BATCH):
        batch = todo[i:i + BATCH]
        lines = []
        for e in batch:
            ref = e.get("posted_at") or date.today().isoformat()
            lines.append(json.dumps({
                "id": e["id"], "bezugsdatum": ref, "titel": e["title"], "preis": e.get("price") or "",
                "ort_laut_anzeige": e.get("address") or e.get("location") or "",
                "erkanntes_datum": e.get("start_date"), "text": (e.get("description") or "")[:2500],
            }, ensure_ascii=False))
        user = ("Heute ist " + date.today().isoformat() + ". Prüfe diese Anzeigen (eine pro Zeile, JSON) und gib für "
                "jede genau ein Ergebnis mit derselben id zurück:\n\n" + "\n".join(lines))
        result = _call(settings, REVIEW_SYSTEM, user, Verdicts)
        if result is None:
            stats["error"] = last_error or "keine Antwort von Claude"
            break
        by_id = {v.id: v for v in result.items}
        for e in batch:
            v = by_id.get(e["id"])
            if v is None:
                continue
            changes: dict = {"ai_checked": 1, "ai_verdict": int(v.is_event), "ai_note": v.reason[:300]}
            if v.is_event:
                changes["category"] = v.category if v.category != "sonstiges" else e.get("category")
                if _valid_date(v.start_date) and v.start_date != e.get("start_date"):
                    changes.update(start_date=v.start_date, end_date=v.end_date if _valid_date(v.end_date) else v.start_date,
                                   date_certain=1)
                    stats["corrected"] += 1
                if v.time_text and not e.get("time_text"):
                    changes["time_text"] = v.time_text[:60]
                if v.address and _better_address(v.address, e.get("address") or ""):
                    changes.update(address=v.address[:200], lat=None, lon=None)  # neu verorten
                    stats["corrected"] += 1
            else:
                changes["relevant"] = 0
                stats["rejected"] += 1
            db.update_event_fields(e["id"], changes)
            stats["checked"] += 1
    return stats


def _valid_date(s: Optional[str]) -> bool:
    try:
        datetime.strptime(s or "", "%Y-%m-%d")
        return True
    except ValueError:
        return False


def _better_address(new: str, old: str) -> bool:
    """Neue Adresse nur übernehmen, wenn sie genauer ist (z.B. Straße oder PLZ ergänzt)."""
    new_n, old_n = new.strip().lower(), old.strip().lower()
    if not new_n or new_n == old_n:
        return False
    has_plz = bool(re.search(r"\b\d{5}\b", new_n))
    return has_plz and (len(new_n) > len(old_n) or not re.search(r"\b\d{5}\b", old_n))


# ---------- 2. Termine aus Webseiten lesen ----------

def page_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for t in soup(["script", "style", "noscript", "svg", "form"]):
        t.decompose()
    for a in soup.find_all("a", href=True):  # Links als Text behalten (für Detail-Links)
        a.append(f" [{a['href']}]")
    return re.sub(r"\n\s*\n+", "\n", soup.get_text("\n")).strip()


def extract_events_from_page(settings: dict, url: str, html: str) -> list[dict] | None:
    """Termine aus einer Seite (Format wie events_page). None = nicht möglich (kein Key/Fehler)."""
    text = page_text(html)
    if len(text) > MAX_PAGE_CHARS:
        log.info("Seite %s ist sehr lang (%d Zeichen) – Claude liest die ersten %d", url, len(text), MAX_PAGE_CHARS)
        text = text[:MAX_PAGE_CHARS]
    digest = hashlib.sha256(f"{date.today().isoformat()[:7]}|{text}".encode()).hexdigest()
    cached = db.ai_page_get(url, digest)
    if cached is not None:
        return cached
    user = f"Heute ist {date.today().isoformat()}. Seite: {url}\n\nText der Seite:\n{text}"
    result = _call(settings, EXTRACT_SYSTEM, user, PageEvents)
    if result is None:
        return None
    items = []
    for ev in result.events:
        if not _valid_date(ev.start_date):
            continue
        start = date.fromisoformat(ev.start_date)
        end = date.fromisoformat(ev.end_date) if _valid_date(ev.end_date) else start
        uid = hashlib.sha1(f"{ev.title}|{start}".encode()).hexdigest()[:16]
        items.append({
            "ext_id": uid, "title": ev.title[:150], "description": (ev.description or "")[:1500],
            "url": ev.url if (ev.url or "").startswith("http") else url, "image": "",
            "start": start, "end": end if end >= start else start, "time_text": ev.time_text or "",
            "location": ev.address or "", "address": ev.address or "", "lat": None, "lon": None,
            "category_hint": ev.category,
        })
    db.ai_page_put(url, digest, items)
    return items
