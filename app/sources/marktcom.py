"""marktcom.de – großer Kalender für Floh- und Trödelmärkte (öffentliche Terminlisten nach PLZ-Gebiet).

Die Liste nennt Titel, Datum, PLZ/Ort und einen Kurztext; Uhrzeit und genaue Adresse stehen auf der
Detailseite (schema.org/Event). Detailseiten werden nur für Termine im Umkreis und nur einmal gelesen.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from . import events_page
from .base import fetch, polite_pause

NAME = "marktcom.de"
BASE = "https://www.marktcom.de"
MAX_PAGES = 25
DATE_RE = re.compile(r"\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b")


def list_url(plz_start: str, page: int = 1) -> str:
    return f"{BASE}/termine/plz?q%5Bevent_plz_start%5D={plz_start}" + (f"&page={page}" if page > 1 else "")


def parse_list(html: str) -> list[dict]:
    """Termine einer Listenseite (gleiches Format wie events_page)."""
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for li in soup.select("li"):
        link = li.select_one(".eventname a[href]")
        if not link:
            continue
        m = DATE_RE.search(li.get_text(" "))
        if not m:
            continue
        try:
            day = date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            continue
        url = urljoin(BASE, link["href"])
        place_el = li.select_one(".d-md-none") or li.select_one(".text-right")
        place = re.sub(r"\s+", " ", place_el.get_text(" ")).strip() if place_el else ""
        venue_el = li.select_one("p.cat")
        venue = re.sub(r"\s+", " ", venue_el.get_text(" ")).strip() if venue_el else ""
        desc_el = li.select_one("p.description")
        desc = re.sub(r"\s*\[mehr\]\s*$", "", re.sub(r"\s+", " ", desc_el.get_text(" ")).strip()) if desc_el else ""
        kinds = [re.sub(r"\s+", " ", b.get_text(" ")).strip() for b in li.select(".badge")]
        kind = next((k for k in kinds if not DATE_RE.search(k) and re.search(r"markt|basar|börse", k, re.I)), "")
        slug = url.rstrip("/").rsplit("/", 1)[-1].split("?")[0]
        out.append({
            "ext_id": f"{slug}:{day.isoformat()}",
            "title": link.get_text(" ", strip=True),
            "description": "\n".join(x for x in (desc, f"Veranstalter/Ort: {venue}" if venue else "", kind) if x)[:1500],
            "url": url,
            "image": "",
            "start": day,
            "end": day,
            "time_text": "",
            "location": place,
            "address": place,
            "lat": None,
            "lon": None,
            "certain": True,
        })
    return out


def enrich(client, item: dict) -> None:
    """Uhrzeit und genaue Adresse von der Detailseite ergänzen."""
    try:
        html = fetch(client, item["url"])
    except Exception:  # noqa: BLE001
        return
    for ev in events_page.parse_html(html, item["url"]):
        if ev["start"] <= item["start"] <= ev["end"] or ev["start"] == item["start"]:
            if ev.get("time_text"):
                item["time_text"] = ev["time_text"]
            if ev.get("address") and re.search(r"\d{5}", ev["address"]):
                item["address"] = ev["address"]
            if ev.get("lat") is not None:
                item["lat"], item["lon"] = ev["lat"], ev["lon"]
            break
    if not item["time_text"]:  # "Sa. 26.09.2026 12:00 - 20:00 Uhr"
        d = item["start"].strftime("%d.%m.%Y")
        m = re.search(re.escape(d) + r"\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*Uhr", BeautifulSoup(html, "html.parser").get_text(" "))
        if m:
            item["time_text"] = f"{m.group(1)}–{m.group(2)} Uhr"


def scrape(client, plz_starts: list[str], until: date, log_msg=None) -> list[dict]:
    """Alle Termine der PLZ-Gebiete (erste Ziffer) bis zum Datum `until`."""
    today = date.today()
    items: dict[str, dict] = {}
    for start in plz_starts:
        for page in range(1, MAX_PAGES + 1):
            polite_pause(1.0, 2.0)
            try:
                found = parse_list(fetch(client, list_url(start, page)))
            except Exception as e:  # noqa: BLE001
                if log_msg:
                    log_msg(f"marktcom.de PLZ {start} Seite {page}: {e}")
                if page == 1:
                    raise
                break
            if not found:
                break
            for it in found:
                if today - timedelta(days=1) <= it["start"] <= until:
                    items.setdefault(it["ext_id"], it)
            if min(it["start"] for it in found) > until:
                break
    return list(items.values())
