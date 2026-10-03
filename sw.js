// WORLD PIXEL service worker.
// Caches the app shell only. Provider data and geocoding are never cached, so the app can't
// show stale providers or pretend live search works offline.
const VERSION = 'wp-shell-v2';
const SHELL = [
  './', 'index.html', 'offline.html', 'manifest.webmanifest', 'styles.css',
  'app.js', 'config.js', 'modules.js', 'dom.js', 'icons.js', 'ui.js', 'pwa.js',
  'location.js', 'geocoding.js', 'providers.js', 'distance.js', 'search.js',
  'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon-32.png'
];
const DATA_FILES = ['providers.json', 'locations.json', 'providers.test.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;   // geocoder etc. pass through
  if (DATA_FILES.some((f) => url.pathname.endsWith('/' + f))) return;       // provider data is always live

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('index.html').then((r) => r || caches.match('offline.html')))
    );
    return;
  }
  // Shell assets: network first so deploys show up, cache when offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
