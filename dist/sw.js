const currentCache = "ritm-v5";
const files = [
  "./", "./index.html", "./styles.css?v=5", "./app.js?v=5", "./audio.js?v=5", "./game.js?v=5",
  "./game-field.js?v=5", "./stage-effects.js?v=5", "./chart-worker.js?v=5", "./manifest.webmanifest?v=5",
  "./assets/cover.webp", "./assets/dusk-lake.webp", "./assets/spectral-bloom.webp", "./assets/neon-pulse.mp3",
  "./assets/manrope-latin.woff2", "./assets/manrope-cyrillic.woff2",
  "./assets/icon-192.png", "./assets/icon-512.png", "./assets/icon-maskable.png"
];
const local = new Set(files.map(path => new URL(path, self.registration.scope).href));

self.addEventListener("install", event => {
  event.waitUntil(caches.open(currentCache).then(cache =>
    cache.addAll(files.map(path => new Request(path, { cache: "reload" })))
  ));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith("ritm-") && key !== currentCache).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  if (event.request.mode === "navigate" && local.has(event.request.url)) {
    event.respondWith(fetch(event.request).catch(() => caches.match("./index.html")));
  } else if (local.has(event.request.url)) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
  }
});
