// Netlify Function: Quelle direkt aus Seite/App hinzufügen oder entfernen.
//
// Trägt die Webadresse in config.json auf GitHub ein und startet sofort den Suchlauf.
// Benötigt in Netlify (Project configuration → Environment variables):
//   GITHUB_TOKEN  – GitHub-Token mit Schreibrecht auf das Repository (Contents + Actions)
// Optional:
//   GITHUB_REPO   – Standard: anonym239/Kleinanzeigen
//   SOURCE_PIN    – wenn gesetzt, muss diese PIN mitgeschickt werden (Schutz vor Fremden)

const REPO = process.env.GITHUB_REPO || "anonym239/Kleinanzeigen";
const BUILTIN = ["kleinanzeigen.de", "krencky24.de", "meine-flohmarkt-termine.de", "kn-online.de"];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const reply = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function gh(path, init = {}) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "flohmarkt-finder",
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
}

const hostOf = (u) => new URL(u).hostname.toLowerCase().replace(/^www\./, "");

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return reply(405, { ok: false, message: "Nur POST erlaubt." });
  if (!process.env.GITHUB_TOKEN) {
    return reply(503, { ok: false, code: "no_token", message: "Das direkte Hinzufügen ist noch nicht eingerichtet (GITHUB_TOKEN fehlt bei Netlify)." });
  }
  let body;
  try { body = await req.json(); } catch { return reply(400, { ok: false, message: "Ungültige Anfrage." }); }
  if (process.env.SOURCE_PIN && String(body.pin || "") !== process.env.SOURCE_PIN) {
    return reply(401, { ok: false, code: "pin", message: "Bitte die richtige PIN eingeben." });
  }
  const action = body.action === "remove" ? "remove" : "add";
  let url = String(body.url || "").trim();
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  let host;
  try { host = hostOf(url); } catch { host = ""; }
  if (!host.includes(".")) return reply(400, { ok: false, message: "Bitte eine gültige Webadresse eingeben, z.B. https://www.kieler-express.de" });

  try {
    const repo = await gh("");
    const branch = repo.default_branch;
    const file = await gh(`/contents/config.json?ref=${encodeURIComponent(branch)}`);
    const cfg = JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
    let urls = Array.isArray(cfg.extra_urls) ? cfg.extra_urls : [];
    let message;
    if (action === "add") {
      if (BUILTIN.some((b) => host.endsWith(b))) return reply(200, { ok: true, changed: false, message: `${host} ist schon fest eingebaut.` });
      if (urls.some((u) => { try { return hostOf(u) === host && u === url; } catch { return false; } })) {
        return reply(200, { ok: true, changed: false, message: `${host} ist schon als Quelle eingetragen.` });
      }
      if (urls.length >= 30) return reply(400, { ok: false, message: "Es sind schon 30 eigene Quellen eingetragen – bitte erst eine entfernen." });
      urls = [...urls, url];
      message = `${host} wurde hinzugefügt. Die Suche läuft – in etwa 10 Minuten erscheinen die Termine.`;
    } else {
      const keep = urls.filter((u) => { try { return hostOf(u) !== host; } catch { return true; } });
      if (keep.length === urls.length) return reply(200, { ok: true, changed: false, message: `${host} war nicht eingetragen.` });
      urls = keep;
      message = `${host} wurde entfernt. Ab dem nächsten Suchlauf (ca. 10 Minuten) sind die Termine weg.`;
    }
    cfg.extra_urls = urls;
    const content = Buffer.from(JSON.stringify(cfg, null, 2) + "\n", "utf8").toString("base64");
    await gh("/contents/config.json", {
      method: "PUT",
      body: JSON.stringify({ message: `Quelle ${action === "add" ? "hinzugefügt" : "entfernt"}: ${host} (aus der App)`, content, sha: file.sha, branch }),
    });
    // Die Änderung an config.json startet den Suchlauf automatisch (Workflow "Termine suchen").
    return reply(200, { ok: true, changed: true, message });
  } catch (e) {
    return reply(502, { ok: false, message: `Speichern bei GitHub hat nicht geklappt: ${e.message}` });
  }
};
