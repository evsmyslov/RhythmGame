const tau = Math.PI * 2;

export function texture(width, height, draw, resolution = 1) {
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
  ctx.scale(1, .61);
  glow(ctx, color, 52, color + "a8");
  ctx.restore();

  const rim = tint(ctx, -17, 20, [[0, "#f2ffff"], [.46, color], [1, "#162b4e"]]);
  const face = tint(ctx, -15, 15, [[0, "#ffffff"], [.30, "#ecfffa"], [.65, color], [1, color + "9e"]]);
  ellipse(ctx, 0, 3.5, 33, 18, "#08192b", color + "d3", 1.45);
  ellipse(ctx, 0, -.25, 32, 18, rim, "#eafffd", 1.35);
  ellipse(ctx, 0, -2.8, 25.75, 13.3, face, color, 1.4);
  ellipse(ctx, -5, -8.1, 12, 2.1, "#ffffffbd");
}

function drawTarget(ctx, color, lit) {
  ellipse(ctx, 0, 2, 33, 17, lit ? color + "ae" : "#15202e48");
  ellipse(ctx, 0, 0, 33, 17, null, lit ? "#f2ffff" : "#eff8ffc2", lit ? 2.8 : 2);
  ellipse(ctx, 0, 0, 26, 12.8, null, lit ? color : "#d2e8ff8a", 1.5);
}

function drawSlideCap(ctx, color, tail) {
  const surface = tint(ctx, -17, 18, [[0, "#fffbe4"], [.34, "#fff9d8"], [.72, color], [1, color + "e5"]]);
  ellipse(ctx, 0, 1, 32, 16, surface, color, 2.4);
  ellipse(ctx, -2, -5, tail ? 10 : 17, 4.8, "#ffffedb8");
}

function drawSpark(ctx, color) {
  ctx.save();
  ctx.scale(1, .72);
  const burst = ctx.createRadialGradient(0, 0, 0, 0, 0, 77);
  burst.addColorStop(0, "#ffffff");
  burst.addColorStop(.22, "#f3ffff");
  burst.addColorStop(.38, color);
  burst.addColorStop(.58, color + "a4");
  burst.addColorStop(1, color + "00");
  ctx.fillStyle = burst;
  ctx.fillRect(-77, -77, 154, 154);
  ctx.restore();
  ellipse(ctx, 0, -1, 21, 9.5, "#ffffffc9");
}

function drawCelebrationSparks(ctx, color) {
  for (let i = 0; i < 16; i++) {
    const angle = Math.PI * (1.06 + i / 17);
    const radius = 29 + (i * 19 % 35);
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius * .62 + 13;
    const size = 1.2 + (i % 4) * .55;
    ctx.fillStyle = i % 3 ? color : "#f7ffff";
    ctx.beginPath();
    ctx.moveTo(x, y - size * 1.9);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size * 1.9);
    ctx.lineTo(x - size, y);
    ctx.closePath();
    ctx.fill();
  }
}

export function buildLaneSprites(colors) {
  const note = texture(108, 66, ctx => drawNote(ctx, "#59dcff"), 2);
  const flash = texture(156, 118, ctx => drawSpark(ctx, "#32dcff"));
  return colors.map((color, lane) => {
    const slideColor = lane % 2 ? "#ff6bb4" : "#ffc331";
    return {
      note, slideColor, flash,
      slide: texture(72, 44, ctx => drawSlideCap(ctx, slideColor, false), 2.5),
      tail: texture(72, 44, ctx => drawSlideCap(ctx, slideColor, true), 2.5),
      target: texture(78, 54, ctx => drawTarget(ctx, color, false), 2.5),
      targetLit: texture(78, 54, ctx => drawTarget(ctx, color, true), 2.5),
      aura: texture(148, 98, ctx => {
        ctx.scale(1, .65);
        glow(ctx, color, 74, color);
      }),
      ring: texture(70, 44, ctx => ellipse(ctx, 0, 0, 32, 19, null, color, 1.75)),
      celebration: texture(140, 70, ctx => drawCelebrationSparks(ctx, color))
    };
  });
}

export function drawLaneSprite(ctx, sprite, x, y, radius, verticalScale = 1) {
  const scale = radius / 32;
  const width = sprite.width * scale;
  const height = sprite.height * scale * verticalScale;
  ctx.drawImage(sprite.canvas, x - width / 2, y - height / 2, width, height);
}
