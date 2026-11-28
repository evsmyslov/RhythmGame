import { catalog } from "./catalog.js?v=18";
import { difficulties } from "./audio.js?v=18";
import { parseTrackLink, streamingReference } from "./track-links.js?v=18";
import { t } from "./i18n.js?v=18";

const item = id => document.getElementById(id);
let connection;

function linkTitle(reference) {
  const url = new URL(reference.url);
  let label = url.pathname.split("/").filter(Boolean).pop() || url.hostname;
  try { label = decodeURIComponent(label); } catch { /* Keep the original filename. */ }
  return reference.provider === "YouTube" ? "YouTube · " + reference.id : label;
}

function previousTracks() {
  const entries = new Map();
  // Earlier score records retained catalog IDs and player links, but no local audio bytes.
  for (let i = 0; i < localStorage.length; i++) {
    const match = /^ritm-best-v1:(.+):([1-5])$/.exec(localStorage.key(i));
    if (!match) continue;
    const [, songId, level] = match;
    const difficulty = Number(level);
    const map = catalog.find(m => m.id === songId || m.id + "-v2" === songId);
    let entry;
    if (map) entry = { key: "map:" + map.id, kind: "map", map: map.id, title: map.title, difficulty: map.difficulty };
    else if (songId === "neon-pulse" || songId === "neon-pulse-v2") {
      entry = { key: "demo", kind: "demo", title: "Neon Pulse", difficulty };
    } else {
      const clock = /^(?:v2\|)?(https:\/\/.+)\|([\d.]+)\|([\d.]+)\|\d+$/.exec(songId);
      if (!clock) continue;
      let url;
      try { url = parseTrackLink(clock[1]); } catch { continue; }
      const reference = streamingReference(url.href) || { provider: "Аудио", url: url.href };
      entry = { key: "stream:" + reference.url, kind: "stream", reference, difficulty,
        title: linkTitle(reference), bpm: Number(clock[2]), phase: Number(clock[3]) };
    }
    entries.set(entry.key, { ...entry, lastPlayed: 0 });
  }
  return entries.values();
}

function database() {
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open("pulsewake-played", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const entries = db.createObjectStore("entries", { keyPath: "key" });
      db.createObjectStore("audio");
      try { for (const entry of previousTracks()) entries.put(entry); } catch { /* Previous records are optional. */ }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); connection = null; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  }).catch(error => { connection = null; throw error; });
  return connection;
}

async function read(store, key) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const table = db.transaction(store).objectStore(store);
    const request = key === undefined ? table.getAll() : table.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function write(change) {
  const db = await database();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(["entries", "audio"], "readwrite");
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || new Error("library transaction aborted"));
    try { change(tx.objectStore("entries"), tx.objectStore("audio")); }
    catch (error) { tx.abort(); reject(error); }
  });
}

export const readPlayedAudio = key => read("audio", key);

export function bindPlayedTracks(openTrack) {
  const list = item("played-list");
  const status = item("played-status");
  let generation = 0;
  let opening = null;
  let saveFailed = false;

  function sourceLabel(entry) {
    if (entry.kind === "map") return t("Карта", "Built-in");
    if (entry.kind === "demo") return t("Демо", "Demo");
    if (entry.reference) return t(entry.reference.provider);
    return entry.provider || t("На устройстве", "On device");
  }

  async function refresh() {
    const current = ++generation;
    if (document.body.dataset.menu !== "history" || !item("game").hidden) return;
    try {
      const entries = await read("entries");
      if (current !== generation || !item("game").hidden) return;
      entries.sort((a, b) => b.lastPlayed - a.lastPlayed || a.title.localeCompare(b.title));
      const content = document.createDocumentFragment();
      for (const entry of entries) {
        const row = document.createElement("li");
        const play = document.createElement("button");
        play.type = "button";
        play.className = "history-play";
        const name = document.createElement("strong");
        name.textContent = entry.title;
        const detail = document.createElement("small");
        detail.textContent = [sourceLabel(entry), entry.preview ? t("Фрагмент", "Preview") : "",
          entry.bpm ? entry.bpm + " BPM" : ""].filter(Boolean).join(" · ");
        play.append(name, detail);
        const level = document.createElement("label");
        level.className = "history-level";
        const caption = document.createElement("span");
        caption.textContent = t("Сложность");
        const select = document.createElement("select");
        select.setAttribute("aria-label", caption.textContent + " · " + entry.title);
        for (const [value, difficulty] of Object.entries(difficulties)) {
          select.add(new Option(value + "★ · " + t(difficulty.name), value));
        }
        select.value = String(entry.difficulty);
        level.append(caption, select);
        play.onclick = async () => {
          opening?.abort();
          const controller = opening = new AbortController();
          play.disabled = true;
          select.disabled = true;
          status.textContent = t("Загрузка…", "Loading…");
          try {
            await openTrack({ ...entry, difficulty: Number(select.value) }, controller.signal, play);
            if (!controller.signal.aborted) status.textContent = "";
          } catch {
            if (!controller.signal.aborted) status.textContent = t("Не удалось открыть трек. Попробуй ещё раз.", "Could not open the track. Try again.");
          } finally {
            if (opening === controller) opening = null;
            play.disabled = false;
            select.disabled = false;
          }
        };
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "history-remove";
        remove.textContent = "×";
        remove.setAttribute("aria-label", t("Удалить из библиотеки", "Remove from library") + " · " + entry.title);
        remove.onclick = async () => {
          if (!window.confirm(t("Удалить трек из библиотеки?", "Remove this track from your library?") + " " + entry.title)) return;
          opening?.abort();
          try {
            await write((entries, audio) => { entries.delete(entry.key); audio.delete(entry.key); });
            await refresh();
          } catch { status.textContent = t("Не удалось удалить трек.", "Could not remove the track."); }
        };
        row.append(play, level, remove);
        content.append(row);
      }
      list.replaceChildren(content);
      status.textContent = saveFailed ? t("Не удалось сохранить последний трек. Проверь свободное место.", "Could not save the last track. Check your free storage.")
        : entries.length ? "" : t("Здесь появятся треки, в которые ты сыграешь.", "Tracks you play will appear here.");
    } catch {
      if (current === generation) status.textContent = t("Хранилище библиотеки недоступно.", "Library storage is unavailable.");
    }
  }

  document.addEventListener("pulsewake-menu", () => { opening?.abort(); refresh(); });
  document.addEventListener("languagechange", () => { list.replaceChildren(); refresh(); });
  return async (track, stream) => {
    try {
      const reference = track.reference;
      const source = track.historyEntry;
      let entry;
      if (track.id) entry = { key: "map:" + track.id, kind: "map", map: track.id, title: track.title };
      else if (reference) {
        entry = { key: "stream:" + reference.url, kind: "stream", reference,
          title: stream?.player?.title?.() || source?.title || track.title || linkTitle(reference),
          bpm: stream.tempo.valueAsNumber, phase: stream.phase };
      } else entry = source;
      if (!entry) return;
      const record = { ...entry, difficulty: track.difficulty, lastPlayed: Date.now() };
      await write((entries, audio) => {
        if (track.originalAudio) audio.put(track.originalAudio, record.key);
        entries.put(record);
      });
      track.originalAudio = null;
      saveFailed = false;
    } catch { saveFailed = true; }
    refresh();
  };
}
