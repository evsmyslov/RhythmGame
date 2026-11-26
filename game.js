import { difficulties } from "./audio.js?v=12";
import { GameField, laneAt } from "./game-field.js?v=12";
import { HitSounds } from "./sound.js?v=12";
import { audibleTime, timingOffset } from "./timing.js?v=12";
import { finishRecord, readBest } from "./records.js?v=12";
const checkpointLead = .06;
const releaseLead = .055;
const feedbackDuration = 560;
const keyLanes = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };
const formatNumber = new Intl.NumberFormat("ru");
const percent = value => Math.round(value * 100) + "%";
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const item = id => document.getElementById(id);

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
    item("pause-button").addEventListener("click", () => this.pause());
    const controls = item("lane-controls");
    controls.addEventListener("pointerdown", event => {
      if (event.button !== 0 || this.phase !== "playing") return;
      event.preventDefault();
      const position = this.field.lanePosition(event.clientX, event.clientY);
      const lane = clamp(Math.round(position), 0, 3);
      controls.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, position);
      this.lightPads();
      this.press(lane, { pointer: event.pointerId });
    });
    controls.addEventListener("pointermove", event => {
      if (!this.pointers.has(event.pointerId)) return;
      this.pointers.set(event.pointerId, this.field.lanePosition(event.clientX, event.clientY));
      this.lightPads();
      if (this.slide && !this.slide.input.keyboard) this.updateSlide(this.playedTime() - this.timingOffset);
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
    this.field.setTrack(track);
    item("game").style.setProperty("--track-accent", this.field.palette.accent);
    item("game").style.setProperty("--track-secondary", this.field.palette.lanes[2]);
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
    this.recentMisses = [-Infinity, -Infinity, -Infinity, -Infinity];
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
    this.clearFeedback();
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
    const best = paused ? null : readBest(this.track);
    const record = item("ready-record");
    record.hidden = !best;
    record.textContent = best ? "Твой рекорд " + formatNumber.format(best.score) : "";
    if (focus) item("start-button").focus({ preventScroll: true });
  }

  makeContext() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    this.context = new Audio();
    this.hitSounds = new HitSounds(this.context);
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
      const audioReady = ctx.resume();
      this.onStart?.();
      await audioReady;
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
    return this.offset + audibleTime(this.context) - this.sourceStart;
  }

  pause(focus = true) {
    if (!["countdown", "playing"].includes(this.phase)) return;
    const time = this.playedTime();
    if (time >= this.track.duration + Math.max(0, this.timingOffset)) {
      this.finish();
      return;
    }
    const resumeTime = this.slide ? Math.max(0, this.slide.note.time + this.timingOffset - .23) : time;
    this.offset = clamp(resumeTime, this.offset, Math.max(0, this.track.duration - .01));
    this.clearInputs();
    this.field.reset();
    this.stopAudio();
    this.clearFeedback();
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

  clearInputs() {
    this.pointers.clear();
    this.keys.clear();
    this.slide = null;
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

  press(lane, input) {
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
      if (note.lane === lane && Math.abs(difference) <= Math.abs(delta)) {
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

    const perfect = Math.abs(delta) <= hitWindow * .46;
    if (closest.path) {
      if (this.slide) return;
      if (!input) {
        this.feedback("Удерживай клавишу", "#e1c2ff");
        return;
      }
      this.hitSounds.play(true);
      this.slide = {
        note: closest, input, perfect, delta, checkpoint: 1, lastLane: lane,
        offPathSince: null, releaseReason: ""
      };
      this.field.illuminate(lane, 8);
      this.feedback("Удерживай", "#e1c2ff");
    } else {
      this.hit(closest, perfect, lane, delta);
    }
  }

  slideTouches(min, max) {
    const positions = this.slide.input.keyboard ? this.keys : this.pointers.values();
    for (const position of positions) {
      if (position >= min && position <= max) return true;
    }
    return false;
  }

  updateSlide(time) {
    const slide = this.slide;
    if (!slide) return;
    const path = slide.note.path;
    const end = path.at(-1);
    const grace = Math.max(.115, this.settings.window * .83);
    const checkpoint = path[slide.checkpoint];
    if (checkpoint && time >= checkpoint.time - checkpointLead) {
      if (time <= checkpoint.time + grace &&
          this.slideTouches(checkpoint.lane - .57, checkpoint.lane + .57)) {
        slide.checkpoint++;
      } else if (time > checkpoint.time + grace) {
        this.failSlide(time, slide.releaseReason || (checkpoint === end ? "Конец на другой дорожке" : "Пропущен поворот"));
        return;
      }
    }

    if (time >= end.time && slide.checkpoint === path.length &&
        this.slideTouches(end.lane - .57, end.lane + .57)) {
      this.completeSlide();
      return;
    }
    if (time > end.time + grace) {
      this.failSlide(time, slide.releaseReason || "Конец на другой дорожке");
      return;
    }

    const lane = laneAt(path, time);
    const behind = laneAt(path, time - .085);
    const ahead = laneAt(path, time + .07);
    const min = Math.min(lane, behind, ahead) - .58;
    const max = Math.max(lane, behind, ahead) + .58;
    if (this.slideTouches(min, max)) {
      slide.offPathSince = null;
      slide.releaseReason = "";
      const nearest = Math.round(lane);
      if (nearest !== slide.lastLane) {
        slide.lastLane = nearest;
        this.field.illuminate(lane, 10);
      }
    } else {
      slide.offPathSince ??= time;
      if (time - slide.offPathSince > grace) {
        this.failSlide(time, slide.releaseReason || "Удержание ушло с маршрута");
      }
    }
  }

  releasePointer(event, cancelled) {
    if (!this.pointers.has(event.pointerId)) return;
    if (this.slide && !this.slide.input.keyboard) {
      const time = this.playedTime() - this.timingOffset;
      if (!cancelled) {
        const position = this.field.lanePosition(event.clientX, event.clientY);
        this.pointers.set(event.pointerId, position);
        this.updateSlide(time);
        if (this.slide) {
          const path = this.slide.note.path;
          const end = path.at(-1);
          if (this.slide.checkpoint === path.length && time >= end.time - releaseLead &&
              Math.abs(position - end.lane) <= .57) this.completeSlide();
        }
      }
      this.pointers.delete(event.pointerId);
      if (this.slide && !this.pointers.size) {
        this.slide.offPathSince ??= time;
        this.slide.releaseReason = cancelled ? "Удержание прервано" : "Отпущен раньше конца";
      }
    } else this.pointers.delete(event.pointerId);
    this.lightPads();
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
    this.combo = 0;
    this.feedback("Слайд сорван", "#ffceb9", reason);
    this.updateScores();
  }

  hit(note, perfect, lane, delta) {
    this.hitSounds.play(true, perfect);
    note.judged = true;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    if (perfect) this.perfect++;
    else this.good++;
    const points = perfect ? 1000 : 650;
    this.score += (note.path ? Math.round(points * 1.45) : points) + Math.min((this.combo - 1) * 12, 360);
    this.field.illuminate(lane, note.path ? 25 : perfect ? 19 : 10);
    if (this.combo % 10 === 0) this.field.celebrate(lane, this.combo);
    this.feedback(perfect ? "Идеально" : "Хорошо", perfect ? "#ffa9dc" : "#9decf5",
      this.timingText(delta));
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
      if (note.path && !all) this.field.fadeSlide(note, note.time, false);
      this.recentMisses[note.lane] = note.time;
      this.misses++;
      this.combo = 0;
      changed = true;
    }
    if (changed) {
      this.updateScores();
      if (!all && this.feedbackUntil + 50 < performance.now()) this.feedback("Пропуск", "#d0b5ec");
    }
  }

  timingText(delta, withDirection = true) {
    const milliseconds = Math.round(Math.abs(delta) * 1000);
    const side = delta < 0 ? "Рано" : "Поздно";
    return (withDirection && milliseconds ? side + " · " : "") + milliseconds + " мс";
  }

  clearFeedback() {
    this.feedbackAnimation?.cancel();
    this.feedbackAnimation = null;
    item("judgement").textContent = "";
    item("judgement-detail").textContent = "";
  }

  feedback(label, color, detail = "") {
    const judgement = item("judgement");
    judgement.textContent = label;
    judgement.style.color = color;
    item("judgement-detail").textContent = detail;
    const message = item("judgement-message");
    const moving = !this.field.motion?.matches;
    this.feedbackAnimation?.cancel();
    this.feedbackAnimation = message.animate?.([
      { opacity: 0, transform: moving ? "translateY(5px) scale(.99)" : "none" },
      { opacity: 1, transform: "none", offset: .14 },
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
      { transform: "translateX(-5px) rotate(-9deg) scale(" + (scale + .48) + ")", color: "#fff8ce", offset: .2 },
      { transform: "translateX(5px) rotate(7deg) scale(" + (scale + .24) + ")", color: "#d5fdff", offset: .42 },
      { transform: "translateX(-2px) rotate(-4deg) scale(" + (scale + .13) + ")", color: "#efc5ff", offset: .62 },
      { transform: stable }
    ] : [
      { transform: stable },
      { transform: "scale(" + (scale + .075) + ")", offset: .3 },
      { transform: stable }
    ];
    this.comboAnimation = label.animate(frames, { duration: milestone ? 660 : 160, easing: "ease-out" });
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
    this.clearFeedback();
    item("ready-screen").hidden = true;
    item("stage-overlay").hidden = false;
    item("results-screen").hidden = false;
    item("result-score").textContent = formatNumber.format(this.score);
    item("result-accuracy").textContent = this.accuracy();
    item("result-combo").textContent = formatNumber.format(this.maxCombo);
    this.showRecord();
    item("result-hits").textContent = "Попадания — " + formatNumber.format(this.perfect + this.good) + " из " + formatNumber.format(this.notes.length);
    this.draw(this.track.duration);
    item("replay-button").focus({ preventScroll: true });
  }

  showRecord() {
    const { best, improved, saved } = finishRecord(this.track, this.score);
    const summary = item("result-record");
    summary.hidden = !best && !this.score;
    summary.classList.toggle("record-improved", improved);
    if (!saved && this.score) summary.textContent = "Браузер не сохранил рекорд.";
    else if (improved) summary.textContent = "Новый личный рекорд · " + formatNumber.format(best.score);
    else if (best) {
      const gap = formatNumber.format(Math.max(0, best.score - this.score));
      summary.textContent = this.score === best.score
        ? "Повторён личный рекорд · " + formatNumber.format(best.score)
        : "Рекорд " + formatNumber.format(best.score) + " · До него " + gap;
    }
  }

  resize() {
    if (!this.track) return;
    this.field.resize();
    const stateTime = { ready: -.9, paused: this.offset, finished: this.track.duration };
    this.draw(stateTime[this.phase] ?? (this.phase === "playing" ? this.playedTime() : this.offset));
  }

  draw(time) {
    this.field.draw(this.notes, this.missCursor, time - this.timingOffset, this.settings.approach, this.slide?.note, this.phase === "playing");
  }
}
