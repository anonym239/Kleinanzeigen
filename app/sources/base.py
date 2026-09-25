from __future__ import annotations

import random
import time

import httpx

BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/128.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
}


class SourceError(Exception):
    pass


def make_client() -> httpx.Client:
    return httpx.Client(headers=BROWSER_HEADERS, timeout=25, follow_redirects=True)


def polite_pause(lo: float = 1.5, hi: float = 3.5) -> None:
    """Kurze Pause zwischen Anfragen, damit wir die Seiten nicht belasten (und nicht gesperrt werden)."""
    time.sleep(random.uniform(lo, hi))


def fetch(client: httpx.Client, url: str) -> str:
    try:
        r = client.get(url)
    except httpx.HTTPError as e:
        raise SourceError(f"Verbindung zu {url} fehlgeschlagen: {e}") from e
    if r.status_code in (403, 429):
        raise SourceError(f"{url}: Zugriff verweigert ({r.status_code}) – später erneut versuchen")
    if r.status_code >= 400:
        raise SourceError(f"{url}: HTTP {r.status_code}")
    return r.text
