/* Sum Duel service worker: offline app shell. Bump VERSION on every deploy that changes shell files. */
const VERSION = 'sd-v2.4.0';
const SHELL = ['/', '/app.js', '/icon.svg', '/manifest.webmanifest',
  '/fonts/sd-lmroman-regular.woff2', '/fonts/sd-lmroman-italic.woff2', '/fonts/sd-lmroman-bold.woff2',
  '/fonts/sd-lmroman-caps.woff2', '/fonts/sd-leanmono-regular.woff2', '/fonts/sd-leanmono-bold.woff2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/')) return;               // never cache API
  if (url.pathname.startsWith('/admin')) return;              // admin portal: always network, never cached
  if (url.origin === location.origin) {
    // Network-first for navigations (fresh deploys land immediately), cache fallback offline.
    if (req.mode === 'navigate') {
      // Only the app shell ('/') is stored, so other pages can never overwrite the cached shell.
      e.respondWith(fetch(req).then(r => { if (url.pathname === '/' && r.ok) { const c = r.clone(); caches.open(VERSION).then(x => x.put('/', c)); } return r; })
        .catch(() => caches.match('/')));
      return;
    }
    // Stale-while-revalidate for same-origin assets.
    e.respondWith(caches.open(VERSION).then(c => c.match(req).then(hit => {
      const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    })));
    return;
  }
});
