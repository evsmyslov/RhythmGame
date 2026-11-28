import { preferences } from "./settings.js?v=16";
import { formatNumber, t } from "./i18n.js?v=16";
import { StreamLevel, tempoChart } from "./stream-level.js?v=16";
import { difficulties } from "./audio.js?v=16";
import { GameField, laneAt } from "./game-field.js?v=16";
import { HitSounds } from "./sound.js?v=16";
import { audibleTime, timingOffset } from "./timing.js?v=16";
import { finishRecord, readBest } from "./records.js?v=16";
const releaseLead = .055;
const slideTick = .18;
const slideLaneTolerance = .59;
const feedbackDuration = 560;
const keyLanes = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };
const percent = value => Math.round(value * 100) + "%";
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const item = id => document.getElementById(id);
const comboTiers = [null,
  { scale: .15, shake: 0, color: "#c8ffed", duration: 270 },
  { scale: .25, shake: 2, color: "#b7f9ff", duration: 370 },
  { scale: .37, shake: 4, color: "#ffde9e", duration: 520 },
  { scale: .50, shake: 6, color: "#ffdcff", duration: 720 }
];

function comboTier(combo) {
  if (!combo) return 0;
  if (combo % 100 === 0) return 4;
  if (combo % 50 === 0) return 3;
  if (combo % 25 === 0) return 2;
  return combo % 10 === 0 ? 1 : 0;
}

export class RhythmGame {
  constructor(onStart) {
    this.onStart = onStart;
    this.timingOffset = timingOffset();
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
    window.addEventListener("resize", this.resize);
    item("start-button").addEventListener("click", () => this.start());
    item("replay-button").addEventListener("click", () => this.start());
    item("restart-button").addEventListener("click", () => { if (this.phase === "paused") this.start(true); });
    item("pause-button").addEventListener("click", () => this.pause());
    const controls = item("lane-controls");
    controls.addEventListener("pointerdown", event => {
      if (event.button !== 0 || !this.listeningForInput()) return;
      event.preventDefault();
      const position = this.field.lanePosition(event.clientX, event.clientY);
      const lane = clamp(Math.round(position), 0, 3);
      this.pointers.set(event.pointerId, position);
      try { controls.setPointerCapture(event.pointerId); } catch { /* Input is also tracked on the document. */ }
      this.lightPads();
      this.press(lane, true);
    });
    document.addEventListener("pointermove", event => {
      if (!this.pointers.has(event.pointerId)) return;
      if (event.pointerType === "mouse" && !(event.buttons & 1)) {
        this.releasePointer(event, true);
        return;
      }
      this.pointers.set(event.pointerId, this.field.lanePosition(event.clientX, event.clientY));
      this.lightPads();
      if (this.slide && this.phase === "playing") this.updateSlide(this.playedTime() - this.timingOffset);
    });
    document.addEventListener("pointerup", event => this.releasePointer(event, false));
    document.addEventListener("pointercancel", event => this.releasePointer(event, true));
    this.buttons.forEach((button, lane) => button.addEventListener("click", event => {
      if (event.detail === 0) this.press(lane);
    }));

    document.addEventListener("keydown", event => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === "Escape" && ["countdown", "playing"].includes(this.phase)) {
        event.preventDefault();
        this.pause();
      }
      if (event.code in keyLanes && this.listeningForInput()) {
        event.preventDefault();
        const lane = keyLanes[event.code];
        this.keys.add(lane);
        this.lightPads();
        this.press(lane, true);
      }
    });
    document.addEventListener("keyup", event => {
      const lane = keyLanes[event.code];
      if (!this.keys.has(lane)) return;
      const time = this.slide && this.phase === "playing" ? this.playedTime() - this.timingOffset : null;
      if (time !== null) this.releaseSlideInput(time, lane);
      this.keys.delete(lane);
      if (time !== null) this.updateSlide(time);
      this.lightPads();
    });
    window.addEventListener("blur", () => {
      setTimeout(() => {
        if (!document.hasFocus() && !item("player-host").contains(document.activeElement)) this.pause(false);
      }, 0);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.pause(false);
    });
  }

  listeningForInput() {
    return this.phase === "playing" || (this.phase === "countdown" && Boolean(this.slide));
  }

  open(track) {
    document.querySelector(".game-layout").classList.toggle("with-player", Boolean(track.reference));
    if (track.reference) Object.assign(track, { notes: [], duration: 0, paletteId: track.reference.url });
    this.track = track;
    this.settings = difficulties[track.difficulty];
    this.field.setTrack(track);
    item("game").style.setProperty("--track-accent", this.field.palette.accent);
    item("game").style.setProperty("--track-secondary", this.field.palette.lanes[2]);
    this.slideCount = track.notes.filter(note => note.path).length;
    this.reset();
    this.showReady(false);
    this.resize();
    if (track.reference) this.connectStream();
    else item("start-button").focus({ preventScroll: true });
  }

  async connectStream() {
    const track = this.track;
    this.stream?.close();
    const stream = this.stream = new StreamLevel(track.reference);
    const button = item("start-button");
    button.disabled = true;
    item("play-error").hidden = true;
    item("ready-title").textContent = t(track.reference.provider);
    item("ready-detail").textContent = t("Подключаем плеер…");
    try {
      await stream.connect();
      this.applyPreferences();
      if (this.stream !== stream) return;
      this.showReady(false);
    } catch (error) {
      if (this.stream !== stream) return;
      stream.close();
      this.stream = null;
      item("ready-detail").textContent = t("Не удалось открыть трек");
      item("play-error").textContent = t(error.message || "Проверь ссылку на трек.");
      item("play-error").hidden = false;
      button.querySelector("span").textContent = t("Попробовать ещё раз");
    } finally {
      if (track === this.track) button.disabled = false;
    }
  }

  close() {
    this.pendingStart?.controller.abort();
    this.pendingStart = null;
    this.stopAudio();
    this.stream?.close();
    this.stream = null;
    this.phase = "idle";
    item("start-button").disabled = false;
    item("replay-button").disabled = false;
    this.comboAnimation?.cancel();
    this.clearInputs();
    this.setVideoBackdrop(false);
    this.track = null;
    this.notes = [];
  }

  reset() {
    this.notes = this.track.notes.map(note => ({ ...note, judged: false }));
    this.missCursor = 0;
    this.recentMisses = [-Infinity, -Infinity, -Infinity, -Infinity];
    this.displayProgress = -1;
    this.score = 0;
    this.good = 0;
    this.perfect = 0;
    this.misses = 0;
    this.resetCombo();
    this.maxCombo = 0;
    this.offset = 0;
    this.countText = "";
    this.feedbackUntil = 0;
    this.clearInputs();
    this.field.reset();
    this.clearFeedback();
    this.updateScores();
    this.updateProgress(0);
  }

  showReady(paused, focus = true) {
    this.phase = paused ? "paused" : "ready";
    this.setVideoBackdrop(false);
    item("pause-actions").hidden = !paused;
    item("pause-button").disabled = true;
    item("countdown").hidden = true;
    item("stage-overlay").hidden = false;
    item("combo").hidden = true;
    item("results-screen").hidden = true;
    item("ready-screen").hidden = false;
    item("play-error").hidden = true;
    item("ready-title").textContent = t(paused ? "Пауза" : "Уровень готов");
    item("ready-detail").textContent = this.settings.stars + " · " + t(this.settings.name) + " · " + formatNumber(this.notes.length) + t(" нот", " notes");
    if (this.track.reference && !paused) {
      item("ready-title").textContent = t(this.track.reference.provider);
      item("ready-detail").textContent = this.settings.stars + " · " + t(this.settings.name) + t(" · Ноты по заданному темпу", " · Tempo-based chart");
    }
    item("tempo-controls").hidden = paused;
    item("ready-hint").hidden = paused || !this.slideCount;
    item("resume-hint").hidden = !paused || !this.slide;
    item("start-button").querySelector("span").textContent = t(paused ? "Продолжить" : "Начать игру");
    const best = paused || !this.track.songId ? null : readBest(this.track);
    const record = item("ready-record");
    record.hidden = !best;
    record.textContent = best ? t("Твой рекорд ", "Personal best ") + formatNumber(best.score) : "";
    if (focus) item("start-button").focus({ preventScroll: true });
  }

  makeContext() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    this.context = new Audio();
    this.musicGain = this.context.createGain();
    this.musicGain.connect(this.context.destination);
    this.hitSounds = new HitSounds(this.context);
    this.applyPreferences();
    this.context.addEventListener("statechange", () => {
      if (this.context.state === "interrupted" || this.context.state === "suspended") this.pause(false);
    });
    return this.context;
  }

  applyPreferences() {
    if (this.musicGain) this.musicGain.gain.value = preferences.music / 100;
    if (this.hitSounds) this.hitSounds.output.gain.value = preferences.hits / 100;
    this.stream?.player?.setVolume?.(preferences.music / 100);
    this.field.setEffectsMode(preferences.effects);
  }

  setVideoBackdrop(active) {
    const enabled = Boolean(active && this.track?.reference?.provider === "YouTube");
    this.stage.parentElement.classList.toggle("video-backdrop", enabled);
    const panel = item("player-panel");
    panel.inert = enabled;
    if (enabled) panel.setAttribute("aria-hidden", "true");
    else panel.removeAttribute("aria-hidden");
  }

  async start(restart = false) {
    const previous = this.phase;
    if (!["ready", "paused", "finished"].includes(previous)) return;
    if (this.track.reference && !this.stream?.player) {
      if (!item("start-button").disabled) await this.connectStream();
      return;
    }
    const controller = new AbortController();
    this.pendingStart = { controller, previous };
    this.phase = "starting";
    const track = this.track;
    item("start-button").disabled = true;
    item("replay-button").disabled = true;
    item("play-error").hidden = true;
    try {
      const ctx = this.context || this.makeContext();
      const audioReady = ctx.resume();
      this.onStart?.();
      const resuming = previous === "paused" && !restart;
      item("pause-actions").hidden = true;
      if (this.stream) {
        const bpm = this.stream.tempo.valueAsNumber;
        const phase = this.stream.phase;
        item("tempo-controls").hidden = true;
        item("ready-screen").hidden = false;
        item("results-screen").hidden = true;
        item("ready-detail").textContent = t("Запускаем трек… Если нужно, нажми ▶ в плеере.");
        const [clock] = await Promise.all([this.stream.play(resuming ? this.offset : 0, resuming, controller.signal), audioReady]);
        if (controller.signal.aborted) return;
        if (!resuming) {
          Object.assign(track, tempoChart(track.reference, track.difficulty, clock.duration, bpm, phase));
          this.field.setTrack(track);
          this.slideCount = track.notes.filter(note => note.path).length;
          this.reset();
        }
        this.lastStreamTime = clock.time;
        this.lastStreamFrame = performance.now();
        this.phase = "playing";
        this.setVideoBackdrop(true);
        item("tempo-controls").hidden = true;
        item("combo").hidden = !this.combo;
      } else {
        await audioReady;
        if (controller.signal.aborted) return;
        if (!resuming) this.reset();
        this.sourceStart = ctx.currentTime + (resuming ? 2 : 3);
        this.source = ctx.createBufferSource();
        this.source.buffer = track.buffer;
        this.source.connect(this.musicGain);
        this.source.start(this.sourceStart, this.offset);
        this.phase = "countdown";
      }
      item("stage-overlay").hidden = true;
      item("pause-button").disabled = false;
      item("countdown").hidden = Boolean(this.stream);
      item("pause-button").focus({ preventScroll: true });
      if (document.hidden) this.pause(false);
      else this.tick();
    } catch (cause) {
      if (!controller.signal.aborted) {
        this.stopAudio();
        this.showReady(previous === "paused", false);
        const error = item("play-error");
        error.textContent = t(this.stream && cause.message ? cause.message : "Звук не запустился. Нажми кнопку ещё раз или открой игру в браузере.");
        error.hidden = false;
      }
    } finally {
      if (!controller.signal.aborted) {
        this.pendingStart = null;
        item("start-button").disabled = false;
        item("replay-button").disabled = false;
      }
    }
  }

  stopAudio() {
    if (this.animation) cancelAnimationFrame(this.animation);
    this.animation = 0;
    this.stream?.player?.pause();
    if (!this.source) return;
    try { this.source.stop(); } catch { /* The buffer may already have ended. */ }
    this.source.disconnect();
    this.source = null;
  }

  playedTime() {
    if (this.stream) return this.stream.player.read().time ?? this.lastStreamTime;
    return this.offset + audibleTime(this.context) - this.sourceStart;
  }

  pause(focus = true, time) {
    if (this.phase === "starting") {
      const { controller, previous } = this.pendingStart;
      controller.abort();
      this.pendingStart = null;
      this.stopAudio();
      this.showReady(previous === "paused", focus);
      item("start-button").disabled = false;
      item("replay-button").disabled = false;
      return;
    }
    if (!["countdown", "playing"].includes(this.phase)) {
      this.stream?.player?.pause();
      return;
    }
    time ??= this.playedTime();
    if (time >= this.track.duration + Math.max(0, this.timingOffset)) {
      this.finish();
      return;
    }
    this.offset = clamp(time, this.offset, Math.max(0, this.track.duration - .01));
    if (this.slide) {
      this.slide.holding = false;
      this.slide.resumeUntil = this.offset - this.timingOffset + .28;
      this.slide.offPathSince = null;
    }
    this.clearInputs(true);
    this.field.reset();
    this.stopAudio();
    this.clearFeedback();
    this.showReady(true, focus);
    this.draw(this.offset);
  }

  tick() {
    if (!["countdown", "playing"].includes(this.phase)) return;
    if (this.stream) {
      const clock = this.stream.player.read();
      const now = performance.now();
      const elapsed = (now - this.lastStreamFrame) / 1000;
      this.lastStreamFrame = now;
      if (clock.state === "ended") { this.finish(); return; }
      if (clock.state === "paused" || clock.state === "error" ||
          clock.time < this.lastStreamTime - .6 || clock.time - this.lastStreamTime > elapsed + 1.2) {
        this.pause(false, this.lastStreamTime);
        return;
      }
      if (clock.state === "buffering") {
        this.animation = requestAnimationFrame(this.tick);
        return;
      }
      this.lastStreamTime = clock.time;
    }
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
        item("combo").hidden = !this.combo;
      }
      const chartTime = time - this.timingOffset;
      this.updateSlide(chartTime);
      this.markMisses(chartTime);
      this.updateProgress(time);
      if (time >= this.track.duration + Math.max(0, this.timingOffset)) {
        this.finish();
        return;
      }
    }
    if (this.feedbackUntil && performance.now() > this.feedbackUntil) {
      this.clearFeedback();
      this.feedbackUntil = 0;
    }
    this.draw(time);
    this.animation = requestAnimationFrame(this.tick);
  }

  clearInputs(keepSlide = false) {
    this.pointers.clear();
    this.keys.clear();
    if (!keepSlide) this.slide = null;
    this.lightPads();
  }

  lightPads() {
    let pressed = 0;
    for (const lane of this.keys) pressed |= 1 << lane;
    for (const position of this.pointers.values()) pressed |= 1 << clamp(Math.round(position), 0, 3);
    if (this.field.pressedLanes === pressed) return;
    this.field.pressedLanes = pressed;
    this.buttons.forEach((button, lane) => button.classList.toggle("pressed", Boolean(pressed & (1 << lane))));
  }

  press(lane, canHold) {
    if (this.phase !== "playing") return;
    const time = this.playedTime() - this.timingOffset;
    this.updateSlide(time);
    this.markMisses(time);
    this.field.illuminate(lane);

    const hitWindow = this.settings.window;
    const feedbackWindow = hitWindow + .13;
    let closest;
    let otherLane = false;
    let delta = feedbackWindow;
    for (let i = this.missCursor; i < this.notes.length; i++) {
      const note = this.notes[i];
      const difference = time - note.time;
      if (difference < -feedbackWindow) break;
      if (note.judged || note === this.slide?.note) continue;
      if (note.lane !== lane && Math.abs(difference) <= hitWindow) otherLane = true;
      if (note.lane === lane && (!closest || Math.abs(difference) < Math.abs(delta)) && Math.abs(difference) <= feedbackWindow) {
        closest = note;
        delta = difference;
      }
    }
    if (!closest || Math.abs(delta) > hitWindow) {
      this.hitSounds.play();
      if (this.slide) return;
      const late = time - this.recentMisses[lane];
      if (late < Math.abs(delta)) delta = late;
      if (closest || late < feedbackWindow) {
        this.feedback(delta < 0 ? "Рано" : "Поздно", "#ffceb9", this.timingText(delta, false));
      } else if (otherLane) this.feedback("Другая дорожка", "#ffceb9");
      return;
    }

    const perfect = Math.abs(delta) <= this.settings.perfectWindow;
    if (closest.path) {
      if (this.slide) return;
      if (!canHold) {
        this.feedback("Удерживай клавишу", "#e1c2ff");
        return;
      }
      this.hitSounds.play(true);
      this.slide = {
        note: closest, perfect, delta, checkpoint: 1, time, holding: true,
        nextTick: closest.time + slideTick, offPathSince: null, resumeUntil: -Infinity
      };
      this.field.illuminate(lane, 8);
      this.feedback("Удерживай", "#e1c2ff");
    } else {
      this.hit(closest, perfect, lane, delta);
    }
  }

  slideTouches(min, max) {
    for (const position of this.keys) {
      if (position >= min && position <= max) return true;
    }
    for (const position of this.pointers.values()) {
      if (position >= min && position <= max) return true;
    }
    return false;
  }

  updateSlide(time) {
    const slide = this.slide;
    if (!slide) return;
    time = slide.time = Math.max(time, slide.time);
    const path = slide.note.path;
    const end = path.at(-1);
    const grace = this.settings.slideGrace;
    if (slide.offPathSince !== null && time > Math.max(slide.offPathSince + grace, slide.resumeUntil)) {
      this.failSlide(time, this.slideFailure("Удержание ушло с маршрута"));
      return;
    }
    const checkpoint = path[slide.checkpoint];
    if (checkpoint) {
      const previous = path[slide.checkpoint - 1];
      const lead = Math.min(.13, (checkpoint.time - previous.time) * .42);
      const deadline = Math.max(checkpoint.time + grace, slide.resumeUntil);
      if (time > deadline) {
        this.failSlide(time, this.slideFailure(checkpoint === end ? "Конец на другой дорожке" : "Пропущен поворот"));
        return;
      }
      if (time >= checkpoint.time - lead && this.slideTouches(checkpoint.lane - slideLaneTolerance, checkpoint.lane + slideLaneTolerance)) {
        slide.checkpoint++;
        if (checkpoint !== end) this.field.illuminate(checkpoint.lane, 10);
      }
    }

    const from = path[slide.checkpoint - 1];
    const to = path[slide.checkpoint] ?? from;
    const incoming = time <= from.time + .08 ? (path[slide.checkpoint - 2] ?? from) : from;
    const wasHolding = slide.holding;
    slide.holding = this.slideTouches(
      Math.min(incoming.lane, from.lane, to.lane) - slideLaneTolerance,
      Math.max(incoming.lane, from.lane, to.lane) + slideLaneTolerance
    );
    slide.offPathSince = slide.holding ? null : (slide.offPathSince ?? time);
    const lane = laneAt(path, time);
    while (slide.nextTick <= time && slide.nextTick < end.time - releaseLead) {
      const tickTime = slide.nextTick;
      slide.nextTick += slideTick;
      if (!slide.holding || (!wasHolding && tickTime < time - .015)) continue;
      this.increaseCombo(lane);
      this.field.illuminate(lane, 5);
      this.updateCombo();
    }
    if (slide.checkpoint !== path.length || time < end.time) return;
    if (this.slideTouches(end.lane - slideLaneTolerance, end.lane + slideLaneTolerance)) this.completeSlide();
    else if (time > Math.max(end.time + grace, slide.resumeUntil)) {
      this.failSlide(time, this.slideFailure("Конец на другой дорожке"));
    }
  }

  slideFailure(fallback) {
    return this.keys.size || this.pointers.size ? fallback : "Отпущен раньше конца";
  }

  releasePointer(event, cancelled) {
    if (!this.pointers.has(event.pointerId)) return;
    const time = this.slide && this.phase === "playing" ? this.playedTime() - this.timingOffset : null;
    if (time !== null && !cancelled) {
      const position = this.field.lanePosition(event.clientX, event.clientY);
      this.pointers.set(event.pointerId, position);
      this.releaseSlideInput(time, position);
    }
    this.pointers.delete(event.pointerId);
    if (time !== null) this.updateSlide(time);
    this.lightPads();
  }

  releaseSlideInput(time, position) {
    this.updateSlide(time);
    const slide = this.slide;
    if (!slide) return;
    const path = slide.note.path;
    const end = path.at(-1);
    if (slide.checkpoint === path.length && slide.time >= end.time - releaseLead &&
        Math.abs(position - end.lane) <= slideLaneTolerance) this.completeSlide();
  }

  completeSlide() {
    const { note, perfect, delta } = this.slide;
    this.slide = null;
    this.hit(note, perfect, note.path.at(-1).lane, delta);
  }

  failSlide(time, reason) {
    const { note } = this.slide;
    this.slide = null;
    this.field.fadeSlide(note, time, true);
    note.judged = true;
    this.misses++;
    this.resetCombo();
    this.feedback("Слайд сорван", "#ffceb9", reason);
    this.updateScores();
  }

  hit(note, perfect, lane, delta) {
    this.hitSounds.play(true, perfect);
    if (preferences.vibration) navigator.vibrate?.(perfect ? 12 : 8);
    note.judged = true;
    this.increaseCombo(lane);
    this.scoringCombo++;
    if (perfect) this.perfect++;
    else this.good++;
    const points = perfect ? 1000 : 650;
    this.score += (note.path ? Math.round(points * 1.45) : points) + Math.min((this.scoringCombo - 1) * 12, 360);
    this.field.illuminate(lane, note.path ? 25 : perfect ? 19 : 10);
    this.feedback(perfect ? "Идеально" : "Хорошо", perfect ? "#ffa9dc" : "#9decf5",
      this.timingText(delta));
    this.updateScores();
  }

  increaseCombo(lane) {
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const tier = comboTier(this.combo);
    if (tier) this.field.celebrate(lane, this.combo, tier);
  }

  resetCombo() {
    this.combo = 0;
    this.scoringCombo = 0;
  }

  markMisses(time, all = false) {
    let changed = false;
    while (this.missCursor < this.notes.length) {
      const note = this.notes[this.missCursor];
      if (!all && (note === this.slide?.note || note.time >= time - this.settings.window)) break;
      this.missCursor++;
      if (note.judged) continue;
      note.judged = true;
      if (note.path && !all) this.field.fadeSlide(note, note.time, false);
      this.recentMisses[note.lane] = note.time;
      this.misses++;
      this.resetCombo();
      changed = true;
    }
    if (changed) {
      this.updateScores();
      if (!all && this.feedbackUntil + 50 < performance.now()) this.feedback("Пропуск", "#d0b5ec");
    }
  }

  timingText(delta, withDirection = true) {
    const milliseconds = Math.round(Math.abs(delta) * 1000);
    const side = t(delta < 0 ? "Рано" : "Поздно");
    return (withDirection && milliseconds ? side + " · " : "") + milliseconds + t(" мс", " ms");
  }

  clearFeedback() {
    this.stage.style.removeProperty("--judgement-color");
    this.feedbackAnimation?.cancel();
    this.feedbackAnimation = null;
    item("judgement").textContent = "";
    item("judgement-detail").textContent = "";
  }

  feedback(label, color, detail = "") {
    const judgement = item("judgement");
    judgement.textContent = t(label);
    judgement.style.color = color;
    this.stage.style.setProperty("--judgement-color", color);
    item("judgement-detail").textContent = t(detail);
    const message = item("judgement-message");
    const moving = !this.field.motion?.matches;
    this.feedbackAnimation?.cancel();
    this.feedbackAnimation = message.animate?.([
      { opacity: .85, transform: moving ? "scale(1.22)" : "none" },
      { opacity: 1, transform: "none", offset: .22 },
      { opacity: 1, transform: "none", offset: .62 },
      { opacity: 0, transform: moving ? "translateY(-4px)" : "none" }
    ], { duration: feedbackDuration, fill: "both" });
    this.feedbackUntil = performance.now() + feedbackDuration;
  }

  accuracy() {
    const judged = this.perfect + this.good + this.misses;
    return judged ? percent((this.perfect + this.good * .65) / judged) : "—";
  }

  updateScores() {
    item("score").textContent = formatNumber(this.score);
    this.updateCombo();
    item("accuracy").textContent = this.accuracy();
  }

  updateCombo() {
    const previous = this.displayedCombo ?? 0;
    if (this.combo === previous) return;
    const label = item("combo");
    label.textContent = formatNumber(this.combo);
    label.setAttribute("aria-label", t("Комбо ", "Combo ") + this.combo);
    label.hidden = !this.combo;
    this.displayedCombo = this.combo;

    const scale = 1 + Math.min(.33, Math.log2(1 + this.combo / 7) * .105);
    const stable = "scale(" + scale + ")";
    label.style.setProperty("--combo-scale", scale);
    const increasing = this.combo > previous;
    const tier = increasing ? comboTier(this.combo) : 0;
    if (increasing && tier < this.comboAnimationTier && this.comboAnimation?.playState === "running") return;
    this.comboAnimation?.cancel();
    label.style.color = "";
    if (!increasing || this.field.motion.matches || !label.animate) return;

    this.comboAnimationTier = tier;
    const effect = comboTiers[tier];
    if (effect) label.style.color = effect.color;
    const frames = effect ? [
      { transform: stable },
      { transform: `translateX(${-effect.shake}px) rotate(${-effect.shake}deg) scale(${scale + effect.scale})`, offset: .2 },
      { transform: `translateX(${effect.shake}px) rotate(${effect.shake * .7}deg) scale(${scale + effect.scale * .5})`, offset: .42 },
      { transform: `translateX(${-effect.shake * .4}px) scale(${scale + effect.scale * .2})`, offset: .64 },
      { transform: stable }
    ] : [
      { transform: stable },
      { transform: "scale(" + (scale + .075) + ")", offset: .3 },
      { transform: stable }
    ];
    this.comboAnimation = label.animate(frames, { duration: effect?.duration ?? 155, easing: "ease-out" });
    if (effect) this.comboAnimation.onfinish = () => { label.style.color = ""; };
  }

  updateProgress(time) {
    const progress = clamp(time / (this.track.duration || 1), 0, 1);
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
    this.setVideoBackdrop(false);
    this.phase = "finished";
    item("tempo-controls").hidden = false;
    item("combo").hidden = true;
    this.clearInputs();
    this.markMisses(this.track.duration, true);
    this.updateProgress(this.track.duration);
    item("pause-button").disabled = true;
    item("countdown").hidden = true;
    this.clearFeedback();
    item("ready-screen").hidden = true;
    item("stage-overlay").hidden = false;
    item("results-screen").hidden = false;
    item("result-score").textContent = formatNumber(this.score);
    item("result-accuracy").textContent = this.accuracy();
    item("result-combo").textContent = formatNumber(this.maxCombo);
    this.showRecord();
    item("result-hits").textContent = t("Попадания — ", "Hits — ") + formatNumber(this.perfect + this.good) + t(" из ", " of ") + formatNumber(this.notes.length);
    this.draw(this.track.duration);
    item("replay-button").focus({ preventScroll: true });
  }

  showRecord() {
    const { best, improved, saved } = finishRecord(this.track, this.score);
    const summary = item("result-record");
    summary.hidden = !best && !this.score;
    summary.classList.toggle("record-improved", improved);
    if (!saved && this.score) summary.textContent = t("Браузер не сохранил рекорд.");
    else if (improved) summary.textContent = t("Новый личный рекорд · ", "New personal best · ") + formatNumber(best.score);
    else if (best) {
      const gap = formatNumber(Math.max(0, best.score - this.score));
      summary.textContent = this.score === best.score
        ? t("Повторён личный рекорд · ", "Matched personal best · ") + formatNumber(best.score)
        : t("Рекорд ", "Personal best ") + formatNumber(best.score) + t(" · До него ", " · Points to beat it: ") + gap;
    }
  }

  resize() {
    if (!this.track) return;
    this.field.resize();
    const stateTime = { ready: -.9, paused: this.offset, finished: this.track.duration };
    this.draw(stateTime[this.phase] ?? (this.phase === "playing" ? this.playedTime() : this.offset));
  }

  draw(time) {
    this.field.draw(this.notes, this.missCursor, time - this.timingOffset, this.settings, this.slide, this.phase === "playing");
  }
}
