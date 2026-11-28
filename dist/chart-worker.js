import { spaceGestures } from "./chart-spacing.js?v=17";

const difficultySettings = {
  1: { gap: .40, density: 1.55, minimum: .50, slideGap: 3.6, slideLegs: 1,
    patterns: [[1, 2, 1, 2], [0, 2, 1, 3], [1, 3, 0, 2]] },
  2: { gap: .27, density: 2.45, minimum: .40, slideGap: 2.9, slideLegs: 1,
    patterns: [[0, 2, 1, 3], [3, 1, 2, 0], [1, 3, 1, 2]] },
  3: { gap: .20, density: 3.30, minimum: .36, slideGap: 2.4, slideLegs: 2, chordGap: 3.2,
    patterns: [[0, 1, 3, 2], [3, 2, 0, 1], [0, 3, 1, 2]] },
  4: { gap: .16, density: 4.05, minimum: .25, slideGap: 1.9, slideLegs: 2, chordGap: 2.4,
    patterns: [[0, 1, 2, 3], [3, 2, 1, 0], [0, 3, 1, 2]] },
  5: { gap: .119, density: 4.85, minimum: .21, slideGap: 1.65, slideLegs: 3, chordGap: 1.7,
    patterns: [[0, 2, 3, 1, 2, 0, 1, 3], [3, 2, 0, 1, 3, 1, 0, 2], [0, 1, 2, 3, 2, 1, 3, 0]] }
};

self.addEventListener("message", ({ data }) => {
  try {
    self.postMessage(makeChart(data.samples, data.sampleRate, data.difficulty));
  } catch {
    self.postMessage({ error: "Не удалось построить дорожки для этого трека." });
  }
});

function makeChart(samples, sampleRate, difficulty) {
  const settings = difficultySettings[difficulty];
  const step = Math.round(sampleRate / 100);
  const frameTime = step / sampleRate;
  const duration = samples.length / sampleRate;
  const frames = Math.floor(samples.length / step);
  const flux = new Float32Array(frames);
  const energy = new Float32Array(frames);
  const bodyEnergy = new Float32Array(frames);
  const bassRise = new Float32Array(frames);
  const lowAlpha = 1 - Math.exp(-2 * Math.PI * 145 / sampleRate);
  const midAlpha = 1 - Math.exp(-2 * Math.PI * 1350 / sampleRate);
  let low = 0;
  let mid = 0;
  let previousLow = 0;
  let previousMid = 0;
  let previousHigh = 0;
  let peakEnergy = 0;
  let peakBody = 0;
  let background = 0;
  let bassTotal = 0;
  let trebleTotal = 0;

  for (let frame = 0, i = 0; frame < frames; frame++) {
    let bass = 0;
    let body = 0;
    let treble = 0;
    for (const end = i + step; i < end; i++) {
      const sample = samples[i];
      low += lowAlpha * (sample - low);
      mid += midAlpha * (sample - mid);
      bass += low * low;
      body += (mid - low) ** 2;
      treble += (sample - mid) ** 2;
    }
    bassTotal += bass;
    trebleTotal += treble;
    energy[frame] = Math.sqrt((bass + body + treble) / step);
    peakEnergy = Math.max(peakEnergy, energy[frame]);

    bodyEnergy[frame] = Math.sqrt(body / step);
    peakBody = Math.max(peakBody, bodyEnergy[frame]);
    const lo = Math.log1p(110 * Math.sqrt(bass / step));
    const mi = Math.log1p(125 * Math.sqrt(body / step));
    const hi = Math.log1p(145 * Math.sqrt(treble / step));
    bassRise[frame] = 1.35 * Math.max(0, lo - previousLow);
    const change = bassRise[frame]
      + .9 * Math.max(0, mi - previousMid)
      + .7 * Math.max(0, hi - previousHigh);
    background += (change - background) * .033;
    flux[frame] = Math.max(0, change - background * .8);
    previousLow = lo;
    previousMid = mi;
    previousHigh = hi;
  }

  if (peakEnergy < .00015) return { notes: [], accents: [], climaxes: [] };

  const peaks = [];
  let maxStrength = 0;
  const start = Math.max(3, Math.ceil(.22 / frameTime));
  const stop = Math.min(frames - 3, Math.floor((duration - .14) / frameTime));
  for (let i = start; i < stop; i++) {
    const strength = flux[i];
    if (energy[i] < peakEnergy * .012 || strength < .0005) continue;
    if (strength <= flux[i - 1] || strength <= flux[i - 2] || strength < flux[i + 1] || strength < flux[i + 2]) continue;
    const curvature = flux[i - 1] + flux[i + 1] - 2 * strength;
    const shift = curvature ? .5 * (flux[i - 1] - flux[i + 1]) / curvature : 0;
    const time = (i + .45 + shift) * frameTime;
    const bass = Math.max(bassRise[i - 1], bassRise[i], bassRise[i + 1]);
    const priority = strength + bass * .38;
    peaks.push({ time, strength, priority, bass });
    maxStrength = Math.max(maxStrength, strength);
  }

  // Local energy and a shared spacing budget preserve rests between musical phrases.
  const occupied = new Uint8Array(frames);
  const gapFrames = Math.ceil(settings.gap / frameTime);
  const accepted = [];
  const sectionLength = 4;
  let cursor = 0;
  let contextStart = 0;
  let contextEnd = 0;
  for (let section = 0; section < duration; section += sectionLength) {
    const end = Math.min(duration, section + sectionLength);
    const candidates = [];
    while (cursor < peaks.length && peaks[cursor].time < end) candidates.push(peaks[cursor++]);
    let intensity = 0;
    const firstFrame = Math.floor(section / frameTime);
    const lastFrame = Math.min(frames, Math.ceil(end / frameTime));
    for (let i = firstFrame; i < lastFrame; i++) intensity += energy[i];
    intensity /= Math.max(1, lastFrame - firstFrame) * peakEnergy;
    if (intensity < .015 || !candidates.length) continue;
    while (contextStart < peaks.length && peaks[contextStart].time < section - 4) contextStart++;
    while (contextEnd < peaks.length && peaks[contextEnd].time < end + 4) contextEnd++;
    const grid = estimateBeatGrid(peaks.slice(contextStart, contextEnd), frameTime);
    if (grid) {
      const divisions = difficulty <= 2 ? 2 : 4;
      for (let i = 0; i < candidates.length; i++) candidates[i] = alignBeat(candidates[i], grid, divisions);
    }
    candidates.sort((left, right) => right.priority - left.priority);
    const pulses = grid ? candidates.filter(note => note.strength > maxStrength * .28).length : 0;
    const beatActivity = grid ? pulses * grid.period / (end - section) * grid.score : 0;
    const activity = Math.min(1, Math.max(.27 + intensity * 3.8, beatActivity));
    const limit = Math.round(settings.density * (end - section) * activity);
    const benchmark = candidates[0]?.priority ?? 0;
    const threshold = Math.max(maxStrength * .041, benchmark * settings.minimum);
    let count = 0;
    for (const candidate of candidates) {
      if (count >= limit || candidate.priority < threshold) break;
      const position = Math.round(candidate.time / frameTime);
      if (occupied[position]) continue;
      occupied.fill(1, Math.max(0, position - gapFrames + 1), position + gapFrames);
      accepted.push(candidate);
      count++;
    }
  }

  // Sparse music can still have a real attack even when the regular selection is empty.
  if (!accepted.length && peaks.length) {
    accepted.push(peaks.reduce((best, peak) => peak.priority > best.priority ? peak : best));
  }

  accepted.sort((left, right) => left.time - right.time);
  const notes = patternNotes(accepted, settings, maxStrength);
  const high = Math.sqrt(trebleTotal);
  return {
    brightness: high / (high + Math.sqrt(bassTotal) || 1),
    notes: spaceGestures(addSlides(notes, difficulty, settings, bodyEnergy, peakBody, frameTime), difficulty),
    ...stageTiming(peaks, maxStrength, energy, frameTime, duration)
  };
}

function estimateBeatGrid(onsets, step) {
  if (onsets.length < 8 || onsets.at(-1).time - onsets[0].time < 3) return null;
  const origin = onsets[0].time;
  const strongest = onsets.reduce((best, event) => Math.max(best, event.priority), 0);
  const end = Math.ceil((onsets.at(-1).time - origin) / step) + 2;
  const pulse = new Float32Array(end);
  const events = [];
  let norm = 0;
  let total = 0;
  for (const onset of onsets) {
    if (onset.priority < strongest * .14) continue;
    const offset = onset.time - origin;
    const frame = Math.round(offset / step);
    const weight = (onset.priority / strongest) ** .8 * (.62 + Math.min(.75, onset.bass / onset.strength));
    pulse[frame] = weight;
    const phaseWeight = weight ** 2;
    events.push({ frame, offset, weight, phaseWeight });
    norm += phaseWeight;
    total += phaseWeight;
  }
  if (events.length < 7) return null;

  const correlation = lag => {
    let sum = 0;
    for (const { frame, weight } of events) {
      const match = frame + lag;
      if (match >= end) break;
      const nearby = Math.max(pulse[match], (pulse[match - 1] || 0) * .78, (pulse[match + 1] || 0) * .78);
      sum += weight * nearby;
    }
    return sum / norm;
  };
  const candidates = [];
  for (let lag = Math.ceil(.31 / step); lag <= Math.floor(.86 / step); lag++) {
    const fit = correlation(lag);
    const second = Math.max(correlation(lag * 2), correlation(lag * 2 - 1), correlation(lag * 2 + 1));
    candidates.push({ lag, fit: fit * .69 + second * .31 });
  }
  candidates.sort((a, b) => b.fit - a.fit);
  const tested = [];
  let best = null;
  for (const { lag, fit } of candidates) {
    if (tested.length === 4 || fit < .16) break;
    if (tested.some(other => Math.abs(other - lag) < 3)) continue;
    tested.push(lag);
    for (let sample = -10; sample <= 10; sample++) {
      const period = (lag + sample * .125) * step;
      let sin = 0;
      let cos = 0;
      for (const { offset, phaseWeight } of events) {
        const phase = offset / period * Math.PI * 2;
        sin += Math.sin(phase) * phaseWeight;
        cos += Math.cos(phase) * phaseWeight;
      }
      const agreement = Math.hypot(sin, cos) / total;
      if (agreement < .41) continue;
      const score = agreement * .72 + fit * .28;
      if (!best || score > best.score) {
        best = { period, phase: origin + Math.atan2(sin, cos) * period / (Math.PI * 2), score };
      }
    }
  }
  return best;
}

function alignBeat(event, grid, divisions) {
  const spacing = grid.period / divisions;
  const slot = Math.round((event.time - grid.phase) / spacing);
  const time = grid.phase + slot * spacing;
  if (Math.abs(time - event.time) > Math.min(.034, spacing * .23)) return event;
  const accent = slot % divisions === 0 ? 1.25 : slot % (divisions / 2) === 0 ? 1.08 : 1;
  return { ...event, time, priority: event.priority * accent };
}

function patternNotes(onsets, { patterns, chordGap }, maxStrength) {
  const notes = [];
  const lastUsed = [-Infinity, -Infinity, -Infinity, -Infinity];
  let phrase = 0;
  let slot = 0;
  let lastLane = -1;
  let lastChord = -Infinity;
  for (let index = 0; index < onsets.length; index++) {
    const { time, strength } = onsets[index];
    let pattern = patterns[phrase % patterns.length];
    if (slot === pattern.length || (slot > 0 && time - onsets[index - 1].time > .69)) {
      pattern = patterns[++phrase % patterns.length];
      slot = 0;
    }
    let lane = pattern[slot++];
    if (lane === lastLane && time - lastUsed[lane] < .36) lane = (lane + 2) % 4;
    const accent = strength / (maxStrength || 1);
    notes.push({ time, lane, accent });
    lastUsed[lane] = time;
    lastLane = lane;
    const pair = (lane + 2) % 4;
    const gap = (onsets[index + 1]?.time ?? Infinity) - time;
    if (chordGap && accent >= .51 && gap >= .155 &&
        time - lastChord >= chordGap && time - lastUsed[pair] >= .245) {
      notes.push({ time, lane: pair, accent });
      lastUsed[pair] = time;
      lastChord = time;
    }
  }
  return notes;
}

function stageTiming(onsets, strongest, energy, frameTime, duration) {
  const accents = [];
  for (const onset of onsets) {
    const strength = onset.strength / strongest;
    if (strength < .19) continue;
    const previous = accents.at(-1);
    if (!previous || onset.time - previous.time >= .24) {
      accents.push({ time: onset.time, strength });
    } else if (strength > previous.strength) {
      accents[accents.length - 1] = { time: onset.time, strength };
    }
  }

  const climaxes = [];
  if (duration < 6 || !accents.length) return { accents, climaxes };
  const sum = new Float64Array(energy.length + 1);
  for (let i = 0; i < energy.length; i++) sum[i + 1] = sum[i] + energy[i] ** 2;
  const loudness = (from, to) => {
    const start = Math.max(0, Math.floor(from / frameTime));
    const end = Math.min(energy.length, Math.ceil(to / frameTime));
    return Math.sqrt((sum[end] - sum[start]) / Math.max(1, end - start));
  };
  const average = loudness(0, duration);
  let cursor = 0;
  for (let start = Math.min(7.4, duration * .3); start < duration - 2.4; start += 30) {
    const end = Math.min(start + 8.5, duration - 2.4);
    while (cursor < accents.length && accents[cursor].time < start) cursor++;
    let chosen;
    let best = -Infinity;
    while (cursor < accents.length && accents[cursor].time <= end) {
      const accent = accents[cursor++];
      const before = loudness(accent.time - 1.1, accent.time - .06);
      const after = loudness(accent.time, accent.time + 1.25);
      const lift = Math.min(2, Math.max(0, (after - before) / average));
      const score = accent.strength * .95 + lift * .9 + Math.min(2, after / average) * .32;
      if (score > best) {
        best = score;
        chosen = accent;
      }
    }
    if (chosen) climaxes.push(chosen.time);
  }
  return { accents, climaxes };
}

function addSlides(notes, difficulty, settings, envelope, peakBody, step) {
  const result = [];
  let nextSlideTime = 1.34;
  let slideNumber = 0;
  for (let index = 0; index < notes.length; index++) {
    const { time, lane, accent } = notes[index];
    const canHold = time >= nextSlideTime && accent >= .085 && !hasChord(notes, index);
    const end = canHold ? sustainEnd(notes, index, difficulty <= 2 ? .40 : .31, .82, envelope, peakBody, step) : -1;
    if (end < 0) {
      result.push({ time, lane });
      continue;
    }

    const hold = slideNumber % (difficulty === 1 ? 2 : 4) === 0;
    let direction = hold ? 0 : lane === 0 ? 1 : lane === 3 ? -1 : slideNumber % 2 ? 1 : -1;
    let nextLane = lane + direction;
    const path = [{ time, lane }, { time: notes[end].time, lane: nextLane }];
    index = end;

    const legs = hold || slideNumber % 3 === 1 ? 1 : settings.slideLegs;
    for (let leg = 1; leg < legs; leg++) {
      const next = sustainEnd(notes, index, .27, .56, envelope, peakBody, step);
      if (next < 0) break;
      if (nextLane + direction < 0 || nextLane + direction > 3 || (difficulty === 5 && leg === 2)) direction *= -1;
      nextLane += direction;
      path.push({ time: notes[next].time, lane: nextLane });
      index = next;
    }

    result.push({ time, lane, path });
    nextSlideTime = notes[index].time + settings.slideGap;
    slideNumber++;
  }
  return result;
}

function hasChord(notes, index) {
  return notes[index - 1]?.time === notes[index].time || notes[index + 1]?.time === notes[index].time;
}

function sustainEnd(notes, from, min, max, envelope, peakBody, step) {
  const startTime = notes[from].time;
  const startFrame = Math.floor(startTime / step);
  let attack = 0;
  for (let i = startFrame; i < Math.min(envelope.length, startFrame + 12); i++) attack = Math.max(attack, envelope[i]);
  const threshold = Math.max(peakBody * .036, attack * .20);
  const firstFrame = startFrame + 12;
  let checked = firstFrame;
  let held = 0;
  let best = -1;
  let strength = 0;
  for (let index = from + 1; index < notes.length; index++) {
    const duration = notes[index].time - startTime;
    if (duration > max || hasChord(notes, index)) break;
    if (duration < min || (notes[index + 1]?.time ?? Infinity) - notes[index].time < .12) continue;
    const lastFrame = Math.floor(notes[index].time / step);
    while (checked < lastFrame && checked < envelope.length) {
      if (envelope[checked++] >= threshold) held++;
    }
    const coverage = held / Math.max(1, checked - firstFrame);
    if (coverage < .68) break;
    const fit = coverage + notes[index].accent * .17 + duration * .15;
    if (fit > strength) {
      strength = fit;
      best = index;
    }
  }
  return best;
}
