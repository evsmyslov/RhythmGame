import { catalog } from "./catalog.js?v=17";
import { difficulties } from "./audio.js?v=17";
import { t, formatNumber } from "./i18n.js?v=17";
import { readBest } from "./records.js?v=17";

const item = id => document.getElementById(id);
const api = "https://pulsewake-scores.royalhero8192.chatgpt.site/v1/maps/";
const mapKey = map => ({ songId: map.id + "-v2", difficulty: map.difficulty });

export async function loadMap(map, signal) {
  const response = await fetch(map.url, { signal });
  if (!response.ok) throw new Error("map unavailable");
  const Decoder = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const buffer = await new Decoder(1, 1, 32000).decodeAudioData(await response.arrayBuffer());
  signal.throwIfAborted();
  return { ...map, ...mapKey(map), paletteId: map.id, buffer, duration: buffer.duration };
}

function playerKey() {
  let token = localStorage.getItem("pulsewake-ranking-key");
  if (!/^[0-9a-f]{64}$/.test(token || "")) {
    const random = crypto.getRandomValues(new Uint8Array(32));
    token = Array.from(random, byte => byte.toString(16).padStart(2, "0")).join("");
    localStorage.setItem("pulsewake-ranking-key", token);
  }
  return token;
}

export function bindLibrary(play, exitGame) {
  let selected = catalog[0];
  let tab = "title";
  let opening;
  let request;
  let sending = false;
  const select = item("score-map");
  const list = item("map-list");
  const name = item("player-name");
  try { name.value = localStorage.getItem("pulsewake-player-name") || ""; } catch { /* Optional preference. */ }
  for (const map of catalog) select.add(new Option(map.title, map.id));

  function renderMaps() {
    if (!list.childElementCount) {
      for (const map of catalog) {
        const row = document.createElement("button");
        row.className = "map-row";
        row.type = "button";
        const art = new Image(240, 240);
        art.src = "./assets/covers/" + map.id + ".webp";
        art.alt = "";
        const title = document.createElement("b");
        title.textContent = map.title;
        const detail = document.createElement("small");
        row.append(art, title, detail);
        row.onclick = () => chooseMap(map);
        list.append(row);
      }
    }
    for (const [index, row] of Array.from(list.children).entries()) {
      const map = catalog[index];
      row.setAttribute("aria-pressed", String(map === selected));
      row.lastElementChild.textContent = t(difficulties[map.difficulty].name) + " · " + map.bpm + " BPM";
    }
    item("previous-map").disabled = selected === catalog[0];
    item("next-map").disabled = selected === catalog.at(-1);
    item("map-title").textContent = selected.title;
    const seconds = Math.round(selected.duration);
    item("map-info").textContent = t(difficulties[selected.difficulty].name) + " · " + selected.bpm + " BPM · " +
      Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  }

  function chooseMap(map) {
    if (!map) return;
    opening?.abort();
    selected = map;
    select.value = map.id;
    renderMaps();
    const card = list.children[catalog.indexOf(map)];
    list.scrollTo({ left: card.offsetLeft - list.offsetLeft - (list.clientWidth - card.offsetWidth) / 2,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }
  item("previous-map").onclick = () => chooseMap(catalog[catalog.indexOf(selected) - 1]);
  item("next-map").onclick = () => chooseMap(catalog[catalog.indexOf(selected) + 1]);

  async function leaderboard(post = false) {
    request?.abort();
    const controller = request = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const map = catalog.find(map => map.id === select.value);
    const best = readBest(mapKey(map));
    const status = item("board-status");
    const detail = item("board-detail");
    const rows = item("board-rows");
    item("submit-score").hidden = !best;
    item("send-score").disabled = post;
    rows.replaceChildren();
    status.textContent = t("Загрузка…", "Loading…");
    detail.textContent = best ? t("Личный рекорд", "Personal best") + " · " + formatNumber(best.score) : "";
    try {
      const options = { signal: controller.signal, credentials: "omit" };
      if (post) {
        const nickname = name.value.trim();
        if (!/^[\p{L}\p{N} _.-]{1,22}$/u.test(nickname)) throw new Error("name");
        options.method = "POST";
        options.headers = { "Content-Type": "application/json", Authorization: "Bearer " + playerKey() };
        options.body = JSON.stringify({ name: nickname, score: best.score });
        localStorage.setItem("pulsewake-player-name", nickname);
      }
      const response = await fetch(api + mapKey(map).songId + "/scores", options);
      if (!response.ok) throw new Error("network");
      const { scores } = await response.json();
      if (request !== controller) return;
      status.textContent = scores.length ? t("Лучшие игроки", "Top players") : t("Пока нет результатов", "No scores yet");
      if (post) detail.textContent = t("Рекорд опубликован", "Best score published") + " · " + formatNumber(best.score);
      for (const row of scores) {
        const li = document.createElement("li");
        const points = document.createElement("strong");
        points.textContent = formatNumber(row.score);
        li.append(document.createTextNode(row.name), points);
        rows.append(li);
      }
    } catch (error) {
      if (request !== controller) return;
      status.textContent = error.message === "name"
        ? t("Введи ник до 22 символов.", "Enter a nickname of up to 22 characters.")
        : t("Нет связи с рейтингом.", "Leaderboard is unavailable.");
    } finally {
      clearTimeout(timeout);
      if (request === controller) item("send-score").disabled = false;
    }
  }

  function showTab(next) {
    tab = next;
    opening?.abort();
    for (const button of document.querySelectorAll("[data-tab]")) button.setAttribute("aria-pressed", String(button.dataset.tab === tab));
    document.body.dataset.menu = tab;
    item("title-pane").hidden = tab !== "title";
    item("menu-back").hidden = tab === "title";
    item("maps-pane").hidden = tab !== "maps";
    item("setup").hidden = tab !== "custom";
    item("scores-pane").hidden = tab !== "scores";
    item("played-pane").hidden = tab !== "history";
    document.dispatchEvent(new Event("pulsewake-menu"));
    if (tab === "scores") leaderboard();
    else { request?.abort(); request = null; }
  }

  document.querySelectorAll("[data-tab]").forEach(button => button.onclick = () => showTab(button.dataset.tab));
  item("menu-back").onclick = () => showTab("title");
  select.onchange = () => leaderboard();
  item("submit-score").onsubmit = async event => {
    event.preventDefault();
    if (sending) return;
    sending = true;
    try { await leaderboard(true); } finally { sending = false; }
  };
  item("result-board").onclick = () => { exitGame(); select.value = item("result-board").dataset.map; showTab("scores"); };
  item("play-map").onclick = async () => {
    const map = selected;
    const controller = opening = new AbortController();
    const button = item("play-map");
    button.disabled = true;
    item("map-error").hidden = true;
    try {
      const track = await loadMap(map, controller.signal);
      if (!controller.signal.aborted) play(track);
    } catch {
      if (!controller.signal.aborted) {
        item("map-error").textContent = t("Не удалось открыть карту. Попробуй ещё раз.", "Could not open the map. Try again.");
        item("map-error").hidden = false;
      }
    } finally {
      if (opening === controller) { opening = null; button.disabled = false; }
    }
  };
  document.addEventListener("languagechange", () => { renderMaps(); if (tab === "scores") leaderboard(); });
  renderMaps();
  showTab("title");
  return () => {
    if (tab === "title") return false;
    showTab("title");
    return true;
  };
}
