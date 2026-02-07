/* LyricsPocket STABLE SW
   No fetch handler. Clears caches and claims clients.
*/
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    try{
      const keys = await caches.keys();
      await Promise.all(keys.map((k)=>caches.delete(k)));
    }catch(e){}
  })());
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try{
      await self.clients.claim();
      const keys = await caches.keys();
      await Promise.all(keys.map((k)=>caches.delete(k)));
    }catch(e){}
  })());
});
// intentionally no fetch event
