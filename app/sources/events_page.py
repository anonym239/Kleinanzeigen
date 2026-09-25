"""Allgemeine Quelle für Webseiten mit Veranstaltungskalender.

Viele Flohmarkt-Kalender, Stadtportale und Veranstalter-Seiten hinterlegen ihre Termine
maschinenlesbar als schema.org/Event (JSON-LD oder Microdata) oder bieten einen
iCal-Feed (.ics) an. Diese Quelle liest beides – ohne API-Key.
"""
from __future__ import annotations

import hashlib
import html as htmlmod
import json
import re
from datetime import date, datetime, timedelta
from typing import Iterator
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from .base import fetch

EVENT_TYPES = {"event", "saleevent", "socialevent", "festival", "exhibitionevent", "businessevent",
               "childrensevent", "communityevent"}


def _clean(s) -> str:
    return re.sub(r"\s+", " ", htmlmod.unescape(str(s or ""))).strip()


def _to_date(v) -> date | None:
    if not v:
        return None
    s = str(v).strip()
    for fmt in ("%Y-%m-%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(s[:10], fmt).date()
        except ValueError:
            pass
    return None


def _time_of(v) -> str:
    m = re.search(r"T(\d{2}):(\d{2})", str(v or ""))
    if not m or (m.group(1), m.group(2)) == ("00", "00"):
        return ""
    h, mi = int(m.group(1)), m.group(2)
    return f"{h}:{mi}" if mi != "00" else f"{h}"


def _address(loc) -> tuple[str, str, float | None, float | None]:
    """-> (Ortsname, Adresse, lat, lon)"""
    if isinstance(loc, list):
        loc = loc[0] if loc else None
    if isinstance(loc, str):
        return loc, loc, None, None
    if not isinstance(loc, dict):
        return "", "", None, None
    name = _clean(loc.get("name"))
    addr = loc.get("address")
    if isinstance(addr, dict):
        parts = [addr.get("streetAddress"), " ".join(filter(None, [addr.get("postalCode"), addr.get("addressLocality")]))]
        address = ", ".join(_clean(p) for p in parts if _clean(p))
    else:
        address = _clean(addr)
    lat = lon = None
    geo = loc.get("geo")
    if isinstance(geo, dict):
        try:
            lat, lon = float(geo.get("latitude")), float(geo.get("longitude"))
        except (TypeError, ValueError):
            pass
    return name, address or name, lat, lon


def _walk_jsonld(node) -> Iterator[dict]:
    if isinstance(node, list):
        for n in node:
            yield from _walk_jsonld(n)
    elif isinstance(node, dict):
        types = node.get("@type")
        types = types if isinstance(types, list) else [types]
        if any(isinstance(t, str) and t.lower() in EVENT_TYPES for t in types):
            yield node
        for key in ("@graph", "itemListElement", "item", "subEvent", "event", "events"):
            if key in node:
                yield from _walk_jsonld(node[key])


def _make(page_url: str, name, start, end, desc, url, image, location) -> dict | None:
    s = _to_date(start)
    if not name or not s:
        return None
    e = _to_date(end) or s
    if (e - s).days > 60:  # Dauerveranstaltungen (z.B. wöchentlicher Markt über Monate) auf Starttag begrenzen
        e = s
    loc_name, address, lat, lon = _address(location)
    t1, t2 = _time_of(start), _time_of(end)
    time_text = f"{t1}–{t2} Uhr" if t1 and t2 else (f"ab {t1} Uhr" if t1 else "")
    if isinstance(image, list):
        image = image[0] if image else ""
    if isinstance(image, dict):
        image = image.get("url", "")
    full_url = urljoin(page_url, str(url)) if url else page_url
    uid = hashlib.sha1(f"{_clean(name)}|{s}|{address}".encode()).hexdigest()[:16]
    return {
        "ext_id": uid,
        "title": _clean(name),
        "description": _clean(BeautifulSoup(str(desc or ""), "html.parser").get_text(" "))[:3000],
        "url": full_url,
        "image": urljoin(page_url, str(image)) if image else "",
        "start": s,
        "end": e,
        "time_text": time_text,
        "location": loc_name or address,
        "address": address,
        "lat": lat,
        "lon": lon,
    }


def parse_html(html: str, page_url: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    out: list[dict] = []
    for tag in soup.find_all("script", type="application/ld+json"):
        raw = tag.string or tag.get_text()
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            continue
        for ev in _walk_jsonld(data):
            item = _make(page_url, ev.get("name"), ev.get("startDate"), ev.get("endDate"), ev.get("description"),
                         ev.get("url"), ev.get("image"), ev.get("location"))
            if item:
                out.append(item)
    # Microdata: <div itemscope itemtype="https://schema.org/Event">
    for el in soup.select("[itemscope][itemtype*='schema.org/']"):
        itype = el.get("itemtype", "").rstrip("/").rsplit("/", 1)[-1].lower()
        if itype not in EVENT_TYPES:
            continue

        def prop(name, _el=el):
            p = _el.find(attrs={"itemprop": name})
            if p is None:
                return None
            return p.get("content") or p.get("datetime") or p.get("href") or p.get("src") or p.get_text(" ")

        loc_el = el.find(attrs={"itemprop": "location"})
        location = _clean(loc_el.get_text(" ")) if loc_el else ""
        item = _make(page_url, _clean(prop("name")), prop("startDate") or prop("date"), prop("endDate"), prop("description"),
                     prop("url"), prop("image"), location)
        if item:
            out.append(item)
    return out


def _unfold_ics(text: str) -> list[str]:
    return re.sub(r"\r?\n[ \t]", "", text).splitlines()


def _ics_unescape(v: str) -> str:
    return v.replace("\\n", "\n").replace("\\N", "\n").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")


def _ics_dt(v: str):
    m = re.match(r"(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?", v)
    if not m:
        return None, ""
    d = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    t = ""
    if m.group(4) and (m.group(4), m.group(5)) != ("00", "00"):
        t = f"{int(m.group(4))}" + (f":{m.group(5)}" if m.group(5) != "00" else "")
    return d, t


def parse_ics(text: str, page_url: str) -> list[dict]:
    out, cur = [], None
    for line in _unfold_ics(text):
        if line == "BEGIN:VEVENT":
            cur = {}
        elif line == "END:VEVENT" and cur is not None:
            start, t1 = _ics_dt(cur.get("DTSTART", ""))
            end, t2 = _ics_dt(cur.get("DTEND", ""))
            if start and cur.get("SUMMARY"):
                if end and "T" not in cur.get("DTEND", "") and end > start:
                    end -= timedelta(days=1)  # Ganztägig: DTEND ist exklusiv
                end = end if end and end >= start and (end - start).days <= 60 else start
                loc = _ics_unescape(cur.get("LOCATION", ""))
                lat = lon = None
                if "GEO" in cur:
                    try:
                        lat, lon = (float(x) for x in cur["GEO"].split(";"))
                    except ValueError:
                        pass
                uid = cur.get("UID") or f"{cur['SUMMARY']}|{start}"
                out.append({
                    "ext_id": hashlib.sha1(uid.encode()).hexdigest()[:16],
                    "title": _clean(_ics_unescape(cur["SUMMARY"])),
                    "description": _ics_unescape(cur.get("DESCRIPTION", ""))[:3000],
                    "url": cur.get("URL") or page_url,
                    "image": "",
                    "start": start,
                    "end": end,
                    "time_text": f"{t1}–{t2} Uhr" if t1 and t2 else (f"ab {t1} Uhr" if t1 else ""),
                    "location": loc,
                    "address": loc,
                    "lat": lat,
                    "lon": lon,
                })
            cur = None
        elif cur is not None and ":" in line:
            key, val = line.split(":", 1)
            cur[key.split(";", 1)[0].upper()] = val
    return out


def source_name(url: str) -> str:
    return urlparse(url).netloc.removeprefix("www.") or url


_BLOCK_TAGS = ["article", "li", "tr", "p", "div", "section", "td"]
_PLZ_ORT = re.compile(r"\b(\d{5})\s+([A-ZÄÖÜ][\wäöüß\-]+(?:[ \-][A-ZÄÖÜ][\wäöüß\-]+)?)(?![\wäöüß])")


def parse_text_blocks(html: str, page_url: str, today: date | None = None) -> list[dict]:
    """Allgemeiner Leser für Seiten ohne maschinenlesbare Termine (z.B. Anzeigenblätter, Vereinsseiten).

    Sucht kleine Textblöcke, die ein Veranstaltungswort (Flohmarkt, Haushaltsauflösung, …) und ein
    ausdrückliches Datum enthalten.
    """
    from ..classify import _EVENT_WORDS
    from ..dateparse import parse_event_date, parse_time_text

    today = today or date.today()
    soup = BeautifulSoup(html, "html.parser")
    for t in soup(["script", "style", "noscript", "nav", "header", "footer", "form", "svg"]):
        t.decompose()
    blocks = []
    for el in soup.find_all(_BLOCK_TAGS):
        text = _clean(el.get_text(" "))
        if not (25 <= len(text) <= 900) or not _EVENT_WORDS.search(text):
            continue
        # Nur den kleinsten Block nehmen: enthält ein Kind-Block fast denselben Text, ist das Kind besser
        inner = [c for c in el.find_all(_BLOCK_TAGS) if len(_clean(c.get_text(" "))) >= 0.8 * len(text)]
        if inner:
            continue
        # Behälter mit mehreren Anzeigen (z.B. ganze Rubrik) überspringen – die Anzeigen einzeln nehmen
        if sum(1 for c in el.find_all(_BLOCK_TAGS) if _EVENT_WORDS.search(c.get_text(" "))) >= 2:
            continue
        blocks.append((el, text))

    out, seen = [], set()
    for el, text in blocks:
        parsed = parse_event_date(text, today)
        if not parsed or not parsed.certain:
            continue
        if parsed.end < today - timedelta(days=1) or parsed.start > today + timedelta(days=120):
            continue
        head = el.find(["h1", "h2", "h3", "h4", "strong", "b"])
        title = _clean(head.get_text(" ")) if head else ""
        if len(title) < 5:
            title = re.split(r"(?<=[.!?:])\s|\s[–|-]\s", text, maxsplit=1)[0]
        title = title[:120]
        m = _PLZ_ORT.search(text)
        address = f"{m.group(1)} {m.group(2)}" if m else ""
        link = el.find("a", href=True)
        url = urljoin(page_url, link["href"]) if link else page_url
        uid = hashlib.sha1(f"{title}|{parsed.start}".encode()).hexdigest()[:16]
        if uid in seen:
            continue
        seen.add(uid)
        out.append({
            "ext_id": uid, "title": title, "description": text[:1500], "url": url, "image": "",
            "start": parsed.start, "end": parsed.end, "time_text": parse_time_text(text) or "",
            "location": address, "address": address, "lat": None, "lon": None,
        })
    return out


def scrape_url(client: httpx.Client, url: str) -> list[dict]:
    text = fetch(client, url)
    if "BEGIN:VCALENDAR" in text[:2000]:
        return parse_ics(text, url)
    # Erst maschinenlesbare Termine (schema.org), sonst Textblöcke mit Datum
    return parse_html(text, url) or parse_text_blocks(text, url)
