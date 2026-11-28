import { StageEffects } from "./stage-effects.js?v=16";
import { buildLaneSprites, drawLaneSprite } from "./lane-sprites.js?v=16";

import { trackPalette } from "./palette.js?v=16";

const laneCount = 4;
const tau = Math.PI * 2;
const clamp = (number, min, max) => Math.max(min, Math.min(max, number));
const celebrationLengths = [0, 350, 480, 620, 780];

function fillRibbon(ctx, sections, width, color) {
  const first = sections[0];
  ctx.beginPath();
  ctx.moveTo(first.x - first.radius * width, first.y);
  for (let i = 1; i < sections.length; i++) {
    const { x, y, radius } = sections[i];
    ctx.lineTo(x - radius * width, y);
  }
  for (let i = sections.length - 1; i >= 0; i--) {
    const { x, y, radius } = sections[i];
    ctx.lineTo(x + radius * width, y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

export function laneAt(path, time) {
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1];
    const to = path[i];
    if (time <= to.time) return from.lane + (to.lane - from.lane) * Math.max(0, (time - from.time) / (to.time - from.time));
  }
  return path.at(-1).lane;
}

export class GameField {
  constructor(canvas, stage) {
    this.canvas = canvas;
    this.stage = stage;
    this.ctx = canvas.getContext("2d");
    this.road = document.createElement("canvas");
    this.road.setAttribute("aria-hidden", "true");
    Object.assign(this.road.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none" });
    stage.insertBefore(this.road, canvas);
    this.motion = matchMedia("(prefers-reduced-motion: reduce)");
    this.effects = new StageEffects(
      this.ctx, stage.parentElement.querySelector(".stage-bloom"), stage.parentElement.querySelector(".stage-light"), stage.parentElement.querySelector(".stage-shade"), this.motion
    );
    this.setEffectsMode("auto");
    this.reset();
  }

  setEffectsMode(value) {
    this.effectsMode = ["auto", "low", "full"].includes(value) ? value : "auto";
    const budgetPhone = matchMedia("(pointer: coarse)").matches &&
      ((navigator.deviceMemory > 0 && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4));
    this.applyLowEffects(this.effectsMode === "low" || (this.effectsMode === "auto" && budgetPhone));
  }

  applyLowEffects(low) {
    this.slowFrames = 0;
    if (this.lowEffects === low) return;
    this.lowEffects = this.effects.low = low;
    if (this.width) this.resize();
  }

  setTrack(track) {
    const key = track.paletteId ?? track.songId;
    if (!this.palette || this.paletteKey !== key) {
      this.paletteKey = key;
      this.palette = trackPalette(key, track.brightness);
      this.laneSprites = buildLaneSprites(this.palette.lanes);
      this.stage.parentElement.style.setProperty("--sky-tint", this.palette.sky + "a6");
      this.palette.lanes.forEach((color, index) => this.stage.style.setProperty("--lane-" + index, color));
    }
    // Cache temporal neighbours on each lane. Short jacks need smaller heads near the horizon.
    const laneTimes = Array.from({ length: laneCount }, () => []);
    for (const note of track.notes ?? []) {
      if (note.path) {
        for (const point of note.path) laneTimes[point.lane].push(point.time);
      } else laneTimes[note.lane].push(note.time);
    }
    this.headGaps = laneTimes.map(times => {
      times.sort((a, b) => a - b);
      return new Map(times.map((t, i) => [t, Math.min(t - (times[i - 1] ?? -Infinity), (times[i + 1] ?? Infinity) - t)]));
    });
    this.effects.setTrack(track, this.palette);
  }

  reset() {
    this.flashes = [-Infinity, -Infinity, -Infinity, -Infinity];
    this.beams = Array(4).fill(-Infinity);
    this.sparks = [];
    this.ripples = [];
    this.impacts = [];
    this.celebration = null;

    this.slideFades = [];
    this.visualLoad = 0;
    this.pressDepth = [0, 0, 0, 0];
    this.pressedLanes = 0;
    this.previousFrame = undefined;
    this.effects.reset();
  }

  resize() {
    const { width: screenWidth, height: screenHeight, left, top } = this.canvas.getBoundingClientRect();
    const style = getComputedStyle(this.stage);
    this.rotated = style.getPropertyValue("--rotated").trim() === "1";
    const width = this.rotated ? screenHeight : screenWidth;
    const height = this.rotated ? screenWidth : screenHeight;
    if (!width || !height) return;
    this.width = width;
    this.height = height;
    this.inputOrigin = this.rotated ? top : left;
    this.farWidth = width * .105;
    this.floorWidth = width * .998;
    const bottom = Number.parseFloat(style.paddingBottom) || 0;
    const hud = Number.parseFloat(style.paddingTop) || 0;
    this.strike = height - Math.max(59 + bottom, height * .185);
    this.spawn = Math.max(49 + hud, height * .13);
    this.travel = Math.max(1, this.strike - this.spawn);
    this.hitWidth = this.spanAt(this.strike);
    this.hitLaneWidth = this.hitWidth / 4;
    this.hitLeft = (width - this.hitWidth) / 2;
    this.targetRadius = Math.min(this.hitLaneWidth * .42, clamp(height * .14, 31, 82));
    this.noteRadius = this.targetRadius * .82;
    this.stage.style.setProperty("--hit-inset", this.hitLeft + "px");
    this.stage.style.setProperty("--key-label-bottom", Math.max(8, height - this.strike - this.targetRadius * .69 - 8) + "px");

    const pixelLimit = Math.sqrt((this.lowEffects ? 620000 : 1320000) / (width * height));
    const dpr = Math.min(window.devicePixelRatio || 1, this.lowEffects ? 1.1 : 1.65, pixelLimit);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.effects.resize(width, height, this.spawn);
    this.road.width = this.canvas.width;
    this.road.height = this.canvas.height;
    const road = this.road.getContext("2d");
    road.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawRoadSurface(road);
    this.hitShades = this.palette.lanes.map(color => {
      const shine = this.ctx.createLinearGradient(0, this.spawn, 0, this.strike);
      shine.addColorStop(0, color + "00");
      shine.addColorStop(.40, color + "0e");
      shine.addColorStop(.80, color + "66");
      shine.addColorStop(1, color + "be");
      return shine;
    });
  }

  lanePosition(clientX, clientY) {
    const coordinate = this.rotated ? clientY : clientX;
    return clamp((coordinate - this.inputOrigin - this.hitLeft) / this.hitLaneWidth - .5, -.5, 3.5);
  }

  spanAt(y) {
    const depth = clamp((y - this.spawn) / Math.max(1, this.height - this.spawn), 0, 1);
    return this.farWidth + (this.floorWidth - this.farWidth) * depth;
  }

  x(lane, y = this.strike) {
    return this.width / 2 + (lane - 1.5) * this.spanAt(y) / 4;
  }

  illuminate(lane, power = 0) {
    if (!this.width) return;
    const nearest = clamp(Math.round(lane), 0, 3);
    const now = performance.now();
    this.flashes[nearest] = now;
    if (!power) return;
    this.beams[nearest] = now;
    if (this.motion.matches) return;

    const color = this.palette.lanes[nearest];
    if (!this.lowEffects) this.ripples.push({ lane, born: now, color, size: 1.4 + power / 21 });
    if (!this.lowEffects && power >= 18) this.ripples.push({ lane, born: now + 64, color: this.palette.lanes[(nearest + 2) % laneCount], size: 2.25 });
    this.impacts.push({ lane, born: now, sprite: this.laneSprites[nearest].flash, power: Math.min(1, power / 20) });
    if (!this.lowEffects) this.scatter(lane, Math.ceil(power * .42), now);
  }

  celebrate(lane, combo, tier) {
    if (!this.width || this.motion.matches) return;
    const now = performance.now();
    this.effects.celebrate(now, tier, combo);
    this.celebration = { lane, nearest: clamp(Math.round(lane), 0, 3), born: now, tier };
  }

  fadeSlide(note, time, active) {
    if (!this.lowEffects) this.slideFades.push({ note, time, active, born: performance.now() });
  }

  scatter(lane, count, now) {
    const color = this.palette.lanes[clamp(Math.round(lane), 0, 3)];
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI + Math.random() * Math.PI;
      const speed = 58 + Math.random() * 152;
      this.sparks.push({
        lane, color: i % 3 === 0 ? this.palette.lanes[i % laneCount] : color,
        born: now, dx: Math.cos(angle) * speed, dy: Math.sin(angle) * speed - 12,
        size: 1.1 + Math.random() * 2.4, life: .25 + Math.random() * .30
      });
    }
    if (this.sparks.length > 48) this.sparks.splice(0, this.sparks.length - 48);
  }

  draw(notes, cursor, time, settings, slide, musicPlaying) {
    if (!this.width) return;
    const ctx = this.ctx;
    const { width, height, strike } = this;
    const { approach } = settings;
    const now = performance.now();
    if (musicPlaying && this.effectsMode === "auto" && !this.lowEffects && this.previousFrame !== undefined) {
      const elapsed = now - this.previousFrame;
      this.slowFrames = elapsed > 24 && elapsed < 100 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 1);
      if (this.slowFrames >= 20) this.applyLowEffects(true);
    }
    let nearby = 0;
    const activeNote = slide?.note;
    let nextTransition = activeNote;
    let end = cursor;
    while (end < notes.length && notes[end].time <= time + approach) {
      const note = notes[end++];
      if (note.judged) continue;
      const until = note.time - time;
      if (until <= .97) nearby += note.path ? 1.6 : 1;
      if (note.path && !nextTransition && until < 1.15 && note.path.some(point => point.lane !== note.lane)) {
        nextTransition = note;
      }
    }
    const load = musicPlaying ? Math.max(activeNote ? .60 : 0, clamp((nearby - 2) / 4, 0, 1)) : 0;
    this.visualLoad += (load - this.visualLoad) * .15;

    ctx.clearRect(0, 0, width, height);
    this.effects.draw(musicPlaying ? time : -1, now, this.visualLoad);
    this.drawHitBeams(now);
    this.effects.drawRoad(this);
    this.drawTargets(now, musicPlaying);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, this.spawn, width, height - this.spawn);
    ctx.clip();
    this.frameApproach = approach;
    for (let i = this.slideFades.length - 1; i >= 0; i--) {
      const { note, time: stamp, active, born } = this.slideFades[i];
      const remaining = 1 - (now - born) / (active ? 200 : 130);
      if (remaining <= 0) { this.slideFades.splice(i, 1); continue; }
      ctx.globalAlpha = remaining ** 2 * .30;
      this.frameTime = stamp;
      // Fade only the ribbon. Repainting a completed slide head can cover the next note.
      this.drawSlide(note, stamp, active, false, false, true);
    }
    ctx.globalAlpha = 1;
    this.frameTime = time;
    for (let i = end - 1; i >= cursor; i--) {
      const note = notes[i];
      if (note.judged) continue;
      const active = activeNote === note;
      if (note.path) this.drawSlide(note, time, active, nextTransition === note, active && musicPlaying && slide.holding);
      else this.drawTimedHead(note.lane, note.time);
    }
    ctx.restore();
    this.drawEffects(now);
    this.drawCelebration(now);
  }

  noteY(timestamp) {
    const delta = (this.frameTime - timestamp) / this.frameApproach;
    if (delta > 0) return this.strike + this.travel * 1.45 * delta;
    const progress = 1 + delta;
    return this.spawn + this.travel * (progress < 0 ? .55 * progress : progress * (.55 + .45 * progress));
  }

  drawRoadSurface(ctx) {
    const fill = ctx.createLinearGradient(0, this.spawn, 0, this.height);
    fill.addColorStop(0, "#0a142644");
    fill.addColorStop(.50, "#091422a8");
    fill.addColorStop(1, "#07101dd6");
    ctx.beginPath();
    ctx.moveTo(this.x(-.5, this.spawn), this.spawn);
    ctx.lineTo(this.x(3.5, this.spawn), this.spawn);
    ctx.lineTo(this.x(3.5, this.height), this.height);
    ctx.lineTo(this.x(-.5, this.height), this.height);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.beginPath();
    for (const side of [-.5, 3.5]) {
      ctx.moveTo(this.x(side, this.spawn), this.spawn);
      ctx.lineTo(this.x(side, this.height), this.height);
    }
    ctx.strokeStyle = "#e6f5ffc7";
    ctx.lineWidth = clamp(this.width * .0023, 1.3, 3.2);
    ctx.stroke();
  }

  drawHitBeams(now) {
    const ctx = this.ctx;
    for (let lane = 0; lane < laneCount; lane++) {
      const age = (now - this.beams[lane]) / 245;
      if (age >= 1) continue;
      const fade = (1 - age) ** 1.7;
      const top = this.motion.matches ? this.strike - this.targetRadius : this.spawn + this.travel * age * .5;
      ctx.globalAlpha = fade * (this.motion.matches ? .25 : .95);
      ctx.beginPath();
      ctx.moveTo(this.x(lane - .46, top), top);
      ctx.lineTo(this.x(lane + .46, top), top);
      ctx.lineTo(this.x(lane + .46, this.height), this.height);
      ctx.lineTo(this.x(lane - .46, this.height), this.height);
      ctx.closePath();
      ctx.fillStyle = this.hitShades[lane];
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawTargets(now, musicPlaying) {
    const ctx = this.ctx;
    const elapsed = clamp(now - (this.previousFrame ?? now - 16), 0, 50);
    const response = this.motion.matches ? 1 : 1 - Math.exp(-elapsed * .055);
    const moving = musicPlaying && !this.motion.matches;
    this.previousFrame = now;

    for (let lane = 0; lane < 4; lane++) {
      const age = now - this.flashes[lane];
      const glow = Math.max(0, 1 - age / 240) ** 1.35;
      const holding = (this.pressedLanes & (1 << lane)) ? 1 : 0;
      this.pressDepth[lane] += (holding - this.pressDepth[lane]) * response;
      const tapTravel = moving ? Math.max(0, 1 - age / 88) * .75 : 0;
      const pressure = Math.max(this.pressDepth[lane], tapTravel);
      const pulse = moving ? this.effects.pulse : 0;
      const x = this.x(lane);
      const y = this.strike + (this.motion.matches ? 0 : pressure * 4);
      const sprite = this.laneSprites[lane];
      const radius = this.targetRadius;
      const vertical = this.motion.matches ? 1 : 1 - pressure * .16;
      const brightness = Math.max(pressure, glow);

      if (brightness > .04 || (!this.lowEffects && pulse > .08)) {
        ctx.globalAlpha = .05 + pulse * .09 + brightness * .62;
        drawLaneSprite(ctx, sprite.aura, x, this.strike + 5, radius * 1.10, .88);
        ctx.globalAlpha = 1;
      }
      drawLaneSprite(ctx, sprite.target, x, y, radius, vertical);
      if (brightness > .03) {
        ctx.globalAlpha = brightness;
        drawLaneSprite(ctx, sprite.targetLit, x, y, radius, vertical);
        ctx.globalAlpha = 1;
      }
    }
  }

  drawSlide(note, time, active, highlighted, charged = false, ribbonOnly = false) {
    const head = active ? { time, lane: laneAt(note.path, Math.min(time, note.path.at(-1).time)) } : note.path[0];
    const tail = note.path.at(-1);
    const headY = this.noteY(head.time);
    if (headY < this.spawn) return;

    if (tail.time > head.time) {
      this.drawSlideRibbon(note.path, head, this.laneSprites[note.lane].slideColor, charged, highlighted);
      const tailY = this.noteY(tail.time);
      const dx = this.x(tail.lane, tailY) - this.x(head.lane, headY);
      const dy = tailY - headY;
      const mergeRadius = this.noteSize(headY) * 1.65;
      if (!ribbonOnly && dx * dx + dy * dy * 3.3 > mergeRadius * mergeRadius) {
        this.drawTimedHead(tail.lane, tail.time, note.lane, "tail");
      }
    }
    if (ribbonOnly) return;
    if (charged) this.drawSlideCharge(note, head);
    this.drawTimedHead(head.lane, head.time, note.lane, active && time >= tail.time ? "tail" : "slide");
  }

  noteSize(y) {
    const depth = clamp((y - this.spawn) / this.travel, 0, 1);
    const laneRadius = this.spanAt(y) / 4 * .43;
    return Math.min(this.noteRadius * (.22 + .78 * depth), laneRadius);
  }

  drawSlideRibbon(path, head, color, charged, highlighted) {
    const ctx = this.ctx;
    const sectionAt = (time, lane) => {
      const y = this.noteY(time);
      return { x: this.x(lane, y), y, radius: this.noteSize(y) * .84 };
    };
    const sections = [sectionAt(head.time, head.lane)];
    const arrows = [];
    const corners = [];
    let previous = head;

    for (const point of path) {
      if (point.time <= head.time) continue;
      const start = sections.at(-1);
      const end = sectionAt(point.time, point.lane);
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);
      const steps = clamp(Math.ceil(length / (this.lowEffects ? 48 : 27)), 2, this.lowEffects ? 5 : 10);
      const section = ratio => sectionAt(
        previous.time + (point.time - previous.time) * ratio,
        previous.lane + (point.lane - previous.lane) * ratio
      );
      for (let i = 1; i < steps; i++) sections.push(section(i / steps));
      sections.push(end);
      if (point !== path.at(-1) && end.y >= this.spawn) corners.push({ point, end });
      if (Math.abs(point.lane - previous.lane) > .2 && length > 37) {
        const angle = Math.atan2(dy, dx);
        for (const ratio of length > 115 ? [.38, .69] : [.53]) {
          const marker = section(ratio);
          if (marker.y >= this.spawn) arrows.push({ ...marker, angle });
        }
      }
      previous = point;
    }

    fillRibbon(ctx, sections, charged ? 1.23 : 1, color + (charged ? "ac" : "88"));
    if (charged) fillRibbon(ctx, sections, .38, "#ffffe99c");
    for (const { point, end } of corners) {
      const radius = this.spacedRadius(point.lane, point.time, end.y, end.radius);
      drawLaneSprite(ctx, this.laneSprites[path[0].lane].slide, end.x, end.y, radius);
    }
    for (const { x, y, radius, angle } of arrows) {
      const size = clamp(radius * (highlighted ? .51 : .42), 2.8, highlighted ? 11 : 8.5);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(-size * .62, -size);
      ctx.lineTo(size * .60, 0);
      ctx.lineTo(-size * .62, size);
      ctx.strokeStyle = charged ? "#112638" : "#edfff5ef";
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.lineWidth = clamp(size * .36, 1.3, 3);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawSlideCharge(note, head) {
    const ctx = this.ctx;
    const x = this.x(head.lane);
    const y = this.strike;
    const radius = this.targetRadius;
    const lane = clamp(Math.round(head.lane), 0, 3);
    const color = this.palette.lanes[lane];
    const rest = this.motion.matches;
    const elapsed = Math.max(0, head.time - note.time);
    const pulse = rest ? .5 : .5 + Math.cos(elapsed * tau / .18) * .5;
    ctx.save();
    ctx.globalAlpha = .62 + pulse * .28;
    drawLaneSprite(ctx, this.laneSprites[lane].aura, x, y, radius * (1.42 + pulse * .11), .83);
    ctx.lineCap = "round";
    for (let side = 0; side < 2; side++) {
      const start = rest ? side * Math.PI : elapsed * 7 + side * Math.PI;
      ctx.beginPath();
      ctx.ellipse(x, y, radius * 1.10, radius * .53, 0, start, start + Math.PI * .69);
      ctx.strokeStyle = side ? color : "#edfff5";
      ctx.lineWidth = 2 + pulse * 2;
      ctx.stroke();
    }

    if (!rest && !this.lowEffects) {
      const tailTime = note.path.at(-1).time;
      for (let i = 0; i < 7; i++) {
        const travel = (elapsed * 4 + i / 7) % 1;
        const time = head.time + travel * Math.min(.56, Math.max(0, tailTime - head.time));
        const py = this.noteY(time);
        const size = this.noteSize(py);
        const side = i % 2 ? 1 : -1;
        const px = this.x(laneAt(note.path, time), py) + side * size * (.32 + travel * .57);
        ctx.globalAlpha = (1 - travel) * .66;
        ctx.fillStyle = i % 3 ? color : "#fff";
        ctx.beginPath();
        ctx.ellipse(px, py + size * .22, 1.6 + travel, 2.4 + travel * 2, side * .45, 0, tau);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  spacedRadius(lane, time, y, radius) {
    const gap = this.headGaps[lane]?.get(time);
    if (gap < this.frameApproach) {
      // The opaque face is about 1.2 radii tall. Keep daylight between rapid repeats.
      return Math.min(radius, Math.max(1, (y - this.noteY(time + gap)) * .72));
    }
    return radius;
  }

  drawTimedHead(lane, time, spriteLane = lane, kind = "note") {
    const y = this.noteY(time);
    if (y < this.spawn || y > this.height + this.noteRadius) return;
    const radius = this.spacedRadius(lane, time, y, this.noteSize(y) * (kind === "tail" ? .86 : 1));
    this.drawHead(lane, y, spriteLane, kind, radius);
  }

  drawHead(lane, y, spriteLane, kind, radius) {
    drawLaneSprite(this.ctx, this.laneSprites[spriteLane][kind], this.x(lane, y), y, radius);
  }

  drawImpact(impact, age) {
    const ctx = this.ctx;
    ctx.globalAlpha = Math.min(1, age * 16 + .48) * (1 - age) ** 1.8 * (.52 + impact.power * .48) * (1 - this.visualLoad * .18);
    const radius = this.targetRadius * (.57 + Math.min(1, age * 3.8) * .66 + age * .32);
    drawLaneSprite(ctx, impact.sprite, this.x(impact.lane), this.strike - 2, radius, .85);
  }

  drawCelebration(now) {
    if (!this.celebration || this.motion.matches) return;
    const { lane, nearest, born, tier } = this.celebration;
    const elapsed = now - born;
    const duration = celebrationLengths[tier];
    if (elapsed >= duration) {
      this.celebration = null;
      return;
    }
    const ctx = this.ctx;
    const progress = elapsed / duration;
    const radius = this.targetRadius;
    ctx.save();
    const first = tier === 1 || this.lowEffects ? nearest : 0;
    const last = tier === 1 || this.lowEffects ? nearest : laneCount - 1;
    for (let i = first; i <= last; i++) {
      const ring = (elapsed - Math.abs(i - lane) * 38) / (duration * .88);
      if (ring < 0 || ring >= .91) continue;
      ctx.globalAlpha = (1 - ring) ** 1.6 * (.68 + tier * .08);
      drawLaneSprite(ctx, this.laneSprites[i].ring, this.x(i), this.strike, radius * (.89 + ring * (1.9 + tier * .34)));
    }

    const rise = 1 - (1 - progress) ** 2;
    ctx.globalAlpha = (1 - progress) ** 1.45;
    drawLaneSprite(ctx, this.laneSprites[nearest].celebration, this.x(lane), this.strike - rise * radius,
      radius * (.71 + rise * (.67 + tier * .115)));
    if (tier === 4 && !this.lowEffects) {
      ctx.globalAlpha *= .65;
      for (const edge of [0, laneCount - 1]) {
        drawLaneSprite(ctx, this.laneSprites[edge].celebration, this.x(edge), this.strike - rise * radius * .8,
          radius * (.67 + rise * 1.18));
      }
    }
    ctx.restore();
  }

  drawEffects(now) {
    const ctx = this.ctx;
    ctx.save();
    this.impacts = this.impacts.filter(impact => {
      const age = (now - impact.born) / 325;
      if (age >= 1) return false;
      this.drawImpact(impact, age);
      return true;
    });
    this.ripples = this.ripples.filter(ripple => {
      const age = (now - ripple.born) / 550;
      if (age < 0) return true;
      if (age >= 1) return false;
      const radius = this.targetRadius + age * this.targetRadius * ripple.size;
      ctx.globalAlpha = (1 - age) ** 2 * (1 - this.visualLoad * .45);
      ctx.beginPath();
      ctx.ellipse(this.x(ripple.lane), this.strike, radius, radius * .60, 0, 0, tau);
      ctx.strokeStyle = ripple.color;
      ctx.lineWidth = (1 - age) * 2.7 + .5;
      ctx.stroke();
      return true;
    });
    this.sparks = this.sparks.filter(particle => {
      const age = (now - particle.born) / 1000;
      if (age >= particle.life) return false;
      const x = this.x(particle.lane) + particle.dx * age;
      const y = this.strike + particle.dy * age + 205 * age ** 2;
      ctx.globalAlpha = (1 - age / particle.life) ** 1.7 * (1 - this.visualLoad * .55);
      ctx.fillStyle = particle.color;
      if (particle.size < 1.8) {
        ctx.fillRect(x, y, particle.size * 1.2, particle.size * 1.2);
        return true;
      }
      ctx.beginPath();
      ctx.moveTo(x, y - particle.size * 1.8);
      ctx.lineTo(x + particle.size, y);
      ctx.lineTo(x, y + particle.size * 1.8);
      ctx.lineTo(x - particle.size, y);
      ctx.closePath();
      ctx.fill();
      return true;
    });
    ctx.restore();
  }
}
