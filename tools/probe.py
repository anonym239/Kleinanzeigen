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

# Zusätzlich komprimiert ins Log schreiben (falls der Artifact-Download nicht erreichbar ist)
for f in sorted(out.glob("*.html")):
    blob = base64.b64encode(gzip.compress(f.read_bytes(), 9)).decode()
    print(f"=====FILE {f.name} {len(blob)}")
    for i in range(0, len(blob), 4000):
        print("B64:" + blob[i:i + 4000])
print("=====END")
