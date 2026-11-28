import { t } from "./i18n.js?v=17";

function conversionError() {
  return new Error(t("Не удалось преобразовать трек в MP3.", "Could not convert this track to MP3."));
}

function saveError() {
  return new Error(t("Не удалось сохранить MP3.", "Could not save the MP3."));
}

function cancelled() {
  return new DOMException("Cancelled", "AbortError");
}

export function encodeMp3(buffer, { signal, onProgress } = {}) {
  if (!buffer?.length || !buffer.numberOfChannels) return Promise.reject(conversionError());
  if (signal?.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./mp3-worker.js?v=17", import.meta.url));
    const channels = Math.min(2, buffer.numberOfChannels);
    const input = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const encoded = [];
    // The worker requests one block at a time, so PCM memory stays bounded on a phone.
    const frames = 1152 * 16;
    let offset = 0;
    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => { cleanup(); reject(cancelled()); };
    const fail = () => { cleanup(); reject(conversionError()); };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = fail;
    worker.onmessageerror = fail;
    worker.onmessage = ({ data }) => {
      if (data.type === "failed") { fail(); return; }
      if (data.bytes?.length) encoded.push(data.bytes);
      if (data.type === "done") {
        cleanup();
        onProgress?.(1);
        resolve(new Blob(encoded, { type: "audio/mpeg" }));
        return;
      }
      onProgress?.(offset / buffer.length);
      if (signal?.aborted) return;
      if (offset >= buffer.length) { worker.postMessage({ type: "end" }); return; }
      const end = Math.min(offset + frames, buffer.length);
      const mix = channel => {
        const block = input[channel].slice(offset, end);
        const count = Math.ceil((input.length - channel) / channels);
        for (let c = channel + channels; c < input.length; c += channels) {
          for (let i = 0; i < block.length; i++) block[i] += input[c][offset + i];
        }
        if (count > 1) {
          for (let i = 0; i < block.length; i++) block[i] /= count;
        }
        return block;
      };
      const left = mix(0);
      const right = channels === 2 ? mix(1) : null;
      offset = end;
      worker.postMessage({ type: "samples", left, right }, right ? [left.buffer, right.buffer] : [left.buffer]);
    };
    worker.postMessage({ type: "start", channels, sampleRate: buffer.sampleRate });
  });
}

function filenameFor(value) {
  let name = (value || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").trim().replace(/\.mp3$/i, "").trim();
  if (!name || /^\.+$/.test(name)) name = "Pulsewake";
  return name.slice(0, 100) + ".mp3";
}

let writing = false;

async function androidSave(blob, filename, signal) {
  const port = window.pulsewakeFilePort;
  if (!port || window !== window.top || writing) throw saveError();
  writing = true;
  const id = crypto.randomUUID();
  let waiting;
  const request = message => new Promise((resolve, reject) => {
    waiting = { resolve, reject };
    port.postMessage(JSON.stringify({ ...message, id }));
  });
  const receive = ({ data }) => {
    let response;
    try { response = JSON.parse(data); } catch { return; }
    if (response.id !== id || !waiting) return;
    if (response.status === "ok") waiting.resolve();
    else waiting.reject(response.status === "cancelled" ? cancelled() : saveError());
    waiting = null;
  };
  const abort = () => {
    port.postMessage(JSON.stringify({ type: "cancel", id }));
    waiting?.reject(cancelled());
    waiting = null;
  };
  port.addEventListener("message", receive);
  port.start();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) throw cancelled();
    await request({ type: "begin", filename, size: blob.size });
    // Android WebMessage uses strings. Send small base64 blocks with native acknowledgements.
    for (let offset = 0; offset < blob.size; offset += 49152) {
      const bytes = new Uint8Array(await blob.slice(offset, offset + 49152).arrayBuffer());
      if (signal?.aborted) throw cancelled();
      let binary = "";
      for (let i = 0; i < bytes.length; i += 4096) binary += String.fromCharCode(...bytes.subarray(i, i + 4096));
      await request({ type: "chunk", bytes: btoa(binary) });
    }
    await request({ type: "save" });
  } catch (error) {
    port.postMessage(JSON.stringify({ type: "cancel", id }));
    throw error;
  } finally {
    writing = false;
    signal?.removeEventListener("abort", abort);
    port.removeEventListener("message", receive);
  }
}

export async function saveMp3Blob(blob, { filename, signal } = {}) {
  if (!blob?.size) throw saveError();
  if (signal?.aborted) throw cancelled();
  const name = filenameFor(filename);
  if (location.origin === "https://appassets.androidplatform.net") {
    await androidSave(blob, name, signal);
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  try { link.click(); } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

export async function exportMp3(buffer, options = {}) {
  const blob = await encodeMp3(buffer, options);
  await saveMp3Blob(blob, options);
}
