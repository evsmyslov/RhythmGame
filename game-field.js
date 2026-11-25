export const laneColors = ["#ff79c9", "#bc95ff", "#74eaf8", "#8eacff"];

export function laneAt(path, time) {
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1];
    const to = path[i];
    if (time <= to.time) return from.lane + (to.lane - from.lane) * Math.max(0, (time - from.time) / (to.time - from.time));
  }
  return path.at(-1).lane;
}

const clamp = (number, min, max) => Math.max(min, Math.min(max, number));

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
  }

  resize() {
    const { width, height, left } = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    this.width = width;
    this.height = height;
    this.left = left;
    this.laneWidth = width / 4;
    const bottom = Number.parseFloat(getComputedStyle(this.stage).paddingBottom) || 0;
    this.strike = height - Math.max(64 + bottom, height * .22);
    this.spawn = Math.max(51, Math.min(95, height * .145));
    this.travel = Math.max(1, this.strike - this.spawn);
    this.stroke = Math.min(this.laneWidth * .67, 150);
    this.noteHeight = clamp(this.height * .022, 10, 16);
    this.stage.style.setProperty("--strike-depth", (height - this.strike) + "px");
    const pixels = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * pixels);
    this.canvas.height = Math.round(height * pixels);
    this.ctx.setTransform(pixels, 0, 0, pixels, 0, 0);
    this.laneShades = laneColors.map(color => {
      const shade = this.ctx.createLinearGradient(0, this.spawn, 0, this.strike);
      shade.addColorStop(0, color + "06");
      shade.addColorStop(.7, color + "13");
      shade.addColorStop(1, color + "27");
      return shade;
    });
  }

  lanePosition(clientX) {
    return clamp((clientX - this.left) / this.laneWidth - .5, -.5, 3.5);
  }

  illuminate(lane, power = 0) {
    if (!this.width) return;
    const nearest = clamp(Math.round(lane), 0, 3);
    const now = performance.now();
    this.flashes[nearest] = now;
    if (!power || this.motion.matches) return;

    for (let i = 0; i < power; i++) {
      const angle = -Math.PI + Math.random() * Math.PI;
      const velocity = 55 + 160 * Math.random();
      this.sparks.push({
        lane, color: laneColors[nearest], born: now,
        dx: Math.cos(angle) * velocity,
        dy: Math.sin(angle) * velocity - 12,
        size: 1 + Math.random() * 2.6,
        life: .23 + Math.random() * .29
      });
    }
    if (this.sparks.length > 120) this.sparks.splice(0, this.sparks.length - 120);
  }

  x(lane) {
    return (lane + .5) * this.laneWidth;
  }

  draw(notes, cursor, time, approach, activeNote) {
    if (!this.width) return;
    const ctx = this.ctx;
    const { width, height, strike, laneWidth } = this;
    const now = performance.now();
    ctx.clearRect(0, 0, width, height);

    for (let lane = 0; lane < 4; lane++) {
      const left = lane * laneWidth;
      ctx.fillStyle = this.laneShades[lane];
      ctx.fillRect(left, this.spawn, laneWidth, strike - this.spawn);
      if (lane > 0) {
        ctx.fillStyle = "#e2cdff25";
        ctx.fillRect(left, this.spawn, 1, height - this.spawn);
      }
      const flash = Math.max(0, 1 - (now - this.flashes[lane]) / 230);
      if (flash) {
        ctx.globalAlpha = flash * (this.motion.matches ? .16 : .28);
        ctx.fillStyle = laneColors[lane];
        ctx.fillRect(left, strike - 38, laneWidth, 38);
        ctx.globalAlpha = 1;
      }
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, this.spawn - 5, width, strike - this.spawn + 36);
    ctx.clip();

    for (let index = cursor; index < notes.length; index++) {
      const note = notes[index];
      if (note.time - time > approach + .1) break;
      if (note.judged) continue;
      const position = timestamp => strike - (timestamp - time) / approach * this.travel;
      if (note.path) this.drawSlide(note, position, time, activeNote === note);
      else this.drawHead(this.x(note.lane), position(note.time), laneColors[note.lane]);
    }
    ctx.restore();

    ctx.fillStyle = "#f5dcff";
    ctx.shadowBlur = this.motion.matches ? 0 : 12;
    ctx.shadowColor = "#c183ff";
    ctx.fillRect(0, strike - 1, width, 2);
    ctx.shadowBlur = 0;
    this.drawSparks(now);
  }

  drawSlide(note, position, time, active) {
    const ctx = this.ctx;
    const remaining = active ? note.path.filter(point => point.time > time) : note.path;
    const head = active ? { time, lane: laneAt(note.path, time) } : remaining[0];
    const tail = remaining.at(-1) ?? head;
    const headX = this.x(head.lane);
    const headY = position(head.time);
    const color = laneColors[note.lane];
    const gradient = ctx.createLinearGradient(headX, headY, this.x(tail.lane), position(tail.time) - 1);
    gradient.addColorStop(0, color + "88");
    gradient.addColorStop(1, laneColors[tail.lane] + "99");
    ctx.beginPath();
    ctx.moveTo(headX, headY);
    for (const point of active ? remaining : remaining.slice(1)) ctx.lineTo(this.x(point.lane), position(point.time));
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = active ? "#fce9ffbc" : gradient;
    ctx.lineWidth = Math.min(this.stroke * .45, 54);
    ctx.shadowColor = color;
    ctx.shadowBlur = this.motion.matches ? 0 : 17;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#f8ddffbc";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (tail !== head) {
      ctx.fillStyle = laneColors[tail.lane];
      ctx.beginPath();
      ctx.arc(this.x(tail.lane), position(tail.time), Math.max(4, this.noteHeight * .46), 0, 2 * Math.PI);
      ctx.fill();
    }
    this.drawHead(headX, headY, active ? "#fff2fb" : color, true);
  }

  drawHead(x, y, color, slide = false) {
    if (y < this.spawn - 25 || y > this.strike + 37) return;
    const ctx = this.ctx;
    const { stroke, noteHeight } = this;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = this.motion.matches ? 0 : 15;
    ctx.beginPath();
    ctx.roundRect(x - stroke / 2, y - noteHeight / 2, stroke, noteHeight, noteHeight / 3);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = slide ? "#190c37b3" : "#fff9";
    ctx.fillRect(x - stroke * .36, y - (slide ? 1 : noteHeight * .23), stroke * .72, 1.5);
  }

  drawSparks(now) {
    const ctx = this.ctx;
    this.sparks = this.sparks.filter(particle => {
      const age = (now - particle.born) / 1000;
      if (age >= particle.life) return false;
      ctx.globalAlpha = (1 - age / particle.life) ** 2;
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(this.x(particle.lane) + particle.dx * age, this.strike + particle.dy * age + 220 * age ** 2, particle.size, 0, 2 * Math.PI);
      ctx.fill();
      return true;
    });
    ctx.globalAlpha = 1;
  }
}
