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

function plate(ctx, width, height, y, fill, outline, lineWidth) {
  const tip = width * .69;
  ctx.beginPath();
  ctx.moveTo(-tip, y - height);
  ctx.lineTo(tip, y - height);
  ctx.quadraticCurveTo(tip + 3, y - height, tip + 6, y - height * .63);
  ctx.lineTo(width, y - 1);
  ctx.quadraticCurveTo(width + 1.5, y + 1.5, width - 1.5, y + height * .36);
  ctx.lineTo(tip + 4, y + height - 1);
  ctx.quadraticCurveTo(tip + 2, y + height, tip - 1, y + height);
  ctx.lineTo(-tip + 1, y + height);
  ctx.quadraticCurveTo(-tip - 2, y + height, -tip - 4, y + height - 1);
  ctx.lineTo(-width + 1.5, y + height * .36);
  ctx.quadraticCurveTo(-width - 1.5, y + 1.5, -width, y - 1);
  ctx.lineTo(-tip - 6, y - height * .63);
  ctx.quadraticCurveTo(-tip - 3, y - height, -tip, y - height);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function drawNote(ctx, color) {
  ctx.save();
  ctx.scale(1, .52);
  glow(ctx, color, 53, color + "9c");
  ctx.restore();

  const lens = tint(ctx, -14, 15, [[0, "#f5fffd"], [.26, color], [.62, color], [1, "#252e49"]]);
  plate(ctx, 33, 14, 4, "#0b1528", color + "bf", 1.35);
  plate(ctx, 33, 14, 0, lens, "#ecfff7", 1.4);
  bar(ctx, -15, -9, 30, 2.4, "#ffffffcf");
  bar(ctx, -17, 6, 34, 2.3, color + "da");
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
  const face = tint(ctx, -15, 17, lit
    ? [[0, color + "6a"], [.58, "#183149"], [1, color + "bc"]]
    : [[0, "#141e2ded"], [.64, "#0b1325f5"], [1, color + "56"]]);
  plate(ctx, 34, 15, 4, "#0a1125", color + "71", 1.1);
  plate(ctx, 34, 15, 0, face, lit ? "#f2fffc" : color + "ad", lit ? 1.65 : 1);
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side, 1);
    ctx.beginPath();
    ctx.moveTo(18, -10);
    ctx.lineTo(24, -10);
    ctx.lineTo(30, -.4);
    ctx.lineTo(24, 9);
    ctx.lineTo(18, 9);
    ctx.strokeStyle = lit ? "#f5ffff" : color;
    ctx.lineWidth = lit ? 3.2 : 2.3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
  }
  bar(ctx, -8, -1.2, 16, 2.4, lit ? "#f2fffc" : color + "95");
  bar(ctx, -12, 15, 24, 2.3, lit ? color : color + "74");
}

function drawSlideCap(ctx, color, tail) {
  const surface = tint(ctx, -13, 15, [[0, "#f0ffff"], [.31, color], [1, "#34768b"]]);
  plate(ctx, 32, 13, 2, "#101a32", color, 1.6);
  plate(ctx, 32, 13, 0, surface, "#ecfff9", 1.35);
  if (tail) {
    bar(ctx, -11, -2.6, 22, 5.2, "#192b43");
  } else {
    ctx.strokeStyle = "#192b43";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-10, 3);
    ctx.lineTo(-4, -4);
    ctx.lineTo(4, -4);
    ctx.lineTo(10, 3);
    ctx.stroke();
    bar(ctx, -8, 5, 16, 2, "#192b43");
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
    note: texture(108, 56, ctx => drawNote(ctx, color), 2),
    slide: texture(72, 44, ctx => drawSlideCap(ctx, color, false), 2.5),
    tail: texture(72, 44, ctx => drawSlideCap(ctx, color, true), 2.5),
    target: texture(74, 44, ctx => drawTarget(ctx, color, false), 2.5),
    targetLit: texture(74, 44, ctx => drawTarget(ctx, color, true), 2.5),
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
