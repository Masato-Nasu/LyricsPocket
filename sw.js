/* LyricsPocket Service Worker (network-only)
   Purpose:
   - Make the site installable as a PWA on desktop browsers (Chrome/Edge).
   - Avoid caching to prevent “old version stuck” issues.
*/
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try { await self.clients.claim(); } catch (e) {}
  })());
});

self.addEventListener("fetch", (event) => {
  // Network-only: no caching.
  event.respondWith(fetch(event.request));
});
