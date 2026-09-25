"""Flohmarkt-Terminkalender nach PLZ-Gebiet (öffentliche Seiten, kein API-Key).

krencky24.de und meine-flohmarkt-termine.de zeigen dieselbe Termin-Datenbank; beide liefern
die Termine als schema.org/Event. Gelesen wird krencky24.de, bei Fehlern meine-flohmarkt-termine.de.
"""
from __future__ import annotations

import logging
import re
from datetime import date
from typing import Callable, Iterator

import httpx

from . import events_page
from .base import SourceError, fetch, polite_pause

log = logging.getLogger(__name__)

SITES = [
    ("krencky24.de", "https://krencky24.de/troedelmarkt-flohmarkt_plzgebiet_{plz}.html", "?page={page}"),
    ("meine-flohmarkt-termine.de", "https://meine-flohmarkt-termine.de/de/plz-gebiet/{plz}", "?page={page}"),
]


def event_key(url: str) -> str | None:
    """Beide Seiten nutzen dieselbe Termin-Nummer (z.B. ..._koeln_23767087.html bzw. .../23767087/details)."""
    m = re.search(r"(\d{7,9})(?:\.html|/details)", url or "")
    return m.group(1) if m else None


def scrape_prefix(client: httpx.Client, plz: str, until: date, max_pages: int = 4,
                  log_msg: Callable[[str], None] = lambda m: None) -> Iterator[tuple[str, dict]]:
    """Liefert (Seitenname, Termin) für ein zweistelliges PLZ-Gebiet bis zum Datum ``until``."""
    for site, base, page_q in SITES:
        try:
            for page in range(1, max_pages + 1):
                url = base.format(plz=plz) + (page_q.format(page=page) if page > 1 else "")
                polite_pause(1.0, 2.0)
                items = events_page.parse_html(fetch(client, url), url)
                for it in items:
                    yield site, it
                if not items or max(i["start"] for i in items) > until:
                    break
            return
        except SourceError as e:
            log_msg(f"{site}: {e} – versuche nächste Seite")
    raise SourceError(f"Kein Terminkalender für PLZ-Gebiet {plz} erreichbar")
