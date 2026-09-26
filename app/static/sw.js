/* Service Worker: App offline startbar machen, letzte Termine zwischenspeichern */
const CACHE = "flohmarkt-v4";
const SHELL = ["./", "static/style.css", "static/app.js", "static/pdf.js", "static/mode.js", "icon.svg", "static/icon-192.png", "manifest.webmanifest",
  "static/vendor/leaflet/leaflet.js", "static/vendor/leaflet/leaflet.css"];
const SCOPE = new URL(self.registration.scope).pathname;
const rel = (pathname) => (pathname.startsWith(SCOPE) ? pathname.slice(SCOPE.length) : pathname) || "./";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.endsWith(".ics")) return;
  // Immer zuerst frisch vom Server holen, bei fehlender Verbindung aus dem Zwischenspeicher
  e.respondWith(
    fetch(e.request).then((res) => {
      const p = rel(url.pathname);
      if (res.ok && (SHELL.includes(p) || ["api/events", "api/settings", "data/events.json"].includes(p))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
