// The AQ Times service worker: makes the app installable and keeps the shell available offline.
const CACHE = 'aq-times-v3';
const SHELL = ['/', '/admin', '/assets/styles.css', '/assets/common.js', '/assets/member.js', '/assets/admin.js', '/manifest.webmanifest', '/apple-touch-icon.png', '/icon-192.png', '/favicon-32.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Network first for our own files (so updates show at once), cache as fallback when offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/')))
  );
});
