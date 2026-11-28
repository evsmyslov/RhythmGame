const currentCache = "ritm-v18";
const files = [
  "./", "./index.html", "./styles.css?v=18", "./app.js?v=18", "./audio.js?v=18", "./sound.js?v=18", "./game.js?v=18",
  "./played-tracks.js?v=18", "./chart-spacing.js?v=18", "./settings.js?v=18", "./provider-import.js?v=18", "./mp3-export.js?v=18", "./mp3-worker.js?v=18", "./vendor/lamejs/lame.min.js",
  "./assets/live-room.webp", "./assets/barlow-condensed-extrabold-italic.ttf",
  "./i18n.js?v=18", "./library.js?v=18", "./catalog.js?v=18",
  ...["glass-ferry", "copper-wire", "night-market", "red-shift", "ion-storm"].flatMap(id => ["./assets/tracks/" + id + ".mp3", "./assets/covers/" + id + ".webp"]),
  "./stream-player.js?v=18", "./stream-level.js?v=18", "./track-links.js?v=18", "./palette.js?v=18", "./records.js?v=18", "./timing.js?v=18", "./game-field.js?v=18", "./lane-sprites.js?v=18", "./stage-effects.js?v=18", "./chart-worker.js?v=18", "./manifest.webmanifest?v=18",
  "./assets/aurora-stage.webp", "./assets/dusk-lake.webp", "./assets/spectral-bloom-alpha.webp", "./assets/neon-pulse.mp3", "./assets/night-circuit.mp3",
  "./assets/manrope-latin.woff2", "./assets/manrope-cyrillic.woff2",
  "./assets/icon-192.png?v=18", "./assets/icon-512.png?v=18", "./assets/icon-maskable.png?v=18"
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
