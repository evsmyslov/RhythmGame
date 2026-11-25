const tau = Math.PI * 2;

function texture(width, height, draw, resolution = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = width * resolution;
  canvas.height = height * resolution;
  const ctx = canvas.getContext("2d");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(resolution, resolution);
  draw(ctx);
  return { canvas, width, height };
}

function ellipse(ctx, x, y, rx, ry, fill, stroke, width = 1) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, tau);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

function tint(ctx, top, bottom, stops) {
  const gradient = ctx.createLinearGradient(0, top, 0, bottom);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  return gradient;
}

function glow(ctx, color, radius, inner) {
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(.29, color + "b4");
  gradient.addColorStop(.51, color + "3b");
  gradient.addColorStop(1, color + "00");
  ctx.fillStyle = gradient;
  ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
}

function drawNote(ctx, color) {
  ctx.save();
  ctx.scale(1, .75);
  glow(ctx, color, 53, "#f5fbffa3");
  ctx.restore();

  const bezel = tint(ctx, -18, 24, [[0, "#e8f1ff"], [.45, color], [1, "#4b5c91"]]);
  const lens = tint(ctx, -16, 14, [[0, "#ffffff"], [.32, "#f6fbfd"], [.69, color], [1, "#7689ba"]]);
  ellipse(ctx, 0, 4, 33, 18, "#122348c8", color + "9c", 1.3);
  ellipse(ctx, 0, 0, 32, 19, bezel, "#eff7ff", 1);
  ellipse(ctx, 0, -1.5, 26, 14, lens, "#ffffffa8", .8);
  ellipse(ctx, -10, -8, 10.5, 2.7, "#ffffffec");
  ellipse(ctx, 12, 7, 6, 1.3, "#ffffff83");
}

function keyProfile(ctx, top, bottom, back, front, fill, stroke, width) {
  ctx.beginPath();
  ctx.moveTo(-back + 5, top);
  ctx.lineTo(back - 5, top);
  ctx.quadraticCurveTo(back, top, back + 2, top + 4);
  ctx.lineTo(front, bottom - 5);
  ctx.quadraticCurveTo(front + 1.5, bottom, front - 5, bottom);
  ctx.lineTo(-front + 5, bottom);
  ctx.quadraticCurveTo(-front - 1.5, bottom, -front, bottom - 5);
  ctx.lineTo(-back - 2, top + 4);
  ctx.quadraticCurveTo(-back, top, -back + 5, top);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

function bar(ctx, x, y, width, height, color) {
  const radius = height / 2;
  ctx.beginPath();
  ctx.moveTo(x + radius, y + radius);
  ctx.lineTo(x + width - radius, y + radius);
  ctx.lineCap = "round";
  ctx.lineWidth = height;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function drawTarget(ctx, color, lit) {
  const base = tint(ctx, 7, 20, [[0, "#202a49"], [1, "#070b1c"]]);
  keyProfile(ctx, -10, 20, 25, 33, base, color + "80", 1.2);

  const surface = tint(ctx, -15, 12, lit
    ? [[0, color + "bf"], [.29, "#2a3857"], [.77, "#32486c"], [1, color]]
    : [[0, "#3b4b70"], [.31, "#192544"], [.71, "#111a34"], [1, "#3b517a"]]);
  keyProfile(ctx, -15, 12, 25, 33, surface, lit ? "#f3ffff" : color, lit ? 1.75 : 1.35);

  bar(ctx, -21, -12, 42, 1.4, lit ? "#ffffff" : color + "b3");
  bar(ctx, -25, 7, 50, 2.4, lit ? "#f8ffff" : color + "e8");
  bar(ctx, -20, 15, 40, 2.1, lit ? color : color + "54");
  bar(ctx, -5, -2, 10, 2.4, lit ? "#f8ffff" : color + "84");
}

function drawSlideCap(ctx, color, tail) {
  const surface = tint(ctx, -16, 16, [[0, "#f5ffff"], [.30, color], [1, "#576889"]]);
  keyProfile(ctx, -14, 17, 26, 32, "#101a32", color, 2);
  keyProfile(ctx, -15, 12, 25, 31, surface, "#f0fcff", 1.3);
  if (tail) {
    bar(ctx, -11, -4, 22, 8, "#172541");
  } else {
    bar(ctx, -13, -5.5, 26, 2.8, "#172541");
    bar(ctx, -13, 1, 26, 2.8, "#172541");
  }
}

function drawSpark(ctx, color) {
  ctx.save();
  ctx.scale(1, .82);
  glow(ctx, color, 76, "#ffffff");
  ctx.restore();
  ctx.strokeStyle = color + "ec";
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-68, 0);
  ctx.lineTo(68, 0);
  ctx.moveTo(0, -43);
  ctx.lineTo(0, 37);
  ctx.stroke();
  ellipse(ctx, 0, 0, 10, 6, "#fbffffdf");
}

export function buildLaneSprites(colors) {
  return colors.map(color => ({
    note: texture(108, 82, ctx => drawNote(ctx, color)),
    slide: texture(72, 44, ctx => drawSlideCap(ctx, color, false), 2.5),
    tail: texture(72, 44, ctx => drawSlideCap(ctx, color, true), 2.5),
    target: texture(74, 46, ctx => drawTarget(ctx, color, false), 2.5),
    targetLit: texture(74, 46, ctx => drawTarget(ctx, color, true), 2.5),
    aura: texture(148, 98, ctx => {
      ctx.scale(1, .65);
      glow(ctx, color, 74, color);
    }),
    flash: texture(152, 126, ctx => drawSpark(ctx, color))
  }));
}

export function drawLaneSprite(ctx, sprite, x, y, radius, verticalScale = 1) {
  const scale = radius / 32;
  const width = sprite.width * scale;
  const height = sprite.height * scale * verticalScale;
  ctx.drawImage(sprite.canvas, x - width / 2, y - height / 2, width, height);
}
