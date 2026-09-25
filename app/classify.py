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
