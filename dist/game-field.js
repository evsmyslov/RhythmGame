import { StageEffects } from "./stage-effects.js?v=14";
import { buildLaneSprites, drawLaneSprite } from "./lane-sprites.js?v=14";

import { trackPalette } from "./palette.js?v=14";

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
    this.motion = matchMedia("(prefers-reduced-motion: reduce)");
    this.effects = new StageEffects(
      this.ctx, stage.querySelector(".stage-bloom"), stage.querySelector(".stage-light"), stage.querySelector(".stage-shade"), this.motion
    );
    this.reset();
  }

  setTrack(track) {
    const key = track.paletteId ?? track.songId;
    if (!this.palette || this.paletteKey !== key) {
      this.paletteKey = key;
      this.palette = trackPalette(key, track.brightness);
      this.laneSprites = buildLaneSprites(this.palette.lanes);
      this.stage.style.setProperty("--sky-tint", this.palette.sky + "a6");
      this.palette.lanes.forEach((color, index) => this.stage.style.setProperty("--lane-" + index, color));
    }
    this.effects.setTrack(track, this.palette);
  }

  reset() {
    this.flashes = [-Infinity, -Infinity, -Infinity, -Infinity];
    this.sparks = [];
    this.ripples = [];
    this.impacts = [];
    this.celebration = null;
    this.visibleTaps = [];
    this.visibleSlides = [];
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
    this.noteRadius = Math.min(this.hitLaneWidth * .34, clamp(height * .080, 18, 42));
    this.targetRadius = Math.min(this.hitLaneWidth * .42, clamp(height * .14, 31, 82));
    this.stage.style.setProperty("--hit-inset", this.hitLeft + "px");
    this.stage.style.setProperty("--key-label-bottom", Math.max(8, height - this.strike - this.targetRadius * .69 - 8) + "px");

    const pixelLimit = Math.max(1, Math.sqrt(1320000 / (width * height)));
    const dpr = Math.min(window.devicePixelRatio || 1, 1.65, pixelLimit);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.effects.resize(width, height, this.spawn);
    this.laneShades = this.palette.lanes.map(color => {
      const shade = this.ctx.createLinearGradient(0, this.spawn, 0, height);
      shade.addColorStop(0, color + "0c");
      shade.addColorStop(.7, color + "18");
      shade.addColorStop(1, color + "46");
      return shade;
    });
    this.hitShades = this.palette.lanes.map(color => {
      const shine = this.ctx.createLinearGradient(0, this.spawn, 0, height);
      shine.addColorStop(0, color + "00");
      shine.addColorStop(.36, color + "08");
      shine.addColorStop(.78, color + "7c");
      shine.addColorStop(1, color + "b8");
      return shine;
    });
    this.runwayShade = this.ctx.createLinearGradient(0, this.spawn, 0, height);
    this.runwayShade.addColorStop(0, "#0b11224d");
    this.runwayShade.addColorStop(.57, "#050d1af1");
    this.runwayShade.addColorStop(.84, this.palette.road + "f9");
    this.runwayShade.addColorStop(1, this.palette.road + "e8");
    this.edgeShade = this.ctx.createLinearGradient(0, this.spawn, 0, height);
    this.edgeShade.addColorStop(0, "#f6ecff0c");
    this.edgeShade.addColorStop(.32, this.palette.lanes[2] + "86");
    this.edgeShade.addColorStop(.80, "#e8fcffd9");
    this.edgeShade.addColorStop(1, this.palette.accent + "d4");
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
    if (!power || this.motion.matches) return;

    const color = this.palette.lanes[nearest];
    this.ripples.push({ lane, born: now, color, size: 1.4 + power / 21 });
    if (power >= 18) this.ripples.push({ lane, born: now + 64, color: this.palette.lanes[(nearest + 2) % laneCount], size: 2.25 });
    this.impacts.push({ lane, born: now, sprite: this.laneSprites[nearest].flash, power: Math.min(1, power / 20) });
    this.scatter(lane, Math.ceil(power * .55), now);
  }

  celebrate(lane, combo, tier) {
    if (!this.width || this.motion.matches) return;
    const now = performance.now();
    this.effects.celebrate(now, tier, combo);
    this.celebration = { lane, nearest: clamp(Math.round(lane), 0, 3), born: now, tier };
  }

  fadeSlide(note, time, active) {
    this.slideFades.push({ note, time, active, born: performance.now() });
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

  draw(notes, cursor, time, approach, slide, musicPlaying) {
    if (!this.width) return;
    const ctx = this.ctx;
    const { width, height, strike } = this;
    const now = performance.now();
    const taps = this.visibleTaps;
    const slides = this.visibleSlides;
    taps.length = 0;
    slides.length = 0;
    let nearby = 0;
    const activeNote = slide?.note;
    let nextTransition = activeNote;
    for (let index = cursor; index < notes.length; index++) {
      const note = notes[index];
      const until = note.time - time;
      if (until > approach + .1) break;
      if (note.judged) continue;
      if (until <= .97) nearby += note.path ? 1.6 : 1;
      if (note.path) {
        if (!nextTransition && until < 1.15 && note.path.some(point => point.lane !== note.lane)) {
          nextTransition = note;
        }
        slides.push(note);
      } else taps.push(note);
    }
    const load = musicPlaying ? Math.max(activeNote ? .60 : 0, clamp((nearby - 2) / 4, 0, 1)) : 0;
    this.visualLoad += (load - this.visualLoad) * .15;

    ctx.clearRect(0, 0, width, height);
    this.effects.draw(musicPlaying ? time : -1, now, this.visualLoad);
    this.drawHighway(now);
    this.effects.drawRoad(this);
    this.drawTargets(now, musicPlaying);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, this.spawn - 4, width, strike - this.spawn + this.targetRadius * 2);
    ctx.clip();
    const project = frameTime => timestamp => {
      const progress = 1 - (timestamp - frameTime) / approach;
      return this.spawn + this.travel * (progress < 0 ? .6 * progress : progress * (.55 + .45 * progress));
    };
    this.slideFades = this.slideFades.filter(({ note, time: stamp, active, born }) => {
      const remaining = 1 - (now - born) / (active ? 500 : 290);
      if (remaining <= 0) return false;
      ctx.globalAlpha = remaining ** 1.5 * (active ? .77 : .48);
      this.drawSlide(note, project(stamp), stamp, active, false);
      return true;
    });
    ctx.globalAlpha = 1;
    const position = project(time);
    for (const note of slides) {
      const active = activeNote === note;
      this.drawSlide(note, position, time, active, nextTransition === note, active && musicPlaying && slide.holding);
    }
    for (const note of taps) this.drawHead(note.lane, position(note.time));
    ctx.restore();
    this.drawEffects(now);
    this.drawCelebration(now);
  }

  drawHighway(now) {
    const ctx = this.ctx;
    const { spawn, height } = this;
    ctx.beginPath();
    ctx.moveTo(this.x(-.5, spawn), spawn);
    ctx.lineTo(this.x(3.5, spawn), spawn);
    ctx.lineTo(this.x(3.5, height), height);
    ctx.lineTo(this.x(-.5, height), height);
    ctx.closePath();
    ctx.fillStyle = this.runwayShade;
    ctx.fill();

    for (let lane = 0; lane < 4; lane++) {
      ctx.beginPath();
      ctx.moveTo(this.x(lane - .5, spawn), spawn);
      ctx.lineTo(this.x(lane + .5, spawn), spawn);
      ctx.lineTo(this.x(lane + .5, height), height);
      ctx.lineTo(this.x(lane - .5, height), height);
      ctx.closePath();
      ctx.fillStyle = this.laneShades[lane];
      ctx.fill();
      const held = this.pressedLanes & (1 << lane) ? .60 : 0;
      const glow = Math.max(held, 1 - (now - this.flashes[lane]) / 235);
      if (glow > .02) {
        ctx.globalAlpha = glow;
        ctx.fillStyle = this.hitShades[lane];
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    for (let divider = 0; divider <= 4; divider++) {
      ctx.beginPath();
      ctx.moveTo(this.x(divider - .5, spawn), spawn);
      ctx.lineTo(this.x(divider - .5, height), height);
      const edge = divider === 0 || divider === 4;
      ctx.strokeStyle = edge ? this.edgeShade : "#e4ddff27";
      ctx.lineWidth = edge ? clamp(this.width * .0033, 1.35, 3.8) : 1;
      ctx.stroke();
    }
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

      ctx.globalAlpha = .27 + pulse * .17 + brightness * .50;
      drawLaneSprite(ctx, sprite.aura, x, this.strike + 5, radius * 1.10, .88);
      ctx.globalAlpha = 1;
      drawLaneSprite(ctx, sprite.target, x, y, radius, vertical);
      if (brightness > .03) {
        ctx.globalAlpha = brightness;
        drawLaneSprite(ctx, sprite.targetLit, x, y, radius, vertical);
        ctx.globalAlpha = 1;
      }
    }
  }

  drawSlide(note, position, time, active, highlighted, charged = false) {
    const head = active ? { time, lane: laneAt(note.path, Math.min(time, note.path.at(-1).time)) } : note.path[0];
    const tail = note.path.at(-1);
    const headY = position(head.time);
    if (headY < this.spawn - 27) return;

    if (tail.time > head.time) {
      this.drawSlideRibbon(note.path, position, head, this.palette.lanes[note.lane], charged, highlighted);
      this.drawHead(tail.lane, position(tail.time), note.lane, "tail");
    }
    if (charged) this.drawSlideCharge(note, head, position);
    this.drawHead(head.lane, headY, note.lane, active && time >= tail.time ? "tail" : "slide");
  }

  noteSize(y) {
    const depth = clamp((y - this.spawn) / this.travel, 0, 1);
    const laneRadius = this.spanAt(y) / 4 * .43;
    return Math.min(this.noteRadius * (.45 + .55 * depth), laneRadius);
  }

  drawSlideRibbon(path, position, head, color, charged, highlighted) {
    const ctx = this.ctx;
    const sectionAt = (time, lane) => {
      const y = position(time);
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
      const steps = clamp(Math.ceil(length / 14), 3, 14);
      const section = ratio => sectionAt(
        previous.time + (point.time - previous.time) * ratio,
        previous.lane + (point.lane - previous.lane) * ratio
      );
      for (let i = 1; i < steps; i++) sections.push(section(i / steps));
      sections.push(end);
      if (point !== path.at(-1) && end.y >= this.spawn) corners.push(end);
      if (Math.abs(point.lane - previous.lane) > .2 && length > 37) {
        const angle = Math.atan2(dy, dx);
        for (const ratio of length > 115 ? [.38, .69] : [.53]) {
          const marker = section(ratio);
          if (marker.y >= this.spawn) arrows.push({ ...marker, angle });
        }
      }
      previous = point;
    }

    fillRibbon(ctx, sections, charged ? 1.46 : highlighted ? 1.14 : 1.06, charged ? color + "47" : "#091322");
    fillRibbon(ctx, sections, 1, charged ? "#effff9" : color);
    fillRibbon(ctx, sections, .79, charged ? color + "dc" : "#111c37c9");
    fillRibbon(ctx, sections, .26, charged ? "#ffffffbd" : color + (highlighted ? "a6" : "60"));
    for (const { x, y, radius } of corners) {
      ctx.beginPath();
      ctx.ellipse(x, y, radius * .82, radius * .42, 0, 0, tau);
      ctx.fillStyle = "#15233e";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = charged ? "#fff" : color;
      ctx.stroke();
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

  drawSlideCharge(note, head, position) {
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

    if (!rest) {
      const tailTime = note.path.at(-1).time;
      for (let i = 0; i < 7; i++) {
        const travel = (elapsed * 4 + i / 7) % 1;
        const time = head.time + travel * Math.min(.56, Math.max(0, tailTime - head.time));
        const py = position(time);
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

  drawHead(lane, y, spriteLane = lane, kind = "note") {
    if (y < this.spawn - 27 || y > this.strike + 36) return;
    const radius = this.noteSize(y) * (kind === "tail" ? .86 : 1);
    drawLaneSprite(this.ctx, this.laneSprites[spriteLane][kind], this.x(lane, y), y, radius);
  }

  drawImpact(impact, age) {
    const ctx = this.ctx;
    ctx.globalAlpha = (1 - age) ** 2.35 * impact.power * (1 - this.visualLoad * .23);
    const radius = this.targetRadius * (.88 + age * .88);
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
    const first = tier === 1 ? nearest : 0;
    const last = tier === 1 ? nearest : laneCount - 1;
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
    if (tier === 4) {
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
