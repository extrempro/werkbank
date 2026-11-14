// Service Worker der Werkbank.
// Regeln (docs/spec.md, Kapitel 11):
// - Gecacht werden nur die App-Hülle und die Offline-Seite.
// - Niemals API-Antworten, Anmeldung oder Anhänge (/api, /auth, /health = nur Netzwerk).
// - Jede Version hat einen eigenen Cache, alte Caches werden beim Aktivieren gelöscht.
// - Neue Versionen warten, bis die Oberfläche "Neu laden" anstößt (kein Wechsel mitten in einer Eingabe).

const VERSION = "__WERKBANK_BUILD__";
const CACHE = `werkbank-shell-${VERSION}`;
const SHELL = [
  "/offline.html",
  "/offline.css",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];
const NETWORK_ONLY = [/^\/api\//, /^\/auth\//, /^\/health/];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("werkbank-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  // Nur Nachrichten von Seiten der eigenen Herkunft annehmen
  if (event.origin !== self.location.origin) {
    return;
  }
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  if (NETWORK_ONLY.some((pattern) => pattern.test(url.pathname))) {
    return;
  }

  // Seitenaufrufe: immer aus dem Netz, ohne Netz die Offline-Seite.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match("/offline.html").then((response) => response || Response.error()),
      ),
    );
    return;
  }

  // Statische Dateien mit Versionskennung im Namen und die App-Hülle: aus dem Cache.
  if (url.pathname.startsWith("/assets/") || SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
