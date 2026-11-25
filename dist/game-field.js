import { StageEffects } from "./stage-effects.js?v=9";
import { buildLaneSprites, drawLaneSprite } from "./lane-sprites.js?v=9";

const laneColors = ["#ffca8f", "#c7b1ff", "#82ead1", "#a5ccff"];
const spectrum = ["#f9ca94", "#f6e4bc", "#cbb7ff", "#82ead1", "#a5ccff"];
const tau = Math.PI * 2;
const clamp = (number, min, max) => Math.max(min, Math.min(max, number));

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
      this.ctx, stage.querySelector(".stage-bloom"), stage.querySelector(".stage-light"), this.motion
    );
    this.reset();
  }

  reset() {
    this.flashes = [-Infinity, -Infinity, -Infinity, -Infinity];
    this.sparks = [];
    this.ripples = [];
    this.impacts = [];
    this.visibleTaps = [];
    this.pressDepth = [0, 0, 0, 0];
    this.pressedLanes = 0;
    this.previousFrame = undefined;
    this.effects.reset();
  }

  resize() {
    const { width, height, left } = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    this.width = width;
    this.height = height;
    this.left = left;
    this.farWidth = width * .105;
    this.floorWidth = width * .998;
    const bottom = Number.parseFloat(getComputedStyle(this.stage).paddingBottom) || 0;
    const hud = Number.parseFloat(getComputedStyle(this.stage).paddingTop) || 0;
    this.strike = height - Math.max(59 + bottom, height * .185);
    this.spawn = Math.max(49 + hud, height * .13);
    this.travel = Math.max(1, this.strike - this.spawn);
    this.hitWidth = this.spanAt(this.strike);
    this.hitLaneWidth = this.hitWidth / 4;
    this.hitLeft = (width - this.hitWidth) / 2;
    this.noteRadius = Math.min(this.hitLaneWidth * .34, clamp(height * .065, 16, 35));
    this.targetRadius = Math.min(this.hitLaneWidth * .42, clamp(height * .14, 31, 82));
    this.stage.style.setProperty("--hit-inset", this.hitLeft + "px");
    this.stage.style.setProperty("--key-label-bottom", Math.max(8, height - this.strike - this.targetRadius * .63 - 8) + "px");

    const pixelLimit = Math.max(1, Math.sqrt(1320000 / (width * height)));
    const dpr = Math.min(window.devicePixelRatio || 1, 1.65, pixelLimit);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.laneSprites ??= buildLaneSprites(laneColors);
    this.effects.resize(width, height, this.spawn);
    this.laneShades = laneColors.map(color => {
      const shade = this.ctx.createLinearGradient(0, this.spawn, 0, height);
      shade.addColorStop(0, color + "0c");
      shade.addColorStop(.7, color + "18");
      shade.addColorStop(1, color + "35");
      return shade;
    });
    this.runwayShade = this.ctx.createLinearGradient(0, this.spawn, 0, height);
    this.runwayShade.addColorStop(0, "#0b11224d");
    this.runwayShade.addColorStop(.62, "#0b1028dc");
    this.runwayShade.addColorStop(.86, "#1a1e5deb");
    this.runwayShade.addColorStop(1, "#2b1863d9");
    this.edgeShade = this.ctx.createLinearGradient(0, this.spawn, 0, height);
    this.edgeShade.addColorStop(0, "#f6ecff0c");
    this.edgeShade.addColorStop(.34, "#bacdf391");
    this.edgeShade.addColorStop(.82, "#d9eafff0");
    this.edgeShade.addColorStop(1, "#9bc7ffe3");
  }

  lanePosition(clientX) {
    return clamp((clientX - this.left - this.hitLeft) / this.hitLaneWidth - .5, -.5, 3.5);
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

    const color = laneColors[nearest];
    this.ripples.push({ lane, born: now, color, size: 1.4 + power / 21 });
    if (power >= 18) this.ripples.push({ lane, born: now + 64, color: spectrum[(nearest + 2) % spectrum.length], size: 2.25 });
    this.impacts.push({ lane, born: now, sprite: this.laneSprites[nearest].flash, power: Math.min(1, power / 20) });
    this.scatter(lane, power, now, false);
  }

  celebrate(lane, combo) {
    if (!this.width || this.motion.matches) return;
    const now = performance.now();
    this.effects.celebrate(now, combo);
    for (let i = 0; i < laneColors.length; i++) {
      const delay = Math.abs(i - lane) * 52;
      this.ripples.push({ lane: i, born: now + delay, color: spectrum[i], size: 3.1 });
    }
    this.scatter(lane, 42, now, true);
    for (const edge of [0, 3]) this.scatter(edge, 16, now, true);
  }

  scatter(lane, count, now, celebration) {
    const color = laneColors[clamp(Math.round(lane), 0, 3)];
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI + Math.random() * Math.PI;
      const speed = (celebration ? 120 : 58) + Math.random() * (celebration ? 235 : 152);
      this.sparks.push({
        lane, color: celebration || i % 3 === 0 ? spectrum[i % spectrum.length] : color,
        born: now, dx: Math.cos(angle) * speed, dy: Math.sin(angle) * speed - 12,
        size: 1.1 + Math.random() * 2.4, life: .25 + Math.random() * (celebration ? .61 : .30)
      });
    }
    if (this.sparks.length > 108) this.sparks.splice(0, this.sparks.length - 108);
  }

  draw(notes, cursor, time, approach, activeNote, musicPlaying) {
    if (!this.width) return;
    const ctx = this.ctx;
    const { width, height, strike } = this;
    const now = performance.now();
    ctx.clearRect(0, 0, width, height);
    this.effects.draw(musicPlaying ? time : -1, now);
    this.drawHighway();
    this.effects.drawRoad(this);
    this.drawTargets(now, musicPlaying);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, this.spawn - 4, width, strike - this.spawn + this.targetRadius * 2);
    ctx.clip();
    const position = timestamp => {
      const progress = 1 - (timestamp - time) / approach;
      return this.spawn + this.travel * (progress < 0 ? .6 * progress : progress * (.64 + .36 * progress));
    };
    const taps = this.visibleTaps;
    taps.length = 0;
    for (let index = cursor; index < notes.length; index++) {
      const note = notes[index];
      if (note.time - time > approach + .1) break;
      if (note.judged) continue;
      if (note.path) this.drawSlide(note, position, time, activeNote === note);
      else taps.push(note);
    }
    for (const note of taps) this.drawHead(note.lane, position(note.time));
    ctx.restore();
    this.drawEffects(now);
  }

  drawHighway() {
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
    }
    for (let divider = 0; divider <= 4; divider++) {
      ctx.beginPath();
      ctx.moveTo(this.x(divider - .5, spawn), spawn);
      ctx.lineTo(this.x(divider - .5, height), height);
      const edge = divider === 0 || divider === 4;
      ctx.strokeStyle = edge ? this.edgeShade : "#e4ddff27";
      ctx.lineWidth = edge ? clamp(this.width * .0033, 1.6, 5.5) : 1;
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
      const glow = Math.max(0, 1 - age / 200);
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

      ctx.globalAlpha = .16 + pulse * .13 + brightness * .37;
      drawLaneSprite(ctx, sprite.aura, x, this.strike + 5, radius * 1.05, .72);
      ctx.globalAlpha = 1;
      drawLaneSprite(ctx, sprite.target, x, y, radius, vertical);
      if (brightness > .03) {
        ctx.globalAlpha = brightness;
        drawLaneSprite(ctx, sprite.targetLit, x, y, radius, vertical);
        ctx.globalAlpha = 1;
      }
    }
  }

  drawSlide(note, position, time, active) {
    const head = active ? { time, lane: laneAt(note.path, time) } : note.path[0];
    const tail = note.path.at(-1);
    const headY = position(head.time);
    if (headY < this.spawn - 27) return;

    if (tail.time > head.time) {
      this.drawSlideRibbon(note.path, position, head, laneColors[note.lane], active);
      this.drawHead(tail.lane, position(tail.time), note.lane, "tail");
    }
    this.drawHead(head.lane, headY, note.lane, "slide");
  }

  noteSize(y) {
    const depth = clamp((y - this.spawn) / this.travel, 0, 1);
    const laneRadius = this.spanAt(y) / 4 * .43;
    return Math.min(this.noteRadius * (.52 + .48 * depth), laneRadius);
  }

  drawSlideRibbon(path, position, head, color, active) {
    const ctx = this.ctx;
    const sectionAt = (time, lane) => {
      const y = position(time);
      return { x: this.x(lane, y), y, radius: this.noteSize(y) * .93 };
    };
    const sections = [sectionAt(head.time, head.lane)];
    const arrows = [];
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
      if (Math.abs(point.lane - previous.lane) > .2 && length > 37) {
        const angle = Math.atan2(dy, dx);
        for (const ratio of length > 115 ? [.38, .69] : [.53]) {
          const marker = section(ratio);
          if (marker.y >= this.spawn) arrows.push({ ...marker, angle });
        }
      }
      previous = point;
    }

    fillRibbon(ctx, sections, 1, "#11182f");
    fillRibbon(ctx, sections, .90, active ? "#edffff" : color);
    fillRibbon(ctx, sections, .72, active ? color + "90" : "#1520435e");
    for (const { x, y, radius, angle } of arrows) {
      const size = clamp(radius * .42, 2.8, 8.5);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(-size * .62, -size);
      ctx.lineTo(size * .60, 0);
      ctx.lineTo(-size * .62, size);
      ctx.strokeStyle = "#14213be8";
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.lineWidth = clamp(size * .36, 1.3, 3);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawHead(lane, y, spriteLane = lane, kind = "note") {
    if (y < this.spawn - 27 || y > this.strike + 36) return;
    const radius = this.noteSize(y) * (kind === "tail" ? .86 : 1);
    drawLaneSprite(this.ctx, this.laneSprites[spriteLane][kind], this.x(lane, y), y, radius);
  }

  drawImpact(impact, age) {
    const ctx = this.ctx;
    ctx.globalAlpha = (1 - age) ** 2 * impact.power;
    const radius = this.targetRadius * (.71 + age * 1.08);
    drawLaneSprite(ctx, impact.sprite, this.x(impact.lane), this.strike, radius, .83);
  }

  drawEffects(now) {
    const ctx = this.ctx;
    ctx.save();
    this.impacts = this.impacts.filter(impact => {
      const age = (now - impact.born) / 425;
      if (age >= 1) return false;
      this.drawImpact(impact, age);
      return true;
    });
    this.ripples = this.ripples.filter(ripple => {
      const age = (now - ripple.born) / 550;
      if (age < 0) return true;
      if (age >= 1) return false;
      const radius = this.targetRadius + age * this.targetRadius * ripple.size;
      ctx.globalAlpha = (1 - age) ** 2;
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
      ctx.globalAlpha = (1 - age / particle.life) ** 1.7;
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
