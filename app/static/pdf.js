/* PDF herunterladen: Termine auswählen (Liste oder Karte) und als eine A4-Seite mit Karte, Route und Infos speichern.
   Nutzt Hilfsfunktionen aus app.js (S, haversine, bestOrder, …). */
"use strict";

const PDF_MAX = 30; // mehr passt nicht lesbar auf eine A4-Seite
const DAY_COLORS = ["#0e6f60", "#c3601a", "#6d3fc0", "#2767b0", "#c0407a", "#7a5230"];

/* ---------- Auswahl ---------- */
function pdfVisibleList() {
  return S.view === "fav" ? S.events.filter((e) => e.favorite && !e.hidden && !isPast(e)) : filtered();
}

function startPdfMode() {
  const list = pdfVisibleList();
  S.pdf = { sel: new Set(list.slice(0, PDF_MAX).map((e) => e.id)) };
  document.documentElement.classList.add("pdf-mode");
  if (list.length > PDF_MAX) toast(`Auf eine A4-Seite passen höchstens ${PDF_MAX} Termine – die ersten ${PDF_MAX} sind ausgewählt.`, 5000);
  render();
}

function stopPdfMode() {
  S.pdf = null;
  document.documentElement.classList.remove("pdf-mode");
  render();
}

function togglePick(id) {
  if (!S.pdf) return;
  if (S.pdf.sel.has(id)) S.pdf.sel.delete(id);
  else if (S.pdf.sel.size >= PDF_MAX) { toast(`Höchstens ${PDF_MAX} Termine passen auf eine Seite.`); return; }
  else S.pdf.sel.add(id);
  renderPdfBar();
  const card = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  if (card) card.classList.toggle("picked", S.pdf.sel.has(id));
  if (S.map) renderMap(filtered(), false);
}

function renderPdfBar() {
  const bar = $("#pdfBar");
  bar.hidden = !S.pdf;
  if (!S.pdf) return;
  const n = S.pdf.sel.size;
  $("#pdfCount").textContent = `${n} ${n === 1 ? "Termin" : "Termine"} ausgewählt`;
  $("#pdfMake").disabled = !n;
}

/* ---------- Reihenfolge: nach Tag, innerhalb des Tages als kürzeste Route ab zu Hause ---------- */
function pdfPlan(events) {
  const home = S.settings.home_lat != null ? { lat: S.settings.home_lat, lon: S.settings.home_lon } : null;
  const byDay = new Map();
  for (const e of events) {
    const d = e.start_date ? (e.start_date < S.today ? S.today : e.start_date) : "";
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(e);
  }
  const days = [...byDay.keys()].sort((a, b) => (a || "9999").localeCompare(b || "9999"));
  let n = 0;
  return {
    home,
    days: days.map((d, i) => {
      const evs = byDay.get(d);
      const pos = evs.filter((e) => e.lat != null), noPos = evs.filter((e) => e.lat == null);
      const { order, km } = d && pos.length ? bestOrder(pos, home, !!home) : { order: pos, km: 0 };
      const stops = [...order, ...noPos].map((e) => ({ ev: e, no: ++n }));
      return { day: d, color: DAY_COLORS[i % DAY_COLORS.length], stops, km: Math.round(km * 1.3), routed: !!d && order.length > 0 };
    }),
  };
}

function mapsUrl(home, stops) {
  const pts = [...new Set(stops.filter((s) => s.ev.lat != null).map((s) => `${s.ev.lat},${s.ev.lon}`))].slice(0, 9);
  if (!pts.length) return "";
  const dest = home ? `${home.lat},${home.lon}` : pts[pts.length - 1];
  const wps = home ? pts : pts.slice(0, -1);
  return `https://www.google.com/maps/dir/?api=1${home ? `&origin=${home.lat},${home.lon}` : ""}&destination=${dest}` +
    `${wps.length ? `&waypoints=${encodeURIComponent(wps.join("|"))}` : ""}&travelmode=driving`;
}

/* ---------- Kartenbild (OpenStreetMap-Kacheln auf ein Canvas) ---------- */
const TILE = 256;
const projX = (lon, z) => ((lon + 180) / 360) * TILE * 2 ** z;
const projY = (lat, z) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z;
};

function loadTile(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const t = setTimeout(() => resolve(null), 7000);
    img.onload = () => { clearTimeout(t); resolve(img); };
    img.onerror = () => { clearTimeout(t); resolve(null); };
    img.src = url;
  });
}

async function mapImage(plan, W, H) {
  const pts = [];
  if (plan.home) pts.push(plan.home);
  for (const d of plan.days) for (const s of d.stops) if (s.ev.lat != null) pts.push(s.ev);
  if (!pts.length) return null;
  const pad = 40;
  let z = 15;
  for (; z > 3; z--) {
    const xs = pts.map((p) => projX(p.lon, z)), ys = pts.map((p) => projY(p.lat, z));
    if (Math.max(...xs) - Math.min(...xs) <= W - 2 * pad && Math.max(...ys) - Math.min(...ys) <= H - 2 * pad) break;
  }
  const xs = pts.map((p) => projX(p.lon, z)), ys = pts.map((p) => projY(p.lat, z));
  const x0 = (Math.max(...xs) + Math.min(...xs)) / 2 - W / 2, y0 = (Math.max(...ys) + Math.min(...ys)) / 2 - H / 2;
  const P = (p) => [projX(p.lon, z) - x0, projY(p.lat, z) - y0];

  const draw = async (withTiles) => {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    g.fillStyle = "#eef0ec"; g.fillRect(0, 0, W, H);
    if (withTiles) {
      const jobs = [];
      for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + W) / TILE); tx++) {
        for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + H) / TILE); ty++) {
          jobs.push(loadTile(`https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`).then((img) => {
            if (img) g.drawImage(img, tx * TILE - x0, ty * TILE - y0);
          }));
        }
      }
      await Promise.all(jobs);
      g.fillStyle = "rgba(255,255,255,.25)"; g.fillRect(0, 0, W, H); // Karte etwas blasser, Route besser sichtbar
    }
    // Routen je Tag
    for (const d of plan.days) {
      if (!d.routed) continue;
      const line = d.stops.filter((s) => s.ev.lat != null).map((s) => P(s.ev));
      if (plan.home) { line.unshift(P(plan.home)); line.push(P(plan.home)); }
      g.strokeStyle = "#ffffff"; g.lineWidth = 7; g.lineJoin = "round"; g.lineCap = "round";
      g.beginPath(); line.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
      g.strokeStyle = d.color; g.lineWidth = 3.5; g.setLineDash([10, 6]);
      g.beginPath(); line.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
      g.setLineDash([]);
    }
    // Zuhause
    if (plan.home) {
      const [x, y] = P(plan.home);
      g.fillStyle = "#1b2420"; g.strokeStyle = "#f3c63f"; g.lineWidth = 4;
      g.beginPath(); g.arc(x, y, 11, 0, 2 * Math.PI); g.fill(); g.stroke();
    }
    // Nummern (bei gleicher Adresse leicht versetzt)
    const used = new Map();
    for (const d of plan.days) {
      for (const s of d.stops) {
        if (s.ev.lat == null) continue;
        let [x, y] = P(s.ev);
        const key = `${Math.round(x / 6)},${Math.round(y / 6)}`;
        const k = used.get(key) || 0; used.set(key, k + 1);
        x += k * 22;
        const top = isTop(s.ev);
        g.fillStyle = top ? "#e0a800" : d.color; g.strokeStyle = "#ffffff"; g.lineWidth = 3;
        g.beginPath(); g.arc(x, y, 14, 0, 2 * Math.PI); g.fill(); g.stroke();
        g.fillStyle = top ? "#2a1f00" : "#ffffff"; g.font = "bold 15px Helvetica, Arial, sans-serif";
        g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(s.no), x, y + 1);
      }
    }
    if (withTiles) {
      g.font = "12px Helvetica, Arial, sans-serif"; g.textAlign = "right"; g.textBaseline = "bottom";
      g.fillStyle = "rgba(255,255,255,.85)"; g.fillRect(W - 190, H - 18, 190, 18);
      g.fillStyle = "#333"; g.fillText("© OpenStreetMap-Mitwirkende", W - 6, H - 3);
    }
    return c.toDataURL("image/jpeg", 0.88);
  };
  try { return await draw(true); } catch { return draw(false); } // ohne Kacheln, falls der Kartendienst nicht mitspielt
}

/* ---------- PDF ---------- */
let jspdfLoading = null;
function loadJsPdf() {
  if (window.jspdf) return Promise.resolve(window.jspdf);
  jspdfLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "static/vendor/jspdf/jspdf.umd.min.js";
    s.onload = () => resolve(window.jspdf);
    s.onerror = () => { jspdfLoading = null; reject(new Error("PDF-Funktion konnte nicht geladen werden (keine Verbindung?)")); };
    document.head.append(s);
  });
  return jspdfLoading;
}

// Die eingebaute PDF-Schrift kennt nur westeuropäische Zeichen
const pdfText = (s) => String(s ?? "")
  .replace(/[„“”«»]/g, '"').replace(/[‚‘’]/g, "'").replace(/[–—]/g, "-").replace(/…/g, "...")
  .replace(/[•·]/g, "·").replace(/€/g, "EUR").replace(/★/g, "*").replace(/\s+/g, " ")
  .replace(/[^\x20-\xff]/g, "").trim();

const shortDay = (iso) => parseISO(iso).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
const longDay = (iso) => parseISO(iso).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });

function infoText(ev) {
  const d = pdfText(ev.description || "");
  if (!d) return "";
  const first = d.split(/(?<=[.!?])\s/)[0];
  const t = first.length >= 40 ? first : d;
  return t.length > 150 ? `${t.slice(0, 147).trim()}...` : t;
}

async function makePdf() {
  const btn = $("#pdfMake");
  const events = S.events.filter((e) => S.pdf?.sel.has(e.id));
  if (!events.length) return;
  btn.disabled = true; btn.textContent = "PDF wird erstellt …";
  try {
    const { jsPDF } = await loadJsPdf();
    const plan = pdfPlan(events);
    const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
    const M = 12, PW = 210, PH = 297, CW = PW - 2 * M;
    const dated = events.filter((e) => e.start_date).map((e) => e.start_date).sort();
    const single = plan.days.filter((d) => d.day).length === 1;

    // Kopf
    doc.setTextColor(20, 30, 26);
    doc.setFont("helvetica", "bold"); doc.setFontSize(17);
    doc.text(single ? `Flohmarkt-Tour ${pdfText(longDay(dated[0]))}` : "Flohmärkte - meine Auswahl", M, M + 5);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(90, 100, 96);
    const range = dated.length ? (dated[0] === dated[dated.length - 1] ? shortDay(dated[0]) : `${shortDay(dated[0])} bis ${shortDay(dated[dated.length - 1])}`) : "";
    doc.text(pdfText([`${events.length} ${events.length === 1 ? "Termin" : "Termine"}`, range,
      S.settings.home_query ? `Start: ${S.settings.home_query}` : ""].filter(Boolean).join("  ·  ")), M, M + 11);
    doc.text(pdfText(`erstellt am ${new Date().toLocaleDateString("de-DE")}`), PW - M, M + 11, { align: "right" });
    let y = M + 15;

    // Karte
    const mapH = events.length <= 8 ? 92 : events.length <= 16 ? 78 : 62;
    const img = await mapImage(plan, Math.round(CW * 5), Math.round(mapH * 5));
    if (img) {
      doc.addImage(img, "JPEG", M, y, CW, mapH);
      doc.setDrawColor(200, 206, 203); doc.rect(M, y, CW, mapH);
      y += mapH + 4;
    }

    // Route je Tag
    doc.setFontSize(9);
    for (const d of plan.days) {
      if (!d.day) continue;
      const nums = d.stops.filter((s) => s.ev.lat != null).map((s) => s.no);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(d.color.slice(i, i + 2), 16));
      doc.setFillColor(r, g, b); doc.rect(M, y - 2.6, 3, 3, "F");
      doc.setFont("helvetica", "bold"); doc.setTextColor(20, 30, 26);
      const head = pdfText(`${longDay(d.day)}:`);
      doc.text(head, M + 5, y);
      const hw = doc.getTextWidth(head) + 2;
      doc.setFont("helvetica", "normal");
      const route = nums.length
        ? `${plan.home ? "Start" : ""}${plan.home ? " > " : ""}${nums.join(" > ")}${plan.home ? " > zurück" : ""}  ·  ca. ${d.km} km`
        : "keine Adresse für die Route";
      const url = mapsUrl(plan.home, d.stops);
      const linkText = nums.length > 9 ? "Route (erste 9 Stopps) in Google Maps" : "Route in Google Maps öffnen";
      const linkW = url ? doc.getTextWidth(linkText) + 4 : 0;
      const lines = doc.splitTextToSize(pdfText(route), CW - 5 - hw - linkW).slice(0, 3);
      doc.text(lines, M + 5 + hw, y);
      if (url) {
        doc.setTextColor(14, 111, 96);
        doc.textWithLink(linkText, PW - M, y, { url, align: "right" });
      }
      y += 4 * lines.length + 1;
    }
    y += 1;
    doc.setDrawColor(210, 215, 212); doc.line(M, y, PW - M, y);
    y += 4;

    // Einträge – Größe so wählen, dass alles auf die Seite passt
    const footerY = PH - 8;
    const avail = footerY - 4 - y;
    const layouts = [
      { cols: 1, fs: 9.5, info: true }, { cols: 1, fs: 8.5, info: true }, { cols: 2, fs: 8.5, info: true },
      { cols: 2, fs: 7.5, info: true }, { cols: 2, fs: 7.5, info: false }, { cols: 2, fs: 6.5, info: false },
    ];
    const items = plan.days.flatMap((d) => d.stops.map((s) => ({ ...s, color: d.color })));
    const blocks = (L) => {
      const colW = (CW - (L.cols - 1) * 6) / L.cols - 8;
      const lh = L.fs * 0.42;
      doc.setFontSize(L.fs);
      return items.map((it) => {
        const e = it.ev;
        doc.setFont("helvetica", "bold");
        const title = doc.splitTextToSize(pdfText(`${isTop(e) ? "* Top-Tipp: " : ""}${e.title}`), colW).slice(0, 2);
        doc.setFont("helvetica", "normal");
        const when = pdfText([e.start_date ? shortDay(e.start_date) : "Datum siehe Anzeige", e.time_text,
          e.category_label].filter(Boolean).join("  ·  "));
        const where = doc.splitTextToSize(pdfText([e.address || e.location || "Ort siehe Anzeige",
          e.distance_km != null ? `${String(e.distance_km).replace(".", ",")} km` : ""].filter(Boolean).join("  ·  ")), colW).slice(0, 2);
        const info = L.info ? doc.splitTextToSize(infoText(e), colW).slice(0, 2) : [];
        const lines = title.length + 1 + where.length + info.length;
        return { it, title, when, where, info, h: lines * lh + 2.2, lh };
      });
    };
    let L, bl;
    for (L of layouts) {
      bl = blocks(L);
      // Spalten der Reihe nach füllen
      const cols = Array.from({ length: L.cols }, () => 0);
      let c = 0;
      for (const b of bl) { if (cols[c] + b.h > avail && c < L.cols - 1) c++; cols[c] += b.h; }
      if (Math.max(...cols) <= avail) break;
    }
    const colW = (CW - (L.cols - 1) * 6) / L.cols;
    let col = 0, cy = y;
    for (const b of bl) {
      if (cy + b.h > footerY - 4 && col < L.cols - 1) { col++; cy = y; }
      if (cy + b.h > footerY - 2) break; // Notbremse (sollte nicht vorkommen)
      const x = M + col * (colW + 6);
      const e = b.it.ev;
      const top = isTop(e);
      // Nummer
      const [r, g, bb] = top ? [224, 168, 0] : [1, 3, 5].map((i) => parseInt(b.it.color.slice(i, i + 2), 16));
      doc.setFillColor(r, g, bb); doc.circle(x + 2.6, cy + b.lh * 0.55, 2.6, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(Math.min(8, L.fs)); doc.setTextColor(top ? 42 : 255, top ? 31 : 255, top ? 0 : 255);
      doc.text(String(b.it.no), x + 2.6, cy + b.lh * 0.55 + 1, { align: "center" });
      const tx = x + 7;
      let ly = cy + b.lh * 0.8;
      doc.setFontSize(L.fs); doc.setTextColor(20, 30, 26);
      for (const t of b.title) {
        if (e.url) doc.textWithLink(t, tx, ly, { url: e.url }); else doc.text(t, tx, ly);
        ly += b.lh;
      }
      doc.setFont("helvetica", "normal"); doc.setTextColor(40, 50, 46);
      doc.text(b.when, tx, ly); ly += b.lh;
      doc.setTextColor(90, 100, 96);
      for (const t of b.where) { doc.text(t, tx, ly); ly += b.lh; }
      doc.setFont("helvetica", "italic");
      for (const t of b.info) { doc.text(t, tx, ly); ly += b.lh; }
      cy += b.h;
    }

    // Fuß
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(120, 128, 125);
    doc.text(pdfText(`Flohmarkt-Finder${L$.data?.site_url ? ` · ${L$.data.site_url.replace(/^https?:\/\//, "")}` : ""} · Angaben ohne Gewähr - Titel antippen öffnet die Anzeige · Kilometer ungefähr`), M, footerY);

    const name = `Flohmarkt-${single ? "Tour" : "Auswahl"}-${dated[0] || toISO(new Date())}.pdf`;
    if (appHas("savePdf")) {
      window.AndroidApp.savePdf(doc.output("datauristring").split(",")[1], name);
    } else if (window.FLOHMARKT_APP) {
      toast("Zum Speichern als PDF bitte die neue App-Version installieren (Hinweis oben in der Liste). Am PC geht es sofort.", 6000);
      return;
    } else {
      doc.save(name);
      toast("PDF wurde heruntergeladen");
    }
    stopPdfMode();
  } catch (e) {
    toast(e.message || "Das PDF konnte nicht erstellt werden.");
  } finally {
    btn.disabled = false; btn.textContent = "PDF erstellen";
  }
}

function bindPdf() {
  $("#pdfBtn").addEventListener("click", () => (S.pdf ? stopPdfMode() : startPdfMode()));
  $("#pdfCancel").addEventListener("click", stopPdfMode);
  $("#pdfAll").addEventListener("click", () => {
    const list = pdfVisibleList();
    S.pdf.sel = new Set(list.slice(0, PDF_MAX).map((e) => e.id));
    if (list.length > PDF_MAX) toast(`Höchstens ${PDF_MAX} Termine passen auf eine Seite.`);
    render();
  });
  $("#pdfNone").addEventListener("click", () => { S.pdf.sel.clear(); render(); });
  $("#pdfMake").addEventListener("click", makePdf);
}
