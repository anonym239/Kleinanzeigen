"""Lädt Beispielseiten der Anbieter herunter (nur zur Entwicklung der Leseprogramme).

Die Seiten werden im Workflow als Artifact abgelegt, es wird nichts ins Repository geschrieben.
"""
import base64
import gzip
import json
import pathlib
import re
import sys
import time

import httpx

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from app.sources.base import BROWSER_HEADERS  # noqa: E402

out = pathlib.Path("probe")
out.mkdir(exist_ok=True)
c = httpx.Client(headers=BROWSER_HEADERS, timeout=30, follow_redirects=True)
report = []


def get(name, url):
    time.sleep(2)
    try:
        r = c.get(url)
        body = r.text
        (out / f"{name}.html").write_text(body)
        report.append({"name": name, "url": url, "final": str(r.url), "status": r.status_code, "len": len(body)})
        return body
    except Exception as e:  # noqa: BLE001
        report.append({"name": name, "url": url, "error": str(e)})
        return ""


loc = get("ka_ort", "https://www.kleinanzeigen.de/s-ort-empfehlungen.json?query=50667")
get("ka_haushalt_all", "https://www.kleinanzeigen.de/s-haushaltsaufloesung/k0")
try:
    lid = next(k[1:] for k in json.loads(loc) if k != "_0")
except Exception:  # noqa: BLE001
    lid = "945"
s = get("ka_haushalt_koeln", f"https://www.kleinanzeigen.de/s-koeln/haushaltsaufl%C3%B6sung/k0l{lid}r50")
get("ka_flohmarkt_koeln", f"https://www.kleinanzeigen.de/s-koeln/flohmarkt/k0l{lid}r50")
get("ka_flohmarkt_koeln_p2", f"https://www.kleinanzeigen.de/s-koeln/seite:2/flohmarkt/k0l{lid}r50")
for i, href in enumerate(re.findall(r'data-href="(/s-anzeige/[^"]+)"', s)[:2]):
    get(f"ka_detail_{i}", "https://www.kleinanzeigen.de" + href)

for name, url in [
    ("marktde_1", "https://www.markt.de/haushaltsaufloesung/"),
    ("marktde_2", "https://www.markt.de/koeln/haushaltsaufloesung/"),
    ("marktde_3", "https://www.markt.de/suche/?keywords=haushaltsaufl%C3%B6sung"),
    ("mft_home", "https://meine-flohmarkt-termine.de/"),
    ("mft_koeln", "https://meine-flohmarkt-termine.de/ort/koeln"),
    ("kompass", "https://www.flohmarktkompass.de/markt/"),
    ("ftnet", "https://www.flohmarkt-termine.net/"),
    ("meinestadt", "https://veranstaltungen.meinestadt.de/koeln/maerkte/flohmarkt-troedelmarkt"),
    ("marktcom", "https://www.marktcom.de/"),
    ("kaenguru", "https://www.kaenguru-online.de/kalender/maerkte"),
    ("krencky", "https://krencky24.de/troedelmarkt-flohmarkt_plzgebiet_5.html"),
    ("nominatim", "https://nominatim.openstreetmap.org/search?postalcode=50667&country=Deutschland&format=json&limit=1"),
]:
    get(name, url)

(out / "report.json").write_text(json.dumps(report, indent=1))
print(json.dumps(report, indent=1))

# Kompakte Auswertung fürs Log
from bs4 import BeautifulSoup  # noqa: E402

from app.sources import events_page, kleinanzeigen  # noqa: E402


def cut(x, n):
    x = re.sub(r"\s+", " ", str(x))
    return x[:n]


for f in sorted(out.glob("*.html")):
    html = f.read_text()
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.get_text(strip=True) if soup.title else ""
    print(f"\n##### {f.name} len={len(html)} title={cut(title, 120)!r}")
    if f.name.startswith("ka_ort") or f.name.startswith("nominatim"):
        print(cut(html, 600))
        continue
    if f.name.startswith("ka_") and "detail" not in f.name:
        ads = kleinanzeigen.parse_search_page(html)
        print(f"PARSED ADS: {len(ads)}")
        for ad in ads[:25]:
            print("AD", json.dumps({k: ad[k] for k in ("title", "location", "posted_raw", "price")}, ensure_ascii=False),
                  "|", cut(ad["description"], 160))
        arts = soup.select("article")
        print("ARTICLES:", len(arts))
        if arts:
            print("FIRST ARTICLE HTML:", cut(arts[0], 3000))
        elif "aditem" not in html:
            print("NO aditem. BODY START:", cut(soup.body or html, 1500))
        continue
    if "detail" in f.name:
        print("PARSED DETAIL:", json.dumps(kleinanzeigen.parse_detail_page(html), ensure_ascii=False)[:1500])
        for sel in ["#viewad-locality", "#street-address", "#viewad-extra-info", "#viewad-details",
                    "#viewad-description-text", "#viewad-title", "#viewad-price"]:
            el = soup.select_one(sel)
            print("SEL", sel, "=>", cut(el, 500) if el else None)
        for m in soup.find_all("meta"):
            if m.get("property", "").startswith("og:") or "lat" in str(m.get("name", "")):
                print("META", m.get("property") or m.get("name"), cut(m.get("content"), 120))
        for m in re.finditer(r"(latitude|longitude|\"lat\"|\"lng\")[^,]{0,40}", html):
            print("GEO", m.group(0))
            break
        continue
    items = events_page.parse_html(html, "https://example.org/")
    print(f"JSONLD/MICRODATA EVENTS: {len(items)}")
    for it in items[:5]:
        print("EV", it["title"], it["start"], it["time_text"], "|", it["address"], it["lat"], "|", it["url"])
    types = {}
    for t in soup.find_all("script", type="application/ld+json"):
        for mt in re.findall(r'"@type"\s*:\s*"(\w+)"', t.get_text()):
            types[mt] = types.get(mt, 0) + 1
    print("LD TYPES:", types)
    m = re.search(r"\b\d{1,2}\.\d{1,2}\.(20)?\d{2}\b", html[3000:])
    if m:
        i = m.start() + 3000
        print("AROUND DATE:", cut(html[max(0, i - 1500):i + 1500], 3000))
    links = [a.get("href") for a in soup.find_all("a", href=True)]
    print("SAMPLE LINKS:", [l for l in links if re.search(r"markt|termin|flohmarkt|anzeige|/ort/|/s/", l or "")][:25])
print("=====END")
