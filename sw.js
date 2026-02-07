/* LyricsPocket SWFIX (self-destruct)
   NOTE: The app does NOT register a Service Worker.
   This file exists only so that if an old/broken SW was registered at ./sw.js,
   it can update to this version, clear caches, then unregister itself.
*/
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try{
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }catch(e){}
    try{ await self.clients.claim(); }catch(e){}
    try{ await self.registration.unregister(); }catch(e){}
  })());
});
