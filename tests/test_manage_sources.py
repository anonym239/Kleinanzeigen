import json

from tools.manage_sources import apply, parse_request


def test_parse_request():
    assert parse_request("Quelle hinzufügen: https://www.kieler-express.de/kleinanzeigen", "") == \
        ("add", "https://www.kieler-express.de/kleinanzeigen")
    assert parse_request("Quelle entfernen", "Adresse: https://example.org/termine.") == ("remove", "https://example.org/termine")
    assert parse_request("Hallo", "") == (None, None)


def test_apply_add_remove(tmp_path):
    cfg = tmp_path / "config.json"
    cfg.write_text(json.dumps({"home": "24146", "extra_urls": []}))
    changed, msg = apply(cfg, "add", "https://www.kieler-express.de/kleinanzeigen")
    assert changed and "kieler-express.de" in msg
    assert json.loads(cfg.read_text())["extra_urls"] == ["https://www.kieler-express.de/kleinanzeigen"]
    assert apply(cfg, "add", "https://www.kieler-express.de/kleinanzeigen")[0] is False  # doppelt
    assert apply(cfg, "add", "https://www.kleinanzeigen.de/s-kiel/k0")[0] is False     # fest eingebaut
    changed, _ = apply(cfg, "remove", "https://kieler-express.de/")
    assert changed and json.loads(cfg.read_text())["extra_urls"] == []
    assert json.loads(cfg.read_text())["home"] == "24146"
