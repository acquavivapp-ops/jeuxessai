const VERSION = 'blue-night-v17-calvi-solid-world';
const ASSETS = ['./', './index.html', './style.css', './app.js', './engine.js', './game-time.js', './police.js', './mobility.js', './mobility-spawns.js', './vegetation.js', './piers.js', './aerial-vehicles.js', './data/calvi-aerial-objects.js', './data/calvi-water-surface.js', './render.js', './imagery-stream.js', './data/calvi-imagery-tiles.json', './assets/aerial/calvi-overview.jpg', './audio.js', './manifest.webmanifest', './assets/icon.svg', './assets/simeoni.svg', './assets/guelfucci.svg', './assets/mitterrand.svg', './assets/pasqua.svg', './assets/blue-night-logo.svg', './assets/victory.svg', './assets/defeat.svg', './assets/corsica-textures.png', './universe.js', './calvi-world.js', './calvi-detail.js', './data/calvi-map.js', './combat.js', './terrain.js', './street-life.js', './data/calvi-elevation.js', './neon-art.js', './assets/ninu.svg', './assets/anto.svg', './effects-art.js', './building-height.js', './data/calvi-building-heights.js', './assets/calvi-orthophoto.jpg', './data/calvi-imagery-provenance.json', './data/calvi-lidar-elevation.js', './data/calvi-lidar-urban-elevation.js', './data/calvi-boundary.geojson'];
self.addEventListener('install', event => { event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('blue-night-') && key !== VERSION).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const aerialRoot = new URL('./assets/aerial/', self.location.href).pathname;
  const highDefinitionTile = url.pathname.startsWith(aerialRoot) && /^(?:calvi-c\d+-r\d+|calvi-detail-(?:urban|airport)-c\d+-r\d+)\.jpg$/.test(url.pathname.slice(aerialRoot.length));
  if (highDefinitionTile) {
    // Only visited HD tiles are cached. No whole-commune image download races
    // with the game; source archives are never part of runtime requests.
    let backgroundWrite = Promise.resolve();
    const responseReady = (async () => {
      let cache = null;
      try { cache = await caches.open(VERSION); const saved = await cache.match(event.request); if (saved) return saved; } catch { /* Storage may be unavailable; the local image still loads. */ }
      try {
        const response = await fetch(event.request);
        if (cache && response.ok) backgroundWrite = cache.put(event.request, response.clone()).catch(() => {});
        return response;
      } catch { return new Response('Image HD indisponible hors ligne.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
    })();
    event.respondWith(responseReady);
    event.waitUntil(responseReady.then(() => backgroundWrite));
    return;
  }
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(VERSION).then(cache => cache.put(event.request, copy))); }
    return response;
  }).catch(async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    return new Response('Ressource indisponible hors ligne.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }));
});
