import { spaceGestures } from "./chart-spacing.js?v=16";
import { t } from "./i18n.js?v=16";
import { maxDuration } from "./audio.js?v=16";
import { connectPlayer, waitFor } from "./stream-player.js?v=16";

const item = id => document.getElementById(id);
const patterns = [[0, 2, 1, 3], [1, 2, 0, 3, 1, 0, 2, 3], [0, 1, 2, 3, 2, 0, 3, 1]];

export function tempoChart(reference, difficulty, duration, bpm, phase) {
  const beat = 60 / bpm;
  const subdivisions = difficulty <= 2 ? 1 : difficulty === 5 ? 4 : 2;
  const pattern = patterns[(difficulty - 1) % patterns.length];
  const notes = [];
  const accents = [];
  const start = phase + Math.ceil((1.4 - phase) / beat) * beat;
  let nextSlot = 0;
  let gesture = 0;
  const slideEvery = [12, 10, 8, 8, 8][difficulty - 1] * subdivisions;
  for (let i = 0; ; i++) {
    const time = start + i * beat / subdivisions;
    if (time >= duration - .15) break;
    if (i % subdivisions === 0) accents.push({ time, strength: i % (subdivisions * 4) ? .54 : .9 });
    if (i < nextSlot) continue;
    if (difficulty === 1 && i % 2) continue;
    if (difficulty === 3 && i % 4 === 1) continue;
    if (difficulty === 5 && i % 16 < 8 && i % 2) continue;
    const lane = pattern[gesture++ % pattern.length];
    const holdSteps = subdivisions * (difficulty === 1 ? 2 : 1);
    if (i % slideEvery === 4 * subdivisions && time + holdSteps * beat / subdivisions < duration - .25) {
      const path = [{ time, lane }, { time: time + holdSteps * beat / subdivisions, lane: lane === 3 ? 2 : lane + 1 }];
      notes.push({ time, lane, path });
      nextSlot = i + holdSteps + Math.max(1, Math.ceil(.115 * subdivisions / beat));
    } else {
      notes.push({ time, lane });
      if (difficulty >= 4 && i % (8 * subdivisions) === 0) notes.push({ time, lane: (lane + 2) % 4 });
    }
  }
  return {
    reference, difficulty, duration, notes: spaceGestures(notes, difficulty), accents, paletteId: reference.url,
    songId: ["v2", reference.url, bpm, phase.toFixed(2), Math.round(duration)].join("|")
  };
}

export class StreamLevel {
  constructor(reference) {
    this.reference = reference;
    this.life = new AbortController();
    this.taps = [];
    this.phase = 0;
    this.tempo = item("stream-tempo");
    this.tempo.value = "120";
    this.hint = item("tempo-hint");
    this.hint.textContent = t("Введи BPM или включи трек и отбей четыре доли.");
    item("player-panel").hidden = false;
    item("player-panel").setAttribute("aria-label", t(reference.provider));
    item("player-host").dataset.provider = reference.provider;
    const options = { signal: this.life.signal };
    this.tempo.addEventListener("input", () => { this.taps = []; this.phase = 0; }, options);
    item("tap-tempo").addEventListener("click", () => this.tap(), options);
  }

  async connect() {
    this.player = await connectPlayer(this.reference, item("player-host"), this.life.signal);
  }

  tap() {
    const clock = this.player?.read();
    if (clock?.state !== "playing") {
      this.hint.textContent = t("Включи трек в плеере, затем нажимай в такт.");
      return;
    }
    const last = this.taps.at(-1);
    if (last !== undefined && (clock.time <= last || clock.time - last > 1.6)) this.taps = [];
    this.taps.push(clock.time);
    if (this.taps.length > 8) this.taps.shift();
    const count = this.taps.length;
    if (count < 4) {
      this.hint.textContent = t("Доли: " + count + " из 4", "Beats: " + count + " of 4");
      return;
    }
    const beat = (clock.time - this.taps[0]) / (count - 1);
    const bpm = Math.round(60 / beat * 10) / 10;
    if (bpm < 40 || bpm > 240) {
      this.taps = [];
      this.hint.textContent = t("Отбей четыре ровные доли в темпе от 40 до 240 BPM.");
      return;
    }
    this.tempo.value = bpm;
    this.phase = clock.time % (60 / bpm);
    this.hint.textContent = t("Темп " + bpm + " BPM. Можно начинать.", "Tempo set to " + bpm + " BPM. Ready to play.");
  }

  async play(seconds, resume, signal) {
    if (!this.tempo.checkValidity()) throw new Error("Введи темп от 40 до 240 BPM.");
    await this.player.start(seconds, resume);
    return waitFor(() => {
      const clock = this.player.read();
      if (clock.state === "error") throw new Error("Сервис не смог воспроизвести этот трек.");
      if (clock.duration > maxDuration) throw new Error("Выбери трек длительностью до 10 минут.");
      if (clock.state !== "playing" || !clock.duration || Math.abs(clock.time - seconds) > 3) return;
      if (clock.duration < 2) throw new Error("Этот фрагмент слишком короткий для уровня.");
      return clock;
    }, signal, "Нажми воспроизведение в плеере, затем попробуй ещё раз.");
  }

  close() {
    this.life.abort();
    item("player-host").replaceChildren();
    item("player-panel").hidden = true;
  }
}
