const CACHE="lyricspocket-androidnextfix-v1";
const SHELL=["./","./index.html","./styles.css","./app.js","./manifest.webmanifest","./icons/icon-192.png","./icons/icon-512.png"];
self.addEventListener("install",(e)=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).catch(()=>{}));});
self.addEventListener("activate",(e)=>{e.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.map(k=>k===CACHE?null:caches.delete(k)));await self.clients.claim();})());});
self.addEventListener("fetch",(e)=>{
  const r=e.request;
  if(r.method!=="GET") return;
  const u=new URL(r.url);
  if(r.mode==="navigate"){
    e.respondWith((async()=>{try{return await fetch(r);}catch(_){return (await caches.match("./index.html"))||Response.error();}})());
    return;
  }
  // app.js network-first to avoid stale broken cache
  if(u.pathname.endsWith("/app.js")){
    e.respondWith((async()=>{try{const f=await fetch(r,{cache:"no-store"});(await caches.open(CACHE)).put(r,f.clone()).catch(()=>{});return f;}catch(_){return (await caches.match(r))||fetch(r);}})());
    return;
  }
  e.respondWith(caches.match(r).then(c=>c||fetch(r)));
});
