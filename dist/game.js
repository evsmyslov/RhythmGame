import { difficulties } from "./audio.js?v=3";
import { GameField, laneAt } from "./game-field.js?v=3";
const keyLanes = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };
const formatNumber = new Intl.NumberFormat("ru");
const percent = value => Math.round(value * 100) + "%";
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const item = id => document.getElementById(id);

export class RhythmGame {
  constructor() {
    this.phase = "idle";
    this.stage = item("stage");
    this.field = new GameField(item("chart-canvas"), this.stage);
    this.pointers = new Map();
    this.keys = new Set();
    this.buttons = Array.from(document.querySelectorAll(".lane-control"));
    this.context = null;
    this.source = null;
    this.animation = 0;
    this.tick = this.tick.bind(this);
    this.resize = this.resize.bind(this);

    new ResizeObserver(this.resize).observe(this.stage);
    item("start-button").addEventListener("click", () => this.start());
    item("replay-button").addEventListener("click", () => this.start());
    item("pause-button").addEventListener("click", () => this.pause());
    const controls = item("lane-controls");
    controls.addEventListener("pointerdown", event => {
      if (event.button !== 0 || this.phase !== "playing") return;
      event.preventDefault();
      const position = this.field.lanePosition(event.clientX);
      const lane = clamp(Math.round(position), 0, 3);
      controls.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, position);
      this.lightPads();
      this.press(lane, { pointer: event.pointerId });
    });
    controls.addEventListener("pointermove", event => {
      if (!this.pointers.has(event.pointerId)) return;
      this.pointers.set(event.pointerId, this.field.lanePosition(event.clientX));
      this.lightPads();
    });
    controls.addEventListener("pointerup", event => this.releasePointer(event, false));
    controls.addEventListener("pointercancel", event => this.releasePointer(event, true));
    controls.addEventListener("lostpointercapture", event => this.releasePointer(event, true));
    this.buttons.forEach((button, lane) => button.addEventListener("click", event => {
      if (event.detail === 0) this.press(lane);
    }));

    document.addEventListener("keydown", event => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === "Escape" && ["countdown", "playing"].includes(this.phase)) {
        event.preventDefault();
        this.pause();
      }
      if (event.code in keyLanes && this.phase === "playing") {
        event.preventDefault();
        const lane = keyLanes[event.code];
        this.keys.add(lane);
        this.lightPads();
        this.press(lane, { keyboard: true });
      }
    });
    document.addEventListener("keyup", event => {
      if (!this.keys.delete(keyLanes[event.code])) return;
      this.lightPads();
    });
    window.addEventListener("blur", () => this.pause(false));
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.pause(false);
    });
  }

  open(track) {
    this.track = track;
    this.settings = difficulties[track.difficulty];
    item("game").dataset.theme = track.difficulty;
    this.slideCount = track.notes.filter(note => note.path).length;
    this.reset();
    this.showReady(false);
    this.resize();
    item("start-button").focus({ preventScroll: true });
  }

  close() {
    this.stopAudio();
    this.phase = "idle";
    this.comboAnimation?.cancel();
    this.clearInputs();
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
    this.clearInputs();
    this.field.reset();
    item("judgement").textContent = "";
    this.updateScores();
    this.updateProgress(0);
  }

  showReady(paused, focus = true) {
    this.phase = paused ? "paused" : "ready";
    item("pause-button").disabled = true;
    item("countdown").hidden = true;
    item("stage-overlay").hidden = false;
    item("combo").hidden = true;
    item("results-screen").hidden = true;
    item("ready-screen").hidden = false;
    item("play-error").hidden = true;
    item("ready-title").textContent = paused ? "Пауза" : "Уровень готов";
    item("ready-detail").textContent = this.settings.stars + " · " + this.settings.name + " · " + formatNumber.format(this.notes.length) + " нот";
    item("ready-hint").hidden = paused || !this.slideCount;
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
    const resumeTime = this.slide ? Math.max(0, this.slide.note.time - .23) : time;
    this.offset = clamp(resumeTime, this.offset, Math.max(0, this.track.duration - .01));
    this.clearInputs();
    this.field.reset();
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
        item("combo").hidden = this.combo < 2;
      }
      this.updateSlide(time);
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

  clearInputs() {
    this.pointers.clear();
    this.keys.clear();
    this.slide = null;
    this.lightPads();
  }

  lightPads() {
    const heldLanes = new Set(this.keys);
    for (const position of this.pointers.values()) heldLanes.add(clamp(Math.round(position), 0, 3));
    this.buttons.forEach((button, lane) => button.classList.toggle("pressed", heldLanes.has(lane)));
  }

  press(lane, input) {
    if (this.phase !== "playing") return;
    const time = this.playedTime();
    this.updateSlide(time);
    this.markMisses(time);
    this.field.illuminate(lane);
    if (this.slide) return;

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

    const perfect = best <= this.settings.window * .46;
    if (closest.path && input) {
      this.slide = { note: closest, input, perfect, offPathSince: null, lastLane: lane };
      this.field.illuminate(lane, 8);
      this.feedback("Удерживай", "#e1c2ff");
    } else if (!closest.path) {
      this.hit(closest, perfect, lane);
    }
  }

  updateSlide(time) {
    const slide = this.slide;
    if (!slide) return;
    const { note, input } = slide;
    const lane = laneAt(note.path, time);
    const distance = input.keyboard
      ? Math.min(...Array.from(this.keys, key => Math.abs(key - lane)))
      : Math.abs((this.pointers.get(input.pointer) ?? Infinity) - lane);
    const nearest = Math.round(lane);
    const end = note.path.at(-1);
    const onPath = distance <= .64;

    if (onPath) {
      slide.offPathSince = null;
      if (nearest !== slide.lastLane) {
        slide.lastLane = nearest;
        this.field.illuminate(lane, 7);
      }
    } else {
      slide.offPathSince ??= time;
    }

    if (time >= end.time) {
      if (onPath) this.completeSlide();
      else this.failSlide();
    } else if (slide.offPathSince !== null && time - slide.offPathSince > this.settings.window * .82) {
      this.failSlide();
    }
  }

  releasePointer(event, cancelled) {
    const position = this.pointers.get(event.pointerId);
    if (position === undefined) return;
    if (this.slide?.input.pointer === event.pointerId) {
      if (cancelled) this.failSlide();
      else {
        const time = this.playedTime();
        const end = this.slide.note.path.at(-1);
        const finalPosition = this.field.lanePosition(event.clientX);
        this.pointers.set(event.pointerId, finalPosition);
        this.updateSlide(time);
        if (this.slide) {
          if (time >= end.time - .065 && Math.abs(finalPosition - end.lane) <= .64) this.completeSlide();
          else this.failSlide();
        }
      }
    }
    this.pointers.delete(event.pointerId);
    this.lightPads();
  }

  completeSlide() {
    const { note, perfect } = this.slide;
    this.slide = null;
    this.hit(note, perfect, note.path.at(-1).lane);
  }

  failSlide() {
    const { note } = this.slide;
    this.slide = null;
    note.judged = true;
    this.misses++;
    this.combo = 0;
    this.feedback("Мимо", "#d0b5ec");
    this.updateScores();
  }

  hit(note, perfect, lane) {
    note.judged = true;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    if (perfect) this.perfect++;
    else this.good++;
    const points = perfect ? 1000 : 650;
    this.score += (note.path ? Math.round(points * 1.45) : points) + Math.min((this.combo - 1) * 12, 360);
    this.field.illuminate(lane, note.path ? 19 : perfect ? 13 : 7);
    if (this.combo % 10 === 0) this.field.celebrate(lane);
    this.feedback(perfect ? "Идеально" : "Хорошо", perfect ? "#ffa9dc" : "#9decf5");
    this.updateScores();
  }

  markMisses(time, all = false) {
    let changed = false;
    while (this.missCursor < this.notes.length) {
      const note = this.notes[this.missCursor];
      if (!all && (note === this.slide?.note || note.time >= time - this.settings.window)) break;
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
    this.updateCombo();
    item("accuracy").textContent = this.accuracy();
  }

  updateCombo() {
    const previous = this.displayedCombo ?? 0;
    const label = item("combo");
    label.textContent = formatNumber.format(this.combo);
    label.setAttribute("aria-label", "Комбо " + this.combo);
    label.hidden = this.combo < 2;
    if (this.combo === previous) return;
    this.displayedCombo = this.combo;

    const scale = 1 + Math.min(.33, Math.log2(1 + this.combo / 7) * .105);
    const stable = "scale(" + scale + ")";
    label.style.setProperty("--combo-scale", scale);
    const increasing = this.combo > previous;
    const milestone = increasing && this.combo % 10 === 0;
    if (increasing && !milestone && this.comboMilestone && this.comboAnimation?.playState === "running") return;
    this.comboAnimation?.cancel();
    if (!increasing || this.field.motion.matches || !label.animate) return;

    this.comboMilestone = milestone;
    const frames = milestone ? [
      { transform: stable },
      { transform: "translateX(-3px) rotate(-6deg) scale(" + (scale + .22) + ")", color: "#fff8ce", offset: .2 },
      { transform: "translateX(3px) rotate(5deg) scale(" + (scale + .14) + ")", color: "#d5fdff", offset: .42 },
      { transform: "translateX(-1.5px) rotate(-3deg) scale(" + (scale + .07) + ")", color: "#efc5ff", offset: .62 },
      { transform: stable }
    ] : [
      { transform: stable },
      { transform: "scale(" + (scale + .075) + ")", offset: .3 },
      { transform: stable }
    ];
    this.comboAnimation = label.animate(frames, { duration: milestone ? 520 : 160, easing: "ease-out" });
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
    item("combo").hidden = true;
    this.clearInputs();
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
    this.field.resize();
    const stateTime = { ready: -.9, paused: this.offset, finished: this.track.duration };
    this.draw(stateTime[this.phase] ?? this.offset);
  }

  draw(time) {
    this.field.draw(this.notes, this.missCursor, time, this.settings.approach, this.slide?.note);
  }
}
