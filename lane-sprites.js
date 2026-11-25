const size = 160;
const center = size / 2;
const tau = Math.PI * 2;

function texture(draw) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.translate(center, center);
  draw(ctx);
  return canvas;
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

function drawTarget(ctx, color) {
  ellipse(ctx, 0, 7, 38, 24, "#0c1127a4");
  const rim = tint(ctx, -20, 24, [[0, "#f3f8ff"], [.34, color], [.57, "#324477"], [1, color]]);
  const face = tint(ctx, -14, 15, [[0, "#263355"], [.36, "#111b36"], [1, "#293757"]]);
  const pool = tint(ctx, -10, 13, [[0, "#26304e"], [.62, "#263455"], [1, color + "7d"]]);
  ellipse(ctx, 0, 2, 32, 19, rim, "#c9ddfbc6", 1);
  ellipse(ctx, 0, -1, 28.7, 16.4, face, color + "c7", 1.2);
  ellipse(ctx, 0, -1, 22, 12, pool, "#e4efff59", .9);

  ctx.beginPath();
  ctx.ellipse(0, .5, 25, 13.8, 0, Math.PI * 1.13, Math.PI * 1.66);
  ctx.strokeStyle = "#f7ffffd4";
  ctx.lineWidth = 1.35;
  ctx.lineCap = "round";
  ctx.stroke();
  ellipse(ctx, -2, -.5, 6.5, 4.2, color + "49", color + "bd", .7);
  ellipse(ctx, -2, -.85, 2.5, 1.5, "#edf9ff");
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
    note: texture(ctx => drawNote(ctx, color)),
    target: texture(ctx => drawTarget(ctx, color)),
    aura: texture(ctx => {
      ctx.scale(1, .65);
      glow(ctx, color, 74, color);
    }),
    flash: texture(ctx => drawSpark(ctx, color))
  }));
}

export function drawLaneSprite(ctx, sprite, x, y, radius, verticalScale = 1) {
  const half = radius * (center / 32);
  const depth = half * verticalScale;
  ctx.drawImage(sprite, x - half, y - depth, half * 2, depth * 2);
}
