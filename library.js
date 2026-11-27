import { catalog } from "./catalog.js?v=15";
import { difficulties } from "./audio.js?v=15";
import { t, formatNumber } from "./i18n.js?v=15";
import { readBest } from "./records.js?v=15";

const item = id => document.getElementById(id);
const api = "https://pulsewake-scores.royalhero8192.chatgpt.site/v1/maps/";
const mapKey = map => ({ songId: map.id, difficulty: map.difficulty });

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
  let tab = "maps";
  let opening;
  let request;
  let sending = false;
  const select = item("score-map");
  const list = item("map-list");
  const name = item("player-name");
  try { name.value = localStorage.getItem("pulsewake-player-name") || ""; } catch { /* Optional preference. */ }
  for (const map of catalog) select.add(new Option(map.title, map.id));

  function renderMaps() {
    list.replaceChildren();
    for (const map of catalog) {
      const row = document.createElement("button");
      row.className = "map-row";
      row.type = "button";
      row.setAttribute("aria-pressed", String(map === selected));
      const art = new Image(46, 46);
      art.src = "./assets/covers/" + map.id + ".webp"; art.alt = "";
      const label = document.createElement("span");
      const title = document.createElement("b");
      title.textContent = map.title;
      const level = document.createElement("small");
      level.textContent = t(difficulties[map.difficulty].name);
      label.append(title, level);
      const tempo = document.createElement("span");
      tempo.className = "speed";
      tempo.textContent = map.bpm + " BPM";
      row.append(art, label, tempo);
      row.onclick = () => {
        opening?.abort();
        selected = map;
        select.value = map.id;
        renderMaps();
        list.children[map.difficulty - 1].focus({ preventScroll: true });
      };
      list.append(row);
    }
    item("map-art").src = "./assets/covers/" + selected.id + ".webp";
    item("map-title").textContent = selected.title;
    const seconds = Math.round(selected.duration);
    item("map-info").textContent = t(difficulties[selected.difficulty].name) + " · " + selected.bpm + " BPM · " +
      Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  }

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
      const response = await fetch(api + map.id + "/scores", options);
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
    item("maps-pane").hidden = tab !== "maps";
    item("setup").hidden = tab !== "custom";
    item("scores-pane").hidden = tab !== "scores";
    if (tab === "scores") leaderboard();
    else { request?.abort(); request = null; }
  }

  document.querySelectorAll("[data-tab]").forEach(button => button.onclick = () => showTab(button.dataset.tab));
  select.onchange = () => leaderboard();
  item("submit-score").onsubmit = async event => {
    event.preventDefault();
    if (sending) return;
    sending = true;
    try { await leaderboard(true); } finally { sending = false; }
  };
  item("result-board").onclick = () => { exitGame(); select.value = selected.id; showTab("scores"); };
  item("play-map").onclick = async () => {
    const map = selected;
    const controller = opening = new AbortController();
    const button = item("play-map");
    button.disabled = true;
    item("map-error").hidden = true;
    try {
      const response = await fetch(map.url, { signal: controller.signal });
      if (!response.ok) throw new Error();
      const Decoder = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const buffer = await new Decoder(1, 1, 32000).decodeAudioData(await response.arrayBuffer());
      if (!controller.signal.aborted) play({ ...map, ...mapKey(map), paletteId: map.id, buffer, duration: buffer.duration });
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
}
