/* LyricsPocket SWRescue v1
   Intentionally does NOT implement fetch handler (network passthrough).
   Clears Cache Storage to avoid stale assets and takes control immediately.
*/
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    try{
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }catch(e){}
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try{
      await self.clients.claim();
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }catch(e){}
  })());
});

// No fetch event on purpose.
