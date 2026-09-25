"""Ordnet Anzeigen einer Kategorie zu und erkennt Dienstleister-Werbung."""
from __future__ import annotations

import re

# Reihenfolge = Priorität (spezifisch vor allgemein)
CATEGORIES: list[tuple[str, str, list[str]]] = [
    ("kinder", "Kinder & Basar", ["kinderflohmarkt", "kinderbasar", "kleiderbasar", "baby basar", "babybasar",
                                   "spielzeugbasar", "kinderkleiderbasar", "basar"]),
    ("haushalt", "Haushaltsauflösung", ["haushaltsauflösung", "haushaltsaufloesung", "wohnungsauflösung",
                                         "hausauflösung", "nachlass", "haushaltsauflösungen", "wohnungsaufloesung",
                                         "hausaufloesung", "kellerauflösung", "dachbodenauflösung", "räumungsverkauf",
                                         "alles muss raus", "auflösung"]),
    ("hof", "Hof- & Garagenflohmarkt", ["hofflohmarkt", "garagenflohmarkt", "hausflohmarkt", "gartenflohmarkt",
                                        "straßenflohmarkt", "strassenflohmarkt", "hofverkauf", "garagenverkauf",
                                        "hofflohmärkte", "privatflohmarkt", "kellerflohmarkt", "scheunenflohmarkt"]),
    ("antik", "Trödel- & Antikmarkt", ["trödelmarkt", "troedelmarkt", "antikmarkt", "antikmärkte", "sammlermarkt",
                                       "trödel", "antiquitätenmarkt", "büchermarkt"]),
    ("flohmarkt", "Flohmarkt", ["flohmarkt", "flohmärkte", "nachtflohmarkt", "hallenflohmarkt", "fundgrube"]),
]
CATEGORY_LABELS = {key: label for key, label, _ in CATEGORIES} | {"sonstiges": "Sonstiges"}

SERVICE_WORDS = [
    "entrümpelung", "entrümpeln", "entruempelung", "besenrein", "wir bieten", "bieten wir", "bieten ihnen",
    "festpreis", "kostenlose besichtigung", "kostenloses angebot", "unverbindliches angebot",
    "wertanrechnung", "fachbetrieb", "unser team", "unsere firma", "rufen sie", "kontaktieren sie uns",
    "seit über", "jahre erfahrung", "jahren erfahrung", "entsorgung", "fachgerecht", "ankauf", "kaufe ",
    "wir kaufen", "sofortankauf", "barzahlung vor ort", "umzugsservice", "umzüge", "transporte",
    "reinigung", "bundesweit", "24/7", "whatsapp", "gewerblich",
]
WANTED_RE = re.compile(r"^\s*(suche|gesucht|biete\s+hilfe|ankauf)\b", re.I)


def classify(title: str, text: str = "") -> str:
    blob = f"{title} {text}".lower()
    t = title.lower()
    for key, _, words in CATEGORIES:
        if any(w in t for w in words):
            return key
    for key, _, words in CATEGORIES:
        if any(w in blob for w in words):
            return key
    return "sonstiges"


def is_service_ad(title: str, text: str = "") -> bool:
    """True für Werbung von Entrümpelungsfirmen, Ankäufern und Gesuchen – keine echten Termine."""
    if WANTED_RE.search(title):
        return True
    blob = f"{title} {text}".lower()
    hits = sum(1 for w in SERVICE_WORDS if w in blob)
    return hits >= 2 or ("entrümpel" in title.lower()) or ("ankauf" in title.lower())


# ---------- Veranstaltung oder einzelner Artikel? ----------
# Viele Anzeigen nennen "Haushaltsauflösung" nur als Grund ("Vase aus Haushaltsauflösung, 5 €").
# Solche Einzelartikel sollen nicht erscheinen – nur echte Termine/Verkäufe vor Ort.
_EVENT_WORDS = re.compile(
    r"flohmarkt|flohmärkte|trödelmarkt|troedelmarkt|antikmarkt|basar|bazar|haushaltsauflösung|haushaltsaufloesung|"
    r"wohnungsauflösung|wohnungsaufloesung|hausauflösung|hausaufloesung|nachlass|hofverkauf|garagenverkauf|"
    r"räumungsverkauf|kellerauflösung|dachbodenauflösung|garagenflohmarkt|hofflohmarkt",
    re.I,
)
_REASON_ONLY = re.compile(
    r"\b(aus|wegen|von|vom|durch|nach|bei|infolge)\s+(der\s+|einer\s+|meiner\s+|unserer\s+|dem\s+|einem\s+)?"
    r"(haushalts|wohnungs|haus|keller|dachboden)?(auflösung|aufloesung|nachlass)",
    re.I,
)
_ON_SITE = re.compile(
    r"vor ort|alles muss raus|besichtigung|termin|geöffnet|öffnungszeit|\d\s*uhr\b|samstag|sonntag|wochenende|"
    r"verkauf findet|verkaufen wir|stände|standgebühr|aussteller|verkäufer|tür(en)? offen|kommen sie|kommt vorbei|"
    r"schnäppchen|stöbern|alles günstig|restposten|komplett|gesamter hausstand|hausstand|inventar|wir räumen|"
    r"ich räume|räumen unser|kommt vorbei|vorbeikommen",
    re.I,
)
# Eindeutige Veranstaltungswörter (anders als "Flohmarkt"/"Trödel", die oft nur Schlagwort für Einzelartikel sind)
_STRONG_WORDS = re.compile(
    r"hofflohmarkt|garagenflohmarkt|hausflohmarkt|gartenflohmarkt|straßenflohmarkt|kinderflohmarkt|nachtflohmarkt|"
    r"hallenflohmarkt|haushaltsauflösung|haushaltsaufloesung|wohnungsauflösung|wohnungsaufloesung|hausauflösung|"
    r"hausaufloesung|basar|bazar|trödelmarkt|troedelmarkt|antikmarkt|räumungsverkauf|garagenverkauf|hofverkauf",
    re.I,
)
_ITEM_PRICE = re.compile(r"^\s*\d+[\d.,]*\s*€")
# Typische Wörter für Einzelartikel/Konvolute ("Trödel Flohmarkt Konvolut", "Flohmarkt Paket Kinderkleidung")
_ITEM_WORDS = re.compile(
    r"konvolut|paket|sammlung|kiste|karton|\bset\b|stück|figur|vase|geschirr|teller|tasse|lampe|handy|iphone|"
    r"samsung|playstation|fahrrad|schrank|sofa|stuhl|tisch|kleid|jacke|schuhe|gr\.\s*\d|größe|zu verkaufen|verkaufe\b",
    re.I,
)


def is_event_ad(title: str, text: str = "", price: str = "", has_date: bool = False, has_time: bool = False) -> bool:
    """True, wenn die Anzeige eine Veranstaltung / einen Verkauf vor Ort beschreibt."""
    t = title or ""
    blob = f"{t}\n{text or ''}"
    in_title = bool(_EVENT_WORDS.search(t)) and not _REASON_ONLY.search(t)
    if not in_title and not _EVENT_WORDS.search(blob):
        return False
    score = 0
    score += (3 if _STRONG_WORDS.search(t) else 2) if in_title else 0
    score -= 3 if _REASON_ONLY.search(t) else 0
    score -= 2 if _ITEM_WORDS.search(t) else 0
    score += 2 if has_date else 0
    score += 1 if has_time else 0
    score += 1 if _ON_SITE.search(blob) else 0
    if _ITEM_PRICE.search(price or ""):
        # Konkreter Preis spricht für einen Einzelartikel (Veranstaltungen haben meist keinen Preis)
        score -= 2
    return score >= 3
