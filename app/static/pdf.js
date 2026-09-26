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
  if (!bar) return;
  bar.hidden = !S.pdf;
  if (!S.pdf) return;
  const n = S.pdf.sel.size;
  $("#pdfCount").textContent = `${n} ${n === 1 ? "Termin" : "Termine"} ausgewählt`;
  $("#pdfMake").disabled = !n;
}

/* ---------- Reihenfolge: nach Tag, innerhalb des Tages als kürzeste Route ab zu Hause ---------- */
async function pdfPlan(events) {
  const home = S.settings.home_lat != null ? { lat: S.settings.home_lat, lon: S.settings.home_lon } : null;
  const byDay = new Map();
  for (const e of events) {
    const d = e.start_date ? (e.start_date < S.today ? S.today : e.start_date) : "";
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(e);
  }
  const days = [...byDay.keys()].sort((a, b) => (a || "9999").localeCompare(b || "9999"));
  // Echte Fahrzeiten je Tag parallel holen (fällt bei Problemen auf Luftlinie zurück)
  const drives = await Promise.all(days.map((d) => {
    const pos = byDay.get(d).filter((e) => e.lat != null);
    return d && pos.length && home ? planDrive(pos, home, true) : Promise.resolve(null);
  }));
  let n = 0;
  return {
    home,
    days: days.map((d, i) => {
      const evs = byDay.get(d);
      const pos = evs.filter((e) => e.lat != null), noPos = evs.filter((e) => e.lat == null);
      const drive = drives[i];
      const est = d && pos.length ? bestOrder(pos, home, !!home) : { order: pos, km: 0 };
      const order = drive ? drive.order : est.order;
      const stops = [...order, ...noPos].map((e, k) => ({ ev: e, no: ++n, leg: drive && k < order.length ? drive.legs[k] : null }));
      return { day: d, color: DAY_COLORS[i % DAY_COLORS.length], stops, km: Math.round(est.km * 1.3), drive, routed: !!d && order.length > 0 };
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

/* ---------- Kartenbild (OpenStreetMap-Kacheln, grau – gut für Schwarz-Weiß-Druck) ---------- */
const TILE = 256;
const projX = (lon, z) => ((lon + 180) / 360) * TILE * 2 ** z;
const projY = (lat, z) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z;
};
// Linienarten je Tag – auch ohne Farbe unterscheidbar
const DAY_DASH = [[], [14, 7], [3, 6], [16, 5, 3, 5]];

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
  const pad = 46;
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
    g.fillStyle = "#f4f4f4"; g.fillRect(0, 0, W, H);
    if (withTiles) {
      g.filter = "grayscale(1) contrast(0.85) brightness(1.08)";
      const jobs = [];
      for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + W) / TILE); tx++) {
        for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + H) / TILE); ty++) {
          jobs.push(loadTile(`https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`).then((img) => {
            if (img) g.drawImage(img, tx * TILE - x0, ty * TILE - y0);
          }));
        }
      }
      await Promise.all(jobs);
      g.filter = "none";
      g.fillStyle = "rgba(255,255,255,.35)"; g.fillRect(0, 0, W, H); // blasser, damit Route und Nummern hervorstechen
    }
    const path = (line) => { g.beginPath(); line.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); };
    plan.days.forEach((d, i) => {
      if (!d.routed) return;
      const line = d.stops.filter((s) => s.ev.lat != null).map((s) => P(s.ev));
      if (plan.home) { line.unshift(P(plan.home)); line.push(P(plan.home)); }
      g.lineJoin = "round"; g.lineCap = "round";
      g.setLineDash([]); g.strokeStyle = "#ffffff"; g.lineWidth = 9; path(line); g.stroke();
      g.setLineDash(DAY_DASH[i % DAY_DASH.length]); g.strokeStyle = "#111111"; g.lineWidth = 4; path(line); g.stroke();
      g.setLineDash([]);
    });
    if (plan.home) { // Haus-Symbol
      const [x, y] = P(plan.home);
      g.fillStyle = "#ffffff"; g.strokeStyle = "#111111"; g.lineWidth = 3;
      g.beginPath(); g.moveTo(x - 13, y - 1); g.lineTo(x, y - 14); g.lineTo(x + 13, y - 1); g.lineTo(x + 10, y - 1);
      g.lineTo(x + 10, y + 12); g.lineTo(x - 10, y + 12); g.lineTo(x - 10, y - 1); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = "#111111"; g.fillRect(x - 3, y + 4, 6, 8);
    }
    const used = new Map();
    for (const d of plan.days) {
      for (const s of d.stops) {
        if (s.ev.lat == null) continue;
        let [x, y] = P(s.ev);
        const key = `${Math.round(x / 8)},${Math.round(y / 8)}`;
        const k = used.get(key) || 0; used.set(key, k + 1);
        x += k * 26;
        const top = isTop(s.ev);
        // normal: schwarzer Kreis mit weißer Zahl; Top-Tipp: weißer Kreis mit dickem schwarzem Doppelrand
        g.beginPath(); g.arc(x, y, top ? 18 : 15, 0, 2 * Math.PI);
        g.fillStyle = top ? "#ffffff" : "#111111"; g.fill();
        g.lineWidth = top ? 5 : 3; g.strokeStyle = top ? "#111111" : "#ffffff"; g.stroke();
        if (top) { g.beginPath(); g.arc(x, y, 12.5, 0, 2 * Math.PI); g.lineWidth = 1.5; g.stroke(); }
        g.fillStyle = top ? "#111111" : "#ffffff"; g.font = `bold ${top ? 17 : 16}px Helvetica, Arial, sans-serif`;
        g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(s.no), x, y + 1);
      }
    }
    if (withTiles) {
      g.font = "13px Helvetica, Arial, sans-serif"; g.textAlign = "right"; g.textBaseline = "bottom";
      g.fillStyle = "rgba(255,255,255,.9)"; g.fillRect(W - 200, H - 20, 200, 20);
      g.fillStyle = "#333"; g.fillText("© OpenStreetMap-Mitwirkende", W - 6, H - 4);
    }
    return c.toDataURL("image/jpeg", 0.9);
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
  .replace(/[•]/g, "·").replace(/€/g, "EUR").replace(/★/g, "*").replace(/\s+/g, " ")
  .replace(/[^\x20-\xff]/g, "").trim();

const shortDay = (iso) => parseISO(iso).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
const longDay = (iso) => parseISO(iso).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
const fullDay = (iso) => parseISO(iso).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

function infoText(ev) {
  const d = pdfText(ev.description || "");
  if (!d) return "";
  const first = d.split(/(?<=[.!?])\s/)[0];
  const t = first.length >= 40 ? first : d;
  return t.length > 170 ? `${t.slice(0, 167).trim()}...` : t;
}

/* Straße + Hausnummer aus dem Anzeigentext, falls die Adresse nur PLZ/Ort enthält */
const STREET_SUF = "straße|strasse|str\\.|weg|allee|platz|ring|damm|chaussee|gasse|redder|twiete|koppel|kamp|stieg|ufer|markt|berg|feld|wiese|brook|moor|horst|hof|tor|reihe|pfad|steig|blick|hörn";
const STREET_RE = new RegExp("((?:(?:Am|An der|Auf dem|Im|In der|Zum|Zur|Alte[rn]?|Neue[rn]?|Große[rn]?|Kleine[rn]?) )?" +
  "(?:[A-ZÄÖÜ][a-zäöüß]+-)*(?:[A-ZÄÖÜ][a-zäöüß]*(?:" + STREET_SUF + ")|(?:" + STREET_SUF.replace(/(^|\|)(\w)/g, (m, a, c) => a + c.toUpperCase()) + "))" +
  "\\s?\\d{1,4}(?!\\d|[.:]\\d)\\s?[a-z]?)(?![a-zäöüß])(?!\\s*(?:uhr|-|–|bis|km|€|eur))");
function whereText(ev) {
  const addr = pdfText(ev.address || ev.location || "");
  if (/\d{1,4}\s?[a-z]?\b/.test(addr.replace(/\b\d{5}\b/g, "")) && /[a-zäöüß]{3}/i.test(addr)) return addr; // hat schon Straße + Nr.
  const m = `${ev.title || ""} ${ev.description || ""}`.match(STREET_RE);
  const street = m ? pdfText(m[1]).replace(/str\.(\d)/i, "str. $1") : "";
  return [street, addr || "Ort siehe Anzeige"].filter(Boolean).join(", ");
}

function sourceText(ev) {
  return ev.source === "kleinanzeigen" ? "Kleinanzeigen" : ev.manual ? "eigener Eintrag"
    : ["krencky24.de", "meine-flohmarkt-termine.de"].includes(ev.source) ? "Markt-Kalender" : pdfText(ev.source || "");
}

async function makePdf() {
  const btn = $("#pdfMake");
  const events = S.events.filter((e) => S.pdf?.sel.has(e.id));
  if (!events.length) return;
  btn.disabled = true; btn.textContent = "PDF wird erstellt …";
  try {
    const { jsPDF } = await loadJsPdf();
    const plan = await pdfPlan(events);
    const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
    const M = 12, PW = 210, PH = 297, CW = PW - 2 * M;
    const INK = [17, 17, 17], GREY = [95, 95, 95], LIGHT = [238, 238, 238], RULE = [170, 170, 170];
    const ink = (c) => doc.setTextColor(...c);
    const dated = events.filter((e) => e.start_date).map((e) => e.start_date).sort();
    const days = plan.days.filter((d) => d.day);
    const single = days.length === 1;

    // ---- Kopf ----
    ink(INK); doc.setFont("helvetica", "bold"); doc.setFontSize(22);
    doc.text(single ? "Flohmarkt-Tour" : "Flohmärkte", M, M + 7);
    doc.setFont("helvetica", "normal"); doc.setFontSize(12.5);
    const sub = single ? fullDay(dated[0])
      : dated.length ? `${longDay(dated[0])} bis ${longDay(dated[dated.length - 1])}` : "meine Auswahl";
    doc.text(pdfText(sub), M, M + 13.5);
    doc.setFontSize(8.5); ink(GREY);
    doc.text(pdfText(`${events.length} ${events.length === 1 ? "Termin" : "Termine"}`), PW - M, M + 3, { align: "right" });
    if (S.settings.home_query) doc.text(pdfText(`Start: ${S.settings.home_query}`), PW - M, M + 8, { align: "right" });
    doc.text(pdfText(`Stand: ${new Date().toLocaleDateString("de-DE")}`), PW - M, M + 13, { align: "right" });
    doc.setDrawColor(...INK); doc.setLineWidth(0.8); doc.line(M, M + 17, PW - M, M + 17);
    let y = M + 21;

    // ---- Karte ----
    const mapH = events.length <= 6 ? 88 : events.length <= 12 ? 74 : events.length <= 18 ? 60 : 48;
    const img = await mapImage(plan, Math.round(CW * 5), Math.round(mapH * 5));
    if (img) {
      doc.addImage(img, "JPEG", M, y, CW, mapH);
      doc.setDrawColor(...INK); doc.setLineWidth(0.3); doc.rect(M, y, CW, mapH);
      y += mapH + 3.5;
      // Legende (in Schwarz-Weiß eindeutig)
      doc.setFontSize(7.5); ink(GREY); doc.setLineWidth(0.3);
      let lx = M;
      doc.setFillColor(...INK); doc.circle(lx + 1.6, y - 1.1, 1.6, "F");
      doc.text("Termin", lx + 4.2, y); lx += 17;
      doc.setDrawColor(...INK); doc.setLineWidth(0.6); doc.setFillColor(255, 255, 255); doc.circle(lx + 1.8, y - 1.1, 1.8, "FD");
      doc.text("Top-Tipp (Dorf-/Straßen-Flohmarkt)", lx + 4.6, y); lx += 55;
      doc.setLineWidth(0.3); doc.rect(lx, y - 2.6, 3, 2.6); doc.line(lx - 0.4, y - 2.4, lx + 1.5, y - 3.8); doc.line(lx + 1.5, y - 3.8, lx + 3.4, y - 2.4);
      doc.text("Start/Zuhause", lx + 4.4, y); lx += 25;
      days.forEach((d, i) => {
        if (!d.routed) return;
        doc.setLineWidth(0.6); doc.setLineDashPattern(DAY_DASH[i % DAY_DASH.length].map((v) => v / 5), 0);
        doc.line(lx, y - 1.1, lx + 7, y - 1.1); doc.setLineDashPattern([], 0);
        doc.text(pdfText(shortDay(d.day)), lx + 8.5, y); lx += 26;
      });
      y += 4;
    }

    // ---- Routen-Kasten ----
    const routeLines = days.map((d) => {
      const pos = d.stops.filter((s) => s.ev.lat != null);
      const nums = pos.map((s) => s.no);
      const back = d.drive?.legs[d.drive.legs.length - 1];
      let txt = !nums.length ? "keine genaue Adresse für eine Route"
        : d.drive
          ? `${plan.home ? "Start" : ""}${pos.map((s) => ` > ${s.no}${s.leg ? ` (${fmtDur(s.leg.min)})` : ""}`).join("")}${back && plan.home ? ` > zurück (${fmtDur(back.min)})` : ""}` +
            `  =  ${fmtDur(d.drive.min)} Fahrt, ${fmtKm(d.drive.km)}`
          : `${plan.home ? "Start > " : ""}${nums.join(" > ")}${plan.home ? " > zurück" : ""}   (ca. ${d.km} km Fahrt)`;
      const wx = wxText(d.day);
      if (wx) txt += `  ·  Wetter: ${wx}`;
      return { d, nums, txt, url: mapsUrl(plan.home, d.stops) };
    });
    if (routeLines.length) {
      doc.setFontSize(9);
      const labelW = 36;
      doc.setFont("helvetica", "bold");
      const linkW = doc.getTextWidth("Google Maps (9 Stopps) >") + 5;
      doc.setFont("helvetica", "normal");
      const rows = routeLines.map((r) => ({ ...r, lines: doc.splitTextToSize(pdfText(r.txt), CW - 6 - labelW - linkW).slice(0, 4) }));
      const boxH = rows.reduce((h, r) => h + r.lines.length * 4 + 1.5, 3.5);
      doc.setFillColor(...LIGHT); doc.setDrawColor(...RULE); doc.setLineWidth(0.2);
      doc.roundedRect(M, y, CW, boxH, 1.5, 1.5, "FD");
      let ry = y + 5;
      for (const r of rows) {
        doc.setFont("helvetica", "bold"); ink(INK);
        doc.text(pdfText(`Route ${shortDay(r.d.day)}:`), M + 3, ry);
        doc.setFont("helvetica", "normal");
        doc.text(r.lines, M + 3 + labelW, ry);
        if (r.url) {
          doc.setFont("helvetica", "bold");
          doc.textWithLink(r.nums.length > 9 ? "Google Maps (9 Stopps) >" : "In Google Maps öffnen >", PW - M - 3, ry, { url: r.url, align: "right" });
          doc.setFont("helvetica", "normal");
        }
        ry += r.lines.length * 4 + 1.5;
      }
      y += boxH + 5;
    }

    // ---- Termine: so groß wie möglich, alles auf eine Seite ----
    const footerY = PH - 7;
    const avail = footerY - 5 - y;
    const layouts = [
      { cols: 1, fs: 10, info: 2 }, { cols: 1, fs: 9, info: 2 }, { cols: 2, fs: 10, info: 2 }, { cols: 2, fs: 9, info: 2 },
      { cols: 2, fs: 8.2, info: 2 },
      { cols: 2, fs: 7.6, info: 1 }, { cols: 2, fs: 7, info: 0 }, { cols: 2, fs: 6.6, info: 0, what: false },
      { cols: 2, fs: 6.4, info: 0, what: false, titleLines: 1 }, { cols: 3, fs: 6.2, info: 0, what: false },
      { cols: 3, fs: 5.8, info: 0, what: false, titleLines: 1 },
    ];
    const items = plan.days.flatMap((d) => d.stops);
    const gap = 6, numW = 9, labW = (fs) => fs * 1.25;
    const measure = (L) => {
      const colW = (CW - (L.cols - 1) * gap) / L.cols;
      const textW = colW - numW - labW(L.fs) - 7; // rechts Platz fürs Abhak-Kästchen
      const lh = L.fs * 0.43;
      return items.map((it) => {
        const e = it.ev;
        doc.setFontSize(L.fs + 1); doc.setFont("helvetica", "bold");
        const title = doc.splitTextToSize(pdfText(e.title), colW - numW - 7).slice(0, L.titleLines || 2);
        doc.setFontSize(L.fs); doc.setFont("helvetica", "normal");
        const when = doc.splitTextToSize(pdfText([e.start_date ? longDay(e.start_date) : "Datum siehe Anzeige",
          e.time_text ? `${e.time_text}` : "Uhrzeit siehe Anzeige"].join(", ")), textW).slice(0, 2);
        const where = doc.splitTextToSize(pdfText(whereText(e) + (e.distance_km != null ? `  (${String(e.distance_km).replace(".", ",")} km)` : "")), textW).slice(0, 2);
        const what = L.what === false ? [] : doc.splitTextToSize(pdfText([e.category_label, sourceText(e), e.gone ? "Anzeige nicht mehr online" : ""].filter(Boolean).join(" · ")), textW).slice(0, 1);
        const info = L.info ? doc.splitTextToSize(infoText(e), textW).slice(0, L.info) : [];
        const tl = (L.fs + 1) * 0.43;
        const h = title.length * tl + (when.length + where.length + what.length + info.length) * lh + (isTop(e) ? lh : 0) + (L.cols === 3 ? 2.6 : 4);
        return { it, e, title, when, where, what, info, h, lh, tl, colW };
      });
    };
    // Spalten gleichmäßig füllen (Reihenfolge bleibt: erst links, dann rechts)
    const distribute = (bl, cols) => {
      const total = bl.reduce((a, b) => a + b.h, 0);
      const target = Math.max(total / cols, ...bl.map((b) => b.h));
      const col = [], heights = Array(cols).fill(0);
      let c = 0;
      for (const b of bl) {
        if (c < cols - 1 && heights[c] > 0 && heights[c] + b.h / 2 > target) c++;
        col.push(c); heights[c] += b.h;
      }
      return { col, heights };
    };
    let L, bl, dist;
    for (L of layouts) {
      bl = measure(L);
      dist = distribute(bl, L.cols);
      if (Math.max(...dist.heights) <= avail) break;
    }
    let cy = y, row = 0, prevCol = 0;
    const bottoms = [];
    for (const [i, b] of bl.entries()) {
      const col = dist.col[i];
      if (col !== prevCol) { bottoms.push(cy); cy = y; row = 0; prevCol = col; }
      if (cy + b.h > footerY - 3) break;
      const x = M + col * (b.colW + gap);
      const e = b.e, top = isTop(e);
      if (row++ % 2 === 0) { doc.setFillColor(246, 246, 246); doc.rect(x, cy - 0.5, b.colW, b.h - 1, "F"); }
      // Nummer: schwarz gefüllt; Top-Tipp weiß mit Doppelrand (wie auf der Karte)
      const cx = x + 4.2, ccy = cy + b.tl * 0.75;
      if (top) {
        doc.setDrawColor(...INK); doc.setFillColor(255, 255, 255); doc.setLineWidth(0.7); doc.circle(cx, ccy, 3.4, "FD");
        doc.setLineWidth(0.25); doc.circle(cx, ccy, 2.5, "S");
      } else { doc.setFillColor(...INK); doc.circle(cx, ccy, 3.2, "F"); }
      doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); ink(top ? INK : [255, 255, 255]);
      doc.text(String(b.it.no), cx, ccy + 1.05, { align: "center" });
      // Abhak-Kästchen rechts
      doc.setDrawColor(...INK); doc.setLineWidth(0.3); doc.rect(x + b.colW - 5.5, cy + 0.2, 4, 4);
      const tx = x + numW;
      let ly = cy + b.tl * 0.95;
      doc.setFontSize(L.fs + 1); ink(INK); doc.setFont("helvetica", "bold");
      for (const t of b.title) { if (e.url) doc.textWithLink(t, tx, ly, { url: e.url }); else doc.text(t, tx, ly); ly += b.tl; }
      doc.setFontSize(L.fs);
      if (top) {
        doc.setFont("helvetica", "bold"); doc.setLineWidth(0.25);
        const tw = doc.getTextWidth("TOP-TIPP") + 2.4;
        doc.rect(tx, ly - b.lh * 0.8, tw, b.lh * 1.0); doc.text("TOP-TIPP", tx + 1.2, ly - 0.1);
        ly += b.lh;
      }
      const lab = (label, lines, bold = false, italic = false) => {
        if (!lines.length) return;
        doc.setFont("helvetica", "bold"); ink(GREY); doc.text(label, tx, ly);
        doc.setFont("helvetica", italic ? "italic" : bold ? "bold" : "normal"); ink(italic ? GREY : INK);
        for (const t of lines) { doc.text(t, tx + labW(L.fs), ly); ly += b.lh; }
      };
      lab("Wann", b.when, true);
      lab("Wo", b.where);
      lab("Was", b.what);
      if (b.info.length) lab("", b.info, false, true);
      cy += b.h;
      doc.setDrawColor(...RULE); doc.setLineWidth(0.15); doc.line(x, cy - 1.5, x + b.colW, cy - 1.5);
    }

    // ---- Notizen, wenn noch Platz ist ----
    bottoms.push(cy);
    const lastY = Math.max(...bottoms);
    if (footerY - 6 - lastY > 22) {
      let ny = lastY + 5;
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); ink(INK); doc.text("Notizen", M, ny);
      doc.setDrawColor(...RULE); doc.setLineWidth(0.2);
      for (ny += 7; ny < footerY - 5; ny += 7) doc.line(M, ny, PW - M, ny);
    }

    // ---- Fuß ----
    doc.setDrawColor(...INK); doc.setLineWidth(0.3); doc.line(M, footerY - 3.5, PW - M, footerY - 3.5);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.2); ink(GREY);
    doc.text(pdfText(`Flohmarkt-Finder${L$.data?.site_url ? ` · ${L$.data.site_url.replace(/^https?:\/\//, "")}` : ""}`), M, footerY);
    doc.text("Angaben ohne Gewähr · Titel anklicken öffnet die Anzeige · km = Luftlinie ab Start", PW - M, footerY, { align: "right" });

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
  $("#pdfBtn")?.addEventListener("click", () => (S.pdf ? stopPdfMode() : startPdfMode()));
  $("#pdfCancel")?.addEventListener("click", stopPdfMode);
  $("#pdfAll")?.addEventListener("click", () => {
    const list = pdfVisibleList();
    S.pdf.sel = new Set(list.slice(0, PDF_MAX).map((e) => e.id));
    if (list.length > PDF_MAX) toast(`Höchstens ${PDF_MAX} Termine passen auf eine Seite.`);
    render();
  });
  $("#pdfNone")?.addEventListener("click", () => { S.pdf.sel.clear(); render(); });
  $("#pdfMake")?.addEventListener("click", makePdf);
}
