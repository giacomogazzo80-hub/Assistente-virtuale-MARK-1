// Tiene l'app disponibile anche offline. Cambia VERSION per forzare l'aggiornamento.
const VERSION = "mark1-v11";
const SHELL = ["./", "index.html", "style.css", "app.js", "brain.js", "stars.js", "vendor/anthropic.js", "google.js", "config.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
// Solo i file dell'app: rete prima (così gli aggiornamenti arrivano subito), cache se offline.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request)));
});
