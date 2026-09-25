/* Service Worker: App offline startbar machen, letzte Termine zwischenspeichern */
const CACHE = "flohmarkt-v1";
const SHELL = ["/", "/static/style.css", "/static/app.js", "/icon.svg", "/manifest.webmanifest",
  "/static/vendor/leaflet/leaflet.js", "/static/vendor/leaflet/leaflet.css"];

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
      if (res.ok && (SHELL.includes(url.pathname) || url.pathname === "/api/events" || url.pathname === "/api/settings")) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
