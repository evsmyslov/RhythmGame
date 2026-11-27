import { texture } from "./lane-sprites.js?v=15";

const tau = Math.PI * 2;
const unit = value => Math.max(0, Math.min(1, value));
const smooth = value => {
  const t = unit(value);
  return t * t * (3 - 2 * t);
};

function latestBefore(events, time, timestamp) {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (timestamp(events[middle]) <= time) low = middle + 1;
    else high = middle;
  }
  return events[low - 1];
}

export class StageEffects {
  constructor(context, bloom, light, shade, motion) {
    this.ctx = context;
    this.bloom = bloom;
    this.light = light;
    this.shade = shade;
    this.motion = motion;
    this.reset();
  }

  setTrack({ accents = [], climaxes = [], duration = 0 }, palette) {
    this.accents = accents;
    this.climaxes = climaxes;
    if (this.colors !== palette.lanes) {
      this.prisms = palette.lanes.map(color => texture(26, 16, ctx => {
        ctx.beginPath();
        ctx.moveTo(-12, 2);
        ctx.lineTo(11, 5);
        ctx.lineTo(4, -5);
        ctx.closePath();
        ctx.fillStyle = color + "bd";
        ctx.fill();
        ctx.lineWidth = .8;
        ctx.strokeStyle = "#efffff";
        ctx.stroke();
      }, 2).canvas);
      this.roadGlow = texture(2, 64, ctx => {
        const glow = ctx.createLinearGradient(0, -32, 0, 32);
        glow.addColorStop(0, palette.lanes[0] + "00");
        glow.addColorStop(.5, palette.lanes[0] + "4b");
        glow.addColorStop(1, palette.lanes[0] + "00");
        ctx.fillStyle = glow;
        ctx.fillRect(-1, -32, 2, 64);
      }).canvas;
    }
    this.colors = palette.lanes;
    this.rayColors = palette.rays;
    this.raySpeed = .50 + unit(accents.length / Math.max(duration, 1) / 3.4) * .36;
  }

  reset() {
    this.wave = 0;
    this.pulse = 0;
    this.streakBurst = -Infinity;
    this.streakPower = 0;
    this.streakTier = 0;
    this.bloomOpacity = -1;
    this.lightOpacity = -1;
    this.shadeOpacity = -1;
    this.setBloom(0);
    this.setLight(.22);
    this.setShade(0);
  }

  resize(width, height, horizon) {
    this.width = width;
    this.height = height;
    this.horizon = horizon;
    const ctx = this.ctx;
    const center = width / 2;
    const extent = Math.min(width, height) * .55;
    this.nebula = ctx.createRadialGradient(center, horizon, 0, center, horizon, extent);
    this.nebula.addColorStop(0, "#e5fff8");
    this.nebula.addColorStop(.09, this.colors[0] + "ae");
    this.nebula.addColorStop(.39, this.colors[1] + "62");
    this.nebula.addColorStop(1, this.colors[2] + "00");

    const count = width * height < 420000 ? 8 : 12;
    this.rayGroups = this.rayColors.map((color, group) => {
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      for (const [stop, opacity] of [[0, "10"], [.11, "d4"], [.30, "b0"], [.50, "00"], [.70, "b0"], [.89, "d4"], [1, "10"]]) {
        gradient.addColorStop(stop, color + opacity);
      }
      const lines = Array.from({ length: count }, (_, index) => {
        const side = (index + group) % 2 ? -1 : 1;
        const seed = index * 13 + group * 29;
        return {
          x: center + side * width * (.026 + (seed % 7) * .011),
          y: horizon + height * ((seed % 5) - 2) * .018,
          dx: side * width * (.58 + (seed % 11) * .013),
          dy: height * ((seed % 29) * .034 - .18),
          phase: (seed * .618) % 1,
          speed: this.raySpeed * (.73 + (seed % 17) * .037),
          length: .12 + (seed % 13) * .012
        };
      });
      return { gradient, lines, thickness: Math.min(2.35, 1 + group * .42 + height * .0007) };
    });
  }

  celebrate(now, tier, combo) {
    if (this.motion.matches || tier < 2) return;
    this.streakBurst = now;
    this.streakTier = tier;
    this.streakPower = tier === 2 ? .36 : tier === 3 ? .68 : Math.min(1, .82 + (combo - 100) * .0006);
  }

  setBloom(opacity) {
    if (!this.bloom || Math.abs(this.bloomOpacity - opacity) < .012) return;
    this.bloomOpacity = opacity;
    this.bloom.style.opacity = opacity.toFixed(3);
  }

  setLight(opacity) {
    if (!this.light || Math.abs(this.lightOpacity - opacity) < .02) return;
    this.lightOpacity = opacity;
    this.light.style.opacity = opacity.toFixed(3);
  }

  setShade(opacity) {
    if (!this.shade || Math.abs(this.shadeOpacity - opacity) < .02) return;
    this.shadeOpacity = opacity;
    this.shade.style.opacity = opacity.toFixed(3);
  }

  draw(time, now, load) {
    this.wave = 0;
    this.pulse = 0;
    if (!this.width || this.motion.matches || time < 0) {
      this.setShade(load * .25);
      this.setBloom(0);
      this.setLight(.22);
      return;
    }

    const accent = latestBefore(this.accents, time, event => event.time);
    const elapsed = accent ? time - accent.time : Infinity;
    const beat = accent && elapsed < .43 ? Math.exp(-elapsed * 8) * accent.strength : 0;
    this.pulse = beat;
    const climax = latestBefore(this.climaxes, time + 1.45, event => event);
    const age = climax === undefined ? -Infinity : time - climax;
    const opening = age < 0 ? smooth((age + 1.45) / 1.45) : 0;
    const peak = age >= 0 ? smooth(age / .24) * (1 - smooth((age - .85) / 2.6)) : 0;
    const streakAge = (now - this.streakBurst) / 1000;
    const celebrating = streakAge < 1.3;
    const streak = celebrating
      ? smooth(streakAge / .13) * (1 - smooth((streakAge - .16) / (.28 * this.streakTier))) * this.streakPower : 0;
    const streakCut = celebrating ? (1 - smooth(streakAge / (.12 + this.streakTier * .045))) * .50 : 0;
    this.setShade(Math.min(.70, load * .35 + opening * .27 + streakCut + beat * .07));
    const calm = 1 - load * .75;
    const energy = Math.max(peak * .60 * calm, streak);
    const wings = this.streakTier === 4 ? streak * .58 : 0;
    this.setBloom(unit(Math.max(peak * .40 * calm, wings) + (opening * .16 + beat * .12) * calm));
    this.setLight(unit(.16 + (beat * .49 + opening * .13) * calm + energy * .19));

    const ctx = this.ctx;
    ctx.save();
    this.drawCore(time, beat * calm, opening * calm, energy * (1 - load * .50));
    this.drawSpeedLines(time, beat, load);
    if (celebrating) {
      this.drawSurge(streakAge, this.streakPower, this.streakTier - 1);
      if (this.streakTier === 4) this.drawPrisms(streakAge, this.streakPower);
    } else if (age >= 0 && age < 1.7 && load < .75) {
      this.drawSurge(age, .50 * calm);
      this.drawPrisms(age, .56 * calm);
    }
    ctx.restore();

    if (this.streakTier >= 3 && streakAge < 1.1) this.wave = .012 + streakAge / 1.1;
    else if (load < .42 && age >= 0 && age < 1.1) this.wave = .012 + age / 1.1;
  }

  drawCore(time, beat, opening, energy) {
    const ctx = this.ctx;
    const x = this.width / 2;
    const y = this.horizon;
    const strength = .11 + .17 * beat + .26 * opening + .43 * energy;
    const radius = Math.min(this.height * .18, this.width * .14);
    ctx.globalAlpha = strength;
    ctx.fillStyle = this.nebula;
    ctx.fillRect(x - radius * 3, y - radius * 3, radius * 6, radius * 6);
    ctx.lineCap = "round";

    for (let index = 0; index < 5; index++) {
      const r = (radius + index * radius * .37) * (.46 + energy * .53 + opening * .18);
      const turn = (index % 2 ? -1 : 1) * time * (.31 + index * .035) + index * .97;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (.47 + index * .06), -.28 + index * .14, turn, turn + 2.4 + energy * 1.3);
      ctx.strokeStyle = this.colors[index % this.colors.length];
      ctx.lineWidth = 1 + energy * 2.4;
      ctx.globalAlpha = strength * (1 - index * .105);
      ctx.stroke();
    }

    if (opening > .04 || energy > .04) {
      const size = radius * (.28 + opening * .35 + energy * .42);
      const spin = time * .52;
      ctx.beginPath();
      for (let corner = 0; corner < 6; corner++) {
        const angle = spin + corner * tau / 6;
        const px = x + Math.cos(angle) * size;
        const py = y + Math.sin(angle) * size * .65;
        if (corner === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.globalAlpha = strength * .83;
      ctx.strokeStyle = "#def5ff";
      ctx.lineWidth = 1.25;
      ctx.stroke();
    }
  }

  drawSpeedLines(time, beat, load) {
    const ctx = this.ctx;
    ctx.globalAlpha = (.66 + beat * .32) * (1 - load * .47);
    ctx.lineCap = "round";
    for (const { lines, gradient, thickness } of this.rayGroups) {
      ctx.beginPath();
      for (const ray of lines) {
        const progress = (time * ray.speed + ray.phase) % 1;
        const head = progress ** 1.65;
        const tail = Math.max(0, progress - ray.length - beat * .09) ** 1.65;
        ctx.moveTo(ray.x + ray.dx * tail, ray.y + ray.dy * tail);
        ctx.lineTo(ray.x + ray.dx * head, ray.y + ray.dy * head);
      }
      ctx.strokeStyle = gradient;
      ctx.lineWidth = thickness + beat * .7;
      ctx.stroke();
    }
  }

  drawSurge(age, strength, echoes = 3) {
    const ctx = this.ctx;
    const span = Math.min(this.height, this.width);
    for (let echo = 0; echo < echoes; echo++) {
      const progress = (age - echo * .14) / 1.12;
      if (progress < 0 || progress >= 1) continue;
      const radius = (1 - (1 - progress) ** 2) * this.width * .68 + span * .075;
      ctx.beginPath();
      ctx.ellipse(this.width / 2, this.horizon + progress * this.height * .51, radius, radius * .22, 0, 0, tau);
      ctx.globalAlpha = (1 - progress) ** 1.7 * strength * (.5 - echo * .085);
      ctx.lineWidth = (1 - progress) * 4 + .7;
      ctx.strokeStyle = this.colors[echo];
      ctx.stroke();
    }
  }

  drawPrisms(age, strength) {
    const ctx = this.ctx;
    const center = this.width / 2;
    const span = Math.min(this.width, this.height);
    for (let index = 0; index < 10; index++) {
      const progress = (age - (index % 5) * .075) / (.97 + (index % 4) * .10);
      if (progress <= 0 || progress >= 1) continue;
      const flight = 1 - (1 - progress) ** 1.8;
      const side = index < 5 ? -1 : 1;
      const distance = this.width * (.28 + (index % 5) * .054);
      const x = center + side * distance * flight;
      const y = this.horizon + this.height * (.06 + (index % 6) * .075) * flight
        - Math.sin(flight * Math.PI) * this.height * .17;
      const size = span * (.037 + (index % 4) * .016);
      ctx.globalAlpha = smooth(progress / .12) * (1 - progress) * strength;
      ctx.drawImage(this.prisms[index % this.prisms.length], x - size / 2, y - size * .30, size, size * .60);
    }
  }

  drawRoad(field) {
    if (!this.wave) return;
    const ctx = this.ctx;
    const progress = unit(this.wave);
    const y = this.horizon + (this.height - this.horizon) * progress ** .72;
    const span = field.spanAt(y) * .5;
    const width = 11 + progress * 34;
    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.drawImage(this.roadGlow, this.width / 2 - span, y - width, span * 2, width * 2);
    ctx.restore();
  }
}
