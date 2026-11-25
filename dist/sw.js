const currentCache = "ritm-v6";
const files = [
  "./", "./index.html", "./styles.css?v=6", "./app.js?v=6", "./audio.js?v=6", "./game.js?v=6",
  "./game-field.js?v=6", "./lane-sprites.js?v=6", "./stage-effects.js?v=6", "./chart-worker.js?v=6", "./manifest.webmanifest?v=6",
  "./assets/cover.webp", "./assets/dusk-lake.webp", "./assets/spectral-bloom-alpha.webp", "./assets/neon-pulse.mp3",
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
