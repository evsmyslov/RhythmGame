import { parseTrackLink, prepareTrack, streamingReference } from "./audio.js?v=7";
import { RhythmGame } from "./game.js?v=7";
import { LobbyMusic } from "./sound.js?v=7";

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
const game = new RhythmGame();
const lobbyMusic = new LobbyMusic(item("lobby-music"), item("lobby-music-button"));
const fullscreenButton = item("fullscreen-button");
fullscreenButton.hidden = !document.fullscreenEnabled || !gameScreen.requestFullscreen;
let fullscreenNoticeTimer = null;

fullscreenButton.addEventListener("click", async () => {
  const notice = item("fullscreen-notice");
  notice.hidden = true;
  clearTimeout(fullscreenNoticeTimer);
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await gameScreen.requestFullscreen();
  } catch {
    notice.hidden = false;
    fullscreenNoticeTimer = setTimeout(() => { notice.hidden = true; }, 3600);
  }
});
document.addEventListener("fullscreenchange", () => {
  const fullscreen = document.fullscreenElement === gameScreen;
  const label = fullscreen ? "Выйти из полноэкранного режима" : "Во весь экран";
  fullscreenButton.setAttribute("aria-label", label);
  fullscreenButton.title = label;
  fullscreenButton.querySelector("use").setAttribute("href", fullscreen ? "#i-minimize" : "#i-fullscreen");
});
const homeHash = location.hash === "#play" ? "" : location.hash;
let job = null;
let file = null;
let returnFocus = startGeneration;

if (location.hash === "#play") history.replaceState(null, "", location.pathname + location.search);

function setError(message = "", onLink = false) {
  errorMessage.textContent = message;
  errorMessage.hidden = !message;
  if (message && onLink) trackURL.setAttribute("aria-invalid", "true");
  else trackURL.removeAttribute("aria-invalid");
}

function updateStreamingSource() {
  const reference = streamingReference(trackURL.value.trim());
  item("streaming-source").hidden = !reference;
  if (!reference) return;
  const link = item("streaming-link");
  link.href = reference.url;
  link.querySelector("span").textContent = "Открыть в " + reference.provider;
  item("streaming-hint").hidden = Boolean(file);
}

function setFile(selected) {
  file = selected;
  if (!selected) trackFile.value = "";
  if (selected && !streamingReference(trackURL.value.trim())) trackURL.value = "";
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

trackURL.addEventListener("input", () => {
  setError();
  updateStreamingSource();
});
trackURL.addEventListener("change", clearFileForDirectLink);

function clearFileForDirectLink() {
  const value = trackURL.value.trim();
  if (file && value && !streamingReference(value)) setFile(null);
}

item("paste-button").addEventListener("click", async () => {
  try {
    const value = await navigator.clipboard.readText();
    if (job) return;
    if (value.trim()) {
      trackURL.value = value.trim();
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

function setBusy(busy) {
  const controls = [startGeneration, demoButton, item("paste-button"), trackURL, fileButton,
    removeFile, ...form.elements.namedItem("difficulty")];
  controls.forEach(control => { control.disabled = busy; });
  item("generation-status").hidden = !busy;
}

item("cancel-generation").addEventListener("click", () => {
  job?.abort();
  job = null;
  setBusy(false);
  returnFocus.focus();
});

async function generate(demo) {
  if (job) return;
  setError();
  let url;
  const source = trackURL.value.trim();
  const reference = streamingReference(source);
  if (!demo && reference && !file) {
    setError("Для этой ссылки выбери аудио или видео с этой песней.");
    fileButton.focus();
    return;
  }
  if (!demo && !reference && (source || !file)) {
    try {
      if (!source) throw new Error("Вставь ссылку на трек или выбери файл.");
      url = parseTrackLink(source);
    } catch (error) {
      setError(error.message, true);
      trackURL.focus();
      return;
    }
  }
  const difficulty = Number(form.elements.namedItem("difficulty").value);
  const controller = new AbortController();
  job = controller;
  returnFocus = demo ? demoButton : startGeneration;
  setBusy(true);
  try {
    const track = await prepareTrack({
      file: demo || url ? null : file,
      url,
      demo,
      difficulty
    }, controller.signal, message => {
      if (job === controller) item("status-text").textContent = message;
    });
    if (job === controller) showGame(track);
  } catch (error) {
    if (job === controller) setError(error.message || "Не удалось сгенерировать уровень.", Boolean(url));
  } finally {
    if (job === controller) {
      job = null;
      setBusy(false);
    }
  }
}

function showGame(track) {
  lobbyMusic.setInLobby(false);
  history.pushState({ rhythmGame: true }, "", "#play");
  document.body.classList.add("playing-view");
  home.hidden = true;
  gameScreen.hidden = false;
  window.scrollTo(0, 0);
  game.open(track);
}

function showHome() {
  if (gameScreen.hidden) return;
  game.close();
  item("fullscreen-notice").hidden = true;
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
document.querySelector(".brand").addEventListener("click", event => {
  if (gameScreen.hidden) return;
  event.preventDefault();
  exitGame();
});
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
installButton.setAttribute("aria-label", "Установить приложение");
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
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

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
