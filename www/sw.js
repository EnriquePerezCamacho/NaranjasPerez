// Guarda la app y los trozos de mapa ya vistos para poder usarla en el campo con poca cobertura.
// Solo se guardan los archivos de la propia app y trozos de mapa medibles (nunca respuestas del servidor de datos).
const APP = 'campcontrol-app-v6';
const TILES = 'campcontrol-mapas-v2';
const MAX_TILES = 3000;
const JS = ['util', 'finca', 'db', 'map', 'notif', 'incidencias', 'parcelas', 'tratamientos', 'recorrido', 'informes', 'backup', 'config', 'sync', 'cuenta', 'main', 'escritorio'];
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './css/app.css', './css/escritorio.css',
  './leaflet/leaflet.css', './leaflet/leaflet.js', ...JS.map(n => `./js/${n}.js`)];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== APP && k !== TILES).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const esMapa = url => /arcgisonline|ign\.es|openstreetmap|opentopomap/.test(url.hostname);
let podando = false;
async function podar(c) {
  if (podando) return; podando = true;
  try { const ks = await c.keys(); if (ks.length > MAX_TILES) await Promise.all(ks.slice(0, ks.length - MAX_TILES).map(k => c.delete(k))); }
  finally { podando = false; }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (esMapa(url)) {
    // Mapas: primero caché; si no, se pide con CORS para poder guardarlo sin que ocupe de más
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(req.url);
      if (hit) return hit;
      try {
        const r = await fetch(req.url, { mode: 'cors', credentials: 'omit' });
        if (r.ok) { c.put(req.url, r.clone()).then(() => podar(c)).catch(() => {}); }
        return r;
      } catch (err) {
        try { return await fetch(req); } catch (e2) { return new Response('', { status: 504 }); }
      }
    }));
    return;
  }

  if (url.origin !== self.location.origin) return; // servidor de datos, fuentes…: sin caché

  // App: red primero (para recibir cambios), caché si no hay conexión.
  e.respondWith(fetch(req).then(r => {
    if (r.ok && r.type === 'basic') { const copy = r.clone(); caches.open(APP).then(c => c.put(req, copy)).catch(() => {}); }
    return r;
  }).catch(() => caches.match(req).then(h => h || caches.match('./index.html'))));
});
