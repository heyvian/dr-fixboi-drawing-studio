// 3D navigation: a small orthographic WebGL viewer used to choose what to draw. It is orthographic on
// purpose, so the view you frame here is projected exactly like the drawing sheet. The viewer never
// touches the drawing settings; the app copies a snapshot() across when you switch to Drawing.

const viewer = (() => {
  const canvas = $('navCanvas'),
    TOP = Math.PI / 2 - 1e-4, // highest orbit elevation (looking straight down)
    HOME = { az: Math.PI / 2 + (5 * Math.PI) / 4, el: 0.57 }, // the drawing's default south-west axo
    PRESETS = {
      iso: HOME,
      top: { az: -Math.PI / 2, el: TOP },
      north: { az: Math.PI / 2, el: 0 },
      east: { az: Math.PI, el: 0 },
      south: { az: -Math.PI / 2, el: 0 },
      west: { az: 0, el: 0 }
    },
    LIGHT = unit([-0.4, 1, 0.65]),
    gl = canvas.getContext('webgl', { antialias: true, alpha: false });

  const camera = { az: HOME.az, el: HOME.el, target: [0, 0, 0], halfHeight: 10 };
  let revision = 0, // bumps whenever the user moves the camera, so the app can tell it changed
    center = [0, 0, 0],
    focus = [0, 0, 0], // the orbit centre: orbiting keeps this point still on screen and presets centre on it
    picking = false, // true while the next click sets the focus
    onPick = null,
    marker = null,
    radius = 10,
    buffers = [],
    program = null,
    locations = null;

  if (!gl) return { ok: false };

  // --- Shaders ---------------------------------------------------------------------------------
  // Positions are projected with the same right/up/back axes the drawing uses (orbitBasis).
  const vertexSource = `
    attribute vec3 p; attribute vec3 n; attribute vec4 c;
    uniform vec3 uRight, uUp, uBack, uTarget; uniform vec2 uHalf; uniform float uDepth;
    varying vec3 vN; varying vec4 vC;
    void main() {
      vec3 d = p - uTarget;
      gl_Position = vec4(dot(d, uRight) / uHalf.x, dot(d, uUp) / uHalf.y, -dot(d, uBack) / uDepth, 1.0);
      vN = n; vC = c;
    }`,
    fragmentSource = `
      precision mediump float;
      uniform vec3 uLight; uniform float uLit, uAlpha;
      varying vec3 vN; varying vec4 vC;
      void main() {
        float shade = 0.5 + 0.5 * abs(dot(normalize(vN), uLight));
        vec3 colour = uLit > 0.5 ? vC.rgb * shade : vec3(0.12, 0.17, 0.14);
        gl_FragColor = vec4(colour, uAlpha);
      }`;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
    return shader;
  }
  try {
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
  } catch (error) {
    console.error('3D view unavailable', error);
    return { ok: false };
  }
  gl.useProgram(program);
  locations = {
    p: gl.getAttribLocation(program, 'p'),
    n: gl.getAttribLocation(program, 'n'),
    c: gl.getAttribLocation(program, 'c')
  };
  for (const name of ['uRight', 'uUp', 'uBack', 'uTarget', 'uHalf', 'uDepth', 'uLight', 'uLit', 'uAlpha'])
    locations[name] = gl.getUniformLocation(program, name);

  // --- Model data --------------------------------------------------------------------------------
  // Upload the visible solid, glass and line buffers (10 floats per vertex: position, normal, colour)
  // and measure them. Called for a new model and whenever layer visibility changes.
  function setModel(model, resetView) {
    for (const buffer of buffers) gl.deleteBuffer(buffer.id);
    buffers = [];
    const mesh = model.assemble(),
      lo = [Infinity, Infinity, Infinity],
      hi = [-Infinity, -Infinity, -Infinity];
    for (const [key, mode] of [['solid', gl.TRIANGLES], ['glass', gl.TRIANGLES], ['lines', gl.LINES]]) {
      const data = Float32Array.from(mesh[key]);
      if (!data.length) continue;
      for (let i = 0; i < data.length; i += 10)
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], data[i + k]);
          hi[k] = Math.max(hi[k], data[i + k]);
        }
      const id = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, id);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      buffers.push({ id, mode, key, count: data.length / 10, data });
    }
    if (!buffers.length) lo.fill(-1), hi.fill(1);
    center = lo.map((v, i) => (v + hi[i]) / 2);
    radius = Math.max(Math.hypot(...hi.map((v, i) => v - lo[i])) / 2, 1);
    if (resetView) {
      focus = [...center];
      camera.az = HOME.az;
      camera.el = HOME.el;
      zoomExtents(false);
    } else draw();
  }

  // --- Camera -----------------------------------------------------------------------------------
  const aspect = () => canvas.clientWidth / Math.max(canvas.clientHeight, 1) || 1;

  // Fit every visible vertex in the window for the current orbit angles, with a small margin.
  function zoomExtents(count = true) {
    const { right, up } = orbitBasis(camera);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const { data } of buffers)
      for (let i = 0; i < data.length; i += 10) {
        const point = [data[i] - center[0], data[i + 1] - center[1], data[i + 2] - center[2]],
          x = dot(point, right),
          y = dot(point, up);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    if (!Number.isFinite(minX)) minX = minY = -1, maxX = maxY = 1;
    const shiftX = (minX + maxX) / 2,
      shiftY = (minY + maxY) / 2;
    camera.target = center.map((v, i) => v + right[i] * shiftX + up[i] * shiftY);
    camera.halfHeight = Math.max((maxY - minY) / 2, (maxX - minX) / 2 / aspect(), 0.01) * 1.08;
    focus = [...center]; // extents also puts the orbit centre back in the middle of the model
    if (count) revision++;
    draw();
  }

  // Jump to a standard view, turning about the focus point and centring it. The zoom is kept.
  function preset(name) {
    Object.assign(camera, PRESETS[name]);
    camera.target = [...focus];
    revision++;
    draw();
  }

  const basisNow = () => orbitBasis(camera);

  // Rotate the model around the focus point. Dragging right turns the model with the cursor.
  // The focus keeps its position in the window, so the camera target is recomputed afterwards.
  function orbit(dx, dy) {
    const before = basisNow(),
      offset = focus.map((v, i) => v - camera.target[i]),
      x = dot(offset, before.right),
      y = dot(offset, before.up);
    camera.az += dx * 0.007;
    camera.el = clamp(camera.el + dy * 0.007, -TOP, TOP);
    const after = basisNow();
    camera.target = focus.map((v, i) => v - after.right[i] * x - after.up[i] * y);
    revision++;
    draw();
  }

  // --- Focus picking ------------------------------------------------------------------------------
  // Find the model point under a window position ((nx, ny) in -1..1). Casts a ray along the view
  // direction against the solid and glass triangles and takes the nearest hit; if it misses the
  // model it falls back to the plane through the model centre that faces the camera.
  function pointAt(nx, ny) {
    const { right, up, back } = basisNow(),
      ratio = aspect(),
      origin = camera.target.map((v, i) => v + right[i] * nx * camera.halfHeight * ratio + up[i] * ny * camera.halfHeight),
      dir = back.map((v) => -v),
      start = origin.map((v, i) => v + back[i] * radius * 100);
    let best = Infinity;
    for (const { key, data } of buffers) {
      if (key === 'lines') continue;
      for (let i = 0; i + 29 < data.length; i += 30) {
        const a = [data[i], data[i + 1], data[i + 2]],
          e1 = [data[i + 10] - a[0], data[i + 11] - a[1], data[i + 12] - a[2]],
          e2 = [data[i + 20] - a[0], data[i + 21] - a[1], data[i + 22] - a[2]],
          p = cross(dir, e2),
          det = dot(e1, p);
        if (Math.abs(det) < 1e-12) continue;
        const s = start.map((v, k) => v - a[k]),
          u = dot(s, p) / det;
        if (u < 0 || u > 1) continue;
        const q = cross(s, e1),
          v = dot(dir, q) / det;
        if (v < 0 || u + v > 1) continue;
        const t = dot(e2, q) / det;
        if (t > 0 && t < best) best = t;
      }
    }
    if (Number.isFinite(best)) return start.map((v, i) => v + dir[i] * best);
    const t = dot(start.map((v, i) => v - center[i]), back);
    return start.map((v, i) => v + dir[i] * t);
  }

  // Make the point under a window position the orbit centre.
  function setFocusAt(nx, ny) {
    focus = pointAt(nx, ny);
    picking = false;
    canvas.style.cursor = '';
    onPick?.();
    draw();
  }

  // Arm or disarm "the next click sets the focus".
  function setPicking(on) {
    picking = on;
    canvas.style.cursor = on ? 'crosshair' : '';
  }

  const toWindow = (event) => {
    const box = canvas.getBoundingClientRect();
    return [((event.clientX - box.left) / box.width) * 2 - 1, 1 - ((event.clientY - box.top) / box.height) * 2];
  };

  // Slide the view across the screen plane by a number of CSS pixels.
  function pan(dx, dy) {
    const { right, up } = basisNow(),
      perPixel = (2 * camera.halfHeight) / Math.max(canvas.clientHeight, 1);
    camera.target = camera.target.map((v, i) => v - right[i] * dx * perPixel + up[i] * dy * perPixel);
    revision++;
    draw();
  }

  // Scale the view. (nx, ny) is the cursor in -1..1 window coordinates; the point under it stays put.
  function zoom(factor, nx = 0, ny = 0) {
    const { right, up } = basisNow(),
      next = clamp(camera.halfHeight * factor, radius * 0.0005, radius * 20),
      ratio = aspect(),
      moveX = nx * camera.halfHeight * ratio - nx * next * ratio,
      moveY = ny * camera.halfHeight - ny * next;
    camera.target = camera.target.map((v, i) => v + right[i] * moveX + up[i] * moveY);
    camera.halfHeight = next;
    revision++;
    draw();
  }

  // --- Drawing ----------------------------------------------------------------------------------
  function resize() {
    const ratio = window.devicePixelRatio || 1,
      width = Math.max(1, Math.round(canvas.clientWidth * ratio)),
      height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  let queued = 0;
  function draw() {
    if (!queued) queued = requestAnimationFrame(paint);
  }
  function paint() {
    queued = 0;
    if (!canvas.clientWidth) return;
    resize();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.96, 0.97, 0.95, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    const { right, up, back } = basisNow(),
      ratio = aspect(),
      distance = Math.hypot(...camera.target.map((v, i) => v - center[i]));
    gl.uniform3fv(locations.uRight, right);
    gl.uniform3fv(locations.uUp, up);
    gl.uniform3fv(locations.uBack, back);
    gl.uniform3fv(locations.uTarget, camera.target);
    gl.uniform2f(locations.uHalf, camera.halfHeight * ratio, camera.halfHeight);
    gl.uniform1f(locations.uDepth, (radius + distance) * 1.5 + 1);
    gl.uniform3fv(locations.uLight, LIGHT);
    // Solids first, then lines, then see-through glass so it blends over what is behind it.
    for (const key of ['solid', 'lines', 'glass']) {
      const buffer = buffers.find((item) => item.key === key);
      if (!buffer) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer.id);
      for (const [name, size, offset] of [['p', 3, 0], ['n', 3, 3], ['c', 4, 6]]) {
        gl.enableVertexAttribArray(locations[name]);
        gl.vertexAttribPointer(locations[name], size, gl.FLOAT, false, 40, offset * 4);
      }
      gl.uniform1f(locations.uLit, key === 'lines' ? 0 : 1);
      gl.uniform1f(locations.uAlpha, key === 'glass' ? 0.35 : 1);
      gl.depthMask(key !== 'glass');
      gl.drawArrays(buffer.mode, 0, buffer.count);
    }
    gl.depthMask(true);
    placeMarker(right, up);
  }

  // A small crosshair over the canvas that shows where the focus point is.
  function placeMarker(right, up) {
    if (!marker) {
      marker = document.createElement('div');
      marker.className = 'nav-focus';
      marker.title = 'Orbit centre';
      canvas.parentElement.appendChild(marker);
    }
    const offset = focus.map((v, i) => v - camera.target[i]),
      x = dot(offset, right) / (camera.halfHeight * aspect()),
      y = dot(offset, up) / camera.halfHeight;
    marker.style.left = `${((x + 1) / 2) * 100}%`;
    marker.style.top = `${((1 - y) / 2) * 100}%`;
    marker.hidden = Math.abs(x) > 1 || Math.abs(y) > 1;
  }
  new ResizeObserver(draw).observe(canvas);

  // --- Input ------------------------------------------------------------------------------------
  let drag = null;
  canvas.addEventListener('pointerdown', (event) => {
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, pan: event.button !== 0 || event.shiftKey };
    canvas.setPointerCapture(event.pointerId);
    canvas.focus({ preventScroll: true });
  });
  canvas.addEventListener('pointermove', (event) => {
    if (drag?.id !== event.pointerId) return;
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (drag.pan) pan(dx, dy);
    else orbit(dx, dy);
  });
  const endDrag = (event) => {
    if (drag?.id !== event.pointerId) return;
    // A click (not a drag) while "Set focus" is armed picks the point under the cursor.
    if (picking && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) setFocusAt(...toWindow(event));
    drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('dblclick', (event) => setFocusAt(...toWindow(event)));
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const box = canvas.getBoundingClientRect();
      zoom(
        Math.exp(event.deltaY * 0.0015),
        ((event.clientX - box.left) / box.width) * 2 - 1,
        1 - ((event.clientY - box.top) / box.height) * 2
      );
    },
    { passive: false }
  );
  canvas.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 60 : 20,
      pans = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (pans[event.key]) pan(...pans[event.key]);
    else if (event.key === '+' || event.key === '=') zoom(0.85);
    else if (event.key === '-' || event.key === '_') zoom(1 / 0.85);
    else if (event.key === 'Home') zoomExtents();
    else return;
    event.preventDefault();
  });

  return {
    ok: true,
    setModel,
    zoomExtents,
    preset,
    redraw: draw,
    setPicking,
    set onPick(fn) {
      onPick = fn;
    },
    get focus() {
      return [...focus];
    },
    pointAt,
    setFocusAt,
    get revision() {
      return revision;
    },
    // What the drawing needs: the viewing angles, the point at the window centre and the half-extents
    // of the window in model units.
    snapshot: () => ({
      az: camera.az,
      el: camera.el,
      target: [...camera.target],
      halfWidth: camera.halfHeight * aspect(),
      halfHeight: camera.halfHeight
    })
  };
})();
