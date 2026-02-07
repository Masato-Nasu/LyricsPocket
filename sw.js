// LyricsPocket PWA service worker (robust, avoid white-screen)
const CACHE = "lyricspocket-pwa-rebuild-swfix-v1";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // delete old caches
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k === CACHE ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

// Optional: allow page to force activate the new SW
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

function isAppShellRequest(req) {
  const url = new URL(req.url);
  const p = url.pathname;
  return (
    p.endsWith("/index.html") ||
    p.endsWith("/styles.css") ||
    p.endsWith("/app.js") ||
    p.endsWith("/manifest.webmanifest") ||
    p.endsWith("/sw.js") ||
    p.includes("/icons/")
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Navigation: try network first, fallback to cached index.html
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put("./index.html", fresh.clone()).catch(() => {});
        return fresh;
      } catch (_) {
        const cached = await caches.match("./index.html");
        return cached || Response.error();
      }
    })());
    return;
  }

  // App shell assets: network-first for app.js to avoid stale-broken cache
  if (isAppShellRequest(req)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
      } catch (_) {
        const cached = await caches.match(req);
        return cached || fetch(req);
      }
    })());
    return;
  }

  // Other assets: cache-first
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
