"""Erkennt Termine (Datum + Uhrzeit) in deutschem Freitext.

Kleinanzeigen-Anzeigen haben kein strukturiertes Veranstaltungsdatum, deshalb
wird es aus Titel und Beschreibung gelesen, z.B.:
  "Hofflohmarkt am Sa. 27.09. von 10-16 Uhr"
  "Haushaltsauflösung 3. und 4. Oktober"
  "Flohmarkt diesen Samstag ab 9 Uhr"
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta

MONTHS = {
    "januar": 1, "jan": 1, "jänner": 1,
    "februar": 2, "feb": 2,
    "märz": 3, "maerz": 3, "mär": 3, "mrz": 3,
    "april": 4, "apr": 4,
    "mai": 5,
    "juni": 6, "jun": 6,
    "juli": 7, "jul": 7,
    "august": 8, "aug": 8,
    "september": 9, "sept": 9, "sep": 9,
    "oktober": 10, "okt": 10,
    "november": 11, "nov": 11,
    "dezember": 12, "dez": 12,
}
_MONTH_RE = "|".join(sorted(MONTHS, key=len, reverse=True))

WEEKDAYS = {
    "montag": 0, "mo": 0,
    "dienstag": 1, "di": 1,
    "mittwoch": 2, "mi": 2,
    "donnerstag": 3, "do": 3,
    "freitag": 4, "fr": 4,
    "samstag": 5, "sa": 5, "sonnabend": 5,
    "sonntag": 6, "so": 6,
}

_SEP = r"\s*(?:-|–|—|bis|und|u\.|/|&|\+)\s*"

# 27.-28.09.2026 | 27./28.9. | 27.9.-28.9.
RE_NUM_RANGE = re.compile(
    r"(?<![\d.])(\d{1,2})\.(?:(\d{1,2})\.)?" + _SEP + r"(\d{1,2})\.(\d{1,2})\.?(\d{4}|\d{2}(?!\d|\s*uhr|:))?(?![\d:])",
    re.I,
)
# 27.09.2026 | 27.9. | 27.09 (nicht: 10.30 Uhr)
RE_NUM = re.compile(
    r"(?<![\d.])(\d{1,2})\.(\d{1,2})(?:\.(\d{4}|\d{2}(?!\d))?)?(?![\d:])(?!\s*(?:uhr|h\b|€|eur|euro|,-))",
    re.I,
)
# 27. September | 27./28. Sept. 2026 | 3. und 4. Oktober
RE_NAMED = re.compile(
    r"(?<![\d.])(\d{1,2})\.?(?:" + _SEP + r"(\d{1,2})\.?)?\s*(" + _MONTH_RE + r")\b\.?\s*(\d{4})?",
    re.I,
)
RE_TIME_RANGE = re.compile(
    r"(\d{1,2})(?:[:.](\d{2}))?\s*(?:uhr)?\s*(?:-|–|bis)\s*(\d{1,2})(?:[:.](\d{2}))?\s*uhr",
    re.I,
)
RE_TIME_FROM = re.compile(r"\bab\s*(\d{1,2})(?:[:.](\d{2}))?\s*uhr", re.I)
RE_WEEKDAY = re.compile(
    r"\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend|sonntag|mo|di|mi|do|fr|sa|so)\b\.?",
    re.I,
)


@dataclass
class ParsedDate:
    start: date
    end: date
    certain: bool  # True = explizites Datum gefunden, False = aus Wochentag abgeleitet


def _mk(day: int, month: int, year: int | None, ref: date) -> date | None:
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return None
    if year is not None and year < 100:
        year += 2000
    try:
        if year is not None:
            return date(year, month, day)
        d = date(ref.year, month, day)
    except ValueError:
        return None
    # Ohne Jahresangabe: liegt das Datum weit in der Vergangenheit, ist das nächste Jahr gemeint
    if d < ref - timedelta(days=60):
        try:
            d = date(ref.year + 1, month, day)
        except ValueError:
            return None
    return d


def _explicit_dates(text: str, ref: date) -> list[tuple[date, date]]:
    found: list[tuple[date, date]] = []
    spans: list[tuple[int, int]] = []

    def taken(m: re.Match) -> bool:
        return any(m.start() < e and m.end() > s for s, e in spans)

    for m in RE_NUM_RANGE.finditer(text):
        d1, m1, d2, m2, y = m.groups()
        year = int(y) if y else None
        end = _mk(int(d2), int(m2), year, ref)
        start = _mk(int(d1), int(m1) if m1 else int(m2), year or (end.year if end else None), ref)
        if start and end and timedelta(0) <= end - start <= timedelta(days=14):
            found.append((start, end))
            spans.append(m.span())

    for m in RE_NAMED.finditer(text):
        if taken(m):
            continue
        d1, d2, mon, y = m.groups()
        month = MONTHS[mon.lower()]
        year = int(y) if y else None
        start = _mk(int(d1), month, year, ref)
        end = _mk(int(d2), month, year, ref) if d2 else start
        if start and end and timedelta(0) <= end - start <= timedelta(days=14):
            found.append((start, end))
            spans.append(m.span())

    for m in RE_NUM.finditer(text):
        if taken(m):
            continue
        d, mo, y = m.groups()
        # "27.09" ohne Schlusspunkt und ohne Jahr nur akzeptieren, wenn plausibel (kein Preis wie 12.50)
        if y is None and not m.group(0).endswith(".") and len(mo) != 2:
            continue
        dt = _mk(int(d), int(mo), int(y) if y else None, ref)
        if dt:
            found.append((dt, dt))
            spans.append(m.span())
    return found


def _relative_date(text: str, ref: date) -> date | None:
    low = text.lower()
    if re.search(r"\bheute\b", low):
        return ref
    if re.search(r"\bmorgen\b", low) and not re.search(r"\bmorgens\b|\bguten morgen\b", low):
        return ref + timedelta(days=1)
    if re.search(r"(dieses|am|kommendes|nächstes|naechstes)\s+wochenende", low):
        days = (5 - ref.weekday()) % 7
        if ref.weekday() == 6:
            days = 0  # Sonntag: "dieses Wochenende" ist heute
        return ref + timedelta(days=days)
    for m in RE_WEEKDAY.finditer(text):
        word = m.group(1).lower()
        # Abkürzungen ("Sa.", "So.") nur mit Punkt – "so" / "do" sind sonst normale Wörter
        if len(word) <= 2 and not m.group(0).endswith("."):
            continue
        wd = WEEKDAYS[word]
        return ref + timedelta(days=(wd - ref.weekday()) % 7)
    return None


def parse_event_date(text: str, ref: date | None = None) -> ParsedDate | None:
    """Findet den (nächsten) Veranstaltungstermin im Text.

    ``ref`` ist das Bezugsdatum (z.B. Einstelldatum der Anzeige), Standard heute.
    """
    ref = ref or date.today()
    candidates = _explicit_dates(text, ref)
    if candidates:
        # Vergangene Termine (relativ zum Bezugsdatum) ignorieren, sofern es zukünftige gibt
        upcoming = [c for c in candidates if c[1] >= ref - timedelta(days=1)]
        pool = upcoming or candidates
        pool.sort()
        start, end = pool[0]
        # Mehrere einzelne Tage direkt hintereinander (Sa + So) zu einem Zeitraum zusammenfassen
        for s, e in pool[1:]:
            if s <= end + timedelta(days=1) and (e - start).days <= 7:
                end = max(end, e)
        return ParsedDate(start, end, True)
    rel = _relative_date(text, ref)
    if rel:
        return ParsedDate(rel, rel, False)
    return None


def _fmt_time(h: str, m: str | None) -> str | None:
    hh = int(h)
    if hh > 24:
        return None
    return f"{hh}:{m}" if m and m != "00" else f"{hh}"


def parse_time_text(text: str) -> str | None:
    """Liefert z.B. "10–16 Uhr" oder "ab 9 Uhr"."""
    m = RE_TIME_RANGE.search(text)
    if m:
        a = _fmt_time(m.group(1), m.group(2))
        b = _fmt_time(m.group(3), m.group(4))
        if a and b:
            return f"{a}–{b} Uhr"
    m = RE_TIME_FROM.search(text)
    if m:
        a = _fmt_time(m.group(1), m.group(2))
        if a:
            return f"ab {a} Uhr"
    return None


def parse_posted_date(raw: str, now: datetime | None = None) -> date | None:
    """Kleinanzeigen-Einstelldatum: "Heute, 14:23", "Gestern, 09:10", "24.09.2026"."""
    now = now or datetime.now()
    raw = (raw or "").strip().lower()
    if not raw:
        return None
    if raw.startswith("heute"):
        return now.date()
    if raw.startswith("gestern"):
        return now.date() - timedelta(days=1)
    m = re.search(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", raw)
    if m:
        try:
            return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            return None
    return None
