function drawingViewport(paper, region) {
  const pixelsPerMillimetre = DRAWING_PIXELS_PER_INCH / 25.4,
    width = region?.width ?? Math.round(paper.width * DRAWING_PIXELS_PER_INCH),
    height = region?.height ?? Math.round(paper.height * DRAWING_PIXELS_PER_INCH),
    margin = region ? DRAWING_TILE_MARGIN : 10 * pixelsPerMillimetre,
    drawingHeight = height - (region ? DRAWING_TILE_RESERVED_HEIGHT : margin * 3.2);
  return { width, height, margin, drawingHeight, pixelsPerMillimetre };
}

function drawingProjection(geometry, camera, planes) {
  const basis = orbitBasis(camera), { right, up, back } = basis;
  const raw = geometry.points.map((p) => [dot(p, right), -dot(p, up), dot(p, back)]);
  const clips = planes.map(({ normal, offset, flip }) => {
    const sign = flip ? -1 : 1;
    return { x: sign * dot(normal, right), y: -sign * dot(normal, up),
      z: sign * dot(normal, back), level: sign * offset };
  });
  const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  let ground = 0;
  function include([x, y]) {
    bounds.left = Math.min(bounds.left, x);
    bounds.right = Math.max(bounds.right, x);
    bounds.top = Math.min(bounds.top, y);
    bounds.bottom = Math.max(bounds.bottom, y);
  }
  const inside = new Uint8Array(raw.length);
  for (const [i, point] of raw.entries()) {
    // Ground alignment uses the original model datum, even on a clipped drawing.
    if (Math.abs(camera.el) > 0.01 && Math.abs(geometry.points[i][1]) <= 0.25)
      ground = Math.max(ground, point[1]);
    inside[i] = clips.every(plane => drawingDistance(point, plane) <= 1e-7);
    if (inside[i]) include(point);
  }
  if (clips.length) {
    // A clipping plane can introduce new extrema along an edge or across a face.
    for (const { vertices: [a, b, c] } of geometry.faces) {
      if (inside[a] && inside[b] && inside[c]) continue;
      const triangle = [raw[a], raw[b], raw[c]];
      if (clips.some(plane => triangle.every(point => drawingDistance(point, plane) > 1e-7))) continue;
      const polygon = trimDrawingFace(triangle, clips);
      if (polygon.length >= 3) polygon.forEach(include);
    }
    for (const { a, b } of geometry.lines) {
      if (inside[a] && inside[b]) continue;
      clipDrawingLine(raw[a], raw[b], clips)?.forEach(include);
    }
  }
  const hasBounds = Number.isFinite(bounds.left);
  return { basis, raw, clips, ground, hasBounds,
    bounds: hasBounds ? bounds : { left: 0, top: 0, right: 0, bottom: 0 } };
}

function fittedDrawingScale(bounds, { width, margin, drawingHeight, pixelsPerMillimetre }) {
  const padding = 3 * pixelsPerMillimetre;
  const required = 1000 * pixelsPerMillimetre * Math.max(
    (bounds.right - bounds.left) / Math.max(1, width - 2 * (margin + padding)),
    (bounds.bottom - bounds.top) / Math.max(1, drawingHeight - 2 * padding)
  );
  const standard = DRAWING_SCALES.find((value) => value >= required);
  // Prefer a nearby architectural scale, but avoid leaving most of the sheet unused.
  return standard && standard <= required * 1.15 ? standard : Math.max(1, Math.ceil(required));
}

// Project, crop and render the drawing on a physical sheet.
function renderDrawing(
  geometry,
  camera,
  planes,
  paper,
  scaleChoice,
  seeThrough,
  placement,
  rendering,
  pens,
  region = null,
  frame = null
) {
  const viewport = drawingViewport(paper, region);
  const { width, height, margin, drawingHeight, pixelsPerMillimetre } = viewport;
  const { basis, raw, clips: modelClips, ground, bounds, hasBounds } = drawingProjection(geometry, camera, planes);
  const { right, up, back } = basis;
  let midX = (bounds.left + bounds.right) / 2, midY = (bounds.top + bounds.bottom) / 2;
  // Manual scales can stay centred on a captured camera target until the user centres the drawing.
  if (frame && scaleChoice !== 'auto' && !placement.center) {
    midX = dot(frame.target, right);
    midY = -dot(frame.target, up);
  }
  const denominator = scaleChoice === 'auto' ? fittedDrawingScale(bounds, viewport) : Number(scaleChoice),
    scale = (1000 * pixelsPerMillimetre) / denominator,
    originX = width / 2 - midX * scale + placement.x * pixelsPerMillimetre,
    centeredY = margin + drawingHeight / 2 - midY * scale,
    groundY = margin + drawingHeight - 5 * pixelsPerMillimetre,
    originY =
      (placement.ground && Math.abs(Math.cos(camera.el)) > 0.01
        ? groundY - ground * scale
        : centeredY) +
      placement.y * pixelsPerMillimetre,
    projected = raw.map(([x, y, z]) => [originX + x * scale, originY + y * scale, z]),
    depth = new Float32Array(width * height).fill(-Infinity),
    paint = rendering !== 'linework' ? new ImageData(width, height) : null,
    sun = unit([-0.4, 1, 0.65]),
    cutLines = [];
  const outline =
    pens.silhouette || pens.componentOutlines
      ? {
          depth: new Float32Array(width * height).fill(-Infinity),
          owner: new Uint16Array(width * height)
        }
      : null;
  const clips = modelClips.map(({ x, y, z, level }) => ({
    x: x / scale, y: y / scale, z, level: level + (x * originX + y * originY) / scale
  }));
  for (const face of geometry.faces) {
    const triangle = face.vertices.map((index) => projected[index]);
    const polygon = trimDrawingFace(triangle, clips);
    if (polygon.length < 3) continue;
    if (!face.glazing || !seeThrough) {
      const color = paint && drawingFaceColor(face, sun, rendering === 'flat');
      const body = face.body || (pens.silhouette ? 1 : 0);
      rasterDrawingPolygon(
        depth,
        width,
        height,
        polygon,
        paint?.data,
        color,
        body ? outline : null,
        body
      );
    }
    for (const plane of clips) {
      if (
        !triangle.some((p) => drawingDistance(p, plane) > 1e-7) ||
        !triangle.some((p) => drawingDistance(p, plane) < -1e-7)
      )
        continue;
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i],
          b = polygon[(i + 1) % polygon.length];
        if (
          Math.abs(drawingDistance(a, plane)) < 1e-6 &&
          Math.abs(drawingDistance(b, plane)) < 1e-6
        )
          cutLines.push([a, b]);
      }
    }
  }
  const marks = [],
    section = [],
    seen = new Set(),
    tolerance = Math.max(0.035, 0.85 / scale);
  const coordinate = (p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1);
  const sheetEdges = [
    { x: -1, y: 0, z: 0, level: -margin },
    { x: 1, y: 0, z: 0, level: width - margin },
    { x: 0, y: -1, z: 0, level: -margin },
    { x: 0, y: 1, z: 0, level: margin + drawingHeight }
  ];
  function strokeVisible(startPoint, endPoint, collect) {
    const paperLine = clipDrawingLine(startPoint, endPoint, sheetEdges);
    if (!paperLine) return;
    const [a, b] = paperLine;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 0.35) return;
    const steps = Math.ceil(length);
    let start = null;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps,
        x = a[0] + (b[0] - a[0]) * t,
        y = a[1] + (b[1] - a[1]) * t,
        z = a[2] + (b[2] - a[2]) * t,
        column = Math.floor(x),
        row = Math.floor(y),
        visible =
          column >= 0 &&
          column < width &&
          row >= 0 &&
          row < height &&
          z + tolerance >= depth[row * width + column];
      if (visible && start == null) start = i;
      if ((!visible || i === steps) && start != null) {
        const end = visible ? i : i - 0.5;
        if (end - start > 0.2) {
          const first = drawingMix(a, b, start / steps),
            last = drawingMix(a, b, end / steps),
            from = coordinate(first),
            to = coordinate(last),
            key = from < to ? from + '/' + to : to + '/' + from;
          if (!seen.has(key) && collect('M' + from + 'L' + to, first, last) !== false) {
            seen.add(key);
          }
        }
        start = null;
      }
    }
  }
  // Draw section cuts first in the deduplication set so their heavier weight wins.
  for (const [a, b] of cutLines) strokeVisible(a, b, (command) => section.push(command));
  function strokeModelEdge(a, b, component, detail, texture = false, bodies = null, outlineOnly = false) {
    const clipped = clipDrawingLine(projected[a], projected[b], clips);
    if (clipped)
      strokeVisible(clipped[0], clipped[1], (command, from, to) => {
        const boundary = bodies?.length
          ? drawingBoundary(outline.owner, width, height, from, to, bodies)
          : '';
        if (outlineOnly && !(boundary && pens.componentOutlines) && !(boundary === 'silhouette' && pens.silhouette))
          return false;
        marks.push({
          command,
          depth: (from[2] + to[2]) / 2,
          component,
          detail,
          texture,
          boundary
        });
      });
  }
  const creaseLimit = Math.cos((pens.creaseAngle * Math.PI) / 180);
  for (const { start, end, faces } of geometry.edges) {
    const first = faces[0],
      facing = dot(first.normal, back);
    const open = faces.length === 1,
      turning = faces.slice(1).some((other) => {
        const similarity = Math.abs(dot(first.normal, other.normal)),
          otherFacing = dot(other.normal, back);
        // Coplanar triangles disappear. Smooth fans show a stroke only at a silhouette.
        return similarity < 0.9999 && facing * otherFacing <= 0;
      }),
      silhouette = (open && pens.openEdges) || (turning && pens.silhouettes);
    const crease =
      pens.creases &&
      faces.slice(1).some((other) => Math.abs(dot(first.normal, other.normal)) < creaseLimit);
    const bodies = outline && faces.map((face) => face.body || (pens.silhouette ? 1 : 0)).filter(Boolean);
    const joint = pens.componentOutlines && bodies.some((body) => body !== bodies[0]);
    const drawEdge = silhouette || crease || joint;
    if (drawEdge || (bodies?.length && (open || turning)))
      strokeModelEdge(start, end, first.component, silhouette ? 0 : 0.52, false, bodies, !drawEdge);
  }
  if (pens.curves)
    for (const { a, b, component, texture } of geometry.lines)
      strokeModelEdge(a, b, component, 1, texture);
  const palette = drawingPenPalette(pens, geometry.model, denominator),
    { ranked, layerIndices } = palette,
    count = ranked.length,
    ink = Array.from({ length: count }, () => []),
    texture = Array.from({ length: count }, () => []),
    silhouetteInk = [],
    componentInk = [];
  let far = Infinity,
    near = -Infinity;
  for (const mark of marks) {
    far = Math.min(far, mark.depth);
    near = Math.max(near, mark.depth);
  }
  // Base the intervals on visible strokes so a clip or a cropped sheet still uses the pen range.
  const [bandStart, bandEnd] = drawingPenDepthRange(pens).map((percent) => percent / 100);
  for (const mark of marks) {
    const position = near > far ? (near - mark.depth) / (near - far) : 0,
      // Strokes nearer than the band start use the heaviest pen and those beyond its end the lightest.
      banded = clamp((position - bandStart) / (bandEnd - bandStart), 0, 1);
    const index = layerIndices ? (layerIndices.get(mark.component) ?? 0)
      : pens.mode === 'component'
        ? pens.components[mark.component]
        : ranked[
            pens.mode === 'distance'
              ? Math.min(count - 1, Math.floor(banded * count))
              : Math.round((count - 1) * mark.detail)
          ];
    if (mark.texture) {
      texture[index].push(mark.command);
      continue;
    }
    // Promote each stroke once. When both options apply, the overall silhouette owns the stroke.
    if (pens.silhouette && mark.boundary === 'silhouette') silhouetteInk.push(mark.command);
    else if (pens.componentOutlines && mark.boundary) componentInk.push(mark.command);
    else ink[index].push(mark.command);
  }
  let groundLine = '';
  if (pens.groundLine && hasBounds && Math.abs(Math.sin(camera.el)) < 0.01) {
    const gap = 5 * pixelsPerMillimetre;
    const inset = pens.detailPens.groundLine.width * pixelsPerMillimetre / 2 + 0.1;
    const left = Math.max(margin + inset, originX + bounds.left * scale - gap);
    const right = Math.min(width - margin - inset, originX + bounds.right * scale + gap);
    if (left < right && originY >= margin + inset && originY <= margin + drawingHeight - inset)
      groundLine = 'M' + coordinate([left, originY]) + 'L' + coordinate([right, originY]);
  }
  let wash = '';
  if (paint) {
    const image = document.createElement('canvas');
    image.width = width;
    image.height = height;
    const ctx = image.getContext('2d');
    ctx.putImageData(paint, 0, 0);
    wash = image.toDataURL('image/png');
  }
  return {
    ink: ink.map((paths) => paths.join('')),
    silhouetteInk: silhouetteInk.join(''),
    componentInk: componentInk.join(''),
    groundLine,
    texture: texture.map((paths) => paths.join('')),
    section: section.join(''),
    pens,
    palette,
    heaviest: ranked[0],
    populated: marks.length > 0 || section.length > 0 || Boolean(groundLine),
    basis,
    scale,
    originX,
    originY,
    midX,
    midY,
    depth,
    wash,
    exportFills: paint
      ? () => drawingExportFills(geometry, projected, seeThrough, [...clips, ...sheetEdges], width, height, sun, rendering === 'flat')
      : null,
    width,
    height,
    denominator,
    margin,
    drawingHeight,
    cropped: hasBounds && (
      originX + bounds.left * scale < margin - 0.1 ||
      originX + bounds.right * scale > width - margin + 0.1 ||
      originY + bounds.top * scale < margin - 0.1 ||
      originY + bounds.bottom * scale > margin + drawingHeight + 0.1
    )
  };
}

// Keep the jury deck's navigation independent of the lab. Print CSS reveals every topic.
function initRationaleSlides(root) {
  const slides = [...root.querySelectorAll('.dr-hero, article.dr-section')],
    previous = root.querySelector('#drPrevious'),
    next = root.querySelector('#drNext'),
    status = root.querySelector('#drSlideStatus'),
    links = [...root.querySelectorAll('.dr-nav a')];
  const slideId = (slide) => slide.id || slide.querySelector('h2').id;
  let current = 0;
  slides.forEach((slide) => slide.classList.add('dr-slide'));
  root.classList.add('dr-slide-deck');
  function show(index, focus) {
    current = Math.min(slides.length - 1, Math.max(0, index));
    for (const [i, slide] of slides.entries())
      slide.toggleAttribute('data-current-slide', i === current);
    for (const link of links)
      link.setAttribute(
        'aria-current',
        link.hash.slice(1) === slideId(slides[current]) ? 'step' : 'false'
      );
    previous.disabled = current === 0;
    next.disabled = current === slides.length - 1;
    status.value = `${current + 1} / ${slides.length}`;
    if (focus) {
      const heading = slides[current].querySelector('h2');
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      root.scrollTop = 0;
      window.scrollTo(0, 0);
    }
  }
  for (const link of links) {
    link.addEventListener('click', (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const target = slides.findIndex((slide) => slideId(slide) === link.hash.slice(1));
      if (target >= 0) show(target, true);
    });
  }
  previous.onclick = () => show(current - 1, true);
  next.onclick = () => show(current + 1, true);
  root.addEventListener('keydown', (event) => {
    const positions = {
      ArrowLeft: current - 1,
      ArrowRight: current + 1,
      Home: 0,
      End: slides.length - 1
    };
    if (!Object.hasOwn(positions, event.key) || event.altKey || event.ctrlKey || event.metaKey)
      return;
    event.preventDefault();
    show(positions[event.key], true);
  });
  show(
    Math.max(
      0,
      slides.findIndex((slide) => slideId(slide) === location.hash.slice(1))
    ),
    false
  );
}

