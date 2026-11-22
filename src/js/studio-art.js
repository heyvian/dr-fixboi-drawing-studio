// Draw one composition per visit. Both palettes use the same geometry and layer order.
(() => {
  const landing = document.querySelector('#landingArtwork');
  const fragments = document.querySelector('#landingFragments');
  const studio = document.createElement('canvas');
  studio.width = landing.width;
  studio.height = landing.height;
  const seed = Math.floor(Math.random() * 2 ** 32);
  const chalk = {
    ink: '#211b2e',
    highlight: '#faf8f1',
    guides: '#4e365c',
    copper: '#b94d37',
    faces: ['#c5e1ce', '#dac9e3', '#dae952', '#7c6a92', '#ece7de']
  };
  const graphite = {
    ink: '#242424',
    highlight: '#fafafa',
    guides: '#505050',
    copper: '#424242',
    faces: ['#c8c8c8', '#dedede', '#a2a2a2', '#686868', '#eaeaea']
  };

  function draw(canvas, palette, foreground) {
    let ctx = canvas.getContext('2d');
    const foregroundContext = foreground?.getContext('2d') || ctx;
    if (!ctx) return false;
    let state = seed;
    function between(min, max) {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return min + (max - min) * (state / 2 ** 32);
    }
    function trace(points, close = false) {
      ctx.beginPath();
      ctx.moveTo(...points[0]);
      for (const point of points.slice(1)) ctx.lineTo(...point);
      if (close) ctx.closePath();
    }
    function line(start, end) {
      trace([start, end]);
      ctx.stroke();
    }
    function pencil(a, b, length, drift) {
      const points = [];
      for (let i = 0; i <= 12; i++)
        points.push(inset(a + length * i / 12, b + drift * i / 12 + between(-1.7, 1.7)));
      trace(points);
      ctx.stroke();
    }
    function ruler(a, b, count) {
      ctx.strokeStyle = palette.ink;
      ctx.globalAlpha = 0.49;
      ctx.lineWidth = 0.8;
      line(inset(a, b), inset(a + count * 9, b));
      for (let i = 0; i <= count; i++) {
        const x = a + i * 9;
        const tick = i % 10 === 0 ? 21 : i % 5 === 0 ? 13 : 6;
        line(inset(x, b), inset(x, b + tick));
      }
    }
    function disk(x, y, radius, fill, opacity) {
      ctx.globalAlpha = opacity;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    function sphere(x, y, radius, color, opacity) {
      const gradient = ctx.createRadialGradient(
        x - radius * 0.37, y - radius * 0.42, radius * 0.06,
        x + radius * 0.06, y + radius * 0.09, radius * 1.02
      );
      gradient.addColorStop(0, palette.highlight);
      gradient.addColorStop(0.37, color);
      gradient.addColorStop(0.84, palette.guides);
      gradient.addColorStop(1, palette.ink);
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.clip();
      ctx.translate(x, y);
      ctx.rotate(-0.38);
      ctx.lineWidth = 0.75;
      ctx.strokeStyle = '#ffffff78';
      for (const latitude of [-0.6, -0.3, 0, 0.3, 0.6]) {
        const width = radius * Math.sqrt(1 - latitude ** 2);
        ctx.beginPath();
        ctx.ellipse(0, latitude * radius * 0.95, width, width * 0.22, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    const x = between(470, 715), y = between(330, 500), angle = between(-0.68, -0.24);
    const inset = (a, b) => [
      x + a * Math.cos(angle) - b * Math.sin(angle),
      y + a * Math.sin(angle) + b * Math.cos(angle)
    ];

    // Separate fields for survey orbits, translucent colour and directional construction lines.
    ctx.strokeStyle = palette.guides;
    for (let i = 0; i < 30; i++) {
      const radius = between(38, 410), rotation = between(-0.9, 0.55), start = between(-3, 3);
      ctx.globalAlpha = between(0.12, 0.65);
      ctx.lineWidth = i % 5 === 0 ? 1.35 : 0.65;
      ctx.setLineDash([[8, 6], [1, 5], [], [14, 5, 1, 5]][i % 4]);
      ctx.beginPath();
      ctx.ellipse(x + between(-118, 118), y + between(-100, 100), radius,
        radius * between(0.40, 0.95), rotation, start, start + between(1.4, 6.3));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    disk(x + between(135, 245), y - between(120, 230), between(36, 71), palette.faces[2], 0.92);
    disk(x - between(100, 195), y + between(100, 175), between(46, 93), palette.faces[0], 0.76);
    ctx.globalAlpha = 0.24;
    ctx.lineWidth = 0.8;
    for (let i = -13; i <= 13; i++) {
      line(inset(-505, i * 22), inset(525, i * 22 + between(-15, 15)));
      line(inset(i * 36, -315), inset(i * 36 + 80, 315));
    }
    ctx.strokeStyle = palette.guides;
    for (let i = 0; i < 46; i++) {
      ctx.globalAlpha = between(0.10, 0.36);
      ctx.lineWidth = between(0.45, 1.25);
      pencil(between(-515, 110), between(-315, 315), between(120, 610), between(-90, 110));
    }
    ruler(-430, 223, 92);

    // Satellite fragments keep the composition active at the edges of the page.
    for (let i = 0; i < 18; i++) {
      const px = (i % 6) * 200 + between(-55, 155);
      const py = Math.floor(i / 6) * 300 + between(15, 280);
      const run = between(48, 205), rise = between(-105, 110);
      trace([[px - run * 0.35, py + rise * 0.48], [px + run, py - rise],
        [px + run * 0.14, py + between(14, 56)]], true);
      ctx.fillStyle = palette.faces[i % palette.faces.length];
      ctx.globalAlpha = between(0.18, 0.46);
      ctx.fill();
      ctx.strokeStyle = palette.ink;
      ctx.lineWidth = i % 5 === 0 ? 1.65 : 0.7;
      ctx.setLineDash(i % 3 === 0 ? [2, 4] : []);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    sphere(between(155, 285), between(120, 220), between(22, 49), palette.faces[1], 0.73);
    sphere(between(875, 1100), between(130, 285), between(39, 83), palette.faces[2], 0.91);
    sphere(between(385, 625), between(650, 780), between(27, 62), palette.faces[0], 0.82);

    ctx = foregroundContext;

    // Stepped, intersecting plates with clipped hatching and projected edges.
    const plates = Math.floor(between(9, 16));
    for (let i = 0; i < plates; i++) {
      const a = between(-280, 105), b = (i - (plates - 1) / 2) * 31 + between(-24, 24);
      const length = between(150, 410), depth = between(17, 67);
      const tip = between(20, 86), taper = between(8, 74);
      const points = [inset(a - tip, b + depth * 0.28), inset(a + length, b),
        inset(a + length - taper, b + depth), inset(a + 34, b + depth * 1.36)];
      trace(points, true);
      const wash = ctx.createLinearGradient(...points[0], ...points[1]);
      wash.addColorStop(0, palette.faces[(i + 3) % palette.faces.length] + '44');
      wash.addColorStop(0.4, palette.faces[i % palette.faces.length]);
      wash.addColorStop(1, palette.faces[(i + 1) % palette.faces.length]);
      ctx.fillStyle = wash;
      ctx.globalAlpha = between(0.48, 0.94);
      ctx.fill();
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = palette.ink;
      ctx.lineWidth = i % 4 === 0 ? 2.5 : 1;
      ctx.stroke();
      ctx.save();
      ctx.clip();
      ctx.lineWidth = 0.7;
      ctx.globalAlpha = i % 3 ? 0.34 : 0.62;
      for (let h = -360; h < 520; h += 6)
        line(inset(h, b - 45), inset(h + 106, b + depth * 2 + 45));
      if (i % 3 === 0) {
        ctx.globalAlpha *= 0.65;
        for (let h = -360; h < 580; h += 11)
          line(inset(h, b - 45), inset(h - 114, b + depth * 2 + 45));
      }
      ctx.restore();
      const edge = [points[1], points[2], inset(a + length - taper, b + depth + 6), inset(a + length + 1, b + 6)];
      trace(edge, true);
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = palette.ink;
      ctx.fill();
    }

    ruler(-286, -204, 52);
    ctx.strokeStyle = palette.copper;
    ctx.globalAlpha = 0.65;
    ctx.lineWidth = 1;
    ctx.setLineDash([51, 5, 3, 5]);
    pencil(-540, 107, 1070, -93);
    pencil(-390, -139, 904, 72);
    ctx.setLineDash([]);

    sphere(between(1000, 1160), between(400, 575), between(13, 30), palette.faces[3], 0.83);
    for (let i = 0; i < 76; i++) {
      const px = between(32, 1170), py = between(24, 870);
      const size = i % 8 === 0 ? between(7, 15) : between(1, 4);
      ctx.globalAlpha = between(0.36, 0.9);
      ctx.strokeStyle = i % 8 === 0 ? palette.copper : palette.ink;
      ctx.lineWidth = i % 8 === 0 ? 1.8 : 0.75;
      line([px - size, py], [px + size, py]);
      line([px, py - size], [px, py + size]);
    }
    return true;
  }

  draw(landing, chalk, fragments);
  if (draw(studio, graphite))
    document.documentElement.style.setProperty('--studio-plot', `url("${studio.toDataURL()}")`);

  const dropZone = landing.closest('.drop-zone');
  const canMove = matchMedia('(prefers-reduced-motion: no-preference) and (any-pointer: fine)');
  function resetMotion() {
    dropZone.style.removeProperty('--art-x');
    dropZone.style.removeProperty('--art-y');
  }
  dropZone.addEventListener('pointermove', (event) => {
    if (!canMove.matches || event.pointerType !== 'mouse') return;
    const bounds = dropZone.getBoundingClientRect();
    dropZone.style.setProperty('--art-x', (2 * (event.clientX - bounds.left) / bounds.width - 1).toFixed(3));
    dropZone.style.setProperty('--art-y', (2 * (event.clientY - bounds.top) / bounds.height - 1).toFixed(3));
  }, { passive: true });
  dropZone.addEventListener('pointerleave', resetMotion);
  canMove.addEventListener('change', resetMotion);

  const directions = ['NE', 'SE', 'NW', 'SW'];
  const direction = directions[seed % directions.length];
  const sampleImage = document.querySelector('#sampleSheetImage');
  sampleImage.src = 'src/assets/sample-sheets/axonometric-' + direction.toLowerCase() + '.svg';
  sampleImage.alt = direction + ' axonometric drawing of The Valentine';
  document.querySelector('#sampleSheetView').textContent = direction + ' axonometric';
})();
