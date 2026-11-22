// Draw one composition per visit. Both palettes use the same geometry and layer order.
(() => {
  const landing = document.querySelector('#landingArtwork');
  const studio = document.createElement('canvas');
  studio.width = landing.width;
  studio.height = landing.height;
  const seed = Math.floor(Math.random() * 2 ** 32);
  const chalk = {
    ink: '#211b2e',
    guides: '#4e365c',
    copper: '#b94d37',
    faces: ['#c5e1ce', '#dac9e3', '#dae952', '#7c6a92', '#ece7de']
  };
  const graphite = {
    ink: '#242424',
    guides: '#505050',
    copper: '#424242',
    faces: ['#c8c8c8', '#dedede', '#a2a2a2', '#686868', '#eaeaea']
  };

  function draw(canvas, palette) {
    const ctx = canvas.getContext('2d');
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
    const x = between(520, 710), y = between(330, 475), angle = between(-0.64, -0.29);
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
      ctx.setLineDash(i % 4 === 0 ? [7, 5, 1, 5] : []);
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

    // Stepped, intersecting plates with clipped hatching and projected edges.
    for (let i = 0; i < 16; i++) {
      const a = between(-205, 75), b = (i - 8) * 27 + between(-20, 20);
      const length = between(150, 410), depth = between(17, 67);
      const points = [inset(a - 86, b + depth * 0.28), inset(a + length, b),
        inset(a + length - 33, b + depth), inset(a + 34, b + depth * 1.36)];
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
      const edge = [points[1], points[2], inset(a + length - 34, b + depth + 6), inset(a + length + 1, b + 6)];
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

    for (let i = 0; i < 62; i++) {
      const a = between(-430, 460), b = between(-280, 280);
      const [px, py] = inset(a, b), size = i % 8 === 0 ? 8 : between(1, 3.5);
      ctx.globalAlpha = between(0.36, 0.9);
      ctx.strokeStyle = i % 8 === 0 ? palette.copper : palette.ink;
      ctx.lineWidth = i % 8 === 0 ? 1.8 : 0.75;
      line([px - size, py], [px + size, py]);
      line([px, py - size], [px, py + size]);
    }
    return true;
  }

  draw(landing, chalk);
  if (draw(studio, graphite))
    document.documentElement.style.setProperty('--studio-plot', `url("${studio.toDataURL()}")`);
})();
