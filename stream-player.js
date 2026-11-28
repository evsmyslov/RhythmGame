// Keep playback inside the provider's player. Its transport is also the clock for scoring.
const libraries = new Map();
const unavailable = "Плеер недоступен. Проверь доступ к треку или выбери его аудиофайл.";

function library(url, callback, getAPI) {
  if (getAPI()) return Promise.resolve(getAPI());
  if (libraries.has(url)) return libraries.get(url);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timer = setTimeout(failed, 16000);
    function done(api) {
      clearTimeout(timer);
      resolve(api || getAPI());
    }
    function failed() {
      clearTimeout(timer);
      script.remove();
      libraries.delete(url);
      reject(new Error(unavailable));
    }
    if (callback) window[callback] = done;
    else script.onload = () => getAPI() ? done() : failed();
    script.onerror = failed;
    script.src = url;
    document.head.append(script);
  });
  libraries.set(url, promise);
  return promise;
}

export async function waitFor(read, signal, message, timeout = 16000) {
  const deadline = performance.now() + timeout;
  while (true) {
    signal.throwIfAborted();
    const value = read();
    if (value) return value;
    if (performance.now() >= deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 60));
  }
}

function eventClock(maxInterpolation = Infinity) {
  let position = 0;
  let stamp = 0;
  let state = "paused";
  let duration = 0;
  return {
    update(seconds, nextState, length = duration) {
      position = Number.isFinite(seconds) ? seconds : this.read().time;
      state = nextState;
      duration = length || duration;
      stamp = performance.now();
    },
    read() {
      const elapsed = state === "playing" ? (performance.now() - stamp) / 1000 : 0;
      return { time: Math.min(duration || Infinity, position + Math.min(elapsed, maxInterpolation)), duration, state };
    }
  };
}

async function youtube(reference, host, signal) {
  const YT = await library("https://www.youtube.com/iframe_api", "onYouTubeIframeAPIReady", () => window.YT?.Player && window.YT);
  signal.throwIfAborted();
  let ready = false;
  let failed = false;
  const target = host.appendChild(document.createElement("div"));
  const player = new YT.Player(target, {
    videoId: reference.id, host: "https://www.youtube-nocookie.com", width: "100%", height: "100%",
    playerVars: { playsinline: 1, origin: location.origin, rel: 0 },
    events: { onReady: () => { ready = true; }, onError: () => { failed = true; } }
  });
  signal.addEventListener("abort", () => player.destroy(), { once: true });
  await waitFor(() => failed || ready, signal, unavailable);
  if (failed) throw new Error(unavailable);
  return {
    read() {
      const state = player.getPlayerState();
      return { time: player.getCurrentTime() || 0, duration: player.getDuration(),
        state: failed ? "error" : state === 0 ? "ended" : state === 1 ? "playing" : state === 3 ? "buffering" : "paused" };
    },
    start(seconds, resume) {
      if (!resume || Math.abs(player.getCurrentTime() - seconds) > .7) player.seekTo(seconds, true);
      player.playVideo();
    },
    setVolume: value => player.setVolume(value * 100),
    pause: () => player.pauseVideo()
  };
}

async function spotify(reference, host, signal) {
  let id = reference.id;
  if (!id) {
    const response = await fetch("https://open.spotify.com/oembed?url=" + encodeURIComponent(reference.url), { signal });
    if (response.ok) {
      const { html } = await response.json();
      id = /open\.spotify\.com\/embed\/track\/([A-Za-z0-9]{22})/.exec(html)?.[1];
    }
    if (!id) throw new Error("Скопируй полную ссылку на трек из Spotify.");
  }
  const api = await library("https://open.spotify.com/embed/iframe-api/v1", "onSpotifyIframeApiReady", () => undefined);
  signal.throwIfAborted();
  const clock = eventClock();
  let player;
  let ready = false;
  let failed = false;
  const uri = "spotify:track:" + id;
  api.createController(host.appendChild(document.createElement("div")), { uri, width: "100%", height: "100%" }, controller => {
    if (signal.aborted) { controller.destroy(); return; }
    player = controller;
    signal.addEventListener("abort", () => controller.destroy(), { once: true });
    controller.addListener("ready", () => { ready = true; });
    controller.addListener("error", () => { failed = true; });
    controller.addListener("playback_update", ({ data }) => {
      if (data.playingURI && data.playingURI !== uri) { failed = true; return; }
      const previous = clock.read();
      const time = data.position / 1000;
      const duration = data.duration / 1000;
      const ended = data.isPaused && duration > 0 && (time >= duration - .2 ||
        (time === 0 && previous.time >= duration - .8));
      clock.update(time, ended ? "ended" : data.isBuffering ? "buffering" : data.isPaused ? "paused" : "playing", duration);
    });
  });
  await waitFor(() => ready || failed, signal, unavailable);
  if (failed) throw new Error(unavailable);
  return {
    read: () => failed ? { state: "error" } : clock.read(),
    start(seconds, resume) {
      if (!resume) player.restart();
      else if (Math.abs(clock.read().time - seconds) > .7) player.seek(seconds);
      player.resume();
    },
    pause: () => player.pause()
  };
}

async function soundcloud(reference, host, signal) {
  const SC = await library("https://w.soundcloud.com/player/api.js", null, () => window.SC?.Widget && window.SC);
  signal.throwIfAborted();
  const frame = document.createElement("iframe");
  frame.title = "SoundCloud";
  frame.allow = "autoplay";
  frame.src = "https://w.soundcloud.com/player/?single_active=true&show_related=false&url=" + encodeURIComponent(reference.url);
  host.append(frame);
  const widget = SC.Widget(frame);
  const events = SC.Widget.Events;
  const clock = eventClock(.42);
  let ready = false;
  let failed = false;
  widget.bind(events.READY, () => widget.getDuration(ms => {
    clock.update(0, "paused", ms / 1000);
    ready = true;
  }));
  widget.bind(events.ERROR, () => { failed = true; });
  widget.bind(events.PLAY, () => clock.update(undefined, "playing"));
  widget.bind(events.PLAY_PROGRESS, data => {
    if (clock.read().state === "playing") clock.update(data.currentPosition / 1000, "playing");
  });
  widget.bind(events.SEEK, data => clock.update(data.currentPosition / 1000, clock.read().state));
  widget.bind(events.PAUSE, () => clock.update(undefined, "paused"));
  widget.bind(events.FINISH, () => clock.update(clock.read().duration, "ended"));
  signal.addEventListener("abort", () => {
    for (const key of ["READY", "ERROR", "PLAY", "PLAY_PROGRESS", "SEEK", "PAUSE", "FINISH"]) widget.unbind(events[key]);
    frame.remove();
  }, { once: true });
  await waitFor(() => ready || failed, signal, unavailable);
  if (failed) throw new Error(unavailable);
  return {
    read: () => failed ? { state: "error" } : clock.read(),
    start(seconds, resume) {
      if (!resume || Math.abs(clock.read().time - seconds) > .7) widget.seekTo(seconds * 1000);
      widget.play();
    },
    setVolume: value => widget.setVolume(value * 100),
    pause: () => widget.pause()
  };
}

async function mediaElement(reference, host, signal) {
  const audio = document.createElement("audio");
  audio.controls = true;
  audio.preload = "metadata";
  audio.src = reference.url;
  host.append(audio);
  signal.addEventListener("abort", () => {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    audio.remove();
  }, { once: true });
  await waitFor(() => audio.readyState || audio.error, signal, unavailable);
  if (audio.error) throw new Error("По этой ссылке браузер не нашёл аудио. Выбери файл или вставь ссылку на отдельный трек.");
  return {
    read: () => ({ time: audio.currentTime, duration: audio.duration,
      state: audio.error ? "error" : audio.ended ? "ended" : audio.paused ? "paused" : audio.readyState < 3 ? "buffering" : "playing" }),
    start(seconds) {
      audio.currentTime = seconds;
      return audio.play();
    },
    setVolume: value => { audio.volume = value; },
    pause: () => audio.pause()
  };
}

const players = { YouTube: youtube, Spotify: spotify, SoundCloud: soundcloud, Аудио: mediaElement };
export function connectPlayer(reference, host, signal) {
  return players[reference.provider](reference, host, signal);
}
