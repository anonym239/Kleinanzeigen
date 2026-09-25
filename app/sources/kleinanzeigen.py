"""Liest Suchergebnisse von kleinanzeigen.de (öffentliche Webseite, kein API-Key nötig)."""
from __future__ import annotations

import logging
import re
from datetime import date
from typing import Callable, Iterator
from urllib.parse import quote, urljoin

import httpx
from bs4 import BeautifulSoup

from ..dateparse import parse_posted_date
from .base import SourceError, fetch, polite_pause

log = logging.getLogger(__name__)
BASE = "https://www.kleinanzeigen.de"
RADII = [5, 10, 20, 30, 50, 100, 150, 200]


def _clean(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _slug(text: str) -> str:
    return quote(re.sub(r"\s+", "-", text.strip().lower()))


def snap_radius(km: float) -> int:
    for r in RADII:
        if km <= r:
            return r
    return RADII[-1]


def find_location_id(client: httpx.Client, query: str) -> tuple[str, str] | None:
    """PLZ/Ort -> (Kleinanzeigen-Orts-ID, Name). Nutzt die Ortsvorschläge der Webseite."""
    try:
        r = client.get(f"{BASE}/s-ort-empfehlungen.json", params={"query": query})
        r.raise_for_status()
        data = r.json()
    except Exception as e:  # noqa: BLE001
        log.warning("Ortssuche bei Kleinanzeigen fehlgeschlagen: %s", e)
        return None
    for key, name in data.items():
        m = re.fullmatch(r"_(\d+)", key)
        if m and m.group(1) != "0":
            return m.group(1), name
    return None


def search_url(term: str, location_id: str | None, location_name: str, radius: int, page: int) -> str:
    page_part = f"seite:{page}/" if page > 1 else ""
    if location_id:
        loc = _slug(re.sub(r"^\d{5}\s*", "", location_name) or location_name) or "ort"
        return f"{BASE}/s-{loc}/{page_part}{_slug(term)}/k0l{location_id}r{radius}"
    return f"{BASE}/s-{page_part}{_slug(term)}/k0"


def parse_search_page(html: str) -> list[dict]:
    """Zerlegt eine Suchergebnisseite in einzelne Anzeigen."""
    soup = BeautifulSoup(html, "html.parser")
    ads = []
    for art in soup.select("article.aditem"):
        ad_id = art.get("data-adid")
        href = art.get("data-href")
        title_a = art.select_one("h2 a, .text-module-begin a, a.ellipsis")
        if not ad_id or not title_a:
            continue
        href = href or title_a.get("href", "")
        img = art.select_one(".imagebox img, img")
        image = ""
        if img is not None:
            image = img.get("src") or img.get("data-src") or ""
        if not image:
            box = art.select_one("[data-imgsrc]")
            image = box.get("data-imgsrc", "") if box else ""
        loc_el = art.select_one(".aditem-main--top--left")
        loc = _clean(loc_el.get_text(" ")) if loc_el else ""
        loc = re.sub(r"\(\s*\d+\s*km\s*\)", "", loc).strip()
        date_el = art.select_one(".aditem-main--top--right")
        desc_el = art.select_one(".aditem-main--middle--description")
        price_el = art.select_one(".aditem-main--middle--price-shipping--price, .aditem-main--middle--price")
        ads.append({
            "ad_id": ad_id,
            "url": urljoin(BASE, href),
            "title": _clean(title_a.get_text()),
            "description": _clean(desc_el.get_text(" ")) if desc_el else "",
            "location": loc,
            "posted_raw": _clean(date_el.get_text(" ")) if date_el else "",
            "price": _clean(price_el.get_text(" ")) if price_el else "",
            "image": image if image.startswith("http") else "",
        })
    return ads


def parse_detail_page(html: str) -> dict:
    """Liest die vollständige Beschreibung, Adresse und ggf. Koordinaten einer Anzeige."""
    soup = BeautifulSoup(html, "html.parser")
    out: dict = {}
    desc = soup.select_one("#viewad-description-text, [itemprop=description]")
    if desc:
        for br in desc.find_all("br"):
            br.replace_with("\n")
        out["description"] = re.sub(r"[ \t]+", " ", desc.get_text()).strip()
    locality = soup.select_one("#viewad-locality")
    street = soup.select_one("#street-address")
    addr = " ".join(_clean(x.get_text(" ")) for x in (street, locality) if x)
    if addr:
        out["address"] = addr.replace(" ,", ",")
    lat = soup.select_one("meta[property='og:latitude']")
    lon = soup.select_one("meta[property='og:longitude']")
    try:
        if lat and lon:
            out["lat"], out["lon"] = float(lat["content"]), float(lon["content"])
    except (KeyError, ValueError):
        pass
    img = soup.select_one("meta[property='og:image']")
    if img and img.get("content"):
        out["image"] = img["content"]
    return out


def scrape(
    client: httpx.Client,
    settings: dict,
    needs_detail: Callable[[dict], bool],
    log_msg: Callable[[str], None] = lambda m: None,
) -> Iterator[dict]:
    """Liefert Roh-Anzeigen (dicts). ``needs_detail(ad)`` entscheidet, ob die Detailseite geladen wird."""
    home = settings.get("home_query") or ""
    loc = find_location_id(client, home) if home else None
    if home and not loc:
        log_msg(f"Ort '{home}' bei Kleinanzeigen nicht gefunden – suche deutschlandweit")
    radius = snap_radius(float(settings.get("radius_km") or 30))
    pages = max(1, int(settings.get("kleinanzeigen_pages") or 1))
    detail_budget = int(settings.get("detail_fetch_limit") or 0)
    seen: set[str] = set()
    errors = 0

    for term in settings.get("search_terms") or []:
        for page in range(1, pages + 1):
            url = search_url(term, loc[0] if loc else None, loc[1] if loc else "", radius, page)
            polite_pause()
            try:
                html = fetch(client, url)
            except SourceError as e:
                errors += 1
                log_msg(str(e))
                if errors >= 3:
                    raise
                break
            ads = parse_search_page(html)
            if not ads:
                break
            new_on_page = 0
            for ad in ads:
                if ad["ad_id"] in seen:
                    continue
                seen.add(ad["ad_id"])
                new_on_page += 1
                ad["posted"] = parse_posted_date(ad["posted_raw"]) or date.today()
                ad["search_term"] = term
                if detail_budget > 0 and needs_detail(ad):
                    detail_budget -= 1
                    polite_pause(1.0, 2.5)
                    try:
                        ad.update(parse_detail_page(fetch(client, ad["url"])))
                        ad["detail_fetched"] = True
                    except SourceError as e:
                        log_msg(str(e))
                yield ad
            if new_on_page == 0 or len(ads) < 20:
                break
