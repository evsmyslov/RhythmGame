const maxBytes = 60 * 1024 * 1024;
const maxVideoBytes = 180 * 1024 * 1024;
const maxDuration = 10 * 60;
const demoURL = new URL("./assets/neon-pulse.mp3", import.meta.url);

export const difficulties = {
  1: { name: "Легко", stars: "★", approach: 1.95, window: .18 },
  2: { name: "Средне", stars: "★★", approach: 1.55, window: .145 },
  3: { name: "Сложно", stars: "★★★", approach: 1.16, window: .118 }
};

export function streamingReference(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;

  const host = url.hostname.replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  const youtubeHosts = ["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"];
  if (host === "youtu.be" || youtubeHosts.includes(host)) {
    const id = host === "youtu.be" ? parts[0]
      : parts[0] === "watch" ? url.searchParams.get("v")
      : ["shorts", "live", "embed"].includes(parts[0]) ? parts[1] : null;
    if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) {
      return { provider: "YouTube", url: "https://www.youtube.com/watch?v=" + id };
    }
  }
  if (host === "open.spotify.com") {
    if (parts[0]?.startsWith("intl-")) parts.shift();
    if (parts[0] === "track" && /^[A-Za-z0-9]{22}$/.test(parts[1])) {
      return { provider: "Spotify", url: "https://open.spotify.com/track/" + parts[1] };
    }
  }
  if (host === "spotify.link" && parts.length === 1 && /^[A-Za-z0-9_-]{4,64}$/.test(parts[0])) {
    return { provider: "Spotify", url: "https://spotify.link/" + parts[0] };
  }
  return null;
}

export function parseTrackLink(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Вставь полную ссылку на аудио, начиная с https://.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Вставь прямую ссылку на аудио, начинающуюся с https://.");
  }
  if (/(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|spotify\.com|spotify\.link|music\.apple\.com|music\.yandex\.ru|soundcloud\.com)$/i.test(url.hostname)) {
    throw new Error("Нужна ссылка на отдельный трек или видео. Используй прямую ссылку на аудио или загрузи файл с телефона.");
  }
  if (/(^|\.)dropbox\.com$/i.test(url.hostname)) {
    url.searchParams.delete("dl");
    url.searchParams.set("raw", "1");
  }
  return url;
}

export async function prepareTrack({ file, url, demo, difficulty }, signal, update) {
  const video = file && (file.type.startsWith("video/") || (!file.type.startsWith("audio/") && /\.(mp4|mov|m4v|webm)$/i.test(file.name)));
  update(file ? "Читаем файл…" : "Загружаем аудио…");
  const bytes = file ? await readFile(file, video) : await download(demo ? demoURL : url, signal);
  signal.throwIfAborted();
  update(video ? "Извлекаем звуковую дорожку…" : "Разбираем звук…");

  let buffer;
  try {
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    buffer = await new Offline(1, 1, 32000).decodeAudioData(bytes);
  } catch {
    throw new Error(video
      ? "Не удалось прочитать звук из видео. Попробуй MP4 со звуком AAC или аудиофайл MP3."
      : "Не удалось прочитать аудио. Попробуй файл в формате MP3, M4A или WAV.");
  }
  signal.throwIfAborted();
  if (buffer.duration < 1) throw new Error("Выбери аудио длительностью хотя бы одну секунду.");
  if (buffer.duration > maxDuration) throw new Error("Выбери трек длительностью до 10 минут.");

  update("Генерируем ноты…");
  const { notes, accents, climaxes } = await scanAudio(buffer, difficulty, signal);
  if (!notes.length) throw new Error("В этом аудио не нашлось слышимых нот или ударов для уровня.");
  return {
    buffer,
    difficulty,
    notes,
    accents,
    climaxes,
    duration: buffer.duration
  };
}

function readFile(file, video) {
  if (file.size > (video ? maxVideoBytes : maxBytes)) {
    throw new Error(video ? "Выбери видео размером до 180 МБ." : "Выбери аудиофайл размером до 60 МБ.");
  }
  return file.arrayBuffer();
}

async function download(url, signal) {
  const request = new AbortController();
  const cancel = () => request.abort(signal.reason);
  signal.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => request.abort(new DOMException("Загрузка заняла слишком много времени. Попробуй файл с телефона.", "TimeoutError")), 45000);
  try {
    signal.throwIfAborted();
    const response = await fetch(url, { signal: request.signal, credentials: "same-origin" });
    if (!response.ok) throw new Error("Аудио по этой ссылке недоступно. Проверь ссылку или выбери файл.");
    const type = response.headers.get("Content-Type")?.toLowerCase();
    if (type?.includes("text/html") || type?.includes("application/json")) {
      throw new Error("Ссылка ведёт на веб-страницу. Вставь прямую ссылку на аудио или выбери файл.");
    }
    if (Number(response.headers.get("Content-Length")) > maxBytes) {
      throw new Error("Выбери аудиофайл размером до 60 МБ.");
    }
    if (!response.body) {
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > maxBytes) throw new Error("Выбери аудиофайл размером до 60 МБ.");
      return bytes;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) throw new Error("Выбери аудиофайл размером до 60 МБ.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return new Blob(chunks).arrayBuffer();
  } catch (error) {
    if (request.signal.aborted) throw request.signal.reason;
    if (error instanceof TypeError) {
      throw new Error("Браузер не смог загрузить аудио по этой ссылке. Проверь доступ к файлу или загрузи его с телефона.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", cancel);
  }
}

function scanAudio(buffer, difficulty, signal) {
  const first = buffer.getChannelData(0);
  const second = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : first;
  const samples = new Float32Array(Math.floor(first.length / 2));
  for (let i = 0, frame = 0; i < samples.length; i++, frame += 2) {
    samples[i] = (first[frame] + first[frame + 1]) * .35 + (second[frame] + second[frame + 1]) * .15;
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./chart-worker.js?v=5", import.meta.url));
    const cancel = () => finish(reject, signal.reason);
    function finish(settle, data) {
      worker.terminate();
      signal.removeEventListener("abort", cancel);
      settle(data);
    }
    worker.addEventListener("message", ({ data }) => {
      if (data.error) finish(reject, new Error(data.error));
      else finish(resolve, data);
    }, { once: true });
    worker.addEventListener("error", () => {
      finish(reject, new Error("Не удалось запустить анализ аудио. Попробуй открыть игру в обновлённом браузере."));
    }, { once: true });
    signal.addEventListener("abort", cancel, { once: true });
    worker.postMessage({ samples, sampleRate: buffer.sampleRate / 2, difficulty }, [samples.buffer]);
  });
}
