"""Fügt eine Quelle (Webseite) zu config.json hinzu oder entfernt sie.

Wird vom Workflow "Quelle hinzufügen/entfernen" aufgerufen, wenn in der Seite/App auf
"Quelle hinzufügen" getippt wurde (daraus entsteht ein GitHub-Issue mit Titel
"Quelle hinzufügen: https://..." bzw. "Quelle entfernen: https://...").

Ausgabe (letzte Zeile): Nachricht für die Antwort im Issue. Rückgabewert 0 = geändert, 3 = nichts zu tun.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

URL_RE = re.compile(r"https?://[^\s<>\"')\]]+", re.I)
BUILTIN = ("kleinanzeigen.de", "krencky24.de", "meine-flohmarkt-termine.de", "kn-online.de")


def parse_request(title: str, body: str) -> tuple[str | None, str | None]:
    t = (title or "").lower()
    action = "add" if "hinzuf" in t else "remove" if "entfern" in t else None
    m = URL_RE.search(title or "") or URL_RE.search(body or "")
    url = m.group(0).rstrip(".,;") if m else None
    return action, url


def apply(config_path: Path, action: str, url: str) -> tuple[bool, str]:
    cfg = json.loads(config_path.read_text(encoding="utf-8"))
    urls: list[str] = list(cfg.get("extra_urls") or [])
    host = urlparse(url).netloc.lower().removeprefix("www.")
    if not host or "." not in host:
        return False, f"„{url}“ ist keine gültige Webadresse."
    if action == "add":
        if any(host.endswith(b) for b in BUILTIN):
            return False, f"{host} ist schon fest eingebaut – nichts zu tun."
        if url in urls:
            return False, f"{url} ist schon als Quelle eingetragen."
        if len(urls) >= 30:
            return False, "Es sind schon 30 eigene Quellen eingetragen – bitte erst eine entfernen."
        urls.append(url)
        msg = (f"✅ Quelle **{host}** hinzugefügt. Die Suche läuft jetzt; in ca. 10 Minuten erscheinen die Termine "
               f"(nur Floh-, Trödel-, Kindermärkte und Haushaltsauflösungen mit Datum im eingestellten Umkreis).")
    else:
        keep = [u for u in urls if u != url and urlparse(u).netloc.lower().removeprefix("www.") != host]
        if len(keep) == len(urls):
            return False, f"{host} war nicht als eigene Quelle eingetragen."
        urls = keep
        msg = f"🗑️ Quelle **{host}** entfernt. Ab dem nächsten Suchlauf (ca. 10 Minuten) sind ihre Termine weg."
    cfg["extra_urls"] = urls
    config_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return True, msg


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config.json")
    ap.add_argument("--title", default="")
    ap.add_argument("--body", default="")
    a = ap.parse_args()
    action, url = parse_request(a.title, a.body)
    if not action or not url:
        print("Bitte im Titel „Quelle hinzufügen: https://…“ oder „Quelle entfernen: https://…“ schreiben.")
        return 3
    changed, msg = apply(Path(a.config), action, url)
    print(msg)
    return 0 if changed else 3


if __name__ == "__main__":
    sys.exit(main())
