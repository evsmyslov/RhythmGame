import { difficulties } from "./audio.js";

const laneColors = ["#ff7ac7", "#c892ff", "#78e3f2", "#929eff"];
const keyLanes = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };
const formatNumber = new Intl.NumberFormat("ru");
const formatDuration = duration => {
  const seconds = Math.floor(duration);
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
};
const percent = value => Math.round(value * 100) + "%";
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const item = id => document.getElementById(id);

export class RhythmGame {
  constructor() {
    this.phase = "idle";
    this.canvas = item("chart-canvas");
    this.paint = this.canvas.getContext("2d");
    this.width = 0;
    this.height = 0;
    this.context = null;
    this.source = null;
    this.animation = 0;
    this.tick = this.tick.bind(this);
    this.resize = this.resize.bind(this);

    new ResizeObserver(this.resize).observe(item("stage"));
    item("start-button").addEventListener("click", () => this.start());
    item("replay-button").addEventListener("click", () => this.start());
    item("pause-button").addEventListener("click", () => this.pause());
    document.querySelectorAll(".lane-control").forEach(button => {
      const lane = Number(button.dataset.lane);
      button.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;
        event.preventDefault();
        this.press(lane);
      });
      button.addEventListener("click", event => {
        if (event.detail === 0) this.press(lane);
      });
    });
    document.addEventListener("keydown", event => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === "Escape" && ["countdown", "playing"].includes(this.phase)) {
        event.preventDefault();
        this.pause();
      }
      if (event.code in keyLanes && this.phase === "playing") {
        event.preventDefault();
        this.press(keyLanes[event.code]);
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.pause(false);
    });
  }

  open(track) {
    this.track = track;
    this.settings = difficulties[track.difficulty];
    item("game-title").textContent = track.title;
    item("game-detail").textContent = this.settings.stars + " · " + this.settings.name + " · " + formatDuration(track.duration);
    this.reset();
    this.showReady(false);
    this.resize();
    item("start-button").focus({ preventScroll: true });
  }

  close() {
    this.stopAudio();
    this.phase = "idle";
    this.track = null;
    this.notes = [];
  }

  reset() {
    this.notes = this.track.notes.map(note => ({ ...note, judged: false }));
    this.missCursor = 0;
    this.displayProgress = -1;
    this.score = 0;
    this.good = 0;
    this.perfect = 0;
    this.misses = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.offset = 0;
    this.countText = "";
    this.feedbackUntil = 0;
    this.flashes = [0, 0, 0, 0];
    item("judgement").textContent = "";
    this.updateScores();
    this.updateProgress(0);
  }

  showReady(paused, focus = true) {
    this.phase = paused ? "paused" : "ready";
    item("pause-button").disabled = true;
    item("countdown").hidden = true;
    item("stage-overlay").hidden = false;
    item("results-screen").hidden = true;
    item("ready-screen").hidden = false;
    item("play-error").hidden = true;
    item("ready-title").textContent = paused ? "Пауза" : "Уровень готов";
    item("ready-detail").textContent = paused ? this.track.title : "Нот в треке — " + formatNumber.format(this.notes.length);
    item("start-button").querySelector("span").textContent = paused ? "Продолжить" : "Начать игру";
    if (focus) item("start-button").focus({ preventScroll: true });
  }

  makeContext() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    this.context = new Audio();
    this.context.addEventListener("statechange", () => {
      if (this.context.state === "interrupted" || this.context.state === "suspended") this.pause(false);
    });
    return this.context;
  }

  async start() {
    const previous = this.phase;
    if (!["ready", "paused", "finished"].includes(previous)) return;
    this.phase = "starting";
    const track = this.track;
    item("start-button").disabled = true;
    item("replay-button").disabled = true;
    item("play-error").hidden = true;
    try {
      const ctx = this.context || this.makeContext();
      await ctx.resume();
      if (this.phase !== "starting" || track !== this.track) return;
      if (previous !== "paused") this.reset();
      const delay = previous === "paused" ? 2 : 3;
      this.sourceStart = ctx.currentTime + delay;
      this.source = ctx.createBufferSource();
      this.source.buffer = track.buffer;
      this.source.connect(ctx.destination);
      this.source.start(this.sourceStart, this.offset);
      this.phase = "countdown";
      item("stage-overlay").hidden = true;
      item("pause-button").disabled = false;
      item("countdown").hidden = false;
      item("pause-button").focus({ preventScroll: true });
      if (document.hidden) this.pause(false);
      else this.tick();
    } catch {
      if (this.phase === "starting" && track === this.track) {
        this.stopAudio();
        this.showReady(previous === "paused", false);
        const error = item("play-error");
        error.textContent = "Звук не запустился. Нажми кнопку ещё раз или открой игру в браузере.";
        error.hidden = false;
      }
    } finally {
      item("start-button").disabled = false;
      item("replay-button").disabled = false;
    }
  }

  stopAudio() {
    if (this.animation) cancelAnimationFrame(this.animation);
    this.animation = 0;
    if (!this.source) return;
    try { this.source.stop(); } catch { /* The buffer may already have ended. */ }
    this.source.disconnect();
    this.source = null;
  }

  playedTime() {
    const ctx = this.context;
    const timestamp = ctx.getOutputTimestamp?.();
    const predicted = timestamp?.contextTime + (performance.now() - timestamp?.performanceTime) / 1000;
    const lag = clamp(ctx.outputLatency || ctx.baseLatency || 0, 0, .18);
    const audible = timestamp?.contextTime > 0 && Math.abs(ctx.currentTime - predicted) < .3
      ? Math.min(predicted, ctx.currentTime)
      : ctx.currentTime - lag;
    return this.offset + audible - this.sourceStart;
  }

  pause(focus = true) {
    if (!["countdown", "playing"].includes(this.phase)) return;
    const time = this.playedTime();
    if (time >= this.track.duration) {
      this.finish();
      return;
    }
    this.offset = clamp(time, this.offset, Math.max(0, this.track.duration - .01));
    this.stopAudio();
    item("judgement").textContent = "";
    this.showReady(true, focus);
    this.draw(this.offset);
  }

  tick() {
    if (!["countdown", "playing"].includes(this.phase)) return;
    const time = this.playedTime();
    if (time < this.offset && this.phase === "countdown") {
      const nextText = String(Math.max(1, Math.min(3, Math.ceil(this.offset - time))));
      if (this.countText !== nextText) {
        item("countdown").textContent = nextText;
        this.countText = nextText;
      }
    } else {
      if (this.phase === "countdown") {
        this.phase = "playing";
        item("countdown").hidden = true;
      }
      this.markMisses(time);
      this.updateProgress(time);
      if (time >= this.track.duration) {
        this.finish();
        return;
      }
    }
    if (this.feedbackUntil && performance.now() > this.feedbackUntil) {
      item("judgement").textContent = "";
      this.feedbackUntil = 0;
    }
    this.draw(time);
    this.animation = requestAnimationFrame(this.tick);
  }

  press(lane) {
    if (this.phase !== "playing") return;
    const time = this.playedTime();
    this.markMisses(time);
    this.flashes[lane] = performance.now();
    let closest;
    let best = this.settings.window;
    for (let i = this.missCursor; i < this.notes.length; i++) {
      const note = this.notes[i];
      if (note.time > time + this.settings.window) break;
      const delta = Math.abs(note.time - time);
      if (!note.judged && note.lane === lane && delta <= best) {
        closest = note;
        best = delta;
      }
    }
    if (!closest) return;

    closest.judged = true;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const perfect = best <= this.settings.window * .46;
    if (perfect) this.perfect++;
    else this.good++;
    this.score += (perfect ? 1000 : 650) + Math.min((this.combo - 1) * 12, 360);
    this.feedback(perfect ? "Идеально" : "Хорошо", perfect ? "#ffa9dc" : "#9decf5");
    this.updateScores();
  }

  markMisses(time, all = false) {
    let changed = false;
    while (this.missCursor < this.notes.length) {
      const note = this.notes[this.missCursor];
      if (!all && note.time >= time - this.settings.window) break;
      this.missCursor++;
      if (note.judged) continue;
      note.judged = true;
      this.misses++;
      this.combo = 0;
      changed = true;
    }
    if (changed) {
      this.updateScores();
      if (!all && this.feedbackUntil + 50 < performance.now()) this.feedback("Мимо", "#d0b5ec");
    }
  }

  feedback(label, color) {
    const judgement = item("judgement");
    judgement.textContent = label;
    judgement.style.color = color;
    this.feedbackUntil = performance.now() + 420;
  }

  accuracy() {
    const judged = this.perfect + this.good + this.misses;
    return judged ? percent((this.perfect + this.good * .65) / judged) : "—";
  }

  updateScores() {
    item("score").textContent = formatNumber.format(this.score);
    item("combo").textContent = formatNumber.format(this.combo);
    item("accuracy").textContent = this.accuracy();
  }

  updateProgress(time) {
    const progress = clamp(time / this.track.duration, 0, 1);
    const value = Math.floor(progress * 100);
    const bar = item("game-progress");
    bar.firstElementChild.style.transform = "scaleX(" + progress + ")";
    if (value !== this.displayProgress) {
      bar.setAttribute("aria-valuenow", value);
      this.displayProgress = value;
    }
  }

  finish() {
    this.stopAudio();
    this.phase = "finished";
    this.markMisses(this.track.duration, true);
    this.updateProgress(this.track.duration);
    item("pause-button").disabled = true;
    item("countdown").hidden = true;
    item("judgement").textContent = "";
    item("ready-screen").hidden = true;
    item("stage-overlay").hidden = false;
    item("results-screen").hidden = false;
    item("result-score").textContent = formatNumber.format(this.score);
    item("result-accuracy").textContent = this.accuracy();
    item("result-combo").textContent = formatNumber.format(this.maxCombo);
    item("result-hits").textContent = "Попадания — " + formatNumber.format(this.perfect + this.good) + " из " + formatNumber.format(this.notes.length);
    this.draw(this.track.duration);
    item("replay-button").focus({ preventScroll: true });
  }

  resize() {
    if (!this.track) return;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!width || !height) return;
    this.width = width;
    this.height = height;
    const pixels = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * pixels);
    this.canvas.height = Math.round(height * pixels);
    this.paint.setTransform(pixels, 0, 0, pixels, 0, 0);
    const stateTime = { ready: -.9, paused: this.offset, finished: this.track.duration };
    this.draw(stateTime[this.phase] ?? this.offset);
  }

  draw(time) {
    if (!this.width || !this.height) return;
    const ctx = this.paint;
    const w = this.width;
    const h = this.height;
    const laneWidth = w / 4;
    const strike = h - Math.min(79, h * .19);
    const now = performance.now();
    ctx.fillStyle = "#110b20";
    ctx.fillRect(0, 0, w, h);

    laneColors.forEach((color, lane) => {
      const x = lane * laneWidth;
      const fade = ctx.createLinearGradient(0, 0, 0, h);
      fade.addColorStop(0, color + "05");
      fade.addColorStop(.72, color + "17");
      fade.addColorStop(1, color + "28");
      ctx.fillStyle = fade;
      ctx.fillRect(x, 0, laneWidth, h);
      if (lane) {
        ctx.fillStyle = "#b289dd32";
        ctx.fillRect(x, 0, 1, h);
      }
      const flash = clamp(1 - (now - this.flashes[lane]) / 190, 0, 1);
      if (flash > 0 && this.flashes[lane]) {
        ctx.globalAlpha = flash * .23;
        ctx.fillStyle = color;
        ctx.fillRect(x, 0, laneWidth, h);
        ctx.globalAlpha = 1;
      }
    });

    ctx.fillStyle = "#f1d0ff";
    ctx.shadowBlur = 13;
    ctx.shadowColor = "#c184ff";
    ctx.fillRect(0, strike - 1, w, 2);
    ctx.shadowBlur = 0;

    const approach = this.settings.approach;
    for (let i = this.missCursor; i < this.notes.length; i++) {
      const note = this.notes[i];
      if (note.time - time > approach + .04) break;
      if (note.judged) continue;
      const y = strike - (note.time - time) / approach * (strike + 8);
      const inset = Math.max(7, laneWidth * .105);
      const noteHeight = clamp(laneWidth * .12, 9, 16);
      const color = laneColors[note.lane];
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.roundRect(note.lane * laneWidth + inset, y - noteHeight / 2, laneWidth - inset * 2, noteHeight, 5);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }
}
