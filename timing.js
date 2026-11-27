import { t } from "./i18n.js?v=15";
const preference = "ritm-timing-offset";
const limit = 220;
const beat = .56;
const tapsNeeded = 8;
const item = id => document.getElementById(id);
const clamp = value => Math.max(-limit, Math.min(limit, Math.round(value)));
const display = value => (value > 0 ? "+" : value < 0 ? "−" : "") + Math.abs(value) + t(" мс", " ms");

export function timingOffset() {
  try {
    const value = Number(localStorage.getItem(preference));
    return Number.isFinite(value) ? clamp(value) / 1000 : 0;
  } catch {
    return 0;
  }
}

export function audibleTime(context) {
  const timestamp = context.getOutputTimestamp?.();
  const predicted = timestamp?.contextTime + (performance.now() - timestamp?.performanceTime) / 1000;
  const lag = Math.max(0, Math.min(.24, context.outputLatency || context.baseLatency || 0));
  return timestamp?.contextTime > 0 && Math.abs(context.currentTime - predicted) < .3
    ? Math.min(predicted, context.currentTime)
    : context.currentTime - lag;
}

export function bindCalibration(onOpen, onClose) {
  const dialog = item("timing-dialog");
  const slider = item("timing-value");
  const output = item("timing-output");
  const start = item("timing-start");
  const tap = item("timing-tap");
  const status = item("timing-status");
  let context;
  let timer;
  let firstBeat;
  let lastTap;
  let samples;
  let applied = Math.round(timingOffset() * 1000);

  const show = value => {
    slider.value = value;
    output.textContent = display(value);
  };

  function stop() {
    clearInterval(timer);
    context?.close().catch(() => {});
    context = null;
    tap.disabled = true;
    start.disabled = false;
  }

  slider.addEventListener("input", () => show(Number(slider.value)));
  item("timing-reset").addEventListener("click", () => show(0));
  item("timing-save").addEventListener("click", () => {
    applied = clamp(Number(slider.value));
    try { localStorage.setItem(preference, String(applied)); } catch { /* Apply for this visit. */ }
    dialog.close();
  });

  const open = () => {
    const resume = onOpen();
    if (resume === false) return;
    show(applied);
    status.textContent = "";
    dialog.showModal();
  };
  item("timing-button").addEventListener("click", open);
  dialog.addEventListener("close", () => {
    stop();
    onClose(applied / 1000);
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden || !context) return;
    stop();
    status.textContent = t("Запусти тест ещё раз.");
  });

  start.addEventListener("click", async () => {
    stop();
    start.disabled = true;
    status.textContent = t("Запускаем метроном…");
    let trial;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      trial = context = new Audio();
      await trial.resume();
      if (context !== trial) return;
      firstBeat = trial.currentTime + .48;
      lastTap = -1;
      samples = [];
      let scheduled = 0;
      const schedule = () => {
        const horizon = trial.currentTime + .24;
        while (firstBeat + scheduled * beat < horizon) {
          const time = firstBeat + scheduled++ * beat;
          if (time < trial.currentTime) continue;
          const note = trial.createOscillator();
          const level = trial.createGain();
          note.frequency.value = 950;
          level.gain.setValueAtTime(.14, time);
          level.gain.exponentialRampToValueAtTime(.001, time + .045);
          note.connect(level).connect(trial.destination);
          note.start(time);
          note.stop(time + .05);
        }
      };
      schedule();
      timer = setInterval(schedule, 80);
      tap.disabled = false;
      status.textContent = t("Нажатия 0 из " + tapsNeeded, "Taps 0 of " + tapsNeeded);
      tap.focus({ preventScroll: true });
    } catch {
      if (!dialog.open || (trial && trial !== context)) return;
      stop();
      status.textContent = t("Звук недоступен. Смещение можно настроить вручную.");
    }
  });

  function takeTap() {
    if (!context || tap.disabled) return;
    const elapsed = audibleTime(context) - firstBeat;
    const index = Math.round(elapsed / beat);
    const difference = elapsed - index * beat;
    if (index <= lastTap || Math.abs(difference) > .245) return;
    lastTap = index;
    samples.push(difference * 1000);
    status.textContent = t("Нажатия " + samples.length + " из " + tapsNeeded, "Taps " + samples.length + " of " + tapsNeeded);
    if (samples.length < tapsNeeded) return;
    const measured = samples.slice(2).sort((left, right) => left - right);
    const middle = measured.length / 2;
    const estimate = clamp((measured[middle - 1] + measured[middle]) / 2);
    stop();
    if (measured.at(-2) - measured[1] > 130) {
      status.textContent = t("Темп нажатий менялся. Попробуй ещё раз.");
      start.focus();
      return;
    }
    show(estimate);
    status.textContent = t("Измеренное смещение ", "Measured offset ") + display(estimate) + ".";
    item("timing-save").focus();
  }
  tap.addEventListener("pointerdown", event => {
    if (event.button === 0) takeTap();
  });
  tap.addEventListener("click", event => {
    if (event.detail === 0) takeTap();
  });
}
