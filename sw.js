/* LyricsPocket PWA - Safe Service Worker (no precache, no hard-fail)
   GitHub Pages subpaths often break precache paths. This SW avoids install failures that can cause blank screens.
*/
const CACHE = "lyricspocket-safe-v1";

self.addEventListener("install", (event) => {
  // Do not precache; just activate ASAP
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // cleanup old caches (optional)
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith("lyricspocket-") && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Network-first passthrough with best-effort cache for GET requests
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      // cache same-origin static files opportunistically
      try {
        const url = new URL(req.url);
        if (url.origin === self.location.origin) {
          const c = await caches.open(CACHE);
          c.put(req, res.clone());
        }
      } catch(_) {}
      return res;
    } catch (e) {
      // offline fallback
      const cached = await caches.match(req);
      if (cached) return cached;
      // final fallback: try cached index for navigation
      if (req.mode === "navigate") {
        const idx = await caches.match("./index.html") || await caches.match("index.html");
        if (idx) return idx;
      }
      throw e;
    }
  })());
});
