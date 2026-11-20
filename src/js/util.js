// Small shared helpers: DOM lookup, number clamping, vector maths, colour parsing and downloads.
// Everything here is a plain global so the other scripts can use it without modules.

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// Euclidean modulo: the result always has the sign of the divisor.
const mod = (x, n) => ((x % n) + n) % n;

// Convert '#rrggbb' to [r, g, b] in the 0-1 range.
function rgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255
  ];
}

// Normalise user or saved colour text to '#rrggbb', or '' when it is not a colour.
function paintHex(value) {
  const hex = typeof value === 'string' ? value.trim().replace(/^#/, '').toLowerCase() : '';
  if (/^[0-9a-f]{6}$/.test(hex)) return '#' + hex;
  if (/^[0-9a-f]{3}$/.test(hex)) return '#' + [...hex].map((digit) => digit + digit).join('');
  return '';
}

// Three-component vector helpers.
const sub = (a, b) => a.map((v, i) => v - b[i]),
  dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0),
  cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ],
  unit = (a) => {
    let l = Math.hypot(...a) || 1;
    return a.map((v) => v / l);
  };

// Camera axes for an orbit angle: azimuth 'az' around the vertical (Y) axis and elevation 'el'.
// 'back' points from the model toward the viewer; 'right' and 'up' span the sheet plane.
function orbitBasis({ az, el }) {
  const back = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
  const right = unit(cross([0, 1, 0], back));
  return { back, right, up: unit(cross(back, right)) };
}

// Offer text or an SVG string to the browser as a file download.
function downloadBlob(data, type, name) {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
