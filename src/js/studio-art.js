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

  function seededRange(state) {
    return (min, max) => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return min + (max - min) * (state / 2 ** 32);
    };
  }

  function draw(canvas, palette, foreground) {
    let ctx = canvas.getContext('2d');
    const foregroundContext = foreground?.getContext('2d') || ctx;
    if (!ctx) return false;
    const between = seededRange(seed);
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
    // Use a different structure for each family: sloping plates, uprights,
    // intersecting diagonals, or a loose fan.
    const compositions = [
      { x: 675, y: 490, angle: -0.55, spread: 0.11, count: 15, spacing: 29 },
      { x: 790, y: 520, angle: -1.26, spread: 0.23, count: 10, spacing: 39 },
      { x: 560, y: 315, angle: 0.30, spread: 0.64, count: 12, spacing: 38 },
      { x: 660, y: 410, angle: -0.19, spread: 1.08, count: 9, spacing: 42 }
    ];
    const layout = compositions[(seed >>> 6) % compositions.length];
    const x = layout.x + between(-90, 90), y = layout.y + between(-85, 85);
    const angle = layout.angle + between(-0.14, 0.14);
    const projection = (heading) => (a, b) => [
      x + a * Math.cos(heading) - b * Math.sin(heading),
      y + a * Math.sin(heading) + b * Math.cos(heading)
    ];
    const inset = projection(angle);

    // Separate fields for survey orbits, translucent colour and directional construction lines.
    ctx.strokeStyle = palette.guides;
    const orbitCount = Math.floor(between(16, 39));
    for (let i = 0; i < orbitCount; i++) {
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
    const plates = layout.count + Math.floor(between(-2, 3));
    for (let i = 0; i < plates; i++) {
      const project = projection(angle + between(-layout.spread, layout.spread));
      const a = between(-280, 105), b = (i - (plates - 1) / 2) * layout.spacing + between(-24, 24);
      const length = between(150, 410), depth = between(17, 67);
      const tip = between(20, 86), taper = between(8, 74);
      const points = [project(a - tip, b + depth * 0.28), project(a + length, b),
        project(a + length - taper, b + depth), project(a + 34, b + depth * 1.36)];
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
        line(project(h, b - 45), project(h + 106, b + depth * 2 + 45));
      if (i % 3 === 0) {
        ctx.globalAlpha *= 0.65;
        for (let h = -360; h < 580; h += 11)
          line(project(h, b - 45), project(h - 114, b + depth * 2 + 45));
      }
      ctx.restore();
      const edge = [points[1], points[2], project(a + length - taper, b + depth + 6), project(a + length + 1, b + 6)];
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
  const paper = document.createElement('canvas');
  paper.width = paper.height = 128;
  const paperContext = paper.getContext('2d');
  if (paperContext) {
    let grainSeed = seed;
    const grain = paperContext.createImageData(paper.width, paper.height);
    for (let i = 0; i < grain.data.length; i += 4) {
      grainSeed = (Math.imul(grainSeed, 1664525) + 1013904223) >>> 0;
      const shade = grainSeed >>> 31 ? 255 : 0;
      grain.data[i] = grain.data[i + 1] = grain.data[i + 2] = shade;
      grain.data[i + 3] = (grainSeed >>> 26) % 22;
    }
    paperContext.putImageData(grain, 0, 0);
    document.documentElement.style.setProperty('--paper-grain', `url("${paper.toDataURL()}")`);
  }

  function drawPaperFibres(stack) {
    const stock = document.createElement('canvas');
    stock.width = 384;
    stock.height = 248;
    const ctx = stock.getContext('2d');
    if (!ctx) return;
    const between = seededRange(seed ^ 0x164c72);
    ctx.lineCap = 'round';
    for (let i = 0; i < 980; i++) {
      const x = between(0, stock.width), y = between(0, stock.height);
      const length = between(0.6, 4), rise = length * between(-0.8, 0.8);
      ctx.strokeStyle = i % 3 ? '#c6dce527' : '#0b243e45';
      ctx.lineWidth = between(0.35, 0.95);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + length / 2, y + rise / 2 + between(-0.8, 0.8), x + length, y + rise);
      ctx.stroke();
    }
    stack.style.setProperty('--sample-paper-fibres', `url("${stock.toDataURL()}")`);
  }
  drawPaperFibres(document.querySelector('.sample-sheets'));

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
  sampleImage.alt = direction + ' axonometric drawing of The Optics Building';
})();
