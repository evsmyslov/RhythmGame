function hex(hue, saturation, lightness) {
  const channel = offset => {
    const angle = (offset + hue / 30) % 12;
    const amplitude = saturation * Math.min(lightness, 1 - lightness);
    const value = lightness - amplitude * Math.max(-1, Math.min(angle - 3, 9 - angle, 1));
    return Math.round(value * 255).toString(16).padStart(2, "0");
  };
  return "#" + channel(0) + channel(8) + channel(4);
}

export function trackPalette(key = "", brightness = .5) {
  let seed = 2166136261;
  for (const letter of key) seed = Math.imul(seed ^ letter.codePointAt(0), 16777619);
  seed = Math.imul(seed ^ seed >>> 16, 0x7feb352d);
  seed = Math.imul(seed ^ seed >>> 15, 0x846ca68b);
  const fraction = ((seed ^ seed >>> 16) >>> 0) / 2 ** 32;
  const hue = (fraction * 360 + 145 * brightness) % 360;
  const lanes = [0, 54, 117, 178].map((offset, index) =>
    hex(hue + offset, index % 2 ? .90 : .84, index % 2 ? .76 : .70)
  );
  return {
    lanes,
    rays: [lanes[0], lanes[2], lanes[3]],
    sky: hex(hue + 36, .76, .57),
    accent: lanes[0]
  };
}
