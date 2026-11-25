const laneColors = ["#ff9bcb", "#c6b0ff", "#8bf0eb", "#a5c8ff"];
const spectrum = ["#ff9bcb", "#ffd2ab", "#cbb7ff", "#8bf0eb", "#a5c8ff"];
const tau = Math.PI * 2;
const clamp = (number, min, max) => Math.max(min, Math.min(max, number));

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
    this.reset();
  }

  reset() {
    this.flashes = [-Infinity, -Infinity, -Infinity, -Infinity];
    this.sparks = [];
    this.ripples = [];
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
    this.noteRadius = clamp(Math.min(this.hitLaneWidth * .23, height * .049), 12, 27);
    this.targetRadius = this.noteRadius + 5;
    this.stage.style.setProperty("--hit-inset", this.hitLeft + "px");
    this.stage.style.setProperty("--strike-depth", (height - this.strike) + "px");
    this.stage.style.setProperty("--target-height", this.targetRadius * .56 + "px");

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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

    this.ripples.push({ lane, born: now, color: laneColors[nearest], size: 1.2 + power / 25 });
    this.scatter(lane, power, now, false);
  }

  celebrate(lane) {
    if (!this.width || this.motion.matches) return;
    const now = performance.now();
    for (let i = 0; i < laneColors.length; i++) {
      const delay = Math.abs(i - lane) * 52;
      this.ripples.push({ lane: i, born: now + delay, color: spectrum[i], size: 2.35 });
    }
    this.scatter(lane, 34, now, true);
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
    if (this.sparks.length > 150) this.sparks.splice(0, this.sparks.length - 150);
  }

  draw(notes, cursor, time, approach, activeNote) {
    if (!this.width) return;
    const ctx = this.ctx;
    const { width, height, strike } = this;
    const now = performance.now();
    ctx.clearRect(0, 0, width, height);
    this.drawHighway();
    this.drawTargets(now);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, this.spawn - 4, width, strike - this.spawn + this.targetRadius * 2);
    ctx.clip();
    const position = timestamp => {
      const progress = 1 - (timestamp - time) / approach;
      return this.spawn + this.travel * (progress < 0 ? .6 * progress : progress * (.64 + .36 * progress));
    };
    for (let index = cursor; index < notes.length; index++) {
      const note = notes[index];
      if (note.time - time > approach + .1) break;
      if (note.judged) continue;
      if (note.path) this.drawSlide(note, position, time, activeNote === note);
      else this.drawHead(note.lane, position(note.time), laneColors[note.lane]);
    }
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

  drawTargets(now) {
    const ctx = this.ctx;
    for (let lane = 0; lane < 4; lane++) {
      const glow = Math.max(0, 1 - (now - this.flashes[lane]) / 240);
      const x = this.x(lane);
      const color = laneColors[lane];
      const radius = this.targetRadius + 2 * glow;
      const pool = ctx.createRadialGradient(x, this.strike, 0, x, this.strike, radius * 2.6);
      pool.addColorStop(0, color + (glow ? "74" : "37"));
      pool.addColorStop(1, color + "00");
      ctx.fillStyle = pool;
      ctx.fillRect(x - radius * 2.6, this.strike - radius * 2.6, radius * 5.2, radius * 5.2);
      ctx.beginPath();
      ctx.ellipse(x, this.strike, radius, radius * .56, 0, 0, tau);
      ctx.fillStyle = glow ? color + "41" : "#111634c7";
      ctx.fill();
      ctx.shadowBlur = this.motion.matches ? 0 : 10 + 15 * glow;
      ctx.shadowColor = color;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.ellipse(x, this.strike, radius * .73, radius * .41, 0, 0, tau);
      ctx.strokeStyle = color + "6e";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, this.strike, 1.8, 0, tau);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }

  drawSlide(note, position, time, active) {
    const ctx = this.ctx;
    const remaining = active ? note.path.filter(point => point.time > time) : note.path.slice(1);
    const head = active ? { time, lane: laneAt(note.path, time) } : note.path[0];
    const tail = remaining.at(-1);
    const headY = position(head.time);
    const color = laneColors[note.lane];

    if (tail) {
      const tailY = position(tail.time);
      const headX = this.x(head.lane, headY);
      const tailX = this.x(tail.lane, tailY);
      const gradient = ctx.createLinearGradient(headX, headY, tailX, tailY - 1);
      gradient.addColorStop(0, color + "cd");
      gradient.addColorStop(.56, "#d9b9ffb8");
      gradient.addColorStop(1, laneColors[tail.lane] + "b9");

      ctx.beginPath();
      ctx.moveTo(headX, headY);
      let previous = head;
      for (const point of remaining) {
        const halfway = (previous.time + point.time) / 2;
        const middleY = position(halfway);
        const middleX = this.x((previous.lane + point.lane) / 2, middleY);
        const endY = position(point.time);
        ctx.quadraticCurveTo(middleX, middleY, this.x(point.lane, endY), endY);
        previous = point;
      }
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = active ? "#fce4ffc5" : gradient;
      ctx.lineWidth = this.noteRadius * .68;
      ctx.shadowColor = color;
      ctx.shadowBlur = this.motion.matches ? 0 : 13;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#f8edffd4";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      this.drawHead(tail.lane, tailY, laneColors[tail.lane], "tail");
    }
    this.drawHead(head.lane, headY, active ? "#fdf5ff" : color, "slide");
  }

  drawHead(lane, y, color, kind = "tap") {
    if (y < this.spawn - 27 || y > this.strike + 36) return;
    const ctx = this.ctx;
    const depth = clamp((y - this.spawn) / this.travel, 0, 1);
    const radius = this.noteRadius * (.45 + .55 * depth) * (kind === "tail" ? .53 : 1);
    const x = this.x(lane, y);
    ctx.beginPath();
    ctx.ellipse(x, y + radius * .15, radius, radius * .57, 0, 0, tau);
    ctx.fillStyle = color + "8c";
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius * .60, 0, 0, tau);
    const fill = ctx.createLinearGradient(0, y - radius, 0, y + radius);
    fill.addColorStop(0, "#ffffff");
    fill.addColorStop(.46, "#f3fbff");
    fill.addColorStop(.76, color);
    fill.addColorStop(1, "#7e9aff");
    ctx.fillStyle = fill;
    ctx.shadowColor = color;
    ctx.shadowBlur = this.motion.matches ? 0 : 16;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = color;
    ctx.stroke();
    if (kind === "slide") {
      ctx.beginPath();
      ctx.ellipse(x, y, radius * .53, radius * .32, 0, 0, tau);
      ctx.strokeStyle = "#372b66ad";
      ctx.stroke();
    }
  }

  drawEffects(now) {
    const ctx = this.ctx;
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
      ctx.beginPath();
      ctx.moveTo(x, y - particle.size * 1.8);
      ctx.lineTo(x + particle.size, y);
      ctx.lineTo(x, y + particle.size * 1.8);
      ctx.lineTo(x - particle.size, y);
      ctx.closePath();
      ctx.fill();
      return true;
    });
    ctx.globalAlpha = 1;
  }
}
