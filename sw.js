const currentCache = "ritm-v10";
const files = [
  "./", "./index.html", "./styles.css?v=10", "./app.js?v=10", "./audio.js?v=10", "./sound.js?v=10", "./game.js?v=10",
  "./records.js?v=10", "./timing.js?v=10", "./game-field.js?v=10", "./lane-sprites.js?v=10", "./stage-effects.js?v=10", "./chart-worker.js?v=10", "./manifest.webmanifest?v=10",
  "./assets/circuit-city.webp", "./assets/dusk-lake.webp", "./assets/spectral-bloom-alpha.webp", "./assets/neon-pulse.mp3", "./assets/night-circuit.mp3",
  "./assets/manrope-latin.woff2", "./assets/manrope-cyrillic.woff2",
  "./assets/icon-192.png", "./assets/icon-512.png", "./assets/icon-maskable.png"
];
const lobbyTrack = new URL("./assets/night-circuit.mp3", self.registration.scope).href;
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
    event.respondWith(cachedAsset(event.request));
  }
});

async function cachedAsset(request) {
  const cached = await caches.match(request);
  if (!cached) return fetch(request);
  if (request.url !== lobbyTrack || !request.headers.has("Range")) return cached;

  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("Range"));
  if (!range || (!range[1] && !range[2])) return fetch(request);
  const blob = await cached.blob();
  const size = blob.size;
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const last = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
  if (!Number.isSafeInteger(start) || last < start || start >= size) {
    return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + size } });
  }
  return new Response(blob.slice(start, last + 1), {
    status: 206,
    headers: {
      "Content-Type": cached.headers.get("Content-Type") || "audio/mpeg",
      "Content-Range": "bytes " + start + "-" + last + "/" + size,
      "Content-Length": String(last - start + 1),
      "Accept-Ranges": "bytes"
    }
  });
}
