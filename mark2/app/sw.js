// Service worker "network-first": prende sempre dalla rete, usa la copia solo offline.
// A OGNI VERSIONE NUOVA cambia VERSION (e anche CONFIG.VERSION in config.js), altrimenti i telefoni tengono la vecchia.
const VERSION = "mark2-v7";
const SHELL = ["./", "index.html", "style.css", "app.js", "config.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "brain.js", "stars.js", "voice.js", "listen.js", "widgets.js"];

self.addEventListener("install", (e) =>
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));

self.addEventListener("activate", (e) =>
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("mark2-") && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Le chiamate al Worker (/api/…) non passano di qui: dati sempre freschi e mai salvati.
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request)));
});
