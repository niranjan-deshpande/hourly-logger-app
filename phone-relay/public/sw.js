// App-shell cache so the page opens instantly (and offline) from the home
// screen. API calls are never intercepted — entries queue in localStorage
// on the page itself when offline.
const CACHE = 'hl-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon.png'];

self.addEventListener('install', (ev) => {
  ev.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  const url = new URL(ev.request.url);
  if (ev.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  // Network-first with cache fallback: updates flow through when online,
  // the shell still opens when not.
  ev.respondWith(
    fetch(ev.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(ev.request, copy));
        return res;
      })
      .catch(() => caches.match(ev.request, { ignoreSearch: true }))
  );
});
