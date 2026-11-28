import { catalog } from "./catalog.js?v=17";
import { bindPlayedTracks, readPlayedAudio } from "./played-tracks.js?v=17";
import { bindLibrary, loadMap } from "./library.js?v=17";
import { initLanguage, t } from "./i18n.js?v=17";
import { decodeTrack, chartTrack } from "./audio.js?v=17";
import { parseTrackLink, streamingReference } from "./track-links.js?v=17";
import { RhythmGame } from "./game.js?v=17";
import { LobbyMusic } from "./sound.js?v=17";
import { bindCalibration } from "./timing.js?v=17";

import { bindSettings } from "./settings.js?v=17";
import { providerReference, resolveProvider } from "./provider-import.js?v=17";
import { exportMp3 } from "./mp3-export.js?v=17";

initLanguage();

const item = id => document.getElementById(id);
const form = item("setup");
const trackURL = item("track-url");
const trackFile = item("track-file");
const startGeneration = item("generate-button");
const demoButton = item("demo-button");
const fileButton = item("file-button");
const fileTag = item("file-tag");
const removeFile = item("remove-file");
const errorMessage = item("source-error");
const home = item("home");
const gameScreen = item("game");
const nativeApp = location.hostname === "appassets.androidplatform.net";
document.documentElement.classList.toggle("native-app", nativeApp);
let androidPaused = false;
const game = new RhythmGame(enterLandscape, bindPlayedTracks(replaySaved));
const lobbyMusic = new LobbyMusic(item("lobby-music"), item("lobby-music-button"));
bindSettings(game, item("lobby-music"));
const fullscreenButton = item("fullscreen-button");
fullscreenButton.hidden = nativeApp || !document.fullscreenEnabled || !gameScreen.requestFullscreen;
let fullscreenNoticeTimer = null;
let landscapeRequest;

function enterLandscape() {
  if (nativeApp) return;
  if (!gameScreen.classList.contains("mobile-play") || !screen.orientation?.lock || landscapeRequest) return;
  landscapeRequest = lockLandscape().finally(() => { landscapeRequest = null; });
}

async function lockLandscape() {
  try {
    if (!standalone && !document.fullscreenElement && document.fullscreenEnabled && gameScreen.requestFullscreen) {
      await gameScreen.requestFullscreen();
    }
    if (!gameScreen.hidden) await screen.orientation.lock("landscape");
    if (gameScreen.hidden && document.fullscreenElement === gameScreen) await document.exitFullscreen();
  } catch { /* The game layout rotates when the browser keeps the screen in portrait. */ }
}

fullscreenButton.addEventListener("click", async () => {
  const notice = item("fullscreen-notice");
  notice.hidden = true;
  clearTimeout(fullscreenNoticeTimer);
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else {
      await gameScreen.requestFullscreen();
      enterLandscape();
    }
  } catch {
    notice.hidden = false;
    fullscreenNoticeTimer = setTimeout(() => { notice.hidden = true; }, 3600);
  }
});
document.addEventListener("fullscreenchange", () => {
  const fullscreen = document.fullscreenElement === gameScreen;
  const label = t(fullscreen ? "Выйти из полноэкранного режима" : "Во весь экран");
  fullscreenButton.setAttribute("aria-label", label);
  fullscreenButton.title = label;
  fullscreenButton.querySelector("use").setAttribute("href", fullscreen ? "#i-minimize" : "#i-fullscreen");
});
const homeHash = location.hash === "#play" ? "" : location.hash;
let job = null;
let file = null;
let choice = null;
const referenceOf = value => streamingReference(value) || providerReference(value);
let returnFocus = startGeneration;

const difficultyHints = [
  "Размеренный ритм и короткие удержания.",
  "Чередование рук и переходы между дорожками.",
  "Переборы, двойные ноты и слайды с поворотом.",
  "Быстрые проходы по четырём дорожкам и двойные ноты.",
  "Смены рук, короткие окна попаданий и длинные маршруты слайдов."
];
const difficultyControl = form.elements.namedItem("difficulty");
function describeDifficulty() {
  item("difficulty-detail").textContent = t(difficultyHints[Number(difficultyControl.value) - 1]);
}
form.addEventListener("change", event => {
  if (event.target.name === "difficulty") describeDifficulty();
});
describeDifficulty();
document.addEventListener("languagechange", () => {
  describeDifficulty();
  updateStreamingSource();
  if (choice) renderChoice();
  if (game.phase === "paused") game.showReady(true, false);
});

bindCalibration(() => {
  if (job || (!gameScreen.hidden && game.phase !== "paused")) return false;
  lobbyMusic.setInLobby(false);
}, offset => {
  game.timingOffset = offset;
  if (gameScreen.hidden && !androidPaused) lobbyMusic.setInLobby(true);
});

if (location.hash === "#play") history.replaceState(null, "", location.pathname + location.search);

function setError(message = "", onLink = false) {
  errorMessage.textContent = t(message);
  errorMessage.hidden = !message;
  if (message && onLink) trackURL.setAttribute("aria-invalid", "true");
  else trackURL.removeAttribute("aria-invalid");
}

function updateStreamingSource() {
  item("clear-url").hidden = !trackURL.value;
  const reference = referenceOf(trackURL.value.trim());
  item("streaming-source").hidden = !reference;
  if (!reference) return;
  const link = item("streaming-link");
  link.href = reference.url;
  link.querySelector("span").textContent = t("Открыть в ", "Open in ") + reference.provider;
  const hint = item("streaming-hint");
  hint.hidden = Boolean(file);
  hint.textContent = reference.provider === "YouTube" ? t("Трек откроется в плеере. Темп можно задать перед игрой.")
    : t("Проверим, какое аудио доступно по этой ссылке. Для полной версии можно выбрать свой файл.",
        "We’ll check the audio available for this link. You can also choose your own full recording.");
}

function setFile(selected) {
  resetImport();
  file = selected;
  if (!selected) trackFile.value = "";
  if (selected && !referenceOf(trackURL.value.trim())) trackURL.value = "";
  fileTag.hidden = !selected;
  fileButton.hidden = Boolean(selected);
  item("file-name").textContent = selected?.name ?? "";
  updateStreamingSource();
}

fileButton.addEventListener("click", () => trackFile.click());
trackFile.addEventListener("change", () => {
  if (!trackFile.files.length) return;
  setError();
  setFile(trackFile.files[0]);
});

removeFile.addEventListener("click", () => {
  setError();
  setFile(null);
  fileButton.focus();
});

function resetImport() {
  choice = null;
  item("source-choice").hidden = true;
  item("import-result").textContent = "";
}
item("clear-url").onclick = () => {
  trackURL.value = "";
  trackURL.dispatchEvent(new Event("input"));
  trackURL.focus();
};
trackURL.addEventListener("input", () => {
  resetImport();
  setError();
  updateStreamingSource();
});
trackURL.addEventListener("change", clearFileForDirectLink);

function clearFileForDirectLink() {
  const value = trackURL.value.trim();
  if (file && value && !referenceOf(value)) setFile(null);
}

item("paste-button").addEventListener("click", async () => {
  try {
    const value = await navigator.clipboard.readText();
    if (job) return;
    if (value.trim()) {
      trackURL.value = value.trim();
      resetImport();
      clearFileForDirectLink();
      updateStreamingSource();
      setError();
    } else {
      setError("В буфере обмена нет ссылки.");
    }
  } catch {
    if (!job && !trackURL.value) setError("Нажми и удерживай поле, чтобы вставить ссылку.");
  }
  if (!job) trackURL.focus();
});

form.addEventListener("submit", event => {
  event.preventDefault();
  generate(false);
});

demoButton.addEventListener("click", () => generate(true));

item("download-mp3").onclick = () => generate(false, "save");
item("play-provider").onclick = () => { if (choice) generate(false, choice.intent, choice.source); };
updateStreamingSource();

function setBusy(busy) {
  const controls = [startGeneration, demoButton, item("paste-button"), item("clear-url"), item("menu-back"),
    item("download-mp3"), item("play-provider"), ...form.querySelectorAll("[data-tab]"), trackURL, fileButton, removeFile, item("timing-button"), ...difficultyControl];
  controls.forEach(control => { control.disabled = busy; });
  item("generation-status").hidden = !busy;
}
function cancelJob() {
  job?.abort();
  job = null;
  setBusy(false);
  returnFocus.focus();
}
item("cancel-generation").onclick = cancelJob;

function renderChoice() {
  const { source, intent } = choice;
  const preview = source.status === "preview";
  const title = [source.artist, source.title].filter(Boolean).join(" — ");
  const label = preview
    ? t("Сервис открыл только демофрагмент. Для полной песни выбери файл с телефона.",
        "Only a preview is available. Choose a file from your device to use the full song.")
    : t("Можно сыграть через плеер сервиса или выбрать аудиофайл. Длительность задаёт сервис.",
        "Play through the service’s player or choose an audio file. The service controls playback length.");
  item("choice-text").textContent = title ? title + ". " + label : label;
  item("play-provider").textContent = preview ? (intent === "save"
    ? t("Скачать фрагмент MP3", "Save preview MP3") : t("Играть фрагмент", "Play preview"))
    : t("Открыть плеер", "Open player");
  item("source-choice").hidden = false;
}
async function generate(demo, intent = "game", accepted = null) {
  if (job) return;
  resetImport();
  setError();
  const value = trackURL.value.trim();
  const reference = !demo && !file && referenceOf(value);
  const difficulty = Number(difficultyControl.value);
  const controller = job = new AbortController();
  const { signal } = controller;
  returnFocus = demo ? demoButton : intent === "save" ? item("download-mp3") : startGeneration;
  const update = message => { if (!signal.aborted) item("status-text").textContent = t(message); };
  const unavailable = () => new Error(t("Сервис не предоставляет файл для скачивания. Выбери аудио с телефона или вставь прямую ссылку на файл.",
    "The service does not provide a downloadable file. Choose audio from your device or paste a direct file link."));
  setBusy(true);
  try {
    let url, title = "", preview = false;
    if (reference) {
      update(t("Проверяем ссылку…", "Checking link…"));
      if (reference.provider === "YouTube") {
        if (intent === "save") throw unavailable();
        showGame({ reference, difficulty });
        return;
      }
      const source = accepted || await resolveProvider(reference, signal);
      signal.throwIfAborted();
      if (source.reason === "choose-track") {
        const result = item("import-result");
        result.textContent = t("Выбери запись из альбома", "Choose a recording");
        for (const track of source.choices) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = track.title;
          button.className = "text-button";
          button.onclick = () => {
            trackURL.value = track.url;
            trackURL.dispatchEvent(new Event("input"));
            generate(false, intent);
          };
          result.append(button);
        }
        return;
      }
      if (source.status === "blocked" || (source.status === "embed-only" && intent === "save")) throw unavailable();
      preview = source.status === "preview";
      if (!accepted && (preview || source.status === "embed-only")) {
        choice = { source, intent };
        renderChoice();
        return;
      }
      if (source.status === "embed-only") {
        showGame({ reference: source.reference, title: [source.artist, source.title].filter(Boolean).join(" — "), difficulty });
        return;
      }
      url = parseTrackLink(source.mediaUrl);
      title = [source.artist, source.title].filter(Boolean).join(" — ");
    } else if (!demo && !file) {
      if (!value) throw new Error("Вставь ссылку на трек или выбери файл.");
      url = parseTrackLink(value);
    }
    const decoded = await decodeTrack({ file: demo ? null : file, url, demo, keepAudio: intent === "game" }, signal, update);
    signal.throwIfAborted();
    if (intent === "save") {
      if (!decoded.buffer) throw unavailable();
      const basename = file?.name || url?.pathname.split("/").pop() || "Pulsewake";
      const filename = (title || basename.replace(/\.[a-z0-9]{1,5}$/i, "")) + (preview ? " (preview)" : "");
      await exportMp3(decoded.buffer, { filename, signal, onProgress: fraction =>
        update(t("Подготовка MP3 · ", "Encoding MP3 · ") + Math.round(fraction * 100) + "%") });
      signal.throwIfAborted();
      item("import-result").textContent = t("MP3 готов", "MP3 ready") + " · " + filename + ".mp3";
    } else {
      const track = await chartTrack(decoded, difficulty, signal, update);
      signal.throwIfAborted();
      const pathName = url?.pathname.split("/").filter(Boolean).pop();
      let fallback = file?.name || pathName || url?.hostname || "Pulsewake";
      try { fallback = decodeURIComponent(fallback); } catch { /* Keep the supplied filename. */ }
      const historyEntry = demo ? { kind: "demo", key: "demo", title: "Neon Pulse" }
        : { kind: "audio", key: "audio:" + track.paletteId, title: title || fallback,
            filename: file?.name || fallback, preview, provider: reference?.provider || "" };
      showGame({ ...track, title: historyEntry.title, historyEntry });
    }
  } catch (error) {
    if (!signal.aborted && error.name !== "AbortError") setError(error.message || "Не удалось сгенерировать уровень.", !!value && !file);
  } finally {
    if (job === controller) {
      job = null;
      setBusy(false);
    }
  }
}

async function replaySaved(entry, signal, button) {
  let track;
  if (entry.kind === "map") {
    track = await loadMap(catalog.find(map => map.id === entry.map), signal);
  } else if (entry.kind === "stream") {
    track = { reference: entry.reference, difficulty: entry.difficulty };
  } else {
    const blob = entry.kind === "demo" ? null : await readPlayedAudio(entry.key);
    signal.throwIfAborted();
    if (!blob && entry.kind !== "demo") throw new Error("missing library audio");
    const file = blob && new File([blob], entry.filename || entry.title, { type: blob.type });
    const decoded = await decodeTrack({ file, demo: entry.kind === "demo" }, signal, () => {});
    track = await chartTrack(decoded, entry.difficulty, signal, () => {});
  }
  signal.throwIfAborted();
  returnFocus = button;
  showGame({ ...track, title: entry.title, historyEntry: entry });
}

function showGame(track) {
  item("result-board").dataset.map = track.id || "";
  item("result-board").hidden = !track.id;
  lobbyMusic.setInLobby(false);
  history.pushState({ rhythmGame: true }, "", "#play");
  document.body.classList.add("playing-view");
  home.hidden = true;
  const mobile = matchMedia("(pointer: coarse)").matches || navigator.userAgentData?.mobile ||
    (navigator.maxTouchPoints > 0 && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));
  gameScreen.classList.toggle("mobile-play", Boolean(mobile));
  gameScreen.hidden = false;
  window.scrollTo(0, 0);
  game.open(track);
}

function showHome() {
  if (gameScreen.hidden) return;
  game.close();
  item("fullscreen-notice").hidden = true;
  if (gameScreen.classList.contains("mobile-play")) {
    try { screen.orientation?.unlock?.(); } catch { /* Some browsers disallow unlocking. */ }
  }
  if (document.fullscreenElement === gameScreen) document.exitFullscreen().catch(() => {});
  gameScreen.hidden = true;
  home.hidden = false;
  document.body.classList.remove("playing-view");
  lobbyMusic.setInLobby(true);
  returnFocus.focus();
}

function exitGame() {
  showHome();
  if (history.state?.rhythmGame) history.back();
}

item("back-button").addEventListener("click", exitGame);
item("result-back").addEventListener("click", exitGame);
item("pause-exit").onclick = exitGame;
window.addEventListener("popstate", () => {
  if (location.hash === "#play" && gameScreen.hidden) {
    history.replaceState(null, "", location.pathname + location.search + homeHash);
  } else if (location.hash !== "#play") {
    showHome();
  }
});

item("help-button").addEventListener("click", () => {
  game.pause(false);
  item("help-dialog").showModal();
});

const installButton = item("install-button");
const labelInstall = () => installButton.setAttribute("aria-label", t("Установить приложение"));
labelInstall();
document.addEventListener("languagechange", labelInstall);
const standalone = nativeApp || matchMedia("(display-mode: standalone)").matches || navigator.standalone;
let installPrompt = null;
installButton.hidden = Boolean(standalone);

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
});
window.addEventListener("appinstalled", () => {
  installButton.hidden = true;
  installPrompt = null;
});
installButton.addEventListener("click", async () => {
  game.pause(false);
  if (installPrompt) {
    const prompt = installPrompt;
    installPrompt = null;
    try {
      await prompt.prompt();
      if ((await prompt.userChoice).outcome === "accepted") installButton.hidden = true;
      return;
    } catch { /* The browser still supports installation through its menu. */ }
  }
  item("install-dialog").showModal();
});

if (!nativeApp && "serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});


const libraryBack = bindLibrary(track => {
  returnFocus = item("play-map");
  showGame(track);
}, exitGame);

window.pulsewakeBack = () => {
  const dialog = Array.from(document.querySelectorAll("dialog[open]")).pop();
  if (dialog) { dialog.close(); return true; }
  if (!gameScreen.hidden) {
    if (["starting", "playing", "countdown"].includes(game.phase)) game.pause();
    else exitGame();
    return true;
  }
  if (job) { cancelJob(); return true; }
  return libraryBack();
};

if (nativeApp) {
  window.addEventListener("pulsewake-pause", () => {
    androidPaused = true;
    game.pause(false);
    game.stream?.player?.pause();
    if (item("timing-dialog").open) item("timing-dialog").close();
    lobbyMusic.setInLobby(false);
  });
  window.addEventListener("pulsewake-resume", () => {
    androidPaused = false;
    if (gameScreen.hidden && !item("timing-dialog").open) lobbyMusic.setInLobby(true);
  });
}
