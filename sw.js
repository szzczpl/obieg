/* Obieg – działanie jak aplikacja: szybkie ładowanie i podstawowy tryb offline */
const VERSION = 'obieg-v2';
const CORE = ['./', 'index.html', 'katalog.html', 'oferta.html', 'profil.html', 'ulubione.html', 'wystaw.html', 'konto.html', 'logowanie.html',
  'style.css', 'app.js', 'db.js', 'config.js', 'consts.js', 'apple-touch-icon.png', 'icon-512.png', 'manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => !x.startsWith(VERSION)).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Własne pliki: najpierw sieć (zawsze aktualne), pamięć podręczna tylko bez internetu
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(res => { const c = res.clone(); caches.open(VERSION).then(x => x.put(req, c)); return res; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
    return;
  }
  // Zdjęcia ofert i fonty: najpierw pamięć podręczna. Dane z bazy (API) zawsze z sieci.
  if (/\/storage\/v1\/object\/public\/|images\.unsplash\.com|fonts\.(googleapis|gstatic)\.com/.test(url.href)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { const c = res.clone(); caches.open(VERSION + '-media').then(x => x.put(req, c)); return res; })));
  }
});
