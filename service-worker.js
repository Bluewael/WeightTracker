// Minimal offline cache for the app shell. All data lives in IndexedDB
// (+ optional Google Drive sync), so this only needs to cache static files —
// no data ever passes through here.
const CACHE_NAME = 'weighttracker-v3';
const APP_SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/version.js',
  './js/utils.js',
  './js/db.js',
  './js/weight.js',
  './js/backup.js',
  './js/sync.js',
  './js/app.js',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for our own static files, falling back to cache only when
// offline — everything else (CDN libs, Google APIs) goes straight to the
// network so we never serve a stale third-party script or a cached Drive
// response. A cache-first strategy previously served stale app files (and a
// stale version footer!) for as long as the SW script itself hadn't changed
// byte-for-byte, even after a fresh deploy — network-first means an online
// user always gets the latest deploy, and the cache is purely an offline
// fallback.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return res;
    }).catch(() => caches.match(event.request))
  );
});
