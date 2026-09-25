"""Lädt Beispielseiten der Anbieter und gibt eine kompakte Auswertung aus (nur zur Entwicklung).

Es wird nichts ins Repository geschrieben; die Rohseiten landen als Artifact am Workflow-Lauf.
"""
import json
import pathlib
import re
import sys
import time

import httpx
from bs4 import BeautifulSoup

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from app.sources import events_page  # noqa: E402
from app.sources.base import BROWSER_HEADERS  # noqa: E402

out = pathlib.Path("probe")
out.mkdir(exist_ok=True)
c = httpx.Client(headers=BROWSER_HEADERS, timeout=30, follow_redirects=True)


def cut(x, n):
    return re.sub(r"\s+", " ", str(x))[:n]


def get(name, url):
    time.sleep(2)
    try:
        r = c.get(url)
    except Exception as e:  # noqa: BLE001
        print(f"\n##### {name} ERROR {e}")
        return ""
    (out / f"{name}.html").write_text(r.text)
    soup = BeautifulSoup(r.text, "html.parser")
    t = soup.title.get_text(strip=True) if soup.title else ""
    print(f"\n##### {name} {r.status_code} {r.url} len={len(r.text)} title={cut(t, 100)!r}")
    return r.text


def links(html, pat, n=30):
    soup = BeautifulSoup(html, "html.parser")
    hs = []
    for a in soup.find_all("a", href=True):
        h = a["href"].strip()
        if re.search(pat, h) and h not in hs:
            hs.append(h)
    print("LINKS", pat, hs[:n])


def events(html, url):
    items = events_page.parse_html(html, url)
    ds = sorted(i["start"] for i in items)
    print(f"EVENTS {len(items)}", f"{ds[0]}..{ds[-1]}" if ds else "")
    for it in items[:4]:
        print("  EV", it["title"], it["start"], it["time_text"], "|", it["address"])


# ---- Kleinanzeigen: Aufbau einer Anzeige ohne SVG-Grafiken
html = get("ka_flohmarkt", "https://www.kleinanzeigen.de/s-koeln/flohmarkt/k0l983r50")
soup = BeautifulSoup(html, "html.parser")
for svg in soup.find_all("svg"):
    svg.decompose()
for art in soup.select("article[data-adid]")[:3]:
    for s in art.find_all("script"):
        s.string = cut(s.string or "", 300)
    print("ART_TEXT:", " ¦ ".join(x.strip() for x in art.stripped_strings))
    print("ART_HTML:", cut(re.sub(r' class="[^"]*"', "", str(art)), 2500))
print("PAGINATION:", [a.get("href") for a in soup.select("a[href*='seite:']")][:8])
print("TOTAL HINT:", cut(" ".join(re.findall(r"[\d.]+\s+Ergebnisse?[^<]{0,40}", html)[:3]), 200))
print("HAS 'Topanzeige':", html.count("TOP"), "gesuch:", html.lower().count("gesuch"))

# ---- meine-flohmarkt-termine.de: Seiten / Zeitraum
h = get("mft_koeln", "https://meine-flohmarkt-termine.de/ort/koeln")
events(h, "https://meine-flohmarkt-termine.de/")
links(h, r"page=|seite|/ort/koeln\?|umkreis|radius|plz")
h = get("mft_koeln_p2", "https://meine-flohmarkt-termine.de/ort/koeln?page=2")
events(h, "https://meine-flohmarkt-termine.de/")
h = get("mft_plz50", "https://meine-flohmarkt-termine.de/de/plz-gebiet/5")
events(h, "https://meine-flohmarkt-termine.de/")
links(h, r"plz-gebiet|page=", 40)

# ---- krencky24: 2-stellige PLZ-Gebiete und weitere Seiten
h = get("krencky_50", "https://krencky24.de/troedelmarkt-flohmarkt_plzgebiet_50.html")
events(h, "https://krencky24.de/")
links(h, r"plzgebiet_50|seite|page|weiter", 40)

# ---- marktcom: Karten mit Datum/Ort
h = get("marktcom_50", "https://www.marktcom.de/termine/plz?q%5Bevent_plz_start%5D=50")
soup = BeautifulSoup(h, "html.parser")
cards = soup.select(".announce")
print("MARKTCOM CARDS", len(cards))
for card in cards[:4]:
    print("  CARD:", " ¦ ".join(x.strip() for x in card.stripped_strings))
links(h, r"page=|seite", 20)

# ---- KÄNGURU (Microdata mit itemprop=date)
h = get("kaenguru", "https://www.kaenguru-online.de/kalender/maerkte")
events(h, "https://www.kaenguru-online.de/")
print("=====END")
