const difficultySettings = {
  1: { gap: .41, density: 1.5, minimum: .41 },
  2: { gap: .25, density: 2.65, minimum: .29 },
  3: { gap: .15, density: 4.4, minimum: .22 }
};

self.addEventListener("message", ({ data }) => {
  try {
    self.postMessage({ notes: makeChart(data.samples, data.sampleRate, data.difficulty) });
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
  const lowAlpha = 1 - Math.exp(-2 * Math.PI * 145 / sampleRate);
  const midAlpha = 1 - Math.exp(-2 * Math.PI * 1350 / sampleRate);
  let low = 0;
  let mid = 0;
  let previousLow = 0;
  let previousMid = 0;
  let previousHigh = 0;
  let peakEnergy = 0;
  let background = 0;

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
    energy[frame] = Math.sqrt((bass + body + treble) / step);
    peakEnergy = Math.max(peakEnergy, energy[frame]);

    const lo = Math.log1p(110 * Math.sqrt(bass / step));
    const mi = Math.log1p(125 * Math.sqrt(body / step));
    const hi = Math.log1p(145 * Math.sqrt(treble / step));
    const change = 1.35 * Math.max(0, lo - previousLow)
      + .9 * Math.max(0, mi - previousMid)
      + .7 * Math.max(0, hi - previousHigh);
    background += (change - background) * .033;
    flux[frame] = Math.max(0, change - background * .8);
    previousLow = lo;
    previousMid = mi;
    previousHigh = hi;
  }

  if (peakEnergy < .00015) return [];

  const peaks = [];
  let maxStrength = 0;
  const start = Math.max(3, Math.ceil(.22 / frameTime));
  const stop = Math.min(frames - 3, Math.floor((duration - .14) / frameTime));
  for (let i = start; i < stop; i++) {
    const strength = flux[i];
    if (energy[i] < peakEnergy * .012 || strength < .0005) continue;
    if (strength <= flux[i - 1] || strength <= flux[i - 2] || strength < flux[i + 1] || strength < flux[i + 2]) continue;
    const time = i * frameTime + frameTime * .45;
    peaks.push({ time, strength });
    maxStrength = Math.max(maxStrength, strength);
  }

  // Enforce spacing across section boundaries while letting quieter sections supply notes.
  const occupied = new Uint8Array(frames);
  const gapFrames = Math.ceil(settings.gap / frameTime);
  const accepted = [];
  const sectionLength = 4;
  let cursor = 0;
  for (let section = 0; section < duration; section += sectionLength) {
    const end = Math.min(duration, section + sectionLength);
    const candidates = [];
    while (cursor < peaks.length && peaks[cursor].time < end) candidates.push(peaks[cursor++]);
    candidates.sort((left, right) => right.strength - left.strength);
    const limit = Math.max(1, Math.round(settings.density * (end - section)));
    const benchmark = candidates[Math.min(3, Math.max(0, candidates.length - 1))]?.strength ?? 0;
    const threshold = Math.max(maxStrength * .025, benchmark * settings.minimum);
    let count = 0;
    for (const candidate of candidates) {
      if (count >= limit || candidate.strength < threshold) break;
      const position = Math.round(candidate.time / frameTime);
      if (occupied[position]) continue;
      occupied.fill(1, Math.max(0, position - gapFrames + 1), position + gapFrames);
      accepted.push(candidate);
      count++;
    }
  }

  if (accepted.length < Math.min(3, Math.floor(duration))) {
    for (let i = start; i < stop; i += Math.ceil(.58 / frameTime)) {
      if (!occupied[i] && energy[i] > peakEnergy * .10) {
        accepted.push({ time: i * frameTime, strength: 0 });
      }
    }
  }

  accepted.sort((left, right) => left.time - right.time);
  const notes = [];
  const lanes = [0, 2, 1, 3];
  let lastLane = -1;
  const lastUsed = [-Infinity, -Infinity, -Infinity, -Infinity];
  accepted.forEach(({ time, strength }, index) => {
    let lane = lanes[(index + Math.floor(time * 2.19) + Math.floor(index / 4)) % 4];
    if (lane === lastLane) lane = (lane + 1 + index % 2) % 4;
    if (time - lastUsed[lane] < .24) lane = lastUsed.indexOf(Math.min(...lastUsed));
    notes.push({ time, lane });
    lastUsed[lane] = time;
    lastLane = lane;
    const pair = (lane + 2) % 4;
    const gapAhead = (accepted[index + 1]?.time ?? Infinity) - time;
    if (difficulty === 3 && time - lastUsed[pair] > .38 && gapAhead > .21 && index % 6 === 2 && strength >= maxStrength * .38) {
      notes.push({ time, lane: pair });
      lastUsed[pair] = time;
    }
  });

  return notes;
}
