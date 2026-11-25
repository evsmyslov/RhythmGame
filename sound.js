const lobbyPreference = "ritm-lobby-music";

export class LobbyMusic {
  constructor(audio, button) {
    this.audio = audio;
    this.button = button;
    this.inLobby = true;
    this.activated = false;
    this.enabled = true;
    try {
      this.enabled = localStorage.getItem(lobbyPreference) !== "off";
    } catch { /* Storage may be unavailable in a private tab. */ }

    for (const event of ["play", "pause", "error"]) {
      audio.addEventListener(event, () => this.updateButton());
    }
    button.addEventListener("click", () => {
      this.enabled = audio.paused;
      this.activated = true;
      try {
        localStorage.setItem(lobbyPreference, this.enabled ? "on" : "off");
      } catch { /* The setting still takes effect for this visit. */ }
      this.sync();
    });

    const activate = event => {
      if (!this.inLobby || button.contains(event.target) || event.repeat) return;
      this.activated = true;
      this.sync();
    };
    document.addEventListener("click", activate, true);
    document.addEventListener("keydown", activate, true);
    document.addEventListener("visibilitychange", () => this.sync());
    window.addEventListener("pagehide", () => audio.pause());
    window.addEventListener("pageshow", () => this.sync());
    this.updateButton();
  }

  setInLobby(value) {
    this.inLobby = value;
    this.sync();
  }

  sync() {
    if (!this.inLobby || !this.enabled || document.hidden) {
      this.audio.pause();
    } else if (this.activated && this.audio.paused) {
      this.audio.play()?.catch(() => this.updateButton());
    }
    this.updateButton();
  }

  updateButton() {
    const playing = !this.audio.paused && !this.audio.error;
    this.button.setAttribute("aria-pressed", String(playing));
    this.button.title = playing ? "Выключить музыку в лобби" : "Включить музыку в лобби";
    this.button.querySelector("use").setAttribute("href", playing ? "#i-volume" : "#i-volume-off");
  }
}

export class HitSounds {
  constructor(context) {
    this.context = context;
    this.lastTime = -Infinity;
    this.lastWasHit = false;
    this.tap = this.makeBuffer(false);
    this.hit = this.makeBuffer(true);
  }

  makeBuffer(hit) {
    const rate = this.context.sampleRate;
    const duration = hit ? .044 : .025;
    const buffer = this.context.createBuffer(1, Math.ceil(duration * rate), rate);
    const samples = buffer.getChannelData(0);
    const frequency = hit ? 1110 : 760;
    const voice = hit ? .068 : .023;
    let seed = 57;
    for (let i = 0; i < samples.length; i++) {
      const time = i / rate;
      seed = (1664525 * seed + 1013904223) >>> 0;
      const noise = seed / 0x80000000 - 1;
      const phase = 2 * Math.PI * (frequency * time - 1800 * time * time);
      const envelope = Math.min(1, time * 810, Math.max(0, duration - time) * 230) * Math.exp(-time * (hit ? 92 : 153));
      samples[i] = voice * envelope * (.77 * Math.sin(phase) + .12 * Math.sin(phase * 1.75) + .11 * noise);
    }
    return buffer;
  }

  play(hit = false, perfect = false) {
    const ctx = this.context;
    if (ctx.state !== "running") return;
    const now = ctx.currentTime;
    if (now - this.lastTime < .015 && (!hit || this.lastWasHit)) return;
    const cue = ctx.createBufferSource();
    cue.buffer = hit ? this.hit : this.tap;
    cue.playbackRate.value = perfect ? 1.12 : 1;
    cue.connect(ctx.destination);
    cue.onended = () => cue.disconnect();
    cue.start();
    this.lastTime = now;
    this.lastWasHit = hit;
  }
}
