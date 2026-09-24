// Assisto service worker — REFERENCE. Reconcile with your deployed sw.js: the page
// already speaks this worker's protocol (it posts 'refresh' before an update and
// registers with updateViaCache 'none'), but if your real worker precaches more than
// the shell, carry those paths over.
//
// The strategy in one line: THE GAME IS FETCHED FROM THE NETWORK FIRST and the cache
// is the fallback, not the source. An online launch therefore always plays the build
// on the server — "latest all the time" — and an offline launch still opens the last
// build that worked. Static assets (icons, manifest) are cache-first; they change
// rarely and never decide gameplay.
//
// CACHE is stamped per deployment. Your build script should restamp the string below
// the same way it restamps BUILD in the HTML — a byte-different sw.js is ALSO what
// makes the browser consider it a new worker at all.
const CACHE = 'assisto-2026-09-24-1930';
const SHELL = './';

self.addEventListener('install', e => {
  // Take over as soon as installed. Waiting politely is for apps with in-flight
  // server sessions; this game keeps its state in localStorage and its matches in
  // Firebase, so an old worker has nothing a new one must not interrupt — and
  // without this, a reload keeps the OLD worker in charge until every window closes,
  // which on an installed app can be days.
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.add(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for(const k of await caches.keys()) if(k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// The page sends 'refresh' when the player applies an update: drop everything, so
// the reload that follows cannot be answered from a stale cache.
self.addEventListener('message', e => {
  if(e.data === 'refresh')
    e.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.origin !== location.origin) return;   // Firebase and CDNs manage themselves

  // Navigations: network first, cache as the offline fallback. The network copy
  // refreshes the fallback on every successful launch.
  if(req.mode === 'navigate'){
    e.respondWith((async () => {
      try{
        const net = await fetch(req);
        const c = await caches.open(CACHE);
        c.put(SHELL, net.clone()).catch(() => {});
        return net;
      }catch(err){
        const hit = await caches.match(SHELL);
        return hit || Response.error();
      }
    })());
    return;
  }

  // Everything else same-origin (icons, manifest): cache first, filled on first use.
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if(hit) return hit;
    const net = await fetch(req);
    if(net && net.ok){
      const c = await caches.open(CACHE);
      c.put(req, net.clone()).catch(() => {});
    }
    return net;
  })());
});
