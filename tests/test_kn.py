from datetime import date

from app.sources import kn

FEED = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
<item>
  <title>Flohmarkt-Termine am Wochenende im September 2026 in Kiel &amp; SH</title>
  <link>https://www.kn-online.de/freizeit/flohmarkt-termine-kiel-sh-ABC.html</link>
  <pubDate>Fri, 25 Sep 2026 06:00:00 +0200</pubDate>
  <description>Sie wollen am Wochenende die Trödelmärkte in Kiel und Schleswig-Holstein besuchen?</description>
  <content:encoded><![CDATA[
    <p>Hier die Übersicht:</p>
    <p><strong>Flohmarkt auf dem Exerzierplatz</strong>: Sonnabend, 26.09., 8 bis 15 Uhr, 24103 Kiel.</p>
    <p><strong>Kinderflohmarkt in Elmschenhagen</strong>: Sonntag, 27.09., 10–13 Uhr, 24146 Kiel.</p>
  ]]></content:encoded>
</item>
<item>
  <title>„Die Sonne kommt gleich wieder“: Stürmischer Flohmarkt in Strande</title>
  <link>https://www.kn-online.de/lokales/strande-XYZ.html</link>
  <pubDate>Mon, 21 Sep 2026 10:00:00 +0200</pubDate>
  <description>Am Sonntag trotzten die Händler dem Wind auf dem Flohmarkt in Strande.</description>
</item>
<item>
  <title>Flohmärkte in Kiel am Wochenende: Hier wird getrödelt</title>
  <link>https://www.kn-online.de/freizeit/floh-DEF.html</link>
  <pubDate>Fri, 25 Sep 2026 07:00:00 +0200</pubDate>
  <description>Wann und wo in Kiel am Wochenende Flohmärkte stattfinden.</description>
</item>
<item>
  <title>Unfall auf der B76</title>
  <link>https://www.kn-online.de/lokales/unfall.html</link>
  <pubDate>Fri, 25 Sep 2026 08:00:00 +0200</pubDate>
  <description>Stau am Morgen.</description>
</item>
</channel></rss>"""


def test_kn_feed_only_listings():
    items = kn.parse_feed(FEED, date(2026, 9, 25))
    titles = {i["title"]: i for i in items}
    assert "Flohmarkt auf dem Exerzierplatz" in titles
    assert titles["Flohmarkt auf dem Exerzierplatz"]["start"] == date(2026, 9, 26)
    assert titles["Flohmarkt auf dem Exerzierplatz"]["address"] == "24103 Kiel"
    assert titles["Kinderflohmarkt in Elmschenhagen"]["start"] == date(2026, 9, 27)
    # Übersicht ohne Artikeltext: ein Eintrag für Sa + So
    over = titles["Flohmärkte in Kiel am Wochenende: Hier wird getrödelt"]
    assert (over["start"], over["end"]) == (date(2026, 9, 26), date(2026, 9, 27))
    # Bericht über vergangenen Flohmarkt und sonstige Nachrichten: nicht übernommen
    assert not any("Strande" in t or "Unfall" in t for t in titles)
    assert len(items) == 3
