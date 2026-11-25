// Drawing components are the imported layers. importModel() fills this table with
// layerKey -> [label, pen portion]. The portion (0 = heaviest pen, 1 = lightest) chooses a default
// pen in "by component" mode.
const DRAWING_COMPONENTS = {};

// Each group's layer field already holds the layer key, so a component is simply the layer.
function drawingComponent(layer) {
  return layer;
}

// Silhouette bodies group faces that outline together. 'layer' draws one outline per layer,
// 'object' one per Rhino object, anything else disables body outlines. Set by the UI.
let drawingBodyMode = 'layer';

function drawingOutlineBody({ layer, name }) {
  if (drawingBodyMode === 'layer') return layer;
  if (drawingBodyMode === 'object') return name;
  return '';
}

// Weld drawing vertices so silhouettes and creases can be found across adjacent faces.
function drawingGeometry(mesh, model) {
  const groups = mesh.groups,
    first = groups.findIndex((group) => group.layer !== 'Reference'),
    parts = groups.map((group) => drawingComponent(group.layer)),
    points = [],
    faces = [],
    edges = new Map(),
    lines = [],
    indices = new Map();
  const bodies = new Map();
  const bodyIds = groups.map((group) => {
    const body = drawingOutlineBody(group);
    if (!body) return 0;
    if (!bodies.has(body)) bodies.set(body, bodies.size + 1);
    return bodies.get(body);
  });
  function vertex(data, at) {
    const point = data.slice(at, at + 3);
    const key = point.map((x) => Math.round(x * 10000)).join(',');
    if (!indices.has(key)) {
      indices.set(key, points.length);
      points.push(point);
    }
    return indices.get(key);
  }
  if (first < 0) return { points, faces, edges: [], lines, model };
  function groupAt(kind) {
    // The mesh stores layer boundaries as offsets into vertex buffers, one range per kind.
    let index = first;
    return (offset) => {
      while (groups[index + 1]?.[kind] <= offset) index++;
      return index;
    };
  }
  for (const kind of ['solid', 'glass']) {
    const data = mesh[kind];
    const groupAtOffset = groupAt(kind);
    for (let i = groups[first][kind]; i < data.length; i += 30) {
      const a = vertex(data, i),
        b = vertex(data, i + 10),
        c = vertex(data, i + 20);
      if (a === b || b === c || c === a) continue;
      const group = groupAtOffset(i);
      const face = {
        vertices: [a, b, c],
        normal: data.slice(i + 3, i + 6),
        color: data.slice(i + 6, i + 9),
        component: parts[group],
        body: bodyIds[group],
        cutGroup: group,
        glazing: kind === 'glass'
      };
      faces.push(face);
      for (const [start, end] of [
        [a, b],
        [b, c],
        [c, a]
      ]) {
        const key = Math.min(start, end) + ':' + Math.max(start, end);
        if (!edges.has(key)) edges.set(key, { start, end, faces: [] });
        edges.get(key).faces.push(face);
      }
    }
  }
  const groupAtLine = groupAt('lines');
  for (let i = groups[first].lines; i < mesh.lines.length; i += 20) {
    const a = vertex(mesh.lines, i),
      b = vertex(mesh.lines, i + 10);
    if (a !== b)
      lines.push({ a, b, component: parts[groupAtLine(i)], texture: mesh.textureStrokes?.has(i) });
  }
  return { points, faces, edges: [...edges.values()], lines, model };
}

// A plane keeps coordinates with a signed distance of zero or less.
const drawingDistance = (p, plane) =>
  p[0] * plane.x + p[1] * plane.y + p[2] * plane.z - plane.level;
const drawingMix = (a, b, t) =>
  a.map((coordinate, axis) => coordinate + (b[axis] - coordinate) * t);

function clipDrawingPolygon(polygon, plane) {
  const clipped = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length],
      da = drawingDistance(a, plane),
      db = drawingDistance(b, plane);
    if (da <= 1e-7) clipped.push(a);
    if ((da < -1e-7 && db > 1e-7) || (da > 1e-7 && db < -1e-7))
      clipped.push(drawingMix(a, b, da / (da - db)));
  }
  return clipped;
}

function clipDrawingLine(start, end, planes) {
  let a = start,
    b = end;
  for (const plane of planes) {
    const da = drawingDistance(a, plane),
      db = drawingDistance(b, plane);
    if (da > 1e-7 && db > 1e-7) return null;
    if (da > 1e-7) a = drawingMix(a, b, da / (da - db));
    else if (db > 1e-7) b = drawingMix(a, b, da / (da - db));
  }
  return [a, b];
}

// The depth buffer hides linework behind the geometry while the strokes remain vector paths.
function rasterDrawingFace(depth, width, height, a, b, c, pixels, color, outline, body, occlusion) {
  const bx = b[0] - a[0],
    by = b[1] - a[1],
    cx = c[0] - a[0],
    cy = c[1] - a[1],
    denominator = bx * cy - by * cx;
  if (Math.abs(denominator) < 1e-7) return;
  const dzB = b[2] - a[2],
    dzC = c[2] - a[2],
    left = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))),
    right = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0]))),
    top = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))),
    bottom = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  let faceId = 0;
  for (let y = top; y <= bottom; y++) {
    const dy = y + 0.5 - a[1];
    for (let x = left; x <= right; x++) {
      const dx = x + 0.5 - a[0],
        u = (dx * cy - dy * cx) / denominator,
        v = (bx * dy - by * dx) / denominator;
      if (u < 0 || v < 0 || u + v > 1) continue;
      const z = a[2] + u * dzB + v * dzC,
        i = y * width + x;
      // Keep the closest principal body independently. Site furniture and trim still occlude
      // lines in the main depth buffer but cannot punch little holes in the building silhouette.
      if (outline && z > outline.depth[i]) {
        outline.depth[i] = z;
        outline.owner[i] = body;
      }
      if (z <= depth[i]) continue;
      depth[i] = z;
      if (occlusion) {
        if (faceId === 0) {
          faceId = occlusion.faces.length;
          occlusion.faces.push({
            origin: a, ux: cy / denominator, uy: -cx / denominator,
            vx: -by / denominator, vy: bx / denominator, dzB, dzC
          });
        }
        occlusion.owners[i] = faceId;
      }
      if (pixels) {
        const offset = i * 4;
        pixels[offset] = color[0];
        pixels[offset + 1] = color[1];
        pixels[offset + 2] = color[2];
        pixels[offset + 3] = 255;
      }
    }
  }
}

function trimDrawingFace(triangle, clips) {
  let polygon = triangle;
  for (const plane of clips) {
    polygon = clipDrawingPolygon(polygon, plane);
    if (polygon.length < 3) break;
  }
  return polygon;
}

function drawingFaceColor(face, sun, flat) {
  if (flat) return face.color.map((channel) => channel * 255);
  const shade = 0.82 + 0.18 * Math.abs(dot(face.normal, sun));
  // Keep the wash light enough for the architectural strokes and section cuts to read over it.
  return face.color.map((channel) => (0.49 + 0.51 * channel * shade) * 255);
}

function rasterDrawingPolygon(depth, width, height, polygon, pixels, color, outline, body, occlusion) {
  for (let i = 1; i + 1 < polygon.length; i++)
    rasterDrawingFace(
      depth,
      width,
      height,
      polygon[0],
      polygon[i],
      polygon[i + 1],
      pixels,
      color,
      outline,
      body,
      occlusion
    );
}

function drawingFaceOccludes(face, x, y, closestVisibleDepth) {
  if (!face) return false;
  const { origin, ux, uy, vx, vy, dzB, dzC } = face;
  const dx = x - origin[0], dy = y - origin[1];
  const u = dx * ux + dy * uy, v = dx * vx + dy * vy;
  const edgeEpsilon = 1e-7;
  return u >= -edgeEpsilon && v >= -edgeEpsilon && u + v <= 1 + edgeEpsilon &&
    origin[2] + u * dzB + v * dzC > closestVisibleDepth;
}

// Raster depth is measured at pixel centres. Test their faces at the stroke's exact XY so a
// steep face does not hide its own edge. Nearby pixel centres capture both sides of a boundary.
function drawingStrokeOccluded({ owners, faces }, width, x, y, closestVisibleDepth) {
  const at = Math.floor(y - 0.5) * width + Math.floor(x - 0.5);
  const topLeft = owners[at], topRight = owners[at + 1],
    bottomLeft = owners[at + width], bottomRight = owners[at + width + 1];
  return drawingFaceOccludes(faces[topLeft], x, y, closestVisibleDepth) ||
    (topRight !== topLeft && drawingFaceOccludes(faces[topRight], x, y, closestVisibleDepth)) ||
    (bottomLeft !== topLeft && drawingFaceOccludes(faces[bottomLeft], x, y, closestVisibleDepth)) ||
    (bottomRight !== topLeft && drawingFaceOccludes(faces[bottomRight], x, y, closestVisibleDepth));
}

function drawingBoundary(owner, width, height, from, to, bodies) {
  function bodyAt(x, y) {
    const column = Math.floor(x),
      row = Math.floor(y);
    return column >= 0 && column < width && row >= 0 && row < height
      ? owner[row * width + column]
      : 0;
  }
  const dx = to[0] - from[0],
    dy = to[1] - from[1],
    length = Math.hypot(dx, dy),
    xOffset = (-dy * 1.2) / length,
    yOffset = (dx * 1.2) / length;
  let silhouette = 0,
    component = 0;
  // Vote along the visible stroke to avoid promoting spurious one-pixel seams near corners.
  for (const fraction of [0.2, 0.5, 0.8]) {
    const x = from[0] + dx * fraction,
      y = from[1] + dy * fraction;
    const a = bodyAt(x + xOffset, y + yOffset),
      b = bodyAt(x - xOffset, y - yOffset);
    if (a === b || (!bodies.includes(a) && !bodies.includes(b))) continue;
    component++;
    if (!a || !b) silhouette++;
  }
  return silhouette >= 2 ? 'silhouette' : component >= 2 ? 'component' : '';
}

// Trace only boundaries between visible colours. Shared edges use the same grid, and tracing
// with the filled side on the right gives any holes the opposite winding from the outline.
function traceDrawingFills(pixels, width, height, resolution) {
  const stride = width + 1,
    steps = [1, stride, -1, -stride],
    colors = new Int32Array(width * height),
    boundaries = new Map();
  for (let i = 0; i < colors.length; i++) {
    const offset = i * 4;
    if (pixels[offset + 3])
      colors[i] = 1 + ((pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2]);
  }
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      const color = colors[i];
      if (!color) continue;
      const top = y === 0 || colors[i - width] !== color,
        right = x + 1 === width || colors[i + 1] !== color,
        bottom = y + 1 === height || colors[i + width] !== color,
        left = x === 0 || colors[i - 1] !== color;
      if (!top && !right && !bottom && !left) continue;
      if (!boundaries.has(color)) boundaries.set(color, new Set());
      const edges = boundaries.get(color),
        corner = y * stride + x;
      if (top) edges.add(corner * 4);
      if (right) edges.add((corner + 1) * 4 + 1);
      if (bottom) edges.add((corner + stride + 1) * 4 + 2);
      if (left) edges.add((corner + stride) * 4 + 3);
    }
  }
  const position = (point) =>
    `${(point % stride) / resolution} ${Math.floor(point / stride) / resolution}`;
  return [...boundaries].map(([color, edges]) => {
    const paths = [];
    for (const start of edges) {
      const origin = Math.floor(start / 4);
      let point = origin,
        edge = start,
        previousDirection = -1;
      const corners = ['M' + position(origin)];
      do {
        edges.delete(edge);
        const direction = edge % 4;
        if (previousDirection >= 0 && direction !== previousDirection)
          corners.push('L' + position(point));
        point += steps[direction];
        previousDirection = direction;
        if (point === origin) break;
        // Prefer turning right at a diagonal touch so two touching regions get separate loops.
        const clockwise = point * 4 + ((direction + 1) % 4),
          straight = point * 4 + direction;
        edge = edges.has(clockwise)
          ? clockwise
          : edges.has(straight)
            ? straight
            : point * 4 + ((direction + 3) % 4);
      } while (edges.has(edge));
      paths.push(corners.join('') + 'Z');
    }
    return { fill: '#' + (color - 1).toString(16).padStart(6, '0'), d: paths.join('') };
  });
}

// Export uses a finer sampling grid than the interactive wash, with the same clipping and depth
// rules. Its result is a set of editable SVG fills, one compound path per visible colour.
function drawingExportFills(geometry, projected, seeThrough, clips, sheetEdges, width, height, sun, flat, optics) {
  const resolution = 2,
    columns = width * resolution,
    rows = height * resolution,
    pixels = new Uint8ClampedArray(columns * rows * 4),
    depth = new Float32Array(columns * rows).fill(-Infinity);
  for (const face of geometry.faces) {
    if (face.glazing && seeThrough) continue;
    const clipped = trimDrawingFace(face.vertices.map((index) => projected[index]), clips);
    if (clipped.length < 3) continue;
    const polygon = trimDrawingFace(optics ? clipped.map(optics.project) : clipped, sheetEdges);
    if (polygon.length >= 3) {
      const points = polygon.map(([x, y, z]) => [x * resolution, y * resolution, z]);
      rasterDrawingPolygon(depth, columns, rows, points, pixels, drawingFaceColor(face, sun, flat));
    }
  }
  return traceDrawingFills(pixels, columns, rows, resolution);
}

const DRAWING_SCALES = [1, 2, 4, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];
const DRAWING_PIXELS_PER_INCH = 88;
const DRAWING_TILE_MARGIN = 8;
const DRAWING_TILE_RESERVED_HEIGHT = 35;
const DRAWING_PEN_PRESETS = [
  [],
  [0.35],
  [0.5, 0.22],
  [0.5, 0.3, 0.18],
  [0.6, 0.45, 0.3, 0.18],
  [0.7, 0.5, 0.35, 0.25, 0.18]
];
const DRAWING_PEN_LIMITS = { min: 0.05, max: 2, step: 0.01 };
const RHINO_DEFAULT_PLOT_WIDTH = 0.25;
const rhinoPlotWidth = ({ plotWeight }) => plotWeight === -1 || plotWeight > 0 ? plotWeight : RHINO_DEFAULT_PLOT_WIDTH;
const DRAWING_DETAIL_PENS = {
  silhouette: { id: 'drawingSilhouette', label: 'Overall silhouette', width: 0.70,
    help: 'Emphasizes the visible outer edge of the model.' },
  componentOutlines: { id: 'drawingComponentOutlines', label: 'Key outlines', width: 0.50,
    help: 'Emphasizes the visible edges of each layer or object. Choose the grouping under Layers → Outlines follow.' },
  groundLine: { id: 'drawingGroundLine', label: 'Ground line', width: 0.25,
    help: 'Marks the model’s base in elevations and vertical sections.' }
};

function drawingPensByWeight(widths) {
  return widths.map((_, index) => index).sort((a, b) => widths[b] - widths[a]);
}

function drawingDepthBoundaries(count, saved) {
  const boundaries = saved?.depthBreaks;
  if (Array.isArray(boundaries) && boundaries.length === count - 1 && boundaries.every((value, i) =>
    Number.isFinite(value) && value >= (boundaries[i - 1] ?? 0) + 1 - 1e-8 && value <= 99)) return [...boundaries];
  // Recover the actual pen boundaries from the old two-slider settings.
  const from = Number.isFinite(saved?.distanceFrom) ? clamp(Math.round(saved.distanceFrom), 0, 90) : 0;
  const to = Number.isFinite(saved?.distanceTo) ? clamp(Math.round(saved.distanceTo), 10, 100) : 100;
  const start = Math.min(from, to - 5), end = Math.max(to, from + 5);
  return Array.from({ length: count - 1 }, (_, i) => start + (end - start) * (i + 1) / count);
}

function drawingDepthBand(boundaries, percent) {
  for (const [i, boundary] of boundaries.entries()) if (percent < boundary) return i;
  return boundaries.length;
}

function drawingPenPalette(pens, model) {
  if (pens.mode !== 'rhino') {
    return { widths: pens.widths, colors: pens.colors,
      ranked: drawingPensByWeight(pens.widths), layerIndices: null };
  }
  const weightsByLayer = model.layers.filter((layer) => layer.visible && rhinoPlotWidth(layer) > 0)
    .map((layer) => [layer.key, rhinoPlotWidth(layer)]);
  const widths = [...new Set(weightsByLayer.map(([, width]) => width))];
  if (!widths.length) widths.push(RHINO_DEFAULT_PLOT_WIDTH);
  const indicesByWeight = new Map(widths.map((width, index) => [width, index]));
  return {
    widths,
    colors: widths.map(() => pens.colors[0]),
    ranked: drawingPensByWeight(widths),
    layerIndices: new Map(weightsByLayer.map(([key, width]) => [key, indicesByWeight.get(width)]))
  };
}

function drawingPens(saved = {}) {
  // Older sheet settings have no pen set. Validate each saved value independently.
  const count =
    Array.isArray(saved?.widths) && saved.widths.length >= 1 && saved.widths.length <= 5
      ? saved.widths.length
      : 3;
  return {
    mode: ['distance', 'component', 'profile', 'rhino'].includes(saved?.mode) ? saved.mode : 'distance',
    silhouette: saved?.silhouette === true,
    componentOutlines: saved?.componentOutlines === true,
    groundLine: saved?.groundLine === true,
    detailPens: Object.fromEntries(Object.entries(DRAWING_DETAIL_PENS).map(([key, { width }]) => {
      const pen = saved?.detailPens?.[key];
      return [key, {
        width: Number.isFinite(pen?.width) ? clamp(pen.width, DRAWING_PEN_LIMITS.min, DRAWING_PEN_LIMITS.max) : width,
        color: paintHex(pen?.color) || paintHex(saved?.colors?.[0]) || '#43534c'
      }];
    })),
    // Which mesh edges become strokes; all on with a 10° crease angle matches the original drawings.
    curves: saved?.curves !== false,
    silhouettes: saved?.silhouettes !== false,
    openEdges: saved?.openEdges !== false,
    creases: saved?.creases !== false,
    creaseAngle: Number.isFinite(saved?.creaseAngle) ? clamp(Math.round(saved.creaseAngle), 5, 90) : 10,
    depthBreaks: drawingDepthBoundaries(count, saved),
    paper: paintHex(saved?.paper) || '#ffffff',
    colors: DRAWING_PEN_PRESETS[count].map((_, i) => paintHex(saved?.colors?.[i]) || '#43534c'),
    widths: DRAWING_PEN_PRESETS[count].map((width, i) =>
      Number.isFinite(saved?.widths?.[i])
        ? clamp(saved.widths[i], DRAWING_PEN_LIMITS.min, DRAWING_PEN_LIMITS.max)
        : width
    ),
    components: Object.fromEntries(
      Object.entries(DRAWING_COMPONENTS).map(([key, [, portion]]) => [
        key,
        Number.isInteger(saved?.components?.[key])
          ? clamp(saved.components[key], 0, count - 1)
          : Math.round((count - 1) * portion)
      ])
    )
  };
}
