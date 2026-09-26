"""marktcom.de: Liste lesen (Aufbau wie auf der echten Seite)."""
from datetime import date

from app.sources import marktcom

LIST_HTML = """
<h2>Märkte am Samstag den 26.09.2026</h2>
<ul class='list-unstyled marktliste w-100'>
<li class='p-2'><div class='row'><div class='col'><div class='row'><div class='col-md-9 col-lg-9'>
<div class='eventname schmucklink'><a href="/veranstaltung/rooftop-flohmarkt-galeria-osterstrasse-in-20259-hamburg-eimsbuettel">ROOFTOP FLOHMARKT GALERIA OSTERSTRASSE</a></div>
<div class='d-md-none'>20259 Hamburg</div>
<p class='cat'>Nachtflohmarkt Rindermarkthalle St. Pauli</p>
<p class='description d-none d-md-block'>Über 200 Stände voller Schätze ... <a href="/veranstaltung/x">[mehr]</a></p>
</div><div class='col-md-3 col-lg-3'><div class='d-none d-md-block text-right'>20259 Hamburg</div></div>
<div class='col-12'><div class='badge badge-pill badge-primary'><i class='far fa-calendar'></i> 26.09.2026</div>
<div class='badge badge-pill mt-1'><span>Floh-, Trödel- &amp; Jahrmarkt</span></div>
<div class='badge badge-pill mt-1'>Freigelände</div></div></div></div></div></li>
<li class='p-2'><div id='div-gpt-ad'>Werbung</div></li>
</ul>
"""

DETAIL_HTML = """<html><body><h1>ROOFTOP FLOHMARKT</h1>
Termine Datum Uhrzeit Sa. 26.09.2026 12:00 - 20:00 Uhr So. 27.09.2026 12:00 - 20:00 Uhr</body></html>"""


def test_parse_list():
    items = marktcom.parse_list(LIST_HTML)
    assert len(items) == 1
    it = items[0]
    assert it["title"] == "ROOFTOP FLOHMARKT GALERIA OSTERSTRASSE"
    assert it["start"] == date(2026, 9, 26)
    assert it["address"] == "20259 Hamburg"
    assert it["url"].startswith("https://www.marktcom.de/veranstaltung/rooftop")
    assert "Floh-, Trödel- & Jahrmarkt" in it["description"] and "[mehr]" not in it["description"]


def test_enrich_time_from_detail(monkeypatch):
    monkeypatch.setattr(marktcom, "fetch", lambda client, url: DETAIL_HTML)
    it = marktcom.parse_list(LIST_HTML)[0]
    marktcom.enrich(None, it)
    assert it["time_text"] == "12:00–20:00 Uhr"
