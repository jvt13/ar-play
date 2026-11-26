import {BUILD} from './src/build.js';
const CACHE=BUILD.cache;
const FILES=['./','./index.html','./style.css','./src/boot.js','./src/build.js','./src/pwa.js','./src/app.js','./src/ground.js','./src/depth.js','./src/spatial-map.js','./src/collision.js','./src/volume.js','./src/diagnostics.js','./src/revalidation.js','./src/spatial-debug.js','./src/movement-probe.js','./src/math.js','./src/engine.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('ar-play-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('message',e=>{
  if(e.data?.type==='BUILD_INFO')e.ports?.[0]?.postMessage(BUILD);
  if(e.data?.type==='ACTIVATE_UPDATE')e.waitUntil(self.skipWaiting());
});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;
  if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match('./index.html')));return;}
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
