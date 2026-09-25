"""Kieler Nachrichten (kn-online.de) über ihre offiziellen RSS-Feeds.

Die Webseite selbst sperrt automatische Abrufe; die RSS-Feeds sind dagegen öffentlich und laut
robots.txt erlaubt. Übernommen werden Artikel über Flohmärkte, Trödelmärkte, Basare und
Haushaltsauflösungen – aber nur Termine, keine Nachrichten: Aus Termin-Übersichten
("Flohmarkt-Termine am Wochenende …") werden die einzelnen Termine übernommen; ist der Artikeltext
nicht im Feed, erscheint nur die Termin-Übersicht selbst (mit Link). Berichte über vergangene
Flohmärkte o.ä. werden nicht übernommen.
"""
from __future__ import annotations

import hashlib
import re
import xml.etree.ElementTree as ET
from datetime import date, timedelta
from email.utils import parsedate_to_datetime

import httpx
from bs4 import BeautifulSoup

from ..classify import _EVENT_WORDS, classify
from ..dateparse import parse_event_date, parse_time_text
from . import events_page
from .base import fetch, polite_pause

NAME = "Kieler Nachrichten"
FEEDS = [
    "https://www.kn-online.de/arc/outboundfeeds/rss/category/lokales/kiel/",
    "https://www.kn-online.de/arc/outboundfeeds/rss/category/lokales/ploen/",
    "https://www.kn-online.de/arc/outboundfeeds/rss/",
]
# Nur Termin-Übersichten/Ankündigungen, keine Berichte
LISTING_RE = re.compile(r"termine|wann und wo|übersicht|am wochenende|diese flohmärkte|wo ist .*flohmarkt|flohmärkte in", re.I)
NS = {"content": "http://purl.org/rss/1.0/modules/content/", "media": "http://search.yahoo.com/mrss/"}


def _text(html: str) -> str:
    return re.sub(r"\s+", " ", BeautifulSoup(html or "", "html.parser").get_text(" ")).strip()


def parse_feed(xml: str, today: date | None = None) -> list[dict]:
    """Liefert Termine (gleiches Format wie events_page) aus einem KN-RSS-Feed."""
    today = today or date.today()
    root = ET.fromstring(xml.encode() if isinstance(xml, str) else xml)
    out: list[dict] = []
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        desc_html = item.findtext("description") or ""
        content_html = item.findtext("content:encoded", default="", namespaces=NS) or ""
        link = (item.findtext("link") or "").strip()
        blob = f"{title} {_text(desc_html)} {_text(content_html)}"
        if not _EVENT_WORDS.search(f"{title} {_text(desc_html)}"):
            continue
        try:
            pub = parsedate_to_datetime(item.findtext("pubDate") or "").date()
        except (TypeError, ValueError):
            pub = today
        image = ""
        media = item.find("media:content", NS)
        if media is not None:
            image = media.get("url", "")
        enc = item.find("enclosure")
        if not image and enc is not None and (enc.get("type") or "").startswith("image"):
            image = enc.get("url", "")

        # 1) Einzelne Termine aus dem Artikeltext (z.B. "Flohmarkt-Termine am Wochenende …")
        singles = []
        if content_html:
            for it in events_page.parse_text_blocks(content_html, link or FEEDS[0], today):
                it["image"] = it["image"] or image
                it["description"] = f"{it['description']}\n\nQuelle: {title}"
                singles.append(it)
        if singles:
            out.extend(singles)
            continue

        # 2) Sonst nur Termin-Übersichten selbst als Eintrag (keine Berichte/Nachrichten)
        if not LISTING_RE.search(title):
            continue
        parsed = parse_event_date(f"{title} {_text(desc_html)}", pub)
        if not parsed:
            continue
        start, end = parsed.start, parsed.end
        if not parsed.certain and re.search(r"wochenende", blob, re.I) and start.weekday() == 5:
            end = start + timedelta(days=1)  # "am Wochenende" = Sa + So
        if end < today - timedelta(days=1) or start > today + timedelta(days=120):
            continue
        out.append({
            "ext_id": hashlib.sha1((link or title).encode()).hexdigest()[:16],
            "title": title,
            "description": _text(desc_html)[:1500] + "\n\nArtikel der Kieler Nachrichten – Details und Liste der Termine im Artikel.",
            "url": link,
            "image": image,
            "start": start,
            "end": end,
            "time_text": parse_time_text(blob) or "",
            "location": "Kiel & Umgebung",
            "address": "",
            "lat": None,
            "lon": None,
            "certain": parsed.certain,
        })
    return out


def scrape(client: httpx.Client) -> list[dict]:
    items: dict[str, dict] = {}
    for url in FEEDS:
        polite_pause(0.5, 1.5)
        for it in parse_feed(fetch(client, url)):
            items.setdefault(it["ext_id"], it)
    return [it for it in items.values() if classify(it["title"], it["description"]) != "sonstiges"]
