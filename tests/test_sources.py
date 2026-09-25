from datetime import date

from app.classify import classify, is_service_ad
from app.sources import events_page, kleinanzeigen

SEARCH_HTML = """
<ul id="srchrslt-adtable">
 <li class="ad-listitem">
  <article class="aditem" data-adid="3012345678" data-href="/s-anzeige/hofflohmarkt-am-samstag/3012345678-234-1234">
   <div class="aditem-image"><a href="#"><div class="imagebox srpimagebox" data-imgsrc="https://img.kleinanzeigen.de/a.jpg">
     <img src="https://img.kleinanzeigen.de/a.jpg" alt=""></div></a></div>
   <div class="aditem-main">
    <div class="aditem-main--top">
     <div class="aditem-main--top--left"><i class="icon icon-pin"></i> 50667 Altstadt-Nord <span>(3 km)</span></div>
     <div class="aditem-main--top--right"><i class="icon"></i> Heute, 14:23</div>
    </div>
    <div class="aditem-main--middle">
     <h2 class="text-module-begin"><a class="ellipsis" href="/s-anzeige/hofflohmarkt-am-samstag/3012345678-234-1234">Hofflohmarkt am Samstag 27.09.</a></h2>
     <p class="aditem-main--middle--description">Wir räumen den Keller, 10-16 Uhr, viel Werkzeug</p>
     <div class="aditem-main--middle--price-shipping"><p class="aditem-main--middle--price-shipping--price">VB</p></div>
    </div>
   </div>
  </article>
 </li>
 <li class="ad-listitem"><article class="aditem" data-adid="1"><div>kaputt</div></article></li>
</ul>"""

DETAIL_HTML = """
<html><head><meta property="og:latitude" content="50.94"><meta property="og:longitude" content="6.95">
<meta property="og:image" content="https://img.kleinanzeigen.de/big.jpg"></head><body>
<span id="street-address">Lindenstraße 5,</span> <span id="viewad-locality">50667 Köln - Altstadt-Nord</span>
<p id="viewad-description-text" itemprop="description">Große Haushaltsauflösung<br>am 4. Oktober ab 9 Uhr</p>
</body></html>"""


def test_parse_search_page():
    ads = kleinanzeigen.parse_search_page(SEARCH_HTML)
    assert len(ads) == 1
    ad = ads[0]
    assert ad["ad_id"] == "3012345678"
    assert ad["title"] == "Hofflohmarkt am Samstag 27.09."
    assert ad["location"] == "50667 Altstadt-Nord"
    assert ad["posted_raw"].startswith("Heute")
    assert ad["url"].startswith("https://www.kleinanzeigen.de/s-anzeige/")
    assert ad["image"] == "https://img.kleinanzeigen.de/a.jpg"


def test_parse_detail_page():
    d = kleinanzeigen.parse_detail_page(DETAIL_HTML)
    assert d["lat"] == 50.94 and d["lon"] == 6.95
    assert "4. Oktober" in d["description"]
    assert "\n" in d["description"]
    assert d["address"] == "Lindenstraße 5, 50667 Köln - Altstadt-Nord"


def test_search_url():
    assert kleinanzeigen.search_url("Haushaltsauflösung", "945", "Köln", 30, 1) == \
        "https://www.kleinanzeigen.de/s-k%C3%B6ln/haushaltsaufl%C3%B6sung/k0l945r30"
    assert kleinanzeigen.search_url("Flohmarkt", "983", "50667 Köln Altstadt", 50, 2) == \
        "https://www.kleinanzeigen.de/s-50667/seite:2/flohmarkt/k0l983r50"
    assert kleinanzeigen.search_url("Flohmarkt", None, "", 30, 1) == "https://www.kleinanzeigen.de/s-flohmarkt/k0"
    assert kleinanzeigen.snap_radius(25) == 30 and kleinanzeigen.snap_radius(999) == 200


JSONLD_HTML = """<html><body>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
 {"@type":"Event","name":"Großer Trödelmarkt am Rhein","startDate":"2026-10-03T08:00:00+02:00",
  "endDate":"2026-10-03T16:00:00+02:00","url":"/termine/1","image":{"url":"/img/1.jpg"},
  "location":{"@type":"Place","name":"Rheinufer","address":{"streetAddress":"Rheinuferstr. 1","postalCode":"50667","addressLocality":"Köln"},
  "geo":{"latitude":"50.93","longitude":"6.97"}}},
 {"@type":"WebPage","name":"egal"}]}</script>
<div itemscope itemtype="https://schema.org/Event"><span itemprop="name">Kinderbasar Gemeindehaus</span>
 <meta itemprop="startDate" content="2026-10-11"><span itemprop="location">Kirchweg 2, 50667 Köln</span></div>
</body></html>"""

ICS = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:abc\r\nSUMMARY:Flohmarkt\\, Schulhof\r\nDTSTART;VALUE=DATE:20261004\r\n" \
      "DTEND;VALUE=DATE:20261005\r\nLOCATION:Schulstr. 1\\, Köln\r\nDESCRIPTION:Viele Stände\\nKuchen\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"


def test_jsonld_and_microdata():
    items = events_page.parse_html(JSONLD_HTML, "https://stadt.example/kalender")
    assert len(items) == 2
    a = next(i for i in items if "Trödel" in i["title"])
    assert a["start"] == date(2026, 10, 3) and a["time_text"] == "8–16 Uhr"
    assert a["url"] == "https://stadt.example/termine/1"
    assert a["image"] == "https://stadt.example/img/1.jpg"
    assert a["address"] == "Rheinuferstr. 1, 50667 Köln" and a["lat"] == 50.93
    b = next(i for i in items if "Kinderbasar" in i["title"])
    assert b["start"] == date(2026, 10, 11) and "Kirchweg" in b["address"]


def test_ics():
    items = events_page.parse_ics(ICS, "https://x.example/cal.ics")
    assert len(items) == 1
    it = items[0]
    assert it["title"] == "Flohmarkt, Schulhof"
    assert it["start"] == it["end"] == date(2026, 10, 4)
    assert it["address"] == "Schulstr. 1, Köln"


def test_classify():
    assert classify("Hofflohmarkt in der Lindenstraße") == "hof"
    assert classify("Große Haushaltsauflösung") == "haushalt"
    assert classify("Kinderkleiderbasar Kita") == "kinder"
    assert classify("Flohmarkt am Rathaus") == "flohmarkt"
    assert classify("Verkaufe Sofa") == "sonstiges"
    assert classify("Verkaufe alles", "wegen Wohnungsauflösung") == "haushalt"


def test_service_detection():
    assert is_service_ad("Entrümpelung & Haushaltsauflösung zum Festpreis")
    assert is_service_ad("Suche Flohmarktartikel")
    assert is_service_ad("Haushaltsauflösung", "Wir bieten besenreine Übergabe, kostenlose Besichtigung")
    assert not is_service_ad("Haushaltsauflösung am Samstag", "Alles muss raus, Möbel, Geschirr, Werkzeug")


def test_event_vs_single_item():
    from app.classify import is_event_ad
    assert is_event_ad("Haushaltsauflösung am Samstag", "Alles muss raus", "", True, True)
    assert is_event_ad("Hofflohmarkt", "Wir räumen die Garage", "VB")
    assert is_event_ad("Große Wohnungsauflösung – alles muss raus", "", "")
    assert is_event_ad("Kinderkleiderbasar im Gemeindehaus", "", "", True)
    assert not is_event_ad("Vase aus Haushaltsauflösung", "schöne Vase", "5 €")
    assert not is_event_ad("iPhone 15 wie neu", "wegen Haushaltsauflösung abzugeben", "650 €")
    assert not is_event_ad("Samsung Handy", "", "120 €")
    assert not is_event_ad("Stuhl wegen Wohnungsauflösung", "Abholung Samstag", "15 €", True)
    assert not is_event_ad("Flohmarkt Paket Kinderkleidung Gr. 104", "", "10 €")


def test_parse_search_page_2026_layout():
    from pathlib import Path
    html = (Path(__file__).parent / "fixtures" / "ka_search_2026.html").read_text()
    ads = kleinanzeigen.parse_search_page(html)
    assert [a["ad_id"] for a in ads] == ["3523053040", "3522937507", "3522876143"]
    a, b, c = ads
    assert a["title"] == "Trödel Flohmarkt Konvolut Haushalt Deko Zeitschaltuhr"
    assert a["location"] == "58511 Lüdenscheid"
    assert a["posted_raw"] == "Heute, 19:33"
    assert a["price"] == "10 €"
    assert a["image"].startswith("https://img.kleinanzeigen.de/")
    assert b["url"].endswith("/s-anzeige/flohmarkt-verschiedenes/3522937507-250-18697")
    assert b["price"] == "VB" and b["location"] == "51067 Köln Holweide"
    assert "Am Sonntag ist Stadtteil Flohmarkt" in c["description"]


def test_real_ads_relevance():
    """Echte Anzeigen aus Köln (Sept. 2026): nur der Stadtteil-Flohmarkt ist ein Termin."""
    from pathlib import Path

    from app.classify import is_event_ad
    from app.dateparse import parse_event_date, parse_time_text
    html = (Path(__file__).parent / "fixtures" / "ka_search_2026.html").read_text()
    verdict = {}
    for ad in kleinanzeigen.parse_search_page(html):
        text = f"{ad['title']} {ad['description']}"
        verdict[ad["title"]] = is_event_ad(ad["title"], ad["description"], ad["price"],
                                           bool(parse_event_date(text, date(2026, 9, 25))), bool(parse_time_text(text)))
    assert verdict == {
        "Trödel Flohmarkt Konvolut Haushalt Deko Zeitschaltuhr": False,
        "Flohmarkt verschiedenes": False,
        "Flohmarkt am Küllenhahn": True,
    }
