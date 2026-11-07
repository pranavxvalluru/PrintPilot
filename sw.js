/* PrintPilot V1.7 service worker: static shell only; never cache private cloud files. */
const CACHE='printpilot-v17-static-1';
const scope=self.registration.scope;
const files=['./','./index.html','./favicon.svg','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/icon-180.png','./vendor/qrcode.js','./app-v17.js'].map(path=>new URL(path,scope).href);
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(files)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(Promise.all([
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('printpilot-')&&k!==CACHE).map(k=>caches.delete(k)))),
  self.clients.claim()
 ]));
});
self.addEventListener('fetch',event=>{
 const req=event.request;
 if(req.method!=='GET'||new URL(req.url).origin!==self.location.origin)return;
 const url=new URL(req.url),root=new URL(scope);
 if(!url.pathname.startsWith(root.pathname))return;
 if(req.mode==='navigate'){
  event.respondWith(fetch(req).then(response=>{
   if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(new URL('./index.html',scope).href,copy)))}
   return response;
  }).catch(async()=>await caches.match(new URL('./index.html',scope).href)||new Response('PrintPilot is offline. Reconnect to manage orders.',{status:503,headers:{'Content-Type':'text/plain'}})));
  return;
 }
 if(!files.includes(url.href))return;
 event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(response=>{
  if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(req,copy)))}
  return response;
 })));
});

self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const target=new URL('./?view=shop',scope).href;
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
  const existing=windows.find(c=>c.url.startsWith(scope));
  if(existing){await existing.focus();return}
  if(self.clients.openWindow)await self.clients.openWindow(target);
 }));
});
