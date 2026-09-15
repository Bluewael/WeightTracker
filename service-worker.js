// Minimal offline cache for the app shell. All data lives in IndexedDB
// (+ optional Google Drive sync), so this only needs to cache static files —
// no data ever passes through here.
const CACHE_NAME = 'weighttracker-v1';
const APP_SHELL = [
  './',
  './index.html',
  './css/app.css',
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

// Cache-first for our own static files; everything else (CDN libs, Google
// APIs) goes straight to the network so we never serve a stale third-party
// script or a cached Drive response.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return res;
      });
    })
  );
});
