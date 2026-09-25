"""Prüft öffentliche Feeds der Kieler Nachrichten (nur zur Entwicklung).

Die Webseite kn-online.de sperrt automatische Abrufe (403). Feeds (RSS) sind dagegen für
automatisches Lesen gedacht – hier wird geprüft, welche erreichbar sind und was sie liefern.
"""
import pathlib
import re
import sys
import time
import xml.etree.ElementTree as ET

import httpx

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from app.sources.base import BROWSER_HEADERS  # noqa: E402

out = pathlib.Path("probe")
out.mkdir(exist_ok=True)
c = httpx.Client(headers={**BROWSER_HEADERS, "Accept": "application/rss+xml, application/xml, text/xml, */*"},
                 timeout=30, follow_redirects=True)

URLS = [
    "https://www.kn-online.de/arc/outboundfeeds/rss/",
    "https://www.kn-online.de/arc/outboundfeeds/rss/category/lokales/kiel/",
    "https://www.kn-online.de/arc/outboundfeeds/rss/category/lokales/",
    "https://www.kn-online.de/arc/outboundfeeds/rss/category/lokales/ploen/",
    "https://www.kn-online.de/arc/outboundfeeds/rss/category/lokales/rendsburg/",
    "https://www.kn-online.de/arc/outboundfeeds/rss/category/lokales/eckernfoerde/",
    "https://www.kn-online.de/arc/outboundfeeds/sitemap/",
    "https://www.kn-online.de/rss/",
    "https://www.kn-online.de/feed/",
    "https://www.kn-online.de/robots.txt",
    "https://news.google.com/rss/search?q=Flohmarkt+site:kn-online.de&hl=de&gl=DE&ceid=DE:de",
    "https://news.google.com/rss/search?q=Tr%C3%B6delmarkt+OR+Flohmarkt+OR+Haushaltsaufl%C3%B6sung+site:kn-online.de+when:30d&hl=de&gl=DE&ceid=DE:de",
    "https://www.bing.com/news/search?q=Flohmarkt+site%3akn-online.de&format=rss",
]

for i, url in enumerate(URLS):
    time.sleep(1.5)
    try:
        r = c.get(url)
    except Exception as e:  # noqa: BLE001
        print(f"\n##### {url}\nERROR {e}")
        continue
    body = r.text
    (out / f"feed_{i}.xml").write_text(body)
    print(f"\n##### {url}\nSTATUS {r.status_code} type={r.headers.get('content-type')} len={len(body)} final={r.url}")
    if "robots" in url:
        print(body[:1500])
        continue
    try:
        root = ET.fromstring(body.encode())
    except ET.ParseError:
        print("KEIN XML:", re.sub(r"\s+", " ", body[:300]))
        continue
    items = root.findall(".//item")
    print("ITEMS:", len(items))
    for it in items[:12]:
        t = (it.findtext("title") or "").strip()
        d = (it.findtext("pubDate") or "").strip()
        desc = re.sub(r"<[^>]+>|\s+", " ", it.findtext("description") or "")[:160]
        print("  -", d[:16], "|", t[:110], "|", desc)
    floh = [it.findtext("title") for it in items
            if re.search(r"floh|trödel|basar|haushaltsaufl|flohmärkte", (it.findtext("title") or "") + (it.findtext("description") or ""), re.I)]
    print("FLOHMARKT-TREFFER:", len(floh), floh[:8])
print("=====END")
