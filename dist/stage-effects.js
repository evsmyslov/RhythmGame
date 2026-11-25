const tau = Math.PI * 2;
const colors = ["#83eaff", "#b895ff", "#ffb1dc", "#ffcf9e"];
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
  constructor(context, bloom, light, motion) {
    this.ctx = context;
    this.bloom = bloom;
    this.light = light;
    this.motion = motion;
    this.setTiming();
    this.reset();
  }

  setTiming(accents = [], climaxes = []) {
    this.accents = accents;
    this.climaxes = climaxes;
  }

  reset() {
    this.wave = 0;
    this.pulse = 0;
    this.streakBurst = -Infinity;
    this.streakPower = 0;
    this.bloomOpacity = -1;
    this.lightOpacity = -1;
    this.setBloom(0, 0);
    this.setLight(.22);
  }

  resize(width, height, horizon) {
    this.width = width;
    this.height = height;
    this.horizon = horizon;
    const ctx = this.ctx;
    const center = width / 2;
    const extent = Math.min(width, height) * .55;
    this.nebula = ctx.createRadialGradient(center, horizon, 0, center, horizon, extent);
    this.nebula.addColorStop(0, "#dcf9ff");
    this.nebula.addColorStop(.08, "#9fe4ffc0");
    this.nebula.addColorStop(.32, "#9278ff59");
    this.nebula.addColorStop(.65, "#d290ff1a");
    this.nebula.addColorStop(1, "#d290ff00");

    this.wingGradients = [-1, 1].map(direction => {
      const gradient = ctx.createLinearGradient(center, horizon, center + direction * width * .52, height * .57);
      gradient.addColorStop(0, "#ebecffdb");
      gradient.addColorStop(.21, direction < 0 ? "#998bffe0" : "#8bdcffe4");
      gradient.addColorStop(.55, direction < 0 ? "#5bcaf9a8" : "#ed93ecac");
      gradient.addColorStop(.82, "#ffc8a07a");
      gradient.addColorStop(1, "#ffe0be08");
      return gradient;
    });
  }

  celebrate(now, combo) {
    if (this.motion.matches) return;
    this.streakBurst = now;
    this.streakPower = Math.min(.98, .59 + combo * .008);
  }

  setBloom(opacity, spread) {
    if (!this.bloom || Math.abs(this.bloomOpacity - opacity) < .012) return;
    this.bloomOpacity = opacity;
    this.bloom.style.opacity = opacity.toFixed(3);
    this.bloom.style.transform = "scale(" + (1.02 + spread * .105).toFixed(3) + ")";
  }

  setLight(opacity) {
    if (!this.light || Math.abs(this.lightOpacity - opacity) < .02) return;
    this.lightOpacity = opacity;
    this.light.style.opacity = opacity.toFixed(3);
  }

  draw(time, now) {
    this.wave = 0;
    this.pulse = 0;
    if (!this.width || this.motion.matches || time < 0) {
      this.setBloom(0, 0);
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
    const streak = smooth(streakAge / .13) * (1 - smooth((streakAge - .16) / 1.19)) * this.streakPower;
    const energy = Math.max(peak, streak * .84);
    const spread = Math.max(opening * .39, energy);
    this.setBloom(unit(energy * .78 + opening * .19 + beat * .12), spread);
    this.setLight(unit(.22 + beat * .69 + opening * .17 + energy * .19));

    const ctx = this.ctx;
    ctx.save();
    this.drawCore(time, beat, opening, energy);
    if (spread > .025) this.drawWings(time, spread, beat);
    if (age >= 0 && age < 2.1) {
      this.drawSurge(age, 1);
      this.drawPrisms(age, 1);
    }
    if (streakAge < 1.24) {
      this.drawSurge(streakAge, this.streakPower);
      this.drawPrisms(streakAge, this.streakPower);
    }
    ctx.restore();

    if (age >= 0 && age < 1.1) this.wave = .012 + age / 1.1;
    else if (streakAge < 1.1) this.wave = .012 + streakAge / 1.1;
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
      ctx.strokeStyle = colors[index % colors.length];
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

  drawWings(time, spread, beat) {
    const ctx = this.ctx;
    const { width, height, horizon } = this;
    const center = width / 2;
    for (let side = 0; side < 2; side++) {
      const direction = side ? 1 : -1;
      ctx.strokeStyle = this.wingGradients[side];
      ctx.fillStyle = this.wingGradients[side];
      for (let strand = 0; strand < 7; strand++) {
        const flutter = Math.sin(time * (1.9 + strand * .15) + strand * .85 + side) * height * .035;
        const reach = width * (.13 + spread * (.405 + strand * .017));
        const outerX = center + direction * reach;
        const outerY = height * (.045 + strand * .118) + flutter;
        const innerY = horizon + height * (.035 + .016 * strand);
        ctx.beginPath();
        ctx.moveTo(center + direction * width * .014, innerY);
        ctx.bezierCurveTo(
          center + direction * reach * .37, horizon + height * (.28 - .019 * strand),
          center + direction * reach * .52, outerY - height * (.22 - .011 * strand),
          outerX, outerY
        );

        ctx.globalAlpha = spread * (.32 + beat * .18) * (1 - strand * .065);
        ctx.lineWidth = strand % 3 === 0 ? 2.6 : 1.05;
        ctx.stroke();
        if (strand % 2 === 0) {
          ctx.bezierCurveTo(
            center + direction * reach * .67, outerY - height * .095,
            center + direction * reach * .34, horizon + height * .27,
            center + direction * width * .014, innerY
          );
          ctx.globalAlpha *= .28;
          ctx.fill();
        }
      }
    }
  }

  drawSurge(age, strength) {
    const ctx = this.ctx;
    const span = Math.min(this.height, this.width);
    for (let echo = 0; echo < 3; echo++) {
      const progress = (age - echo * .14) / 1.12;
      if (progress < 0 || progress >= 1) continue;
      const radius = (1 - (1 - progress) ** 2) * this.width * .68 + span * .075;
      ctx.beginPath();
      ctx.ellipse(this.width / 2, this.horizon + progress * this.height * .51, radius, radius * .22, 0, 0, tau);
      ctx.globalAlpha = (1 - progress) ** 1.7 * strength * (.5 - echo * .085);
      ctx.lineWidth = (1 - progress) * 4 + .7;
      ctx.strokeStyle = colors[echo];
      ctx.stroke();
    }
  }

  drawPrisms(age, strength) {
    const ctx = this.ctx;
    const center = this.width / 2;
    for (let index = 0; index < 18; index++) {
      const progress = (age - (index % 9) * .055) / (1.15 + (index % 4) * .14);
      if (progress <= 0 || progress >= 1) continue;
      const flight = 1 - (1 - progress) ** 1.8;
      const side = index < 9 ? -1 : 1;
      const distance = this.width * (.27 + (index % 9) * .037);
      const x = center + side * distance * flight;
      const y = this.horizon + this.height * (.06 + (index % 6) * .075) * flight
        - Math.sin(flight * Math.PI) * this.height * .17;
      const tip = Math.min(this.width, this.height) * (.018 + (index % 5) * .007);
      const opacity = smooth(progress / .12) * (1 - progress) * strength;
      ctx.beginPath();
      ctx.moveTo(x - tip * side, y - tip * .28);
      ctx.lineTo(x + tip * side, y + tip * .31);
      ctx.lineTo(x + tip * .39 * side, y - tip * .42);
      ctx.closePath();
      ctx.globalAlpha = opacity * .51;
      ctx.fillStyle = colors[index % colors.length];
      ctx.fill();
      ctx.globalAlpha = opacity * .72;
      ctx.strokeStyle = "#edfbff";
      ctx.lineWidth = .55;
      ctx.stroke();
    }
  }

  drawRoad(field) {
    if (!this.wave) return;
    const ctx = this.ctx;
    const progress = unit(this.wave);
    const y = this.horizon + (this.height - this.horizon) * progress ** .72;
    const span = field.spanAt(y) * .5;
    const width = 11 + progress * 34;
    const glow = ctx.createLinearGradient(0, y - width, 0, y + width);
    const alpha = Math.round((1 - progress) * 75).toString(16).padStart(2, "0");
    glow.addColorStop(0, "#a9dbff00");
    glow.addColorStop(.5, "#a9dbff" + alpha);
    glow.addColorStop(1, "#a9dbff00");
    ctx.fillStyle = glow;
    ctx.fillRect(this.width / 2 - span, y - width, span * 2, width * 2);
    const start = Math.max(this.horizon, y - width * 1.9);
    const end = Math.min(this.height, y + width * 1.5);
    ctx.save();
    ctx.globalAlpha = (1 - progress) * .82;
    ctx.lineWidth = 2.5 + progress * 4;
    ctx.lineCap = "round";
    for (const [lane, color] of [[-.5, colors[0]], [3.5, colors[2]]]) {
      ctx.beginPath();
      ctx.moveTo(field.x(lane, start), start);
      ctx.lineTo(field.x(lane, end), end);
      ctx.strokeStyle = color;
      ctx.stroke();
    }
    ctx.restore();
  }
}
