// Sakay Laguna service worker (website only; the Android app has its files
// built in). Saves mobile data by keeping on the phone:
//   - the app's own files (each version has a unique name, so cache forever),
//   - map tiles, fonts and icons from OpenFreeMap (tiles are versioned too),
// and always fetching live data (jeepneys, search, AI, account) fresh.
const VERSION = 'v1';
const APP = `sakay-app-${VERSION}`;
const MAP = 'sakay-map-v1';
const MAX_MAP_ITEMS = 2500; // a few MB: the whole route area at every zoom, many times over
const MAX_APP_ITEMS = 80;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP)
      .then((c) => c.addAll(['/', '/manifest.webmanifest', '/logo.svg', '/icon-192.png']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('sakay-') && k !== APP && k !== MAP).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Keep a cache from growing forever: drop the oldest entries.
async function trim(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

let puts = 0;
async function cacheFirst(request, name, max) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    cache.put(request, res.clone());
    if (++puts % 40 === 0) trim(name, max);
  }
  return res;
}

// Answer from the phone right away, and refresh it in the background.
async function staleWhileRevalidate(request, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  const update = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => hit);
  return hit ?? update;
}

// Pages: the newest version when online, the saved one when offline.
async function networkFirst(request) {
  const cache = await caches.open(APP);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put('/', res.clone());
    return res;
  } catch {
    return (await cache.match('/')) ?? Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/')) return; // AI: always live
    if (request.mode === 'navigate') return event.respondWith(networkFirst(request));
    if (url.pathname.startsWith('/assets/')) return event.respondWith(cacheFirst(request, APP, MAX_APP_ITEMS));
    if (url.pathname === '/sw.js') return;
    return event.respondWith(staleWhileRevalidate(request, APP));
  }

  if (url.hostname === 'tiles.openfreemap.org') {
    // Tiles live under a dated folder, fonts and icons never change in place.
    if (/\/planet\/[^/]+\/\d+\/\d+\/\d+\.pbf$/.test(url.pathname) || url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/sprites/') || url.pathname.startsWith('/natural_earth/')) {
      return event.respondWith(cacheFirst(request, MAP, MAX_MAP_ITEMS));
    }
    // The style and the tile list can change (new map data): refresh quietly.
    return event.respondWith(staleWhileRevalidate(request, MAP));
  }
  // Everything else (live jeepneys, accounts, search, directions): network only.
});
