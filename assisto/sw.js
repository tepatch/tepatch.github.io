// Assisto's service worker.
//
// Two jobs, and the second matters more than the first.
//
// It makes the game playable with no connection, which is most of what an installed
// icon promises: a tap opens a pitch, on a train, straight away.
//
// And it must never hand back yesterday's build. A cached game is a game frozen at the
// version it was cached on, and this one checks its own build against the opponent's
// before an online match and against the gameplay tag before ranking a run — a stale
// copy does not misbehave quietly, it refuses to play. So the page itself is fetched
// from the network first and only falls back to the cache; everything else, which is
// content-addressed by its own name, is served from the cache and refreshed behind.
const VERSION = 'assisto-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  // Ready on the first visit, so an install that happens straight after a first match
  // already has something to open.
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.allSettled(SHELL.map(u => cache.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for(const key of await caches.keys()) if(key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;

  const url = new URL(req.url);

  // Anything that is not ours — the database, the Firebase SDK — is left entirely
  // alone. Caching a socket or an auth call would be worse than useless.
  if(url.origin !== self.location.origin) return;

  const isPage = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if(isPage){
    // network first: a build one version old refuses to play against a current one,
    // so a stale page is a broken game rather than an old one
    e.respondWith((async () => {
      try{
        const fresh = await fetch(req);
        const cache = await caches.open(VERSION);
        cache.put('./index.html', fresh.clone());
        return fresh;
      }catch(err){
        const cache = await caches.open(VERSION);
        return (await cache.match(req)) ||
               (await cache.match('./index.html')) ||
               (await cache.match('./')) ||
               new Response('Assisto needs a connection the first time.',
                 { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  // everything else: from the cache, and refreshed behind for next time
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req);
    const net = fetch(req).then(res => {
      if(res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return hit || (await net) || new Response('', { status: 504 });
  })());
});

// The page asks for this when its own build stamp does not match what was cached, so
// a player is never stuck on an old copy with no way to say so.
self.addEventListener('message', e => {
  if(e.data === 'refresh')
    e.waitUntil(caches.delete(VERSION).then(() => self.skipWaiting()));
});
