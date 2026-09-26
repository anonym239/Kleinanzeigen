/* Flohmarkt-Finder – Oberfläche (ohne Build-Schritt, reines JavaScript) */
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    const json = JSON.stringify(value), at = Date.now();
    try { localStorage.setItem(key, json); localStorage.setItem("__at", String(at)); } catch { /* egal */ }
    // In der Android-App zusätzlich sicher im Handy speichern (falls Android die App im Hintergrund beendet)
    try { if (window.AndroidApp && typeof window.AndroidApp.backupSet === "function") window.AndroidApp.backupSet(key, json, at); } catch { /* egal */ }
  },
};

/* Beim Start: war die Sicherung in der App neuer als der Browser-Speicher? Dann zurückholen. */
(function restoreBackup() {
  try {
    if (!window.AndroidApp || typeof window.AndroidApp.backupGetAll !== "function") return;
    const b = JSON.parse(window.AndroidApp.backupGetAll() || "{}");
    const local = Number(localStorage.getItem("__at") || 0);
    if (!b.__at || b.__at <= local) {
      // Browser-Speicher ist aktuell: einmalig komplett sichern (z.B. nach dem Update auf diese Version)
      if (!b.__at) for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k !== "__at") window.AndroidApp.backupSet(k, localStorage.getItem(k), local || Date.now());
      }
      return;
    }
    for (const [k, v] of Object.entries(b)) if (k !== "__at" && typeof v === "string") localStorage.setItem(k, v);
    localStorage.setItem("__at", String(b.__at));
  } catch { /* egal */ }
})();

const DEFAULT_FILTERS = {
  range: "weekend", cats: [], q: "", radius: null, weekendOnly: false, favOnly: false,
  undated: false, noLocation: false, services: false, showHidden: false, source: "", sort: "date",
};
const FILTER_KEY = "filters.v3";
// Nur diese Einstellungen bleiben beim nächsten Öffnen erhalten. Quelle, Suche, Kategorien usw. starten immer frisch,
// sonst sieht man später nur noch einen Teil der Termine, ohne zu merken warum.
const KEEP_FILTERS = ["radius", "sort", "noLocation", "services", "showHidden"];
const CAT_COLORS = ["dorf", "strasse", "flohmarkt", "hof", "haushalt", "kinder", "antik", "sonstiges"];
const TOP_CATS = ["dorf", "strasse"]; // die besten Flohmärkte – werden hervorgehoben und stehen oben
const isTop = (ev) => TOP_CATS.includes(ev.category);
const savedFilters = () => {
  const saved = store.get(FILTER_KEY, {}) || {};
  return Object.fromEntries(KEEP_FILTERS.filter((k) => k in saved).map((k) => [k, saved[k]]));
};

const S = {
  events: [], settings: {}, categories: {}, today: null,
  // Startansicht ist immer "Dieses Wochenende" ohne weitere Einschränkung (nur Umkreis & Sortierung bleiben)
  filters: { ...DEFAULT_FILTERS, ...savedFilters() },
  view: store.get("view", "list") === "map" ? "map" : "list",
  map: null, mapLayer: null, prevVisit: 0, polling: null,
  pdf: null, // PDF-Auswahl: { sel: Set von Termin-IDs }
};

/* ---------- Hilfsfunktionen ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const parseISO = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayDiff = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
const fmtDay = (iso) => parseISO(iso).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
const fmtShort = (iso) => parseISO(iso).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "numeric" });

function relDay(iso) {
  const n = dayDiff(S.today, iso);
  if (n === 0) return "heute";
  if (n === 1) return "morgen";
  if (n === 2) return "übermorgen";
  if (n > 2) return `in ${n} Tagen`;
  if (n === -1) return "gestern";
  return `vor ${-n} Tagen`;
}

function icon(name) {
  const p = {
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9Z"/>',
    route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h7"/>',
    eyeoff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3 3.8M6.4 6.4A17 17 0 0 0 2.5 12S6 19 12 19a9.5 9.5 0 0 0 5.6-1.8M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    eye: '<path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z"/><circle cx="12" cy="12" r="3"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9Z"/><circle cx="8" cy="8" r="1.5"/>',
  }[name];
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
}

/* Symbole je Art (Dorf, Straße, Marktstand, Garage, Sessel, Teddy, Vase, Preisschild) */
const CAT_ICONS = {
  dorf: '<path d="M2 20h20"/><path d="M3.5 20v-6l3.5-3 3.5 3v6M6 20v-3h2v3"/><path d="M13 20V9l3.5-3.5L20 9v11M16.5 5.5V2.5M15.3 3.7h2.4M15.5 20v-3.5h2V20"/>',
  strasse: '<path d="M8 3 4 21M16 3l4 18"/><path d="M12 4v2.5M12 10v3M12 16.5V20"/>',
  flohmarkt: '<path d="M3 9.5 5 4h14l2 5.5"/><path d="M3 9.5h18c0 1.7-1.3 3-3 3s-3-1.3-3-3c0 1.7-1.3 3-3 3s-3-1.3-3-3c0 1.7-1.3 3-3 3s-3-1.3-3-3Z"/><path d="M5 12.5V20h14v-7.5M10 20v-4.5h4V20"/>',
  hof: '<path d="M3 11 12 4l9 7"/><path d="M5 9.5V20h14V9.5"/><path d="M8 20v-7h8v7M8 15.5h8M8 18h8"/>',
  haushalt: '<path d="M6 11V8a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v3"/><path d="M3.5 13a2 2 0 0 1 4 0v2h9v-2a2 2 0 0 1 4 0v5h-17Z"/><path d="M6 18v2M18 18v2"/>',
  kinder: '<circle cx="12" cy="13.5" r="6"/><circle cx="6.8" cy="6.8" r="2.3"/><circle cx="17.2" cy="6.8" r="2.3"/><path d="M10.2 12.2h.01M13.8 12.2h.01M10.5 15.6c1 .8 2 .8 3 0"/>',
  antik: '<path d="M9 3h6M10 3v3.5C7 8.5 6 11 6.8 14.5 7.5 17.5 9.5 20 12 20s4.5-2.5 5.2-5.5C18 11 17 8.5 14 6.5V3"/><path d="M7 12h10"/>',
  sonstiges: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9Z"/><circle cx="8" cy="8" r="1.5"/>',
};
const catKey = (k) => (CAT_COLORS.includes(k) ? k : "sonstiges");
const catIcon = (k, cls = "") => `<svg class="cat-ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${CAT_ICONS[catKey(k)]}</svg>`;

function toast(msg, ms = 3500) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

const STATIC = !!window.FLOHMARKT_STATIC;
if (STATIC) document.documentElement.classList.add("static-mode");
if (window.AndroidApp) window.FLOHMARKT_APP = true; // Webseite läuft in der Android-App
if (window.FLOHMARKT_APP) document.documentElement.classList.add("in-app");

async function api(path, opts = {}) {
  if (STATIC) return localApi(path.replace(/^\//, ""), opts);
  const r = await fetch(path.replace(/^\//, ""), { headers: { "Content-Type": "application/json" }, ...opts });
  if (!r.ok) {
    let msg = `Fehler ${r.status}`;
    try { const j = await r.json(); if (j.detail) msg = typeof j.detail === "string" ? j.detail : "Bitte Eingaben prüfen."; } catch { /* egal */ }
    throw new Error(msg);
  }
  return r.json();
}

/* ---------- Betrieb ohne Server (GitHub Pages) ----------
   Die Termine kommen aus data/events.json (alle 3 Stunden von GitHub neu erzeugt).
   Wohnort, Favoriten, Notizen und eigene Termine speichert der Browser. */
const L$ = { data: null };

function haversine(lat1, lon1, lat2, lon2) {
  const r = (x) => (x * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

async function geocodeBrowser(q) {
  const plz = /^\d{5}$/.test(q.trim());
  const params = new URLSearchParams({ format: "json", limit: "1", countrycodes: "de,at,ch" });
  if (plz) { params.set("postalcode", q.trim()); params.set("country", "Deutschland"); } else params.set("q", q);
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { "Accept-Language": "de" } });
  const j = r.ok ? await r.json() : [];
  if (!j.length) return null;
  return { lat: Number(j[0].lat), lon: Number(j[0].lon), label: j[0].display_name };
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function loadStaticData(force = false) {
  if (L$.data && !force) return L$.data;
  // Mehrere Quellen und Versuche (in der App z.B. GitHub und als Ersatz das jsDelivr-CDN)
  const sources = window.FLOHMARKT_DATA_URLS || [window.FLOHMARKT_DATA_URL || "data/events.json"];
  const problems = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const src of sources) {
      try {
        const r = await fetch(`${src}?t=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) { problems.push(`${new URL(src, location.href).host}: HTTP ${r.status}`); continue; }
        L$.data = await r.json();
        L$.at = Date.now();
        return L$.data;
      } catch (e) {
        problems.push(`${new URL(src, location.href).host}: ${e.message}`);
      }
    }
    await sleep(1500 * (attempt + 1)); // z.B. wenn das Netz beim App-Start noch nicht bereit ist
  }
  const err = new Error("Die Termine konnten nicht geladen werden.");
  err.detail = `${navigator.onLine === false ? "Das Gerät meldet: keine Internetverbindung. " : ""}${[...new Set(problems)].join(" · ")}`;
  throw err;
}

function localSettings() {
  const region = L$.data?.region || {};
  const start = L$.data?.start?.lat != null ? L$.data.start : null; // Standard-Start, z.B. 24147 Kiel-Elmschenhagen Nord
  const own = store.get("homeSettings", {});
  // Früher nur "24147" eingetragen? Dann den genaueren Standard-Start nehmen (gleiche PLZ)
  if (start && own.home_query && !own.home_precise && /^\d{5}$/.test(own.home_query.trim()) && start.query.startsWith(own.home_query.trim())) {
    delete own.home_query; delete own.home_lat; delete own.home_lon; delete own.home_label;
    store.set("homeSettings", own);
  }
  return {
    home_query: start?.query || region.home_query || "", home_label: start?.query || region.home_label || "",
    home_lat: start?.lat ?? region.home_lat ?? null, home_lon: start?.lon ?? region.home_lon ?? null,
    radius_km: region.radius_km || 50, days_ahead: region.days_ahead || 14,
    region_query: region.home_query || "", region_radius: region.radius_km || 50, ...own,
  };
}

function manualEvents() { return store.get("manualEvents", []); }

/* Merken/Ausblenden/Notizen je Termin. Früher wurden die IDs versehentlich kodiert gespeichert ("ka%3A123") –
   die werden hier einmalig zurückgeholt, damit nichts Gemerktes verloren geht. */
function eventStates() {
  const states = store.get("eventState", {});
  let fixed = false;
  for (const k of Object.keys(states)) {
    if (!k.includes("%")) continue;
    let real = k;
    try { real = decodeURIComponent(k); } catch { continue; }
    states[real] = { ...states[k], ...(states[real] || {}) };
    delete states[k]; fixed = true;
  }
  if (fixed) store.set("eventState", states);
  return states;
}

async function localApi(path, opts) {
  const method = (opts.method || "GET").toUpperCase();
  const body = opts.body ? JSON.parse(opts.body) : {};
  const states = eventStates();
  const m0 = path.match(/^api\/events\/(.+?)(\/state)?$/);
  const m = m0 && [m0[0], decodeURIComponent(m0[1]), m0[2]]; // IDs kommen URL-kodiert ("ka%3A123" -> "ka:123")

  if (path === "api/settings" && method === "GET") { await loadStaticData(); return localSettings(); }
  if (path === "api/settings" && method === "PUT") {
    const cur = localSettings();
    const own = store.get("homeSettings", {});
    for (const k of ["radius_km", "days_ahead"]) if (body[k] != null) own[k] = body[k];
    if (body.home_lat != null && body.home_lon != null) {
      // Genauer Standort vom Handy
      Object.assign(own, { home_query: body.home_query, home_label: body.home_label || body.home_query,
        home_lat: body.home_lat, home_lon: body.home_lon, home_precise: true });
    } else if (body.home_query != null && body.home_query.trim() !== cur.home_query) {
      const q = body.home_query.trim();
      let g = null;
      try { g = q ? await geocodeBrowser(q) : null; } catch { /* offline */ }
      if (q && !g) throw new Error(`Ort „${q}“ wurde nicht gefunden. Bitte PLZ oder Ortsnamen prüfen.`);
      if (q) Object.assign(own, { home_query: q, home_lat: g.lat, home_lon: g.lon, home_label: g.label, home_precise: false });
      else { for (const k of ["home_query", "home_lat", "home_lon", "home_label", "home_precise"]) delete own[k]; } // leer = Standard-Start
    }
    store.set("homeSettings", own);
    return localSettings();
  }
  if (path === "api/events" && method === "GET") {
    const data = await loadStaticData();
    const set = localSettings();
    const events = [...data.events, ...manualEvents()].map((e) => {
      const st = states[e.id] || {};
      const dist = set.home_lat != null && e.lat != null ? Math.round(haversine(set.home_lat, set.home_lon, e.lat, e.lon) * 10) / 10 : null;
      return { ...e, favorite: !!st.favorite, hidden: !!st.hidden, note: st.note || "", distance_km: dist,
        category_label: data.categories[e.category] || "Sonstiges", manual: !!e.manual };
    });
    const today = new Date();
    return { events, categories: data.categories, today: toISO(today) };
  }
  if (m && m[2] && method === "PATCH") {
    states[m[1]] = { ...(states[m[1]] || {}), ...body };
    store.set("eventState", states);
    return states[m[1]];
  }
  if (path === "api/events" && method === "POST") {
    const ev = {
      id: `manual:${Date.now().toString(36)}`, source: "eigener Eintrag", manual: true, title: body.title,
      description: body.description || "", url: /^https?:\/\//.test(body.url || "") ? body.url : "", image: "",
      category: body.category, start_date: body.start_date, end_date: body.end_date && body.end_date >= body.start_date ? body.end_date : body.start_date,
      date_certain: true, time_text: body.time_text || "", location: body.address || "", address: body.address || "",
      lat: null, lon: null, price: "", is_service: false, posted_at: null, first_seen: Date.now() / 1000,
    };
    if (!ev.title || ev.title.length < 2 || !ev.start_date) throw new Error("Bitte Titel und Datum angeben.");
    if (ev.address) { try { const g = await geocodeBrowser(ev.address); if (g) { ev.lat = g.lat; ev.lon = g.lon; } } catch { /* offline */ } }
    store.set("manualEvents", [...manualEvents(), ev]);
    return ev;
  }
  if (m && !m[2] && method === "DELETE") {
    store.set("manualEvents", manualEvents().filter((e) => e.id !== m[1]));
    return { ok: true };
  }
  if (path === "api/hidden/reset") {
    let n = 0;
    for (const st of Object.values(states)) if (st.hidden) { st.hidden = false; n++; }
    store.set("eventState", states);
    return { restored: n };
  }
  if (path === "api/refresh") {
    await loadStaticData(true);
    return { started: false, running: false };
  }
  if (path === "api/status") {
    const data = await loadStaticData();
    return { running: false, message: "", last_finished: data.generated_at, runs: data.runs || [], total_events: data.events.length };
  }
  throw new Error("Unbekannte Anfrage");
}

/* ---------- Kalender-Datei (.ics) ---------- */
function icsFor(evs) {
  const esc2 = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const d = (iso, plus = 0) => toISO(addDays(parseISO(iso), plus)).replace(/-/g, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Flohmarkt-Finder//DE", "CALSCALE:GREGORIAN"];
  for (const ev of evs) {
    if (!ev.start_date) continue;
    lines.push("BEGIN:VEVENT", `UID:${ev.id.replace(/[^a-zA-Z0-9]/g, "")}@flohmarkt-finder`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
      `DTSTART;VALUE=DATE:${d(ev.start_date)}`, `DTEND;VALUE=DATE:${d(ev.end_date || ev.start_date, 1)}`,
      `SUMMARY:${esc2(ev.title + (ev.time_text ? ` (${ev.time_text})` : ""))}`,
      `DESCRIPTION:${esc2([ev.time_text, (ev.description || "").slice(0, 1000), ev.url].filter(Boolean).join("\n"))}`,
      `LOCATION:${esc2(ev.address || ev.location)}`, ...(ev.url ? [`URL:${ev.url}`] : []), "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

function downloadIcs(ev) {
  if (window.AndroidApp && ev.start_date) {
    const start = parseISO(ev.start_date), end = addDays(parseISO(ev.end_date || ev.start_date), 1);
    window.AndroidApp.addToCalendar(ev.title + (ev.time_text ? ` (${ev.time_text})` : ""), start.getTime(), end.getTime(),
      ev.address || ev.location || "", [ev.time_text, (ev.description || "").slice(0, 800), ev.url].filter(Boolean).join("\n"));
    return;
  }
  if (!STATIC) { location.href = `api/events/${encodeURIComponent(ev.id)}/ics`; return; }
  const url = URL.createObjectURL(new Blob([icsFor([ev])], { type: "text/calendar" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "termin.ics" });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ---------- Datum-Bereiche ---------- */
function rangeBounds(range) {
  const t = parseISO(S.today);
  const dow = t.getDay(); // So=0, Sa=6
  let sat = addDays(t, (6 - dow + 7) % 7);
  if (dow === 0) sat = addDays(t, -1);
  switch (range) {
    case "today": return [t, t];
    case "weekend": return [dow === 0 || dow === 5 ? t : sat, addDays(sat, 1)]; // freitags inkl. Freitag
    case "nextweekend": return [addDays(sat, 7), addDays(sat, 8)];
    case "days": return [t, addDays(t, (S.settings.days_ahead || 14))];
    default: return [t, null];
  }
}

function overlapsWeekend(ev) {
  const s = parseISO(ev.start_date), e = parseISO(ev.end_date || ev.start_date);
  if (dayDiff(ev.start_date, ev.end_date || ev.start_date) >= 6) return true;
  for (let d = new Date(s); d <= e; d = addDays(d, 1)) if (d.getDay() === 0 || d.getDay() === 6) return true;
  return false;
}

/* ---------- Filtern ---------- */
function radiusValue() { return S.filters.radius ?? S.settings.radius_km ?? 30; }

function passesBase(ev, f, skipCats = false) {
  if (ev.hidden && !f.showHidden) return false;
  if (ev.is_service && !f.services) return false;
  if (f.favOnly && !ev.favorite) return false;
  if (f.source && ev.source !== f.source) return false;
  if (!skipCats && f.cats.length && !f.cats.includes(ev.category)) return false;
  if (f.q) {
    const hay = `${ev.title} ${ev.description} ${ev.location} ${ev.address} ${ev.note}`.toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))) return false;
  }
  if (ev.distance_km == null) {
    if (!f.noLocation && S.settings.home_lat != null) return false;
  } else if (S.settings.home_lat != null && ev.distance_km > radiusValue()) return false;

  if (!ev.start_date) return f.undated || f.favOnly;
  const [from, to] = rangeBounds(f.range);
  const s = parseISO(ev.start_date), e = parseISO(ev.end_date || ev.start_date);
  if (e < from) return false;
  if (to && s > to) return false;
  if (f.weekendOnly && !overlapsWeekend(ev)) return false;
  return true;
}

function filtered() {
  const f = S.filters;
  const list = S.view === "fav"
    ? S.events.filter((ev) => ev.favorite && !ev.hidden && !isPast(ev))
    : S.events.filter((ev) => passesBase(ev, f));
  const byNew = (a, b) => b.first_seen - a.first_seen;
  if (f.sort === "distance") list.sort((a, b) => (a.distance_km ?? 9999) - (b.distance_km ?? 9999));
  else if (f.sort === "new") list.sort(byNew);
  else list.sort((a, b) => {
    if (!a.start_date !== !b.start_date) return a.start_date ? -1 : 1;
    if (a.start_date !== b.start_date) return (a.start_date || "").localeCompare(b.start_date || "");
    if (isTop(a) !== isTop(b)) return isTop(a) ? -1 : 1; // Dorf- und Straßen-Flohmärkte zuerst
    return (a.distance_km ?? 9999) - (b.distance_km ?? 9999);
  });
  return list;
}

function activeFilterCount() {
  const f = S.filters, d = DEFAULT_FILTERS;
  let n = f.cats.length ? 1 : 0;
  for (const k of ["q", "weekendOnly", "favOnly", "undated", "noLocation", "services", "showHidden", "source"]) if (f[k] !== d[k]) n++;
  if (f.radius != null && f.radius !== S.settings.radius_km) n++;
  return n;
}

/* ---------- Darstellung ---------- */
function isNew(ev) { return S.prevVisit && ev.first_seen > S.prevVisit; }

function dateLine(ev) {
  if (!ev.start_date) return `<strong>Datum nicht erkannt</strong> · bitte Anzeige lesen`;
  const multi = ev.end_date && ev.end_date !== ev.start_date;
  let txt = multi ? `${fmtShort(ev.start_date)} – ${fmtShort(ev.end_date)}` : fmtDay(ev.start_date);
  if (!ev.date_certain) txt = `vermutlich ${txt}`;
  return `<strong>${esc(txt)}</strong>${ev.time_text ? ` · ${esc(ev.time_text)}` : ""}`;
}

function placeLine(ev) {
  const place = ev.address || ev.location || "Ort unbekannt";
  const dist = ev.distance_km != null ? ` · <strong>${ev.distance_km.toLocaleString("de-DE")} km</strong>` : "";
  return `${esc(place)}${dist}`;
}

function sourceLabel(src) { return src === "kleinanzeigen" ? "Kleinanzeigen" : src; }

function routeUrl(ev) {
  const dest = ev.lat != null ? `${ev.lat},${ev.lon}` : encodeURIComponent(ev.address || ev.location || "");
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
}

function cardHTML(ev) {
  const k = catKey(ev.category);
  const placeholder = `<div class="thumb ph" aria-hidden="true">${catIcon(k)}</div>`;
  const media = ev.image
    ? `<img class="thumb" src="${esc(ev.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML=this.nextElementSibling.innerHTML"><template>${placeholder}</template>`
    : placeholder;
  const pills = [
    isTop(ev) ? `<span class="pill top">★ Top-Tipp</span>` : "",
    `<span class="pill cat">${catIcon(k, "sm")}${esc(ev.category_label)}</span>`,
    isNew(ev) ? `<span class="pill new">NEU</span>` : "",
    memoryPills(ev),
    ev.gone ? `<span class="pill warn">Anzeige nicht mehr online</span>` : "",
    ev.is_service ? `<span class="pill warn">Firma/Werbung</span>` : "",
    `<span class="pill src">${ev.source === "kleinanzeigen" ? "Privat · Kleinanzeigen" : ev.manual ? "Eigener Eintrag"
      : ev.source === "Kieler Nachrichten" ? "Kieler Nachrichten"
      : ["krencky24.de", "meine-flohmarkt-termine.de"].includes(ev.source) ? "Markt-Kalender" : esc(ev.source)}</span>`,
  ].join("");
  return `
  <article class="card ${ev.hidden ? "is-hidden" : ""} ${isTop(ev) ? "is-top" : ""} ${S.pdf?.sel.has(ev.id) ? "picked" : ""}" style="--cat: var(--c-${k})" data-id="${esc(ev.id)}" tabindex="0">
    <span class="pick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span>
    ${media}
    <div class="card-body">
      <div class="card-top">${pills}</div>
      <h3>${esc(ev.title)}</h3>
      <div class="meta">
        <div>${icon("cal")}<span>${dateLine(ev)}</span></div>
        <div>${icon("pin")}<span>${placeLine(ev)}</span></div>
      </div>
      <div class="card-actions">
        <button class="act fav" type="button" data-act="fav" aria-pressed="${ev.favorite}">${icon("star")}<span>${ev.favorite ? "Gemerkt" : "Merken"}</span></button>
        <a class="act" href="${routeUrl(ev)}" target="_blank" rel="noopener" data-act="link">${icon("route")}<span>Route</span></a>
        ${ev.hidden ? `<button class="act" type="button" data-act="hide">${icon("eye")}<span>Einblenden</span></button>` : ""}
        <span class="more" aria-hidden="true">Details ›</span>
      </div>
    </div>
  </article>`;
}

function renderList(list) {
  const el = $("#list");
  if (S.view === "fav") { renderFavView(); return; }
  if (!list.length) {
    const noData = !S.events.length;
    el.innerHTML = `<div class="empty">
      <h2>${noData ? "Noch keine Termine geladen" : "Keine Termine für diese Auswahl"}</h2>
      <p>${noData ? "Tippe auf „Aktualisieren“. Die erste Suche dauert ein paar Minuten." : "Probiere einen längeren Zeitraum, einen größeren Umkreis oder setze die Filter zurück."}</p>
      ${noData ? `<button class="btn primary" type="button" id="emptyRefresh">Jetzt suchen</button>` : `<button class="btn ghost" type="button" id="emptyReset">Filter zurücksetzen</button>`}
    </div>`;
    $("#emptyRefresh")?.addEventListener("click", startRefresh);
    $("#emptyReset")?.addEventListener("click", resetFilters);
    return;
  }
  if (S.filters.sort !== "date") { el.innerHTML = list.map(cardHTML).join(""); return; }
  el.innerHTML = groupedListHTML(list, true);
}

function groupedListHTML(list, overview) {
  const groups = new Map();
  for (const ev of list) {
    const key = ev.start_date && ev.start_date < S.today ? S.today : (ev.start_date || "");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ev);
  }
  let html = "";
  const days = [...groups.keys()].filter(Boolean);
  if (overview && days.length >= 1 && days.length <= 4) {
    html += `<nav class="day-overview" aria-label="Tage">` + days.map((d) => `
      <a class="day-tile" href="#tag-${d}">
        <span class="dt-day">${esc(parseISO(d).toLocaleDateString("de-DE", { weekday: "long" }))}</span>
        <span class="dt-date">${esc(parseISO(d).toLocaleDateString("de-DE", { day: "numeric", month: "numeric" }))}</span>
        <span class="dt-n"><strong>${groups.get(d).length}</strong> ${groups.get(d).length === 1 ? "Termin" : "Termine"}</span>
      </a>`).join("") + `</nav>`;
  }
  for (const [day, evs] of groups) {
    const head = day
      ? `<span class="day-tag">${esc(fmtDay(day))}</span><span class="day-rel">${relDay(day)}</span>`
      : `<span class="day-tag muted">Ohne erkanntes Datum</span><span class="day-rel">Datum steht evtl. im Text</span>`;
    html += `<div class="day-head" id="tag-${day || "ohne-datum"}">${head}<span class="day-count">${evs.length}</span></div>` + evs.map(cardHTML).join("");
  }
  return html;
}

function renderCats() {
  const f = S.filters;
  const counts = {};
  for (const ev of S.events) if (passesBase(ev, f, true)) counts[ev.category] = (counts[ev.category] || 0) + 1;
  $("#catChips").innerHTML = Object.entries(S.categories)
    .filter(([key]) => counts[key] || f.cats.includes(key) || key !== "sonstiges")
    .map(([key, label]) => `
    <button type="button" class="cat-chip ${TOP_CATS.includes(key) ? "top" : ""}" style="--cat: var(--c-${key})" data-cat="${key}" aria-pressed="${f.cats.includes(key)}">
      ${catIcon(key)}${esc(label)} <span class="n">${counts[key] || 0}</span>
    </button>`).join("");
}

function renderSources() {
  const sel = $("#source");
  const sources = [...new Set(S.events.map((e) => e.source))].sort();
  sel.innerHTML = `<option value="">Alle Quellen</option>` + sources.map((s) => `<option value="${esc(s)}">${esc(sourceLabel(s))}</option>`).join("");
  sel.value = sources.includes(S.filters.source) ? S.filters.source : "";
}

function syncControls() {
  const f = S.filters;
  const labels = { today: "Heute", weekend: "Dieses Wochenende", nextweekend: "Nächstes Wochenende",
    days: `Nächste ${S.settings.days_ahead || 14} Tage`, all: "Alle" };
  $$("#rangeBar button").forEach((b) => {
    const r = b.dataset.range;
    const n = S.events.filter((ev) => ev.start_date && passesBase(ev, { ...f, range: r, undated: false })).length;
    b.setAttribute("aria-pressed", String(r === f.range));
    b.innerHTML = `${labels[r]} <span class="rn">${n}</span>`;
  });
  $("#q").value = f.q;
  $("#radius").value = radiusValue();
  $("#radiusOut").textContent = `${radiusValue()} km`;
  $("#radiusHint").textContent = S.settings.home_lat == null ? "Erst Wohnort festlegen, dann wirkt der Umkreis." : `um ${S.settings.home_query}`;
  for (const k of ["weekendOnly", "favOnly", "undated", "noLocation", "services", "showHidden"]) $("#" + k).checked = f[k];
  $("#sort").value = f.sort;
  const n = activeFilterCount();
  $("#filterCount").hidden = !n; $("#filterCount").textContent = n;
  $("#homeChipText").textContent = S.settings.home_query ? `${S.settings.home_query} · ${radiusValue()} km` : "Wohnort festlegen";
}

function render() {
  store.set(FILTER_KEY, Object.fromEntries(KEEP_FILTERS.map((k) => [k, S.filters[k]])));
  const list = filtered();
  const undated = list.filter((e) => !e.start_date).length;
  const nFav = S.events.filter((e) => e.favorite && !e.hidden && !isPast(e)).length;
  $("#favCount").textContent = nFav ? nFav : "";
  $("#count").textContent = S.view === "fav"
    ? `${nFav} gemerkte ${nFav === 1 ? "Anzeige" : "Anzeigen"}`
    : `${list.length} ${list.length === 1 ? "Termin" : "Termine"}${undated ? ` (davon ${undated} ohne Datum)` : ""}`;
  $("#welcome").hidden = !!S.settings.home_query;
  syncControls();
  renderCats();
  renderMemoryHints();
  if (typeof renderPdfBar === "function") renderPdfBar();
  renderList(list);
  applyView();
  if (S.map) renderMap(list);
}

/* ---------- Karte ---------- */
const isSplit = () => window.matchMedia("(min-width: 1300px)").matches;

function applyView() {
  const split = isSplit();
  $("#layout").classList.toggle("split", split);
  const showMap = split || S.view === "map";
  $("#list").hidden = !split && S.view === "map";
  $("#viewFav").setAttribute("aria-selected", String(S.view === "fav"));
  document.documentElement.classList.toggle("fav-view", S.view === "fav");
  $("#mapWrap").hidden = !showMap;
  $("#viewList").setAttribute("aria-selected", String(S.view === "list"));
  $("#viewMap").setAttribute("aria-selected", String(S.view === "map"));
  if (showMap) {
    if (!S.map) initMap();
    else setTimeout(() => S.map.invalidateSize(), 50);
  }
}

function initMap() {
  if (!window.L) { $("#map").innerHTML = '<p class="empty">Die Karte konnte nicht geladen werden (keine Internetverbindung?).</p>'; return; }
  S.map = L.map("map", { scrollWheelZoom: true });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(S.map);
  S.mapLayer = L.layerGroup().addTo(S.map);
  S.map.setView([51.16, 10.45], 6);
  // Erst zeichnen, wenn der Kartenbereich seine endgültige Größe hat
  setTimeout(() => { S.map.invalidateSize(); renderMap(filtered(), true); }, 120);
}

function renderMap(list, fit = true) {
  if (!S.map) return;
  S.mapLayer.clearLayers();
  const css = getComputedStyle(document.documentElement);
  const pts = [];
  if (S.settings.home_lat != null) {
    const home = [S.settings.home_lat, S.settings.home_lon];
    L.marker(home, { icon: L.divIcon({ className: "", html: '<div class="home-marker"></div>', iconSize: [22, 22] }), title: "Zuhause" }).addTo(S.mapLayer);
    L.circle(home, { radius: radiusValue() * 1000, color: css.getPropertyValue("--accent").trim(), weight: 1.5, fillOpacity: 0.04 }).addTo(S.mapLayer);
    pts.push(home);
  }
  for (const ev of list) {
    if (ev.lat == null) continue;
    const k = catKey(ev.category);
    const size = ev.favorite ? 40 : 32;
    const m = L.marker([ev.lat, ev.lon], {
      title: ev.title,
      icon: L.divIcon({
        className: "",
        html: `<div class="pin ${ev.favorite ? "fav" : ""} ${isTop(ev) ? "top" : ""} ${S.pdf && !S.pdf.sel.has(ev.id) ? "off" : ""}" style="--cat: var(--c-${k}); --s: ${size}px">${catIcon(k)}</div>`,
        iconSize: [size, size], iconAnchor: [size / 2, size], popupAnchor: [0, -size],
      }),
    });
    m.bindPopup(`<div class="map-pop"><strong>${esc(ev.title)}</strong>${dateLine(ev)}<br>${placeLine(ev)}<br>${S.pdf
      ? `<button class="btn ${S.pdf.sel.has(ev.id) ? "primary" : "ghost"}" type="button" data-pick="${esc(ev.id)}">${S.pdf.sel.has(ev.id) ? "✓ Im PDF – abwählen" : "Fürs PDF auswählen"}</button>`
      : `<button class="btn primary" type="button" data-open="${esc(ev.id)}">Details</button>`}</div>`);
    m.addTo(S.mapLayer);
    pts.push([ev.lat, ev.lon]);
  }
  if (fit && pts.length > 1) S.map.fitBounds(pts, { padding: [30, 30], maxZoom: 13 });
  else if (fit && pts.length === 1) S.map.setView(pts[0], 11);
}

/* ---------- Detailansicht ---------- */
function openDetail(id) {
  const ev = S.events.find((e) => e.id === id);
  if (!ev) return;
  const body = $("#detailBody");
  body.innerHTML = `
    <div class="sheet-head">
      <h2>${esc(ev.title)}</h2>
      <button class="icon-btn" type="button" data-close aria-label="Schließen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    </div>
    ${ev.image ? `<img class="detail-img" src="${esc(ev.image)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
    <div class="card-top">
      ${isTop(ev) ? `<span class="pill top">★ Top-Tipp</span>` : ""}
      <span class="pill cat ${isTop(ev) ? "top-cat" : ""}" style="--cat: var(--c-${catKey(ev.category)})">${catIcon(catKey(ev.category), "sm")}${esc(ev.category_label)}</span>
      ${isNew(ev) ? `<span class="pill new">NEU</span>` : ""}
      ${ev.is_service ? `<span class="pill warn">Vermutlich Firma/Werbung</span>` : ""}
    </div>
    <dl class="detail-meta">
      <dt>Wann</dt><dd>${dateLine(ev)}${ev.start_date ? ` <span class="hint">(${relDay(ev.start_date)})</span>` : ""}</dd>
      <dt>Wo</dt><dd>${placeLine(ev)}</dd>
      ${ev.price ? `<dt>Preis</dt><dd>${esc(ev.price)}</dd>` : ""}
      <dt>Quelle</dt><dd>${esc(sourceLabel(ev.source))}${ev.posted_at ? `, eingestellt ${esc(parseISO(ev.posted_at).toLocaleDateString("de-DE"))}` : ""}</dd>
    </dl>
    ${ev.ai_checked ? `<p class="hint ai-ok">✓ Von Claude geprüft${ev.ai_note ? `: ${esc(ev.ai_note)}` : ""}</p>`
      : !ev.date_certain && ev.start_date ? `<p class="hint">Das Datum wurde aus einem Wochentag im Text abgeleitet. Bitte in der Anzeige prüfen.</p>` : ""}
    ${ev.description ? `<p class="detail-desc">${esc(ev.description)}</p>` : ""}
    <div class="detail-actions">
      <button class="btn ${ev.favorite ? "primary" : "ghost"}" type="button" data-dact="fav">${icon("star")} ${ev.favorite ? "Gemerkt" : "Merken"}</button>
      ${ev.url ? `<a class="btn ghost" href="${esc(ev.url)}" target="_blank" rel="noopener">${icon("ext")} Anzeige öffnen</a>` : ""}
      <a class="btn ghost" href="${routeUrl(ev)}" target="_blank" rel="noopener">${icon("route")} Route</a>
      ${ev.start_date ? `<button class="btn ghost" type="button" data-dact="ics">${icon("cal")} In den Kalender</button>` : ""}
      <button class="btn ghost" type="button" data-dact="share">${icon("share")} Teilen</button>
      <button class="btn ghost" type="button" data-dact="hide">${icon(ev.hidden ? "eye" : "eyeoff")} ${ev.hidden ? "Wieder anzeigen" : "Ausblenden"}</button>
      ${ev.manual ? `<button class="btn danger" type="button" data-dact="delete">Termin löschen</button>` : ""}
    </div>
    ${visitBoxHTML(ev)}
    <label class="field"><span class="field-label">Eigene Notiz</span>
      <textarea id="noteField" rows="2" placeholder="z.B. Werkzeug anschauen, Bargeld mitnehmen">${esc(ev.note || "")}</textarea></label>
    <p class="form-error" id="detailError" hidden></p>`;
  body.dataset.id = id;
  const dlg = $("#detail");
  if (!dlg.open) dlg.showModal();
  $("#noteField")?.addEventListener("change", (e) => setState(ev, { note: e.target.value }, false));
}

function visitBoxHTML(ev) {
  const m = memoryFor(ev);
  const v = m.visit;
  const isY = yearly().some((y) => y.id === ev.id);
  return `<div class="visit-box">
    <div class="visit-row">
      <button class="btn ${v ? "primary" : "ghost"}" type="button" data-dact="visited">${v ? "✓ Besucht" : "Schon besucht?"}</button>
      <button class="btn ${isY ? "primary" : "ghost"}" type="button" data-dact="yearly">🔁 ${isY ? "Jährlich vorgemerkt" : "Jedes Jahr erinnern"}</button>
    </div>
    ${v ? `<div class="stars" role="group" aria-label="Wie war es?"><span class="hint">Wie war es?</span>${[1, 2, 3, 4, 5].map((n) =>
      `<button type="button" data-dact="rate" data-r="${n}" aria-pressed="${n <= (v.rating || 0)}" aria-label="${n} Sterne">★</button>`).join("")}</div>` : ""}
    ${m.earlier ? `<p class="hint">Du warst am ${esc(parseISO(m.earlier.start_date).toLocaleDateString("de-DE"))} schon dort${m.earlier.rating ? ` – Bewertung ${stars(m.earlier.rating)}` : ""}.</p>` : ""}
    ${m.yearly && m.yearly.id !== ev.id ? `<p class="hint">🔁 Diesen Markt hast du jährlich vorgemerkt (zuletzt ${esc(parseISO(m.yearly.start_date).toLocaleDateString("de-DE"))}).</p>` : ""}
  </div>`;
}

async function setState(ev, patch, rerender = true) {
  try {
    await api(`/api/events/${encodeURIComponent(ev.id)}/state`, { method: "PATCH", body: JSON.stringify(patch) });
    Object.assign(ev, patch);
    if (ev.gone && patch.favorite === false) { // selbst entmerkt: jetzt wirklich weg
      S.events = S.events.filter((x) => x !== ev);
      const sn = favSnaps(); delete sn[ev.id]; store.set("favSnap", sn);
    }
    if (patch.favorite !== undefined) { syncFavSnaps(); pushReminder(); }
    if (rerender) render();
    if (patch.note !== undefined) toast("Notiz gespeichert");
  } catch (e) { toast(e.message); }
}


/* ---------- Mein Flohmarkt-Tagebuch: besucht, jährliche Märkte, abgelaufene Merkliste ----------
   Alles wird nur auf diesem Gerät gespeichert (wie Favoriten und Notizen). */
const snapOf = (ev) => ({
  id: ev.id, title: ev.title, start_date: ev.start_date, end_date: ev.end_date, time_text: ev.time_text || "",
  address: ev.address || "", location: ev.location || "", lat: ev.lat ?? null, lon: ev.lon ?? null,
  category: ev.category, category_label: ev.category_label, url: ev.url || "", source: ev.source,
});
const visits = () => store.get("visits", {});   // id -> { at, rating, ...snap }
const yearly = () => store.get("yearly", []);   // [{ ...snap, rating }]
const favSnaps = () => store.get("favSnap", {}); // gemerkte Termine bleiben erhalten, auch wenn die Anzeige verschwindet
const endOf = (ev) => ev.end_date || ev.start_date;
const isPast = (ev) => !!ev.start_date && endOf(ev) < S.today;
const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);

// Wörter, die nichts über den konkreten Markt sagen (für "ist das derselbe Markt wie letztes Jahr?")
const MARKET_STOP = new Set(("flohmarkt flohmärkte flohmaerkte dorfflohmarkt straßenflohmarkt strassenflohmarkt hofflohmarkt " +
  "garagenflohmarkt hausflohmarkt trödelmarkt troedelmarkt kinderflohmarkt kinderbasar basar großer grosser große grosse " +
  "kleiner kleine herbstflohmarkt frühjahrsflohmarkt sommerflohmarkt herbst frühjahr sommer samstag sonntag heute morgen " +
  "und mit der die das den dem von vom bis zum zur beim für auf januar februar märz april juni juli august september " +
  "oktober november dezember haushaltsauflösung wohnungsauflösung nachlass verkauf alles muss raus").split(" "));
function marketWords(title) {
  return new Set(String(title || "").toLowerCase().replace(/[^a-zäöüß]+/g, " ").split(" ")
    .filter((w) => w.length >= 4 && !MARKET_STOP.has(w)));
}
function sameMarket(a, b) {
  const wa = marketWords(a.title), wb = marketWords(b.title);
  const shared = [...wa].filter((w) => wb.has(w)).length;
  if (a.lat != null && b.lat != null) {
    const d = haversine(a.lat, a.lon, b.lat, b.lon);
    return d <= 0.3 || (d <= 3 && shared >= 1);
  }
  return shared >= 2 || (shared >= 1 && shared / Math.max(1, Math.min(wa.size, wb.size)) >= 0.5);
}

/* Merkt sich zu jedem Termin: selbst besucht? jährlich vorgemerkt? früher schon dort gewesen? */
function memoryFor(ev) {
  const v = visits()[ev.id];
  const rec = yearly().find((y) => y.id === ev.id || (y.start_date !== ev.start_date && sameMarket(y, ev)));
  let earlier = null;
  if (!v && ev.start_date) {
    for (const old of Object.values(visits())) {
      if (old.id !== ev.id && old.start_date && dayDiff(old.start_date, ev.start_date) > 150 && sameMarket(old, ev)) { earlier = old; break; }
    }
  }
  return { visit: v || null, yearly: rec || null, earlier };
}

function memoryPills(ev) {
  const m = ev._mem || memoryFor(ev);
  return [
    m.visit ? `<span class="pill visited">✓ Besucht${m.visit.rating ? ` <span class="stars-sm">${stars(m.visit.rating)}</span>` : ""}</span>` : "",
    !m.visit && m.earlier ? `<span class="pill visited">Schon mal dort${m.earlier.rating ? ` <span class="stars-sm">${stars(m.earlier.rating)}</span>` : ""}</span>` : "",
    m.yearly && m.yearly.id !== ev.id ? `<span class="pill yearly">🔁 Jährlich vorgemerkt</span>` : "",
  ].join("");
}

function setVisit(ev, patch) {
  const all = visits();
  if (patch === null) delete all[ev.id];
  else all[ev.id] = { ...(all[ev.id] || { at: Date.now() }), ...snapOf(ev), ...patch };
  store.set("visits", all);
  const ys = yearly(); // Bewertung auch beim jährlichen Eintrag aktualisieren
  const y = ys.find((r) => r.id === ev.id);
  if (y && patch && patch.rating != null) { y.rating = patch.rating; store.set("yearly", ys); }
}

function toggleYearly(ev) {
  let ys = yearly();
  if (ys.some((y) => y.id === ev.id)) ys = ys.filter((y) => y.id !== ev.id);
  else ys = [...ys.filter((y) => !sameMarket(y, ev)), { ...snapOf(ev), rating: visits()[ev.id]?.rating || 0 }];
  store.set("yearly", ys);
  return ys.some((y) => y.id === ev.id);
}

/* Nächster Termin eines jährlichen Marktes: gefundene Anzeige oder Schätzung "gleiche Zeit wie letztes Mal" */
function yearlyStatus(rec) {
  const next = S.events.filter((e) => e.id !== rec.id && e.start_date && e.start_date >= S.today && e.start_date > rec.start_date && sameMarket(rec, e))
    .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  if (next) return { found: next };
  if (!rec.start_date) return {};
  const last = parseISO(rec.start_date), today = parseISO(S.today);
  let guess = new Date(today.getFullYear(), last.getMonth(), last.getDate());
  if (toISO(guess) < S.today) guess = new Date(today.getFullYear() + 1, last.getMonth(), last.getDate());
  if (toISO(guess) <= rec.start_date) guess = new Date(last.getFullYear() + 1, last.getMonth(), last.getDate());
  return { guess: toISO(guess), soon: dayDiff(S.today, toISO(guess)) <= 30 };
}

/* Gemerkte Termine bleiben, bis man sie selbst entmerkt – auch wenn die Anzeige aus den Daten verschwindet
   (gelöscht, aussortiert oder unter anderer Quelle). Taucht derselbe Markt am selben Tag wieder auf, geht das
   Merken automatisch auf die neue Anzeige über. */
function addKeptFavorites() {
  const snaps = favSnaps(), byId = new Set(S.events.map((e) => e.id));
  const states = eventStates();
  const s = S.settings;
  for (const sn of Object.values(snaps)) {
    if (byId.has(sn.id) || !sn.start_date) continue;
    const twin = S.events.find((e) => e.start_date === sn.start_date && sameMarket(sn, e));
    if (twin) {
      if (!twin.favorite) { twin.favorite = true; setState(twin, { favorite: true }, false); }
      delete snaps[sn.id];
      continue;
    }
    const dist = s.home_lat != null && sn.lat != null ? Math.round(haversine(s.home_lat, s.home_lon, sn.lat, sn.lon) * 10) / 10 : null;
    S.events.push({ description: "", image: "", date_certain: true, first_seen: 0, is_service: false, price: "", ...sn,
      favorite: true, hidden: false, note: states[sn.id]?.note || "", distance_km: dist, gone: true,
      category_label: sn.category_label || S.categories[sn.category] || "Sonstiges" });
  }
  store.set("favSnap", snaps);
}

function syncFavSnaps() {
  const snaps = favSnaps();
  let changed = false;
  for (const ev of S.events) {
    if (ev.favorite) { const n = snapOf(ev); if (JSON.stringify(snaps[ev.id]) !== JSON.stringify(n)) { snaps[ev.id] = n; changed = true; } }
    else if (snaps[ev.id]) { delete snaps[ev.id]; changed = true; }
  }
  if (changed) store.set("favSnap", snaps);
  for (const ev of S.events) ev._mem = memoryFor(ev);
}

/* Gemerkte Termine, die vorbei sind (auch wenn die Anzeige inzwischen gelöscht wurde) */
function pastFavorites() {
  const byId = new Map(S.events.map((e) => [e.id, e]));
  return Object.values(favSnaps()).map((sn) => byId.get(sn.id) || sn).filter(isPast)
    .sort((a, b) => (b.start_date || "").localeCompare(a.start_date || ""));
}

async function removeFavorite(id) {
  const ev = S.events.find((e) => e.id === id);
  if (ev) await setState(ev, { favorite: false }, false);
  else {
    try { await api(`/api/events/${encodeURIComponent(id)}/state`, { method: "PATCH", body: JSON.stringify({ favorite: false }) }); } catch { /* Anzeige gibt es nicht mehr */ }
  }
  const snaps = favSnaps(); delete snaps[id]; store.set("favSnap", snaps);
}

/* Hinweise über der Liste: vorbei gemerkte Termine, jährliche Märkte mit neuem Termin */
function renderMemoryHints() {
  const el = $("#memoryHints");
  if (!el) return; // Seite und Programm kurzzeitig unterschiedlich alt (Zwischenspeicher)
  if (S.view === "fav") { el.innerHTML = ""; return; }
  const hints = [];
  const past = pastFavorites();
  if (past.length) {
    hints.push(`<div class="notice"><span>📌 ${past.length === 1 ? "Ein gemerkter Termin ist" : `${past.length} gemerkte Termine sind`} vorbei. Warst du da?</span>
      <button class="btn small" type="button" data-goto-fav>Bewerten &amp; aufräumen</button></div>`);
  }
  const seen = store.get("yearlySeen", {});
  for (const rec of yearly()) {
    const st = yearlyStatus(rec);
    if (st.found && seen[st.found.id] !== 1) {
      hints.push(`<div class="notice gold"><span>🔁 <strong>${esc(rec.title)}</strong> ist wieder da: ${esc(fmtDay(st.found.start_date))}</span>
        <button class="btn small" type="button" data-open="${esc(st.found.id)}" data-seen="${esc(st.found.id)}">Ansehen</button></div>`);
    }
  }
  el.innerHTML = hints.join("");
}

/* ---------- Ansicht „Gemerkt“ ---------- */
function renderFavView() {
  const el = $("#list");
  const favs = S.events.filter((e) => e.favorite && !e.hidden && !isPast(e));
  const past = pastFavorites();
  const ys = yearly();
  const vs = Object.values(visits()).sort((a, b) => (b.start_date || "").localeCompare(a.start_date || ""));
  let html = "";

  const tourDays = [...new Set(favs.filter((e) => e.start_date).map((e) => (e.start_date < S.today ? S.today : e.start_date)))].sort();
  if (tourDays.length) {
    html += `<section class="fav-sec"><h2>🚗 Tour planen</h2>
      <p class="hint">Die App sortiert deine gemerkten Termine eines Tages in die kürzeste Reihenfolge und öffnet die Route.</p>
      <div class="tour-days">${tourDays.map((d) => {
        const n = favs.filter((e) => onDay(e, d)).length;
        return `<button class="btn ghost" type="button" data-tour="${d}">${esc(fmtDay(d))} <span class="rn">${n} ${n === 1 ? "Stopp" : "Stopps"}</span></button>`;
      }).join("")}</div></section>`;
  }
  if (past.length) {
    html += `<section class="fav-sec past"><h2>Vorbei <span class="day-count">${past.length}</span></h2>
      <p class="hint">Warst du da? Dann „Besucht“ antippen und Sterne vergeben – nächstes Jahr zeigt die App, wie es war.</p>
      ${past.map((e) => pastRowHTML(e)).join("")}
      <button class="btn ghost" type="button" data-past-clear>Alle vorbeien Termine entfernen</button></section>`;
  }
  if (favs.length) html += `<h2 class="fav-title">Demnächst</h2>` + groupedListHTML(favs, false);
  else if (!past.length) {
    html += `<div class="empty"><h2>Noch nichts gemerkt</h2>
      <p>Tippe bei einer Anzeige auf „Merken“ – dann steht sie hier, egal an welchem Tag sie ist.</p>
      <button class="btn primary" type="button" id="favBack">Zu allen Terminen</button></div>`;
  }
  if (ys.length) {
    html += `<section class="fav-sec"><h2>🔁 Jährliche Märkte</h2>
      <p class="hint">Sobald eine Anzeige für den nächsten Termin auftaucht, erscheint oben in der Liste ein Hinweis.</p>
      ${ys.map((rec) => {
        const st = yearlyStatus(rec);
        const status = st.found ? `<strong class="ok">Neuer Termin: ${esc(fmtDay(st.found.start_date))}</strong>`
          : st.guess ? `voraussichtlich um den ${esc(parseISO(st.guess).toLocaleDateString("de-DE", { day: "numeric", month: "long" }))}${st.soon ? " – noch keine Anzeige gefunden" : ""}` : "";
        return `<div class="mem-row">
          <div class="mem-main"><strong>${esc(rec.title)}</strong>
            <small>Zuletzt ${rec.start_date ? esc(parseISO(rec.start_date).toLocaleDateString("de-DE")) : "?"}${rec.rating ? ` · ${stars(rec.rating)}` : ""}${rec.location || rec.address ? ` · ${esc(rec.address || rec.location)}` : ""}</small>
            <small>${status}</small></div>
          <div class="mem-acts">${st.found ? `<button class="btn small" type="button" data-open="${esc(st.found.id)}">Ansehen</button>` : ""}
            <button class="link-btn" type="button" data-yearly-remove="${esc(rec.id)}">Entfernen</button></div>
        </div>`;
      }).join("")}</section>`;
  }
  if (vs.length) {
    html += `<details class="fav-sec"><summary><h2>✓ Besuchte Märkte <span class="day-count">${vs.length}</span></h2></summary>
      ${vs.map((v) => `<div class="mem-row"><div class="mem-main"><strong>${esc(v.title)}</strong>
        <small>${v.start_date ? esc(parseISO(v.start_date).toLocaleDateString("de-DE")) : ""}${v.rating ? ` · ${stars(v.rating)}` : " · noch nicht bewertet"}</small></div></div>`).join("")}
    </details>`;
  }
  el.innerHTML = html;
  $("#favBack")?.addEventListener("click", () => { S.view = "list"; store.set("view", "list"); render(); });
}

function pastRowHTML(e) {
  const v = visits()[e.id];
  return `<div class="mem-row" data-past="${esc(e.id)}">
    <div class="mem-main"><strong>${esc(e.title)}</strong>
      <small>${esc(fmtDay(e.start_date))}${e.address || e.location ? ` · ${esc(e.address || e.location)}` : ""}</small>
      ${v ? `<div class="stars" role="group" aria-label="Bewertung">${[1, 2, 3, 4, 5].map((n) =>
        `<button type="button" data-past-rate="${n}" aria-pressed="${n <= (v.rating || 0)}" aria-label="${n} Sterne">★</button>`).join("")}</div>` : ""}
    </div>
    <div class="mem-acts">
      <button class="btn small ${v ? "on" : ""}" type="button" data-past-visited>${v ? "✓ Besucht" : "Besucht"}</button>
      <button class="link-btn" type="button" data-past-remove>Entfernen</button>
    </div>
  </div>`;
}

const onDay = (e, d) => e.start_date && e.start_date <= d && endOf(e) >= d;

/* ---------- Wochenend-Tour ---------- */
const TOUR = { day: null, skip: new Set(), back: true };

function tourStops(day) {
  return S.events.filter((e) => e.favorite && !e.hidden && onDay(e, day));
}

/* Kürzeste Reihenfolge (bis 8 Stopps exakt, sonst "immer zum nächsten") */
function bestOrder(stops, home, back) {
  const d = (a, b) => haversine(a.lat, a.lon, b.lat, b.lon);
  const cost = (order) => {
    let c = 0, prev = home;
    for (const s of order) { if (prev) c += d(prev, s); prev = s; }
    if (back && home && order.length) c += d(order[order.length - 1], home);
    return c;
  };
  if (stops.length <= 8) {
    let best = stops, bestC = Infinity;
    const perm = (rest, acc) => {
      if (!rest.length) { const c = cost(acc); if (c < bestC) { bestC = c; best = acc; } return; }
      for (let i = 0; i < rest.length; i++) perm([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, rest[i]]);
    };
    perm(stops, []);
    return { order: best, km: bestC };
  }
  const left = [...stops], order = [];
  let cur = home || left[0];
  while (left.length) {
    left.sort((a, b) => d(cur, a) - d(cur, b));
    cur = left.shift(); order.push(cur);
  }
  return { order, km: cost(order) };
}

function openTour(day) {
  if (TOUR.day !== day) { TOUR.day = day; TOUR.skip = new Set(); }
  const all = tourStops(day);
  const withPos = all.filter((e) => e.lat != null && !TOUR.skip.has(e.id));
  const noPos = all.filter((e) => e.lat == null);
  const home = S.settings.home_lat != null ? { lat: S.settings.home_lat, lon: S.settings.home_lon } : null;
  const { order, km } = bestOrder(withPos, home, TOUR.back && !!home);
  const road = Math.round(km * 1.3); // Luftlinie -> ungefähre Fahrstrecke
  const maxStops = 9; // mehr Zwischenziele nimmt Google Maps nicht
  const used = order.slice(0, maxStops + (TOUR.back && home ? 0 : 1));
  const pt = (e) => `${e.lat},${e.lon}`;
  let url = "";
  if (used.length) {
    const dest = TOUR.back && home ? `${home.lat},${home.lon}` : pt(used[used.length - 1]);
    const wps = [...new Set((TOUR.back && home ? used : used.slice(0, -1)).map(pt))].filter((w) => w !== dest); // gleiche Adresse nur einmal
    url = `https://www.google.com/maps/dir/?api=1${home ? `&origin=${home.lat},${home.lon}` : ""}&destination=${dest}` +
      `${wps.length ? `&waypoints=${encodeURIComponent(wps.join("|"))}` : ""}&travelmode=driving`;
  }
  let prev = home;
  $("#tourBody").innerHTML = `
    <div class="sheet-head"><h2>Tour am ${esc(fmtDay(day))}</h2>
      <button class="icon-btn" type="button" data-close aria-label="Schließen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    ${order.length ? `<p class="tour-sum"><strong>${order.length} ${order.length === 1 ? "Stopp" : "Stopps"}</strong> · ca. ${road} km Fahrstrecke${TOUR.back && home ? " (mit Rückfahrt)" : ""}</p>` : ""}
    <ol class="tour-list">
      ${home ? `<li class="tour-home">🏠 Start: ${esc(S.settings.home_query || "Zuhause")}</li>` : ""}
      ${order.map((e) => {
        const leg = prev ? Math.round(haversine(prev.lat, prev.lon, e.lat, e.lon) * 1.3) : null; prev = e;
        return `<li class="tour-stop" style="--cat: var(--c-${catKey(e.category)})">
          <label class="switch"><input type="checkbox" data-tour-skip="${esc(e.id)}" checked>
          <span><strong>${esc(e.title)}</strong><small>${esc(e.time_text || "Uhrzeit siehe Anzeige")} · ${esc(e.address || e.location || "")}${leg != null ? ` · ca. ${leg} km` : ""}</small></span></label></li>`;
      }).join("")}
      ${TOUR.back && home && order.length ? `<li class="tour-home">🏠 Zurück nach Hause</li>` : ""}
    </ol>
    ${all.filter((e) => TOUR.skip.has(e.id)).map((e) => `<label class="switch tour-off"><input type="checkbox" data-tour-skip="${esc(e.id)}"><span>${esc(e.title)} <small>(nicht dabei)</small></span></label>`).join("")}
    ${noPos.length ? `<p class="hint">Ohne genaue Adresse, deshalb nicht in der Route: ${noPos.map((e) => esc(e.title)).join(", ")}</p>` : ""}
    ${order.length > maxStops ? `<p class="hint">Google Maps nimmt höchstens ${maxStops} Zwischenziele – die ersten ${maxStops} sind in der Route.</p>` : ""}
    ${home ? `<label class="switch"><input type="checkbox" id="tourBack" ${TOUR.back ? "checked" : ""}><span>Am Ende zurück nach Hause</span></label>`
      : `<p class="hint">Tipp: Wohnort in den Einstellungen eintragen, dann startet die Tour zu Hause.</p>`}
    <p class="hint">Uhrzeiten bitte selbst im Blick behalten – manche Märkte beginnen erst mittags.</p>
    <div class="sheet-actions">
      ${url ? `<a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener">${icon("route")} Route in Google Maps öffnen</a>`
        : `<p class="hint">Mindestens einen Termin auswählen.</p>`}
    </div>`;
  const dlg = $("#tourDialog");
  if (!dlg.open) dlg.showModal();
}

/* ---------- Freitags-Erinnerung (nur Android-App) ---------- */
const APK_URL = "https://github.com/anonym239/Kleinanzeigen/releases/latest/download/Flohmarkt-Finder.apk";
const appHas = (fn) => !!(window.AndroidApp && typeof window.AndroidApp[fn] === "function");

const DAY_NAMES = { 5: "Donnerstag", 6: "Freitag", 7: "Samstag" }; // Nummern wie Java Calendar
const reminderDay = () => (DAY_NAMES[store.get("reminderDay", 6)] ? Number(store.get("reminderDay", 6)) : 6);
const reminderTime = () => (/^\d\d:\d\d$/.test(store.get("fridayTime", "")) ? store.get("fridayTime") : "07:00");

function pushReminder() {
  const [h, m] = reminderTime().split(":").map(Number);
  try {
    if (appHas("setReminderSchedule")) window.AndroidApp.setReminderSchedule(reminderDay(), h, m);
    else if (appHas("setReminderTime")) window.AndroidApp.setReminderTime(h, m);
  } catch { /* ältere App */ }
  if (!appHas("setReminder")) return;
  const s = S.settings;
  const favIds = S.events.filter((e) => e.favorite).map((e) => e.id);
  try {
    window.AndroidApp.setReminder(store.get("friday", true), s.home_lat ?? 0, s.home_lon ?? 0, s.home_lat != null ? radiusValue() : 0,
      JSON.stringify(favIds));
  } catch { /* ältere App */ }
}

function checkAppUpdate() {
  const el = $("#appUpdate");
  if (!el) return; // Seite und Programm kurzzeitig unterschiedlich alt (Zwischenspeicher)
  const old = window.FLOHMARKT_APP && !appHas("backupSet"); // neueste Funktion der App
  const snoozed = Date.now() - store.get("updateSnooze6", 0) < 3 * 86400000;
  el.hidden = !old || snoozed;
  if (el.hidden) return;
  el.innerHTML = `<span>📲 <strong>Neue App-Version:</strong> Gemerktes wird zusätzlich sicher im Handy gespeichert, genauer Standort per GPS, PDF speichern, bessere Darstellung. Einfach herunterladen und über die alte App installieren – alles Gemerkte bleibt.</span>
    <span class="notice-acts"><button class="btn small" type="button" id="updateNow">Jetzt aktualisieren</button>
    <button class="link-btn" type="button" id="updateLater">Später</button></span>`;
  $("#updateNow")?.addEventListener("click", () => { if (appHas("openUrl")) window.AndroidApp.openUrl(APK_URL); else openExternal(APK_URL); });
  $("#updateLater")?.addEventListener("click", () => { store.set("updateSnooze6", Date.now()); el.hidden = true; });
}

function syncReminderSettings() {
  const inApp = !!window.FLOHMARKT_APP, ok = appHas("setReminder");
  $("#setFriday").checked = store.get("friday", true);
  const time = reminderTime();
  const preset = [...$("#fridayTime").options].some((o) => o.value === time);
  $("#fridayTime").value = preset ? time : "custom";
  $("#fridayCustom").value = time;
  $("#fridayCustom").hidden = preset;
  $("#reminderDay").value = String(reminderDay());
  $("#fridayTime").disabled = $("#fridayCustom").disabled = !ok || !$("#setFriday").checked;
  $("#reminderDay").disabled = !appHas("setReminderSchedule") || !$("#setFriday").checked;
  $("#setFriday").disabled = !ok;
  $("#testFriday").disabled = !ok;
  const status = ok && appHas("reminderStatus") ? window.AndroidApp.reminderStatus() : "";
  $("#fridayHint").textContent = !inApp
    ? "Die Freitags-Erinnerung gibt es in der Android-App."
    : !ok ? "Dafür bitte die neue App-Version installieren (Hinweis oben in der Liste)."
    : status === "blocked" ? "Benachrichtigungen sind für die App ausgeschaltet: Handy-Einstellungen → Apps → Flohmärkte → Benachrichtigungen erlauben."
    : `Kommt jeden ${appHas("setReminderSchedule") ? DAY_NAMES[reminderDay()] : "Freitag"} gegen ${time.replace(/^0/, "")} Uhr: wie viele Flohmärkte am Wochenende in deinem Umkreis sind, mit den Top-Tipps.` +
      (appHas("setReminderSchedule") ? "" : " (Tag wählen geht mit der neuesten App-Version.)");
}

const APP = window.AndroidApp || null; // in der Android-App vorhanden

async function shareEvent(ev) {
  const text = `${ev.title}\n${ev.start_date ? fmtDay(ev.start_date) : ""} ${ev.time_text || ""}\n${ev.address || ev.location || ""}`.trim();
  const url = ev.url || routeUrl(ev);
  if (APP) { APP.share(`${text}\n${url}`); return; }
  if (navigator.share) {
    try { await navigator.share({ title: ev.title, text, url }); return; } catch { /* abgebrochen */ }
  }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toast("In die Zwischenablage kopiert – jetzt z.B. in WhatsApp einfügen"); }
  catch { toast("Teilen wird von diesem Browser nicht unterstützt"); }
}

/* ---------- Aktualisieren ---------- */
async function startRefresh() {
  if (STATIC) {
    try {
      await api("/api/refresh", { method: "POST" });
      await loadEvents();
      toast(`Stand: ${new Date(L$.data.generated_at * 1000).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })} Uhr. Neue Anzeigen kommen automatisch alle 3 Stunden.`, 5000);
    } catch (e) { toast(e.message); }
    return;
  }
  try {
    await api("/api/refresh", { method: "POST" });
    toast("Suche gestartet. Das kann ein paar Minuten dauern.");
    pollStatus();
  } catch (e) { toast(e.message); }
}

async function pollStatus() {
  clearTimeout(S.polling);
  let st;
  try { st = await api("/api/status"); } catch { return; }
  const line = $("#statusLine");
  $("#refreshBtn").classList.toggle("spinning", st.running);
  if (st.running) {
    line.hidden = false; line.textContent = st.message || "Suche läuft …";
    S.polling = setTimeout(pollStatus, 3000);
    S.wasRunning = true;
  } else {
    line.hidden = true;
    if (S.wasRunning) { S.wasRunning = false; await loadEvents(); toast("Fertig. Die Termine sind aktualisiert."); }
  }
  return st;
}

/* ---------- Einstellungen ---------- */
function applyLook() {
  const font = store.get("font", 1);
  document.documentElement.style.setProperty("--font-scale", font);
  const theme = store.get("theme", "");
  if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
  $$("#fontSeg button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.font) === Number(font))));
  $$("#themeSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeSet === theme)));
  measureTopbar();
  if (S.map) setTimeout(() => { S.map.invalidateSize(); renderMap(filtered(), false); }, 60);
}

async function openSettings() {
  const s = S.settings;
  $("#setHome").value = s.home_query || "";
  $("#setHomeLabel").textContent = s.home_label ? `Start: ${s.home_label}` : "";
  syncStartBtn();
  $("#regionHint").textContent = STATIC && s.region_query
    ? `Die Anzeigen werden im Umkreis von ${s.region_radius} km um ${s.region_query} gesucht (einstellbar in config.json). Hier stellst du ein, von wo aus die Entfernung gerechnet wird.` : "";
  $("#setRadius").value = s.radius_km;
  $("#setDays").value = s.days_ahead;
  $("#setKa").checked = !!s.kleinanzeigen_enabled;
  $("#setTerms").value = (s.search_terms || []).join("\n");
  $("#setPages").value = s.kleinanzeigen_pages;
  $("#setHours").value = s.refresh_hours;
  $("#setUrls").value = (s.extra_urls || []).join("\n");
  $("#icsUrl").value = new URL("api/favorites.ics", location.href).href;
  $("#settingsError").hidden = true;
  syncReminderSettings();
  $("#settings").showModal();
  $("#sourceError").hidden = true;
  if (STATIC) renderSourceList();
  try {
    const st = await api("/api/status");
    const when = (ts) => ts ? new Date(ts * 1000).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "noch nie";
    $("#sourceStatus").innerHTML = (st.runs.length ? st.runs.map((r) => `
      <div class="src-row"><span class="state ${r.ok ? "" : "bad"}"></span>
        <strong>${esc(sourceLabel(r.source))}</strong>
        <small>${when(r.finished)} · ${r.ok ? `${r.found} gefunden, ${esc(r.message)}` : `Fehler: ${esc(r.message)}`}</small></div>`).join("")
      : `<p class="hint">Es wurde noch nicht gesucht.</p>`) + `<p class="hint">Insgesamt ${st.total_events} Einträge gespeichert.</p>`;
  } catch { /* egal */ }
}

/* ---------- Genauer Standort (GPS / Android-Standort) ---------- */
async function reverseLabel(lat, lon) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&lat=${lat}&lon=${lon}`,
      { headers: { "Accept-Language": "de" } });
    const a = (await r.json()).address || {};
    const street = [a.road, a.house_number].filter(Boolean).join(" ");
    const place = [a.postcode, a.city || a.town || a.village || a.municipality].filter(Boolean).join(" ");
    const part = a.suburb || a.city_district || a.quarter || "";
    return [street, place + (part && !place.includes(part) ? `-${part}` : "")].filter(Boolean).join(", ") || "Mein Standort";
  } catch { return "Mein Standort"; }
}

function useMyLocation() {
  const btn = $("#useLocation"), msg = $("#setHomeLabel");
  if (!navigator.geolocation) { msg.textContent = "Dieses Gerät kann den Standort nicht bestimmen."; return; }
  btn.disabled = true; btn.textContent = "Standort wird gesucht …";
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude: lat, longitude: lon, accuracy } = pos.coords;
    const label = await reverseLabel(lat, lon);
    try {
      S.settings = await api("/api/settings", { method: "PUT", body: JSON.stringify({ home_query: label, home_label: label, home_lat: lat, home_lon: lon }) });
      $("#setHome").value = label;
      msg.textContent = `Gefunden: ${label} (genau auf ca. ${Math.max(5, Math.round(accuracy))} m)`;
      await loadEvents();
      syncStartBtn();
      toast("Standort übernommen – Entfernungen und Routen rechnen jetzt von hier");
      pushReminder();
    } catch (e) { msg.textContent = e.message; }
    btn.disabled = false; btn.textContent = "📍 Meinen Standort verwenden";
  }, (err) => {
    btn.disabled = false; btn.textContent = "📍 Meinen Standort verwenden";
    msg.textContent = err.code === 1
      ? (window.FLOHMARKT_APP && !appHas("hasLocation")
        ? "Dafür bitte die neue App-Version installieren (Hinweis oben in der Liste)."
        : "Standort nicht erlaubt. Bitte beim Nachfragen „Zulassen“ wählen bzw. in den Handy-Einstellungen → Apps → Flohmärkte → Berechtigungen → Standort erlauben.")
      : "Standort konnte nicht bestimmt werden. Ist der Standort (GPS) am Handy eingeschaltet?";
  }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
}

function syncStartBtn() {
  const start = L$.data?.start;
  $("#useStart").hidden = !STATIC || !start?.query || S.settings.home_query === start.query;
  $("#useStart").textContent = `Zurück auf ${start?.query || "Standard"}`;
}

function resetToStart() {
  const own = store.get("homeSettings", {});
  for (const k of ["home_query", "home_lat", "home_lon", "home_label", "home_precise"]) delete own[k];
  store.set("homeSettings", own);
}

/* ---------- Eigene Quellen (Betrieb ohne Server) ---------- */
const REPO = window.FLOHMARKT_REPO || "anonym239/Kleinanzeigen";

function openExternal(url) {
  const a = Object.assign(document.createElement("a"), { href: url, target: "_blank", rel: "noopener" });
  document.body.append(a); a.click(); a.remove();
}

function sourceIssue(action, url) {
  const title = `Quelle ${action === "add" ? "hinzufügen" : "entfernen"}: ${url}`;
  const body = action === "add"
    ? `Bitte diese Webseite als Quelle für den Flohmarkt-Finder aufnehmen:\n\n${url}\n\n(Einfach auf „Submit new issue“ tippen – der Rest passiert automatisch.)`
    : `Bitte diese Quelle entfernen:\n\n${url}`;
  openExternal(`https://github.com/${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`);
}

/* Quelle direkt hinzufügen/entfernen: über den Netlify-Helfer (trägt sie bei GitHub ein) */
function sourceApiUrl() {
  const onWeb = !window.FLOHMARKT_APP && location.protocol.startsWith("http");
  const base = onWeb ? "" : (L$.data?.site_url || "");
  return base || onWeb ? `${base}/.netlify/functions/sources` : "";
}

function showSourceMsg(text, isError = false) {
  const el = $("#sourceError");
  el.textContent = text;
  el.classList.toggle("ok", !isError);
  el.hidden = false;
}

async function changeSource(action, url) {
  const api = sourceApiUrl();
  const btn = $("#addSource");
  btn.disabled = true; btn.textContent = action === "add" ? "Wird hinzugefügt …" : "Wird entfernt …";
  try {
    if (!api) throw Object.assign(new Error("nicht eingerichtet"), { code: "no_api" });
    const r = await fetch(api, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, url, pin: store.get("sourcePin", "") }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) {
      const pin = window.prompt ? window.prompt("PIN für neue Quellen:") : "";
      if (pin) { store.set("sourcePin", pin.trim()); return changeSource(action, url); }
      throw new Error(j.message || "PIN fehlt.");
    }
    if (r.status === 404 || j.code === "no_token") throw Object.assign(new Error(j.message || "nicht eingerichtet"), { code: "no_api" });
    if (!r.ok || !j.ok) throw new Error(j.message || `Fehler ${r.status}`);
    showSourceMsg(j.message);
    $("#newSource").value = "";
    const pending = store.get("pendingSources", []);
    if (j.changed && action === "add") store.set("pendingSources", [...pending, { url, at: Date.now() }]);
    if (j.changed && action === "remove") store.set("pendingSources", pending.filter((p) => p.url !== url));
    renderSourceList();
  } catch (e) {
    if (e.code === "no_api") {
      // Rückfall, solange der Helfer nicht eingerichtet ist: GitHub-Nachricht vorbereiten
      showSourceMsg("Das direkte Hinzufügen ist noch nicht eingerichtet. Es öffnet sich GitHub – dort „Submit new issue“ tippen.", true);
      sourceIssue(action, url);
    } else {
      showSourceMsg(e.message || "Das hat nicht geklappt. Bitte später erneut versuchen.", true);
    }
  } finally {
    btn.disabled = false; btn.textContent = "Quelle hinzufügen";
  }
}

function renderSourceList() {
  const data = L$.data;
  if (!data) return;
  const when = (ts) => ts ? new Date(ts * 1000).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "";
  const runFor = (src) => (data.runs || []).find((r) =>
    r.source === src.name || (src.name === "Kleinanzeigen" && r.source === "kleinanzeigen"));
  const counts = {};
  for (const e of data.events) counts[e.source] = (counts[e.source] || 0) + 1;
  $("#sourceList").innerHTML = (data.sources || []).map((src) => {
    const run = runFor(src);
    const n = src.name === "Kleinanzeigen" ? counts.kleinanzeigen
      : src.name === "Flohmarkt-Kalender" ? (counts["krencky24.de"] || 0) + (counts["meine-flohmarkt-termine.de"] || 0)
      : src.name === "Kieler Nachrichten" ? counts["Kieler Nachrichten"]
      : counts[src.name];
    const empty = run && run.ok && !n;
    const state = !run ? "wartet auf ersten Suchlauf"
      : !run.ok ? `Fehler: ${run.message}`
      : empty ? `keine Termine gefunden (zuletzt ${when(run.finished)}) – die Seite enthält gerade keine lesbaren Termine${data.ai?.enabled ? "" : "; mit der Claude-Prüfung werden auch schwierige Seiten gelesen"}`
      : `${n} Termine · zuletzt ${when(run.finished)}`;
    return `<div class="src-row">
      <span class="state ${run && !run.ok ? "bad" : !run || empty ? "wait" : ""}"></span>
      <div class="src-main"><strong>${esc(src.name)}</strong>${src.builtin ? ` <span class="pill">fest eingebaut</span>` : ""}
        <small>${esc(state)}</small></div>
      ${src.builtin ? "" : `<button class="link-btn" type="button" data-remove-src="${esc(src.url)}">Entfernen</button>`}
    </div>`;
  }).join("") + pendingSourcesHTML() + aiStatusHTML() || `<p class="hint">Noch keine Quellen.</p>`;
}

function aiStatusHTML() {
  const ai = L$.data?.ai;
  if (!ai) return "";
  const run = (L$.data.runs || []).find((r) => r.source === "Claude-Prüfung");
  const when = run ? ` · zuletzt ${new Date(run.finished * 1000).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}` : "";
  const text = !ai.enabled
    ? "nicht eingerichtet – der Key fehlt bei GitHub (Settings → Secrets and variables → Actions → Secret ANTHROPIC_API_KEY)"
    : run && !run.ok ? `Problem: ${run.message}${when}`
    : `${ai.checked} Anzeigen geprüft, ${ai.rejected} aussortiert${when}`;
  const state = !ai.enabled ? "wait" : run && !run.ok ? "bad" : "";
  return `<div class="src-row"><span class="state ${state}"></span>
    <div class="src-main"><strong>Claude-Prüfung</strong> <span class="pill">KI</span><small>${esc(text)}</small></div><span></span></div>`;
}

function pendingSourcesHTML() {
  const known = new Set((L$.data?.sources || []).map((s) => s.url));
  const pending = store.get("pendingSources", []).filter((p) => !known.has(p.url) && Date.now() - p.at < 86400000);
  store.set("pendingSources", pending);
  return pending.map((p) => `<div class="src-row"><span class="state wait"></span>
    <div class="src-main"><strong>${esc(new URL(p.url).hostname.replace(/^www\./, ""))}</strong>
    <small>wird gerade eingerichtet – Termine erscheinen in ca. 10 Minuten</small></div><span></span></div>`).join("");
}

async function saveSettings() {
  const lines = (v) => v.split("\n").map((x) => x.trim()).filter(Boolean);
  const body = {
    home_query: $("#setHome").value.trim(),
    radius_km: Number($("#setRadius").value) || 30,
    days_ahead: Number($("#setDays").value) || 14,
    kleinanzeigen_enabled: $("#setKa").checked,
    search_terms: lines($("#setTerms").value),
    kleinanzeigen_pages: Number($("#setPages").value) || 2,
    refresh_hours: Number($("#setHours").value) || 3,
    extra_urls: lines($("#setUrls").value),
  };
  const btn = $("#saveSettings");
  btn.disabled = true; btn.textContent = "Speichere …";
  try {
    const before = S.settings;
    S.settings = await api("/api/settings", { method: "PUT", body: JSON.stringify(body) });
    S.filters.radius = null;
    $("#settings").close();
    const searchChanged = before.home_query !== S.settings.home_query || before.radius_km !== S.settings.radius_km ||
      JSON.stringify(before.search_terms) !== JSON.stringify(S.settings.search_terms) ||
      JSON.stringify(before.extra_urls) !== JSON.stringify(S.settings.extra_urls);
    await loadEvents();
    if (searchChanged) startRefresh(); else toast("Gespeichert");
  } catch (e) {
    $("#settingsError").textContent = e.message; $("#settingsError").hidden = false;
  } finally { btn.disabled = false; btn.textContent = "Speichern"; }
}

/* ---------- Eigener Termin ---------- */
function openAdd() {
  $("#addForm").reset();
  $("#addCat").innerHTML = Object.entries(S.categories).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("");
  $("#addStart").value = S.today;
  $("#addError").hidden = true;
  $("#addDialog").showModal();
}

async function submitAdd(e) {
  e.preventDefault();
  const body = {
    title: $("#addTitle").value.trim(), category: $("#addCat").value, start_date: $("#addStart").value,
    end_date: $("#addEnd").value || null, time_text: $("#addTime").value.trim(), address: $("#addAddress").value.trim(),
    description: $("#addDesc").value.trim(), url: $("#addUrl").value.trim(),
  };
  try {
    await api("/api/events", { method: "POST", body: JSON.stringify(body) });
    $("#addDialog").close();
    await loadEvents();
    toast("Termin gespeichert");
  } catch (err) { $("#addError").textContent = err.message; $("#addError").hidden = false; }
}

/* ---------- Laden ---------- */
/* Neue Version der Oberfläche veröffentlicht? Dann einmal neu laden (z.B. wenn die App lange im Hintergrund offen war) */
function reloadIfOutdated() {
  const live = L$.data?.build, mine = window.FLOHMARKT_BUILD;
  if (!STATIC || !live || !mine || live === mine) return false;
  let tried = "";
  try { tried = sessionStorage.getItem("reloadedFor") || ""; } catch { /* egal */ }
  if (tried === live) return false; // nur einmal pro Version versuchen (Zwischenspeicher der Server)
  try { sessionStorage.setItem("reloadedFor", live); } catch { /* egal */ }
  location.reload();
  return true;
}

async function loadEvents() {
  if (STATIC) {
    if (Date.now() - (L$.at || 0) > 10000) await loadStaticData(true).catch(() => {}); // beim Start nicht doppelt laden
    if (reloadIfOutdated()) return;
  }
  const data = await api("/api/events");
  S.events = data.events; S.categories = data.categories; S.today = data.today;
  addKeptFavorites();
  syncFavSnaps();
  pushReminder();
  checkAppUpdate();
  renderSources();
  render();
}

function resetFilters() {
  S.filters = { ...DEFAULT_FILTERS, range: S.filters.range };
  render();
}

function setFiltersOpen(open) {
  $("#filters").classList.toggle("open", open);
  document.documentElement.classList.toggle("filters-open", open);
  if (open) $("#filters").scrollTop = 0;
}

function measureTopbar() {
  // Genaue Höhe (in der App oft mit Nachkommastellen), abgerundet – sonst bleibt über der Tageszeile ein Spalt
  document.documentElement.style.setProperty("--topbar-h", `${Math.floor($(".topbar").getBoundingClientRect().height)}px`);
}

function bind() {
  $(".brand").addEventListener("click", (e) => {
    e.preventDefault();
    for (const d of $$("dialog[open]")) d.close();
    setFiltersOpen(false);
    S.filters.range = "weekend";
    S.view = "list";
    if (S.events.length) render(); else startLoad();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $("#rangeBar")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-range]"); if (!b) return;
    S.filters.range = b.dataset.range; render();
  });
  let qT;
  $("#q")?.addEventListener("input", (e) => { clearTimeout(qT); qT = setTimeout(() => { S.filters.q = e.target.value.trim(); render(); }, 200); });
  $("#catChips")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]"); if (!b) return;
    const c = b.dataset.cat, cats = S.filters.cats;
    S.filters.cats = cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c];
    render();
  });
  $("#radius")?.addEventListener("input", (e) => { $("#radiusOut").textContent = `${e.target.value} km`; });
  $("#radius")?.addEventListener("change", (e) => { S.filters.radius = Number(e.target.value); render(); pushReminder(); });
  for (const k of ["weekendOnly", "favOnly", "undated", "noLocation", "services", "showHidden"]) {
    $("#" + k).addEventListener("change", (e) => { S.filters[k] = e.target.checked; render(); });
  }
  $("#source")?.addEventListener("change", (e) => { S.filters.source = e.target.value; render(); });
  $("#sort")?.addEventListener("change", (e) => { S.filters.sort = e.target.value; render(); });
  $("#resetFilters")?.addEventListener("click", resetFilters);

  $("#openFilters")?.addEventListener("click", () => setFiltersOpen(true));
  $("#closeFilters")?.addEventListener("click", () => setFiltersOpen(false));
  $("#showResults")?.addEventListener("click", () => { setFiltersOpen(false); window.scrollTo({ top: 0 }); });

  $("#viewList")?.addEventListener("click", () => { S.view = "list"; store.set("view", "list"); render(); });
  $("#viewFav")?.addEventListener("click", () => { S.view = "fav"; store.set("view", "fav"); render(); window.scrollTo({ top: 0 }); });
  $("#viewMap")?.addEventListener("click", () => { S.view = "map"; store.set("view", "map"); applyView(); if (S.map) renderMap(filtered()); });

  $("#list")?.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-tour],[data-open],[data-past-visited],[data-past-remove],[data-past-rate],[data-past-clear],[data-yearly-remove]");
    if (t) {
      const row = t.closest("[data-past]");
      const past = row ? pastFavorites().find((x) => x.id === row.dataset.past) : null;
      if (t.dataset.tour) openTour(t.dataset.tour);
      else if (t.dataset.open) openDetail(t.dataset.open);
      else if (t.hasAttribute("data-past-visited") && past) { setVisit(past, visits()[past.id] ? null : {}); render(); }
      else if (t.dataset.pastRate && past) { setVisit(past, { rating: Number(t.dataset.pastRate) }); render(); }
      else if (t.hasAttribute("data-past-remove") && past) { await removeFavorite(past.id); syncFavSnaps(); render(); toast("Aus der Merkliste entfernt"); }
      else if (t.hasAttribute("data-past-clear")) {
        if (t.dataset.confirm !== "1") { t.dataset.confirm = "1"; t.textContent = "Wirklich alle entfernen? Nochmal tippen"; return; }
        for (const p of pastFavorites()) await removeFavorite(p.id);
        syncFavSnaps(); render(); toast("Vorbeie Termine entfernt – Besuche und Bewertungen bleiben gespeichert");
      } else if (t.dataset.yearlyRemove) { store.set("yearly", yearly().filter((y) => y.id !== t.dataset.yearlyRemove)); syncFavSnaps(); render(); }
      return;
    }
    const card = e.target.closest(".card"); if (!card) return;
    if (S.pdf) { e.preventDefault(); togglePick(card.dataset.id); return; } // PDF-Auswahl: Antippen = an/abwählen
    const ev = S.events.find((x) => x.id === card.dataset.id);
    const act = e.target.closest("[data-act]");
    if (act?.dataset.act === "link") return;
    if (act?.dataset.act === "ics") { downloadIcs(ev); return; }
    if (act?.dataset.act === "fav") { setState(ev, { favorite: !ev.favorite }); if (!ev.favorite) toast("Gemerkt"); return; }
    if (act?.dataset.act === "hide") {
      const hide = !ev.hidden;
      setState(ev, { hidden: hide });
      if (hide) toast("Ausgeblendet. Zurückholen unter Filter → „Ausgeblendete wieder zeigen“.");
      return;
    }
    openDetail(ev.id);
  });
  $("#list")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.classList.contains("card")) openDetail(e.target.dataset.id);
  });
  $("#map")?.addEventListener("click", (e) => {
    const pick = e.target.closest("[data-pick]");
    if (pick) { togglePick(pick.dataset.pick); S.map.closePopup(); return; }
    const b = e.target.closest("[data-open]"); if (b) openDetail(b.dataset.open);
  });
  if (typeof bindPdf === "function") bindPdf(); // pdf.js fehlt, wenn die Seite noch alt zwischengespeichert ist
  $("#memoryHints")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-goto-fav],[data-open]"); if (!b) return;
    if (b.dataset.seen) { const seen = store.get("yearlySeen", {}); seen[b.dataset.seen] = 1; store.set("yearlySeen", seen); }
    if (b.hasAttribute("data-goto-fav")) { S.view = "fav"; store.set("view", "fav"); render(); window.scrollTo({ top: 0 }); }
    else { openDetail(b.dataset.open); renderMemoryHints(); }
  });
  $("#tourDialog")?.addEventListener("click", (e) => {
    if (e.target === $("#tourDialog") || e.target.closest("[data-close]")) $("#tourDialog").close();
  });
  $("#tourDialog")?.addEventListener("change", (e) => {
    const id = e.target.dataset.tourSkip;
    if (id) { if (e.target.checked) TOUR.skip.delete(id); else TOUR.skip.add(id); }
    if (e.target.id === "tourBack") TOUR.back = e.target.checked;
    openTour(TOUR.day);
  });
  $("#setFriday")?.addEventListener("change", (e) => { store.set("friday", e.target.checked); pushReminder(); syncReminderSettings(); });
  $("#fridayTime")?.addEventListener("change", (e) => {
    if (e.target.value === "custom") { $("#fridayCustom").hidden = false; $("#fridayCustom").focus(); return; }
    store.set("fridayTime", e.target.value); pushReminder(); syncReminderSettings();
    toast(`Die Erinnerung kommt jetzt ${DAY_NAMES[reminderDay()].toLowerCase()}s um ${e.target.value} Uhr`);
  });
  $("#reminderDay")?.addEventListener("change", (e) => {
    store.set("reminderDay", Number(e.target.value)); pushReminder(); syncReminderSettings();
    toast(`Die Erinnerung kommt jetzt ${DAY_NAMES[reminderDay()].toLowerCase()}s um ${reminderTime()} Uhr`);
  });
  $("#fridayCustom")?.addEventListener("change", (e) => {
    if (!/^\d\d:\d\d$/.test(e.target.value)) return;
    store.set("fridayTime", e.target.value); pushReminder(); syncReminderSettings();
    toast(`Die Erinnerung kommt jetzt ${DAY_NAMES[reminderDay()].toLowerCase()}s um ${e.target.value} Uhr`);
  });
  $("#testFriday")?.addEventListener("click", () => {
    pushReminder();
    if (appHas("testReminder")) { window.AndroidApp.testReminder(); toast("Probe-Nachricht kommt gleich (Termine werden geladen) …"); }
  });

  $("#detail")?.addEventListener("click", async (e) => {
    if (e.target === $("#detail") || e.target.closest("[data-close]")) { $("#detail").close(); return; }
    const b = e.target.closest("[data-dact]"); if (!b) return;
    const ev = S.events.find((x) => x.id === $("#detailBody").dataset.id);
    if (b.dataset.dact === "fav") { await setState(ev, { favorite: !ev.favorite }); openDetail(ev.id); }
    if (b.dataset.dact === "hide") { await setState(ev, { hidden: !ev.hidden }); $("#detail").close(); }
    if (b.dataset.dact === "visited") {
      const v = visits()[ev.id];
      setVisit(ev, v ? null : {});
      if (!v) toast("Schön! Wie war es? Sterne antippen.");
      syncFavSnaps(); openDetail(ev.id); render();
    }
    if (b.dataset.dact === "rate") { setVisit(ev, { rating: Number(b.dataset.r) }); syncFavSnaps(); openDetail(ev.id); render(); }
    if (b.dataset.dact === "yearly") {
      const on = toggleYearly(ev);
      toast(on ? "Vorgemerkt – nächstes Jahr zeigt die App einen Hinweis, sobald der Termin da ist." : "Nicht mehr jährlich vorgemerkt");
      syncFavSnaps(); openDetail(ev.id); render();
    }
    if (b.dataset.dact === "share") shareEvent(ev);
    if (b.dataset.dact === "ics") downloadIcs(ev);
    if (b.dataset.dact === "delete") {
      if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Wirklich löschen? Nochmal tippen"; return; }
      try { await api(`/api/events/${encodeURIComponent(ev.id)}`, { method: "DELETE" }); $("#detail").close(); await loadEvents(); toast("Termin gelöscht"); }
      catch (err) { toast(err.message); }
    }
  });

  $("#refreshBtn")?.addEventListener("click", startRefresh);
  $("#settingsBtn")?.addEventListener("click", openSettings);
  $("#homeChip")?.addEventListener("click", openSettings);
  $("#saveSettings")?.addEventListener("click", saveSettings);
  $("#useLocation")?.addEventListener("click", useMyLocation);
  $("#useStart")?.addEventListener("click", async () => {
    resetToStart();
    S.settings = await api("/api/settings");
    $("#setHome").value = S.settings.home_query || "";
    $("#setHomeLabel").textContent = `Start: ${S.settings.home_query}`;
    syncStartBtn();
    await loadEvents(); pushReminder();
    toast(`Start ist wieder ${S.settings.home_query}`);
  });
  $("#settings")?.addEventListener("click", (e) => { if (e.target === $("#settings")) $("#settings").close(); });
  $("#fontSeg")?.addEventListener("click", (e) => { const b = e.target.closest("[data-font]"); if (b) { store.set("font", Number(b.dataset.font)); applyLook(); } });
  $("#themeSeg")?.addEventListener("click", (e) => { const b = e.target.closest("[data-theme-set]"); if (b) { store.set("theme", b.dataset.themeSet); applyLook(); } });
  $("#copyIcs")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("#icsUrl").value); toast("Adresse kopiert"); }
    catch { $("#icsUrl").select(); toast("Adresse markiert – jetzt kopieren"); }
  });
  $("#restoreHidden")?.addEventListener("click", async () => {
    const r = await api("/api/hidden/reset", { method: "POST" });
    await loadEvents(); toast(`${r.restored} Termine wiederhergestellt`);
  });

  $("#addSource")?.addEventListener("click", async () => {
    let url = $("#newSource").value.trim();
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    let ok = false;
    try { ok = !!new URL(url).hostname.includes("."); } catch { ok = false; }
    if (!ok) { showSourceMsg("Bitte eine Webadresse eingeben, z.B. www.kieler-express.de", true); return; }
    await changeSource("add", url);
  });
  $("#sourceList")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-remove-src]");
    if (!b) return;
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Wirklich entfernen?"; return; }
    changeSource("remove", b.dataset.removeSrc);
  });
  $("#addBtn")?.addEventListener("click", openAdd);
  $("#addForm")?.addEventListener("submit", submitAdd);
  $("#addDialog")?.addEventListener("click", (e) => { if (e.target === $("#addDialog") || e.target.closest("[data-close]")) $("#addDialog").close(); });

  $("#welcomeForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#welcomeError"); err.hidden = true;
    try {
      S.settings = await api("/api/settings", { method: "PUT", body: JSON.stringify({
        home_query: $("#welcomeQuery").value.trim(), radius_km: Number($("#welcomeRadius").value) }) });
      S.filters.radius = null;
      render();
      startRefresh();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });

  window.addEventListener("resize", () => { measureTopbar(); applyView(); });
  if (window.ResizeObserver) new ResizeObserver(() => measureTopbar()).observe($(".topbar"));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { loadEvents().catch(() => {}); pollStatus(); } });
}

async function startLoad() {
  $("#count").textContent = "Lade Termine …";
  try {
    S.settings = await api("/api/settings");
    await loadEvents();
  } catch (e) {
    showLoadError(e);
  }
}

function showLoadError(e) {
  $("#count").textContent = "Keine Verbindung";
  $("#welcome").hidden = true;
  $("#list").hidden = false;
  $("#list").innerHTML = `<div class="empty">
    <h2>${esc(e.message || "Die Termine konnten nicht geladen werden.")}</h2>
    <p>Bitte prüfen, ob das Handy mit dem Internet (WLAN oder mobile Daten) verbunden ist, und dann erneut versuchen.</p>
    ${window.FLOHMARKT_APP ? `<p class="hint">Falls es weiter nicht geht: Handy-Einstellungen → Apps → Flohmärkte → „Mobile Daten &amp; WLAN“ bzw. „Netzwerkzugriff“ erlauben.</p>` : ""}
    <button class="btn primary" type="button" id="retryLoad">Erneut versuchen</button>
    ${e.detail ? `<p class="hint err-detail">Technische Info: ${esc(e.detail)}</p>` : ""}
  </div>`;
  $("#retryLoad")?.addEventListener("click", startLoad);
}

async function main() {
  S.prevVisit = store.get("lastVisit", 0);
  store.set("lastVisit", Date.now() / 1000);
  applyLook();
  bind();
  measureTopbar();
  await startLoad();
  const st = await pollStatus();
  if (st && !st.last_finished && !st.runs.length && S.settings.home_query && !st.running) startRefresh();
  if ("serviceWorker" in navigator && !window.FLOHMARKT_APP) navigator.serviceWorker.register("sw.js").catch(() => {});
}

main();
