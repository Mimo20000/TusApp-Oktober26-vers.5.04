// Tus2 by Mimo — PWA service worker
// IMPORTANT: bump SW_VERSION on every release so old caches are purged and
// existing installations receive the new bundle automatically without needing
// to be re-installed. User data (login token in IndexedDB/localStorage) and
// all server-side data (MongoDB) are NOT touched — only the offline cache.
const SW_VERSION = "5.0.0";
const CACHE = `tus2-mimo-${SW_VERSION}`;
const SHELL = ["/", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {})
  );
  // Activate the new worker as soon as it's installed so the update
  // is picked up on the next reload instead of "some day".
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Delete every old cache from previous versions.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      // Take over already-open tabs immediately.
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Never cache API traffic — always fresh.
  if (url.pathname.startsWith("/api/")) return;
  // Network-first for HTML navigations so a new deployment is picked up
  // the moment the user opens the app; fall back to cache offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match("/")))
    );
    return;
  }
  // Cache-first for static assets (JS/CSS/images).
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req)
          .then((res) => {
            if (res && res.status === 200 && res.type === "basic") {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => cached)
    )
  );
});
