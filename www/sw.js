// Guarda la app y los trozos de mapa ya vistos para poder usarla en el campo con poca cobertura.
const APP = 'naranjal-app-v1';
const TILES = 'naranjal-mapas-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png',
  './leaflet/leaflet.css', './leaflet/leaflet.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== APP && k !== TILES).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const esMapa = url => /arcgisonline|ign\.es|openstreetmap|opentopomap|catastro/.test(url.hostname);

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (esMapa(url)) {
    // Mapas: primero caché (rápido y sin cobertura), si no, red y se guarda.
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      try { const r = await fetch(req); if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }
      catch (err) { return new Response('', { status: 504 }); }
    }));
    return;
  }

  // App: red primero (para recibir cambios), caché si no hay conexión.
  e.respondWith(fetch(req).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(APP).then(c => c.put(req, copy)); }
    return r;
  }).catch(() => caches.match(req).then(h => h || caches.match('./index.html'))));
});
