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

const COMPASS_POINTS = [
  ['N', 'north', 2, 1], ['NE', 'northeast', 3, 1], ['E', 'east', 3, 2], ['SE', 'southeast', 3, 3],
  ['S', 'south', 2, 3], ['SW', 'southwest', 1, 3], ['W', 'west', 1, 2], ['NW', 'northwest', 1, 1]
];
const compassAzimuth = (degrees) => Math.PI / 2 + degrees * Math.PI / 180;
const compassHeading = (azimuth) => mod(Math.round((azimuth - Math.PI / 2) * 180 / Math.PI), 360);

function createViewCompass(element, choose) {
  const buttons = COMPASS_POINTS.map(([label, name, column, row], index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.style.gridColumn = column;
    button.style.gridRow = row;
    button.style.setProperty('--compass-turn', index * 45 + 'deg');
    button.dataset.compassPoint = label;
    button.setAttribute('aria-label', 'View from ' + name);
    const arrow = document.createElement('span');
    arrow.className = 'compass-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '↓';
    button.append(arrow, label);
    button.onclick = () => choose(index * 45);
    return button;
  });
  const reading = document.createElement('span');
  reading.className = 'compass-reading';
  reading.setAttribute('aria-hidden', 'true');
  element.append(...buttons, reading);
  return (heading, plan = false) => {
    reading.textContent = heading == null ? '•' : `${heading}°`;
    buttons.forEach((button, index) => {
      button.setAttribute('aria-label', (plan ? 'Top of plan toward ' : 'View from ') + COMPASS_POINTS[index][1]);
      button.setAttribute('aria-pressed', String(heading === index * 45));
    });
  };
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
