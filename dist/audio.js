import { linkedMedia } from "./track-links.js?v=15";

const maxBytes = 60 * 1024 * 1024;
const maxVideoBytes = 180 * 1024 * 1024;
export const maxDuration = 10 * 60;
const demoURL = new URL("./assets/neon-pulse.mp3", import.meta.url);

export const difficulties = {
  1: { name: "Легко", stars: "★", approach: 1.95, window: .25, perfectWindow: .083, slideGrace: .18 },
  2: { name: "Средне", stars: "★★", approach: 1.55, window: .225, perfectWindow: .067, slideGrace: .15 },
  3: { name: "Сложно", stars: "★★★", approach: 1.24, window: .20, perfectWindow: .054, slideGrace: .15 },
  4: { name: "Эксперт", stars: "★★★★", approach: 1.12, window: .18, perfectWindow: .046, slideGrace: .15 },
  5: { name: "Мастер", stars: "★★★★★", approach: 1.02, window: .165, perfectWindow: .041, slideGrace: .15 }
};

export async function prepareTrack({ file, url, demo, difficulty }, signal, update) {
  const video = file && (file.type.startsWith("video/") || (!file.type.startsWith("audio/") && /\.(mp4|mov|m4v|webm)$/i.test(file.name)));
  update(file ? "Читаем файл…" : "Загружаем аудио…");
  const media = file ? await readFile(file, video) : await download(demo ? demoURL : url, signal);
  if (media.reference) return { ...media, difficulty };
  const bytes = media;
  signal.throwIfAborted();
  const paletteId = await fingerprint(bytes);
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
  const { notes, accents, climaxes, brightness } = await scanAudio(buffer, difficulty, signal);
  if (!notes.length) throw new Error("В этом аудио не нашлось слышимых нот или ударов для уровня.");
  return {
    buffer,
    songId: demo ? "neon-pulse" : paletteId,
    paletteId,
    difficulty,
    notes,
    accents,
    climaxes,
    brightness,
    duration: buffer.duration
  };
}

async function fingerprint(buffer) {
  const bytes = new Uint8Array(buffer);
  const size = Math.min(16384, bytes.length);
  const sample = new Uint8Array(8 + size * 3);
  new DataView(sample.buffer).setFloat64(0, bytes.length);
  const middle = Math.floor((bytes.length - size) / 2);
  sample.set(bytes.subarray(0, size), 8);
  sample.set(bytes.subarray(middle, middle + size), 8 + size);
  sample.set(bytes.subarray(bytes.length - size), 8 + size * 2);
  const digest = await crypto.subtle.digest("SHA-256", sample);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
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
    let address = url;
    let response;
    for (let page = 0; page < 2; page++) {
      try {
        response = await fetch(address, { signal: request.signal, credentials: "same-origin" });
      } catch (error) {
        if (error instanceof TypeError && address.origin !== location.origin && !request.signal.aborted) {
          // A media element can play many cross-origin files whose bytes the browser cannot read.
          return { reference: { provider: "Аудио", url: address.href } };
        }
        throw error;
      }
      if (!response.ok || !response.headers.get("Content-Type")?.includes("text/html")) break;
      if (page === 1) throw new Error("На странице не нашлось доступной звуковой дорожки.");
      const html = await readBytes(response, 2 * 1024 * 1024, "Страница с треком слишком большая.");
      address = linkedMedia(new TextDecoder().decode(html), response.url);
      if (!address) throw new Error("На странице не нашлось аудио. Вставь ссылку на отдельный трек или выбери файл.");
    }
    if (!response.ok) throw new Error("Аудио по этой ссылке недоступно. Проверь ссылку или выбери файл.");
    const type = response.headers.get("Content-Type")?.toLowerCase();
    if (type?.includes("text/html") || type?.includes("application/json")) {
      throw new Error("Ссылка ведёт на веб-страницу. Вставь прямую ссылку на аудио или выбери файл.");
    }
    const limit = type?.startsWith("video/") ? maxVideoBytes : maxBytes;
    return await readBytes(response, limit, limit === maxVideoBytes ? "Выбери видео размером до 180 МБ." : "Выбери аудиофайл размером до 60 МБ.");
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

async function readBytes(response, limit, tooLarge) {
  if (Number(response.headers.get("Content-Length")) > limit) {
    throw new Error(tooLarge);
  }
  if (!response.body) {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > limit) throw new Error(tooLarge);
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
      if (total > limit) throw new Error(tooLarge);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return new Blob(chunks).arrayBuffer();
}

function scanAudio(buffer, difficulty, signal) {
  const first = buffer.getChannelData(0);
  const second = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : first;
  const samples = new Float32Array(Math.floor(first.length / 2));
  for (let i = 0, frame = 0; i < samples.length; i++, frame += 2) {
    samples[i] = (first[frame] + first[frame + 1]) * .35 + (second[frame] + second[frame + 1]) * .15;
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./chart-worker.js?v=15", import.meta.url));
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
