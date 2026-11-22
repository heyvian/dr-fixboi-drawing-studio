// Dashed-style construction axes through the model centre. Plan shows both horizontal axes
// (east-west and north-south); other views show the vertical axis and the ground-plane axis.
function constructionGuides(model, camera, project, coordinate) {
  if (!model) return '';
  const plan = Math.abs(Math.sin(camera.el)) > 0.99,
    radius = model.reach * 1.08,
    height = model.height;
  const axis = (angle) => {
    const x = radius * Math.cos(angle),
      z = radius * Math.sin(angle);
    return [
      [-x, 0, -z],
      [x, 0, z]
    ];
  };
  const guides = plan
    ? [axis(0), axis(Math.PI / 2)]
    : [
        axis(Math.abs(camera.el) < 0.01 ? camera.az + Math.PI / 2 : 0),
        [
          [0, -1, 0],
          [0, height + 4, 0]
        ]
      ];
  return guides
    .map(([a, b]) => 'M' + coordinate(project(a)) + 'L' + coordinate(project(b)))
    .join('');
}

// Project the complete model on a physical sheet. Clipping offsets keep a stable frame.
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
  const width = region?.width ?? Math.round(paper.width * DRAWING_PIXELS_PER_INCH),
    height = region?.height ?? Math.round(paper.height * DRAWING_PIXELS_PER_INCH),
    pixelsPerMillimetre = DRAWING_PIXELS_PER_INCH / 25.4,
    margin = region ? DRAWING_TILE_MARGIN : 10 * pixelsPerMillimetre,
    drawingHeight = height - (region ? DRAWING_TILE_RESERVED_HEIGHT : margin * 3.2);
  const basis = orbitBasis(camera),
    { right, up, back } = basis,
    raw = geometry.points.map((p) => [dot(p, right), -dot(p, up), dot(p, back)]);
  let left = Infinity,
    top = Infinity,
    rightEdge = -Infinity,
    bottom = -Infinity,
    ground = 0;
  for (const [i, [x, y]] of raw.entries()) {
    left = Math.min(left, x);
    rightEdge = Math.max(rightEdge, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
    // In an axonometric, anchor the foremost ground edge. Elevations use the zero grade datum.
    if (Math.abs(camera.el) > 0.01 && Math.abs(geometry.points[i][1]) <= 0.25)
      ground = Math.max(ground, y);
  }
  if (!raw.length) {
    left = top = 0;
    rightEdge = bottom = 1;
  }
  // A frame (from the 3D view) replaces the model bounds: centre on its target and make sure
  // everything that was visible in the 3D window fits the sheet.
  if (frame) {
    const aspect = (width - margin * 2) / drawingHeight,
      halfWidth = Math.max(frame.halfWidth, frame.halfHeight * aspect),
      centerX = dot(frame.target, right),
      centerY = -dot(frame.target, up);
    left = centerX - halfWidth;
    rightEdge = centerX + halfWidth;
    top = centerY - halfWidth / aspect;
    bottom = centerY + halfWidth / aspect;
  }
  const available = Math.min(
      (width - margin * 2) / (rightEdge - left),
      drawingHeight / (bottom - top)
    ),
    minimumDenominator = (1000 * pixelsPerMillimetre) / available,
    denominator =
      scaleChoice === 'auto'
        ? (DRAWING_SCALES.find((value) => value >= minimumDenominator) ?? DRAWING_SCALES.at(-1))
        : Number(scaleChoice),
    scale = (1000 * pixelsPerMillimetre) / denominator,
    originX = width / 2 - ((left + rightEdge) * scale) / 2 + placement.x * pixelsPerMillimetre,
    centeredY = margin + drawingHeight / 2 - ((top + bottom) * scale) / 2,
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
  // Transform model-space planes into the same pixel and depth coordinates as the mesh.
  const clips = planes.map(({ normal, offset, flip }) => {
    const sign = flip ? -1 : 1,
      x = (sign * dot(normal, right)) / scale,
      y = (-sign * dot(normal, up)) / scale;
    return { x, y, z: sign * dot(normal, back), level: sign * offset + x * originX + y * originY };
  });
  for (const face of geometry.faces) {
    const triangle = face.vertices.map((index) => projected[index]);
    const polygon = trimDrawingFace(triangle, clips);
    if (polygon.length < 3) continue;
    if (!face.glazing || !seeThrough) {
      const color = paint && drawingFaceColor(face, sun, rendering === 'flat');
      rasterDrawingPolygon(
        depth,
        width,
        height,
        polygon,
        paint?.data,
        color,
        face.body ? outline : null,
        face.body
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
          if (!seen.has(key)) {
            collect('M' + from + 'L' + to, first, last);
            seen.add(key);
          }
        }
        start = null;
      }
    }
  }
  // Draw section cuts first in the deduplication set so their heavier weight wins.
  for (const [a, b] of cutLines) strokeVisible(a, b, (command) => section.push(command));
  function strokeModelEdge(a, b, component, detail, texture = false, bodies = null) {
    const clipped = clipDrawingLine(projected[a], projected[b], clips);
    if (clipped)
      strokeVisible(clipped[0], clipped[1], (command, from, to) => {
        const boundary = bodies?.length
          ? drawingBoundary(outline.owner, width, height, from, to, bodies)
          : '';
        marks.push({
          command,
          depth: (from[2] + to[2]) / 2,
          component,
          detail,
          texture,
          from,
          to,
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
    const bodies = outline && faces.map((face) => face.body).filter(Boolean);
    const joint = pens.componentOutlines && bodies.some((body) => body !== bodies[0]);
    if (silhouette || crease || joint)
      strokeModelEdge(start, end, first.component, silhouette ? 0 : 0.52, false, bodies);
  }
  if (pens.curves)
    for (const { a, b, component, texture } of geometry.lines)
      strokeModelEdge(a, b, component, 1, texture);
  const ranked = pens.widths
      .map((width, index) => ({ width, index }))
      .sort((a, b) => b.width - a.width),
    count = ranked.length,
    ink = Array.from({ length: count }, () => [[], [], []]),
    texture = Array.from({ length: count }, () => []),
    pencil = [],
    pencilEcho = [],
    silhouetteInk = [],
    componentInk = [],
    sketch = pens.style === 'sketch';
  let far = Infinity,
    near = -Infinity;
  for (const mark of marks) {
    far = Math.min(far, mark.depth);
    near = Math.max(near, mark.depth);
  }
  // Base the intervals on visible strokes so a clip or a cropped sheet still uses the pen range.
  const bandStart = Math.min(pens.distanceFrom, pens.distanceTo - 5) / 100,
    bandEnd = Math.max(pens.distanceTo, pens.distanceFrom + 5) / 100;
  for (const mark of marks) {
    const position = near > far ? (near - mark.depth) / (near - far) : 0,
      // Strokes nearer than the band start use the heaviest pen and those beyond its end the lightest.
      banded = clamp((position - bandStart) / (bandEnd - bandStart), 0, 1);
    const index =
      pens.mode === 'component'
        ? pens.components[mark.component]
        : ranked[
            pens.mode === 'distance'
              ? Math.min(count - 1, Math.floor(banded * count))
              : Math.round((count - 1) * mark.detail)
          ].index;
    if (mark.texture) {
      texture[index].push(mark.command);
      continue;
    }
    const { from, to } = mark,
      noise = sketch ? Math.sin(from[0] * 12.9898 + from[1] * 78.233) * 43758.5453 : 0,
      variation = noise - Math.floor(noise),
      pressure = sketch && mark.detail < 1 ? (variation < 0.22 ? 1 : variation > 0.78 ? 2 : 0) : 0;
    // Promote each stroke once. When both options apply, the overall silhouette owns the stroke.
    if (pens.silhouette && mark.boundary === 'silhouette') silhouetteInk.push(mark.command);
    else if (pens.componentOutlines && mark.boundary) componentInk.push(mark.command);
    else ink[index][pressure].push(mark.command);
    if (!sketch || mark.detail >= 1 || (mark.detail > 0 && variation > 0.38)) continue;

    const dx = to[0] - from[0],
      dy = to[1] - from[1],
      length = Math.hypot(dx, dy);
    if (length < 5) continue;
    // Follow a visible edge with a bowed graphite stroke. An occasional shorter pass gives
    // longer edges the retraced look of a pencil layout. The offsets are stable on re-export.
    const tx = dx / length,
      ty = dy / length,
      bow = (variation < 0.5 ? -1 : 1) * (1.5 + variation * 2.1),
      lead = 1.5 + variation * 2.1,
      a = [from[0] - tx * lead - ty * bow * 0.4, from[1] - ty * lead + tx * bow * 0.4],
      b = [to[0] + tx * lead - ty * bow * 0.3, to[1] + ty * lead + tx * bow * 0.3],
      middle = [(from[0] + to[0]) / 2 - ty * bow, (from[1] + to[1]) / 2 + tx * bow];
    pencil.push('M' + coordinate(a) + 'Q' + coordinate(middle) + ' ' + coordinate(b));
    if (length > 13 && variation > 0.72) {
      const start = [from[0] - tx * 2 + ty * bow * 0.6, from[1] - ty * 2 - tx * bow * 0.6],
        end = [from[0] + dx * 0.68 + ty * bow * 0.7, from[1] + dy * 0.68 - tx * bow * 0.7];
      pencilEcho.push('M' + coordinate(start) + 'L' + coordinate(end));
    }
  }
  const construction = sketch
    ? constructionGuides(
        geometry.model,
        camera,
        (point) => [originX + dot(point, right) * scale, originY - dot(point, up) * scale],
        coordinate
      )
    : '';
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
    ink: ink.map((pressure) => pressure.map((paths) => paths.join(''))),
    silhouetteInk: silhouetteInk.join(''),
    componentInk: componentInk.join(''),
    texture: texture.map((paths) => paths.join('')),
    pencil: pencil.join(''),
    pencilEcho: pencilEcho.join(''),
    construction,
    section: section.join(''),
    pens,
    heaviest: ranked[0].index,
    populated: marks.length > 0 || section.length > 0,
    basis,
    scale,
    originX,
    originY,
    midX: (left + rightEdge) / 2,
    midY: (top + bottom) / 2,
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
    cropped:
      originX + left * scale < margin - 0.1 ||
      originX + rightEdge * scale > width - margin + 0.1 ||
      originY + top * scale < margin - 0.1 ||
      originY + bottom * scale > margin + drawingHeight + 0.1
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

