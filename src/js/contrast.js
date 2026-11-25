// WCAG relative luminance for sRGB colours, including the visible result of faded ink.
function paperContrast(ink, paper, opacity = 1) {
  const base = rgb(paper);
  const visible = rgb(ink).map((value, i) => value * opacity + base[i] * (1 - opacity));
  const luminance = (color) => dot(color.map((value) => value <= 0.04045
    ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4), [0.2126, 0.7152, 0.0722]);
  const a = luminance(base), b = luminance(visible);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function accessibleInk(ink, paper, target, opacity = 1) {
  if (paperContrast(ink, paper, opacity) >= target) return ink;
  const original = rgb(ink);
  // Mix toward the closer qualifying tone while preserving the original hue.
  const directions = [0, 1].filter((tone) => paperContrast(tone ? '#ffffff' : '#000000', paper, opacity) >= target);
  for (let step = 1; step <= 100; step++) {
    for (const tone of directions) {
      const candidate = '#' + original.map((value) => Math.round((value + (tone - value) * step / 100) * 255)
        .toString(16).padStart(2, '0')).join('');
      if (paperContrast(candidate, paper, opacity) >= target) return candidate;
    }
  }
  return null;
}
