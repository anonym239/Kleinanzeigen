from datetime import date, datetime

import pytest

from app.dateparse import parse_event_date, parse_posted_date, parse_time_text

REF = date(2026, 9, 25)  # Freitag


@pytest.mark.parametrize(
    "text,start,end,certain",
    [
        ("Hofflohmarkt am Sa. 27.09. von 10-16 Uhr", date(2026, 9, 27), date(2026, 9, 27), True),
        ("Flohmarkt 27.9.2026", date(2026, 9, 27), date(2026, 9, 27), True),
        ("Haushaltsauflösung 3. und 4. Oktober", date(2026, 10, 3), date(2026, 10, 4), True),
        ("Garagenflohmarkt 27./28.09.", date(2026, 9, 27), date(2026, 9, 28), True),
        ("Termin: 27.-28.09.2026", date(2026, 9, 27), date(2026, 9, 28), True),
        ("am Samstag 27.09. und Sonntag 28.09.", date(2026, 9, 27), date(2026, 9, 28), True),
        ("Trödelmarkt am 11. Okt. 2026", date(2026, 10, 11), date(2026, 10, 11), True),
        ("Kinderbasar am 10.01.", date(2027, 1, 10), date(2027, 1, 10), True),
        ("Flohmarkt diesen Samstag ab 9 Uhr", date(2026, 9, 26), date(2026, 9, 26), False),
        ("Hausflohmarkt am Wochenende", date(2026, 9, 26), date(2026, 9, 26), False),
        ("Flohmarkt Sa. von 8 bis 14 Uhr", date(2026, 9, 26), date(2026, 9, 26), False),
        ("Wohnungsauflösung heute", REF, REF, False),
    ],
)
def test_event_dates(text, start, end, certain):
    r = parse_event_date(text, REF)
    assert r is not None, text
    assert (r.start, r.end, r.certain) == (start, end, certain)


@pytest.mark.parametrize(
    "text",
    [
        "Öffnungszeit 10.30 Uhr bis 16.00 Uhr",
        "Alles muss raus, Preise ab 5.50 €",
        "So schön, alles gut erhalten",
        "Verkaufe Kommode, Maße 80x40",
    ],
)
def test_no_false_dates(text):
    assert parse_event_date(text, REF) is None


def test_prefers_upcoming_date():
    r = parse_event_date("Letzter Flohmarkt war 01.08., nächster am 04.10.", REF)
    assert r.start == date(2026, 10, 4)


@pytest.mark.parametrize(
    "text,expected",
    [
        ("von 10-16 Uhr", "10–16 Uhr"),
        ("10:30 bis 15 Uhr", "10:30–15 Uhr"),
        ("ab 9 Uhr geöffnet", "ab 9 Uhr"),
        ("ohne Zeit", None),
    ],
)
def test_time(text, expected):
    assert parse_time_text(text) == expected


def test_posted():
    now = datetime(2026, 9, 25, 12, 0)
    assert parse_posted_date("Heute, 14:23", now) == date(2026, 9, 25)
    assert parse_posted_date("Gestern, 09:10", now) == date(2026, 9, 24)
    assert parse_posted_date("20.09.2026", now) == date(2026, 9, 20)
    assert parse_posted_date("", now) is None
