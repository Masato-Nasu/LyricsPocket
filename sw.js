/* LyricsPocket SAFE SW
   - no fetch handler (so it won't interfere with media/file access)
   - activates immediately; clears old caches
*/
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    try{
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }catch(e){}
  })());
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try{
      await self.clients.claim();
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }catch(e){}
  })());
});
