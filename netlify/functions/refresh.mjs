// Netlify Scheduled Function: zweiter Wecker für die Termin-Suche.
//
// GitHub lässt geplante Läufe manchmal ausfallen. Diese Funktion läuft jede Stunde bei Netlify, schaut nach,
// wie alt die veröffentlichten Termine sind, und stößt die Suche bei GitHub an, wenn sie älter als
// 2 Std 40 Min sind. So kommt spätestens alle ~3 Stunden ein neuer Stand.
// Benötigt dasselbe GITHUB_TOKEN wie sources.mjs (Contents: Read and write reicht).

const REPO = process.env.GITHUB_REPO || "anonym239/Kleinanzeigen";
const MAX_AGE = 9600; // Sekunden

export default async () => {
  if (!process.env.GITHUB_TOKEN) return new Response("GITHUB_TOKEN fehlt", { status: 200 });
  let age = Infinity;
  try {
    const site = process.env.URL || "";
    const r = await fetch(`${site}/data/events.json?t=${Date.now()}`, { cache: "no-store" });
    age = Date.now() / 1000 - (await r.json()).generated_at;
  } catch { /* unbekannt -> anstoßen */ }
  if (age < MAX_AGE) return new Response(`Stand ist ${Math.round(age / 60)} Minuten alt – nichts zu tun`);
  const r = await fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "flohmarkt-finder",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event_type: "refresh" }),
  });
  return new Response(r.ok ? "Suche angestoßen" : `GitHub ${r.status}: ${(await r.text()).slice(0, 200)}`);
};

export const config = { schedule: "53 * * * *" }; // jede Stunde (Minute 53, versetzt zu GitHubs Zeitplan)
