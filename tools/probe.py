"""Lädt Beispielseiten eines Anbieters und gibt eine kompakte Auswertung aus (nur zur Entwicklung).

Es wird nichts ins Repository geschrieben; die Rohseiten landen als Artifact am Workflow-Lauf.
Aktuell: Kieler Nachrichten (kn-online.de) – wo gibt es Anzeigen / Termine?
"""
import json
import pathlib
import re
import sys
import time
from urllib.parse import urljoin

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
    time.sleep(1.5)
    try:
        r = c.get(url)
    except Exception as e:  # noqa: BLE001
        print(f"\n##### {name} ERROR {e}")
        return ""
    (out / f"{name}.html").write_text(r.text)
    soup = BeautifulSoup(r.text, "html.parser")
    t = soup.title.get_text(strip=True) if soup.title else ""
    print(f"\n##### {name} {r.status_code} {r.url} len={len(r.text)} title={cut(t, 100)!r}")
    types = {}
    for s in soup.find_all("script", type="application/ld+json"):
        for mt in re.findall(r'"@type"\s*:\s*"(\w+)"', s.get_text()):
            types[mt] = types.get(mt, 0) + 1
    print("LD TYPES:", types)
    items = events_page.parse_html(r.text, str(r.url))
    print("EVENTS:", len(items), [(i["title"][:50], str(i["start"])) for i in items[:5]])
    return r.text


def links(html, base, pat, n=40):
    soup = BeautifulSoup(html, "html.parser")
    hs = []
    for a in soup.find_all("a", href=True):
        h = urljoin(base, a["href"].strip())
        txt = cut(a.get_text(" "), 60)
        if re.search(pat, h + " " + txt, re.I) and h not in [x[0] for x in hs]:
            hs.append((h, txt))
    print("LINKS", pat)
    for h, t in hs[:n]:
        print("   ", h, "|", t)


home = get("kn_home", "https://www.kn-online.de/")
links(home, "https://www.kn-online.de/", r"anzeig|markt|veranstalt|termin|flohmarkt|trödel|kalender|service|freizeit")

for name, url in [
    ("kn_anzeigen", "https://www.kn-online.de/anzeigen/"),
    ("kn_kleinanzeigen", "https://www.kn-online.de/kleinanzeigen/"),
    ("kn_marktplatz", "https://www.kn-online.de/marktplatz/"),
    ("kn_veranstaltungen", "https://www.kn-online.de/veranstaltungen/"),
    ("kn_freizeit", "https://www.kn-online.de/freizeit/"),
    ("kn_anzeigen_sub", "https://anzeigen.kn-online.de/"),
    ("kn_kleinanzeigen_sub", "https://kleinanzeigen.kn-online.de/"),
    ("kn_markt_sub", "https://markt.kn-online.de/"),
    ("kn_suche_floh", "https://www.kn-online.de/suche/?q=flohmarkt"),
    ("kn_tag_floh", "https://www.kn-online.de/themen/flohmarkt/"),
]:
    h = get(name, url)
    if h:
        links(h, url, r"anzeig|flohmarkt|trödel|haushalt|termin|veranstalt|rubrik|kategorie", 25)
print("=====END")
