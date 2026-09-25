/* Flohmarkt-Finder – Oberfläche (ohne Build-Schritt, reines JavaScript) */
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* egal */ } },
};

const DEFAULT_FILTERS = {
  range: "weekend", cats: [], q: "", radius: null, weekendOnly: false, favOnly: false,
  undated: false, noLocation: false, services: false, showHidden: false, source: "", sort: "date",
};
const FILTER_KEY = "filters.v2"; // neue Standardwerte (ohne Datum aus) gelten auch für bisherige Besucher
const CAT_COLORS = ["flohmarkt", "hof", "haushalt", "kinder", "antik", "sonstiges"];

const S = {
  events: [], settings: {}, categories: {}, today: null,
  // Startansicht ist immer "Dieses Wochenende"; übrige Filter bleiben gespeichert
  filters: { ...DEFAULT_FILTERS, ...store.get(FILTER_KEY, {}), range: "weekend" },
  view: store.get("view", "list"),
  map: null, mapLayer: null, prevVisit: 0, polling: null,
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

/* Symbole je Art (Marktstand, Garage, Sessel, Teddy, Vase, Preisschild) */
const CAT_ICONS = {
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

async function loadStaticData(force = false) {
  if (L$.data && !force) return L$.data;
  const src = window.FLOHMARKT_DATA_URL || "data/events.json";
  const r = await fetch(`${src}?t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error("Die Termin-Daten wurden noch nicht erzeugt. Bitte später erneut versuchen.");
  L$.data = await r.json();
  return L$.data;
}

function localSettings() {
  const region = L$.data?.region || {};
  const own = store.get("homeSettings", {});
  return {
    home_query: region.home_query || "", home_label: region.home_label || "", home_lat: region.home_lat ?? null,
    home_lon: region.home_lon ?? null, radius_km: region.radius_km || 50, days_ahead: region.days_ahead || 14,
    region_query: region.home_query || "", region_radius: region.radius_km || 50, ...own,
  };
}

function manualEvents() { return store.get("manualEvents", []); }

async function localApi(path, opts) {
  const method = (opts.method || "GET").toUpperCase();
  const body = opts.body ? JSON.parse(opts.body) : {};
  const states = store.get("eventState", {});
  const m = path.match(/^api\/events\/(.+?)(\/state)?$/);

  if (path === "api/settings" && method === "GET") { await loadStaticData(); return localSettings(); }
  if (path === "api/settings" && method === "PUT") {
    const cur = localSettings();
    const own = store.get("homeSettings", {});
    for (const k of ["radius_km", "days_ahead"]) if (body[k] != null) own[k] = body[k];
    if (body.home_query != null && body.home_query.trim() !== cur.home_query) {
      const q = body.home_query.trim();
      let g = null;
      try { g = q ? await geocodeBrowser(q) : null; } catch { /* offline */ }
      if (q && !g) throw new Error(`Ort „${q}“ wurde nicht gefunden. Bitte PLZ oder Ortsnamen prüfen.`);
      Object.assign(own, q ? { home_query: q, home_lat: g.lat, home_lon: g.lon, home_label: g.label }
        : { home_query: "", home_lat: null, home_lon: null, home_label: "" });
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
  const list = S.events.filter((ev) => passesBase(ev, f));
  const byNew = (a, b) => b.first_seen - a.first_seen;
  if (f.sort === "distance") list.sort((a, b) => (a.distance_km ?? 9999) - (b.distance_km ?? 9999));
  else if (f.sort === "new") list.sort(byNew);
  else list.sort((a, b) => {
    if (!a.start_date !== !b.start_date) return a.start_date ? -1 : 1;
    if (a.start_date !== b.start_date) return (a.start_date || "").localeCompare(b.start_date || "");
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
    `<span class="pill cat">${catIcon(k, "sm")}${esc(ev.category_label)}</span>`,
    isNew(ev) ? `<span class="pill new">NEU</span>` : "",
    ev.is_service ? `<span class="pill warn">Firma/Werbung</span>` : "",
    `<span class="pill src">${ev.source === "kleinanzeigen" ? "Privat · Kleinanzeigen" : ev.manual ? "Eigener Eintrag" : "Markt-Kalender"}</span>`,
  ].join("");
  return `
  <article class="card ${ev.hidden ? "is-hidden" : ""}" style="--cat: var(--c-${k})" data-id="${esc(ev.id)}" tabindex="0">
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
  const groups = new Map();
  for (const ev of list) {
    const key = ev.start_date && ev.start_date < S.today ? S.today : (ev.start_date || "");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ev);
  }
  let html = "";
  const days = [...groups.keys()].filter(Boolean);
  if (days.length >= 2 && days.length <= 4) {
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
  el.innerHTML = html;
}

function renderCats() {
  const f = S.filters;
  const counts = {};
  for (const ev of S.events) if (passesBase(ev, f, true)) counts[ev.category] = (counts[ev.category] || 0) + 1;
  $("#catChips").innerHTML = Object.entries(S.categories)
    .filter(([key]) => counts[key] || f.cats.includes(key) || key !== "sonstiges")
    .map(([key, label]) => `
    <button type="button" class="cat-chip" style="--cat: var(--c-${key})" data-cat="${key}" aria-pressed="${f.cats.includes(key)}">
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
  store.set(FILTER_KEY, S.filters);
  const list = filtered();
  const undated = list.filter((e) => !e.start_date).length;
  $("#count").textContent = `${list.length} ${list.length === 1 ? "Termin" : "Termine"}${undated ? ` (davon ${undated} ohne Datum)` : ""}`;
  $("#welcome").hidden = !!S.settings.home_query;
  syncControls();
  renderCats();
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
  $("#mapWrap").hidden = !showMap;
  $("#viewList").setAttribute("aria-selected", String(S.view !== "map"));
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
        html: `<div class="pin ${ev.favorite ? "fav" : ""}" style="--cat: var(--c-${k}); --s: ${size}px">${catIcon(k)}</div>`,
        iconSize: [size, size], iconAnchor: [size / 2, size], popupAnchor: [0, -size],
      }),
    });
    m.bindPopup(`<div class="map-pop"><strong>${esc(ev.title)}</strong>${dateLine(ev)}<br>${placeLine(ev)}<br><button class="btn primary" type="button" data-open="${esc(ev.id)}">Details</button></div>`);
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
      <span class="pill cat" style="--cat: var(--c-${CAT_COLORS.includes(ev.category) ? ev.category : "sonstiges"})">${esc(ev.category_label)}</span>
      ${isNew(ev) ? `<span class="pill new">NEU</span>` : ""}
      ${ev.is_service ? `<span class="pill warn">Vermutlich Firma/Werbung</span>` : ""}
    </div>
    <dl class="detail-meta">
      <dt>Wann</dt><dd>${dateLine(ev)}${ev.start_date ? ` <span class="hint">(${relDay(ev.start_date)})</span>` : ""}</dd>
      <dt>Wo</dt><dd>${placeLine(ev)}</dd>
      ${ev.price ? `<dt>Preis</dt><dd>${esc(ev.price)}</dd>` : ""}
      <dt>Quelle</dt><dd>${esc(sourceLabel(ev.source))}${ev.posted_at ? `, eingestellt ${esc(parseISO(ev.posted_at).toLocaleDateString("de-DE"))}` : ""}</dd>
    </dl>
    ${!ev.date_certain && ev.start_date ? `<p class="hint">Das Datum wurde aus einem Wochentag im Text abgeleitet. Bitte in der Anzeige prüfen.</p>` : ""}
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
    <label class="field"><span class="field-label">Eigene Notiz</span>
      <textarea id="noteField" rows="2" placeholder="z.B. Werkzeug anschauen, Bargeld mitnehmen">${esc(ev.note || "")}</textarea></label>
    <p class="form-error" id="detailError" hidden></p>`;
  body.dataset.id = id;
  const dlg = $("#detail");
  if (!dlg.open) dlg.showModal();
  $("#noteField").addEventListener("change", (e) => setState(ev, { note: e.target.value }, false));
}

async function setState(ev, patch, rerender = true) {
  try {
    await api(`/api/events/${encodeURIComponent(ev.id)}/state`, { method: "PATCH", body: JSON.stringify(patch) });
    Object.assign(ev, patch);
    if (rerender) render();
    if (patch.note !== undefined) toast("Notiz gespeichert");
  } catch (e) { toast(e.message); }
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
  $("#setHomeLabel").textContent = s.home_label ? `Gefunden: ${s.home_label}` : "";
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
  $("#settings").showModal();
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
async function loadEvents() {
  const data = await api("/api/events");
  S.events = data.events; S.categories = data.categories; S.today = data.today;
  renderSources();
  render();
}

function resetFilters() {
  S.filters = { ...DEFAULT_FILTERS };
  render();
}

function measureTopbar() {
  document.documentElement.style.setProperty("--topbar-h", `${$(".topbar").offsetHeight}px`);
}

function bind() {
  $("#rangeBar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-range]"); if (!b) return;
    S.filters.range = b.dataset.range; render();
  });
  let qT;
  $("#q").addEventListener("input", (e) => { clearTimeout(qT); qT = setTimeout(() => { S.filters.q = e.target.value.trim(); render(); }, 200); });
  $("#catChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]"); if (!b) return;
    const c = b.dataset.cat, cats = S.filters.cats;
    S.filters.cats = cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c];
    render();
  });
  $("#radius").addEventListener("input", (e) => { $("#radiusOut").textContent = `${e.target.value} km`; });
  $("#radius").addEventListener("change", (e) => { S.filters.radius = Number(e.target.value); render(); });
  for (const k of ["weekendOnly", "favOnly", "undated", "noLocation", "services", "showHidden"]) {
    $("#" + k).addEventListener("change", (e) => { S.filters[k] = e.target.checked; render(); });
  }
  $("#source").addEventListener("change", (e) => { S.filters.source = e.target.value; render(); });
  $("#sort").addEventListener("change", (e) => { S.filters.sort = e.target.value; render(); });
  $("#resetFilters").addEventListener("click", resetFilters);

  $("#openFilters").addEventListener("click", () => $("#filters").classList.add("open"));
  $("#closeFilters").addEventListener("click", () => $("#filters").classList.remove("open"));
  $("#showResults").addEventListener("click", () => { $("#filters").classList.remove("open"); window.scrollTo({ top: 0 }); });

  $("#viewList").addEventListener("click", () => { S.view = "list"; store.set("view", "list"); applyView(); });
  $("#viewMap").addEventListener("click", () => { S.view = "map"; store.set("view", "map"); applyView(); if (S.map) renderMap(filtered()); });

  $("#list").addEventListener("click", (e) => {
    const card = e.target.closest(".card"); if (!card) return;
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
  $("#list").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.classList.contains("card")) openDetail(e.target.dataset.id);
  });
  $("#map").addEventListener("click", (e) => { const b = e.target.closest("[data-open]"); if (b) openDetail(b.dataset.open); });

  $("#detail").addEventListener("click", async (e) => {
    if (e.target === $("#detail") || e.target.closest("[data-close]")) { $("#detail").close(); return; }
    const b = e.target.closest("[data-dact]"); if (!b) return;
    const ev = S.events.find((x) => x.id === $("#detailBody").dataset.id);
    if (b.dataset.dact === "fav") { await setState(ev, { favorite: !ev.favorite }); openDetail(ev.id); }
    if (b.dataset.dact === "hide") { await setState(ev, { hidden: !ev.hidden }); $("#detail").close(); }
    if (b.dataset.dact === "share") shareEvent(ev);
    if (b.dataset.dact === "ics") downloadIcs(ev);
    if (b.dataset.dact === "delete") {
      if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Wirklich löschen? Nochmal tippen"; return; }
      try { await api(`/api/events/${encodeURIComponent(ev.id)}`, { method: "DELETE" }); $("#detail").close(); await loadEvents(); toast("Termin gelöscht"); }
      catch (err) { toast(err.message); }
    }
  });

  $("#refreshBtn").addEventListener("click", startRefresh);
  $("#settingsBtn").addEventListener("click", openSettings);
  $("#homeChip").addEventListener("click", openSettings);
  $("#saveSettings").addEventListener("click", saveSettings);
  $("#settings").addEventListener("click", (e) => { if (e.target === $("#settings")) $("#settings").close(); });
  $("#fontSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-font]"); if (b) { store.set("font", Number(b.dataset.font)); applyLook(); } });
  $("#themeSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-theme-set]"); if (b) { store.set("theme", b.dataset.themeSet); applyLook(); } });
  $("#copyIcs").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("#icsUrl").value); toast("Adresse kopiert"); }
    catch { $("#icsUrl").select(); toast("Adresse markiert – jetzt kopieren"); }
  });
  $("#restoreHidden").addEventListener("click", async () => {
    const r = await api("/api/hidden/reset", { method: "POST" });
    await loadEvents(); toast(`${r.restored} Termine wiederhergestellt`);
  });

  $("#addBtn").addEventListener("click", openAdd);
  $("#addForm").addEventListener("submit", submitAdd);
  $("#addDialog").addEventListener("click", (e) => { if (e.target === $("#addDialog") || e.target.closest("[data-close]")) $("#addDialog").close(); });

  $("#welcomeForm").addEventListener("submit", async (e) => {
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
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { loadEvents().catch(() => {}); pollStatus(); } });
}

async function main() {
  S.prevVisit = store.get("lastVisit", 0);
  store.set("lastVisit", Date.now() / 1000);
  applyLook();
  bind();
  measureTopbar();
  try {
    S.settings = await api("/api/settings");
    await loadEvents();
  } catch (e) {
    $("#count").textContent = "Server nicht erreichbar";
    toast(e.message, 6000);
  }
  const st = await pollStatus();
  if (st && !st.last_finished && !st.runs.length && S.settings.home_query && !st.running) startRefresh();
  if ("serviceWorker" in navigator && !window.FLOHMARKT_APP) navigator.serviceWorker.register("sw.js").catch(() => {});
}

main();
