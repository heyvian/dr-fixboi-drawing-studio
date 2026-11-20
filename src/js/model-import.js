// Model import: turns a Rhino .3dm file (via rhino3dm.js), a Wavefront .obj file or a built-in sample
// into a "model" the drawing workspace can draw.
//
// Every importer feeds a ModelBuilder in Rhino coordinates (Z up, metres). The builder converts to the
// drawing coordinate system once all geometry is known:
//   drawing x = -(rhino x - centre x)   so Rhino's top view matches the plan sheet
//   drawing y =   rhino z - lowest z    so the lowest point of the model sits on the ground datum
//   drawing z =   rhino y - centre y    so Rhino +Y is plan north
// That mapping is a pure rotation, so handedness (and therefore face winding) is preserved.

const RHINO_CDN = 'https://cdn.jsdelivr.net/npm/rhino3dm@8.17.0/';
const IMPORT_TRIANGLE_WARNING = 300000;
const IMPORT_BODY_LIMIT = 65535;

// Metres per model unit, keyed by rhino3dm's UnitSystem enum value.
const RHINO_UNIT_METRES = {
  1: 1e-6, 2: 1e-3, 3: 1e-2, 4: 1, 5: 1e3, 6: 2.54e-8, 7: 2.54e-5, 8: 0.0254, 9: 0.3048, 10: 1609.344,
  12: 1e-10, 13: 1e-9, 14: 0.1, 15: 10, 16: 100, 17: 1e6, 18: 1e9, 19: 0.9144, 22: 1852
};
// Header drop-down overrides.
const UNIT_CHOICES = { mm: 1e-3, cm: 1e-2, m: 1, in: 0.0254, ft: 0.3048 };

// --- Loading the rhino3dm library -------------------------------------------------------------

let rhinoPromise = null;
// Load the pinned Rhino library on demand and clear the cached request if loading fails.
function loadRhino() {
  if (!rhinoPromise) {
    rhinoPromise = (async () => {
      const lib = await import(RHINO_CDN + 'rhino3dm.module.min.js');
      return await lib.default({ locateFile: (name) => RHINO_CDN + name });
    })();
    rhinoPromise.catch(() => {
      rhinoPromise = null;
    });
  }
  return rhinoPromise;
}

// Reject if a promise takes longer than 'ms' (used for the library download).
function timed(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('The Rhino reader did not download in time')), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

// rhino3dm objects live in WebAssembly memory and must be freed explicitly. Document tables are
// owned by the document, and their own delete(name) method removes an entry, so leave them alone.
const dispose = (o) => {
  if (!o || /Table$/.test(o.constructor.name)) return;
  if (typeof o.delete === 'function') o.delete();
  else if (typeof o.destroy === 'function') o.destroy();
};

// --- Model builder ----------------------------------------------------------------------------

// Layers whose names suggest glazing go into the "see through" glass buffer.
const GLASS_LAYER = /glass|glazing|window|curtain|vitrine/i;

// Default pen portion (0 = heaviest pen, 1 = lightest) by layer name, used in "Layers" pen mode.
function defaultPenPortion(name) {
  if (/struct|wall|core|column|slab|beam|frame|shell/i.test(name)) return 0.15;
  if (GLASS_LAYER.test(name) || /site|ground|land|context|furniture|plant|tree|topo/i.test(name)) return 1;
  return 0.5;
}

class ModelBuilder {
  constructor(name) {
    this.name = name;
    this.layers = []; // { key, label, color: [r,g,b], visible, glass, triangles, segments }
    this.layerIndex = new Map();
    this.objects = []; // { layer, name, color, tris: flat xyz triples x3, segs: flat xyz pairs }
    this.warnings = [];
    this.triangleCount = 0;
  }

  // Find or create a layer by path. 'visible' is only used when the layer is first created.
  layer(key, color = [0.55, 0.6, 0.57], visible = true) {
    if (!this.layerIndex.has(key)) {
      this.layerIndex.set(key, this.layers.length);
      this.layers.push({
        key,
        label: key.replace(/::/g, ' \u203a '),
        color,
        visible,
        glass: GLASS_LAYER.test(key),
        triangles: 0,
        segments: 0
      });
    }
    return this.layerIndex.get(key);
  }

  warn(text) {
    if (!this.warnings.includes(text)) this.warnings.push(text);
  }

  // Start a Rhino object. Geometry is added to the returned record with tri() and seg().
  object(layer, name, color) {
    const record = { layer, name: name || 'Object ' + (this.objects.length + 1), color, tris: [], segs: [] };
    this.objects.push(record);
    return record;
  }

  tri(object, a, b, c) {
    object.tris.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.layers[object.layer].triangles++;
    this.triangleCount++;
  }

  quad(object, a, b, c, d) {
    this.tri(object, a, b, c);
    this.tri(object, a, c, d);
  }

  seg(object, a, b) {
    object.segs.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    this.layers[object.layer].segments++;
  }

  // Axis-aligned box helper for the sample model (Rhino coordinates).
  box(object, [x0, y0, z0], [x1, y1, z1]) {
    const p = (x, y, z) => [x, y, z];
    const v = [
      p(x0, y0, z0), p(x1, y0, z0), p(x1, y1, z0), p(x0, y1, z0),
      p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)
    ];
    for (const [a, b, c, d] of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]])
      this.quad(object, v[a], v[b], v[c], v[d]);
  }

  // Convert to the drawing coordinate system and return the model the workspace consumes.
  finish() {
    let min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (const object of this.objects)
      for (const list of [object.tris, object.segs])
        for (let i = 0; i < list.length; i += 3)
          for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], list[i + k]);
            max[k] = Math.max(max[k], list[i + k]);
          }
    if (!Number.isFinite(min[0])) throw Error('The file contains no visible geometry that can be drawn.');
    const centre = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]];
    const toDrawing = (list, i) => [-(list[i] - centre[0]), list[i + 2] - centre[2], list[i + 1] - centre[1]];
    let reach = 0;
    for (const object of this.objects)
      for (const list of [object.tris, object.segs])
        for (let i = 0; i < list.length; i += 3) {
          const p = toDrawing(list, i);
          reach = Math.max(reach, Math.hypot(p[0], p[2]));
        }
    const builder = this;
    return {
      name: this.name,
      reach: Math.max(reach, 1),
      height: Math.max(max[2] - min[2], 0.5),
      layers: this.layers.filter((layer) => layer.triangles || layer.segments),
      warnings: this.warnings,
      triangleCount: this.triangleCount,
      // Build the flat vertex buffers drawingGeometry() reads, honouring layer visibility.
      // Each vertex is 10 floats: position (3), normal (3) and colour (4). Triangles go to 'solid'
      // (or 'glass' for glazing layers) and segments to 'lines'. 'groups' records where each Rhino
      // object starts in every buffer.
      assemble() {
        const mesh = { solid: [], glass: [], lines: [], groups: [] };
        for (const object of builder.objects) {
          const layer = builder.layers[object.layer];
          if (!layer.visible) continue;
          const colour = [...(object.color || layer.color), 1];
          const buffer = layer.glass ? mesh.glass : mesh.solid;
          mesh.groups.push({
            layer: layer.key,
            name: object.name,
            solid: mesh.solid.length,
            glass: mesh.glass.length,
            lines: mesh.lines.length
          });
          for (let i = 0; i < object.tris.length; i += 9) {
            const a = toDrawing(object.tris, i),
              b = toDrawing(object.tris, i + 3),
              c = toDrawing(object.tris, i + 6),
              n = unit(cross(sub(b, a), sub(c, a)));
            for (const p of [a, b, c]) buffer.push(...p, ...n, ...colour);
          }
          for (let i = 0; i < object.segs.length; i += 6)
            for (const at of [i, i + 3]) mesh.lines.push(...toDrawing(object.segs, at), 0, 1, 0, ...colour);
        }
        // Outline bodies are numbered per object; fall back to layers when there are too many.
        if (mesh.groups.length > IMPORT_BODY_LIMIT && drawingBodyMode === 'object') drawingBodyMode = 'layer';
        return mesh;
      }
    };
  }
}

// Register the model's layers as pen components and return it ready for the workspace.
function registerComponents(model) {
  for (const key of Object.keys(DRAWING_COMPONENTS)) delete DRAWING_COMPONENTS[key];
  for (const layer of model.layers) DRAWING_COMPONENTS[layer.key] = [layer.label, defaultPenPortion(layer.key)];
  return model;
}

// --- Rhino (.3dm) -----------------------------------------------------------------------------

const to255 = (c) => [c.r / 255, c.g / 255, c.b / 255];
const identity = () => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
function multiply(a, b) {
  return a.map((row) => [0, 1, 2, 3].map((j) => row.reduce((sum, v, k) => sum + v * b[k][j], 0)));
}
// Read an rhino3dm Transform into a 4x4 array.
function transformMatrix(x) {
  return [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => x['m' + i + j]));
}
const applyMatrix = (m, p) => [
  m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2] + m[0][3],
  m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2] + m[1][3],
  m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2] + m[2][3]
];

// Read a Rhino document. 'r' is the rhino3dm module, so this also runs under node for the tests.
// 'unitChoice' is 'auto' or a key of UNIT_CHOICES. 'progress(done, total)' is optional.
async function importRhino(r, bytes, name, unitChoice = 'auto', progress = () => {}) {
  const doc = r.File3dm.fromByteArray(bytes);
  if (!doc) throw Error('This does not look like a Rhino .3dm file.');
  const builder = new ModelBuilder(name);
  try {
    // Units
    let metres = 1;
    if (UNIT_CHOICES[unitChoice]) metres = UNIT_CHOICES[unitChoice];
    else {
      const settings = doc.settings();
      const unit = settings.modelUnitSystem.value;
      dispose(settings);
      if (RHINO_UNIT_METRES[unit]) metres = RHINO_UNIT_METRES[unit];
      else builder.warn('The file does not state its units, so metres were assumed. Use "Model units" to change this.');
    }
    const scale = (p) => [p[0] * metres, p[1] * metres, p[2] * metres];

    // Layers. Visibility accounts for hidden parent layers.
    const layerTable = doc.layers(),
      layers = [];
    for (let i = 0; i < layerTable.count; i++) {
      const layer = layerTable.get(i);
      layers.push({
        path: layer.fullPath || layer.name,
        id: layer.id,
        parent: layer.parentLayerId,
        color: to255(layer.color),
        visible: layer.visible
      });
      dispose(layer);
    }
    const byId = new Map(layers.map((layer) => [layer.id, layer]));
    const layerVisible = (layer) => {
      for (let guard = 0; layer && guard < 32; guard++) {
        if (!layer.visible) return false;
        layer = byId.get(layer.parent);
      }
      return true;
    };
    dispose(layerTable);

    const objects = doc.objects(),
      definitions = doc.instanceDefinitions(),
      total = objects.count,
      stats = { unmeshed: 0, skipped: new Map(), instances: 0 };
    const skip = (kind) => stats.skipped.set(kind, (stats.skipped.get(kind) || 0) + 1);

    // Triangulate every face of a Rhino mesh (quads become two triangles).
    function addMesh(record, mesh, matrix) {
      const vertices = mesh.vertices(),
        faces = mesh.faces(),
        point = (i) => scale(applyMatrix(matrix, vertices.get(i)));
      for (let i = 0; i < faces.count; i++) {
        const [a, b, c, d] = faces.get(i);
        builder.tri(record, point(a), point(b), point(c));
        if (d !== c) builder.tri(record, point(a), point(c), point(d));
      }
      dispose(vertices);
      dispose(faces);
    }

    // Sample a curve into straight segments.
    function addCurve(record, curve, matrix) {
      const type = curve.constructor.name;
      let points = [];
      if (type === 'LineCurve') points = [curve.pointAtStart, curve.pointAtEnd];
      else if (type === 'PolylineCurve') for (let i = 0; i < curve.pointCount; i++) points.push(curve.point(i));
      else {
        const [t0, t1] = curve.domain,
          linear = curve.isLinear(1e-6),
          count = linear ? 1 : clamp(curve.spanCount * (curve.degree <= 1 ? 1 : 16), 8, 600);
        if (curve.degree === 1 && !linear && type === 'NurbsCurve') {
          const control = curve.points();
          for (let i = 0; i < control.count; i++) points.push(control.get(i));
          dispose(control);
        } else for (let i = 0; i <= count; i++) points.push(curve.pointAt(t0 + ((t1 - t0) * i) / count));
      }
      for (let i = 0; i + 1 < points.length; i++)
        builder.seg(record, scale(applyMatrix(matrix, points[i])), scale(applyMatrix(matrix, points[i + 1])));
    }

    // Draw one piece of geometry. Returns nothing; unsupported types are counted.
    function addGeometry(record, geometry, matrix, depth) {
      const type = geometry.constructor.name;
      if (type === 'Mesh') return addMesh(record, geometry, matrix);
      if (type === 'Brep') {
        const faces = geometry.faces();
        let missing = false;
        for (let i = 0; i < faces.count; i++) {
          const face = faces.get(i);
          const mesh = face.getMesh(r.MeshType.Any);
          if (mesh) addMesh(record, mesh, matrix);
          else missing = true;
          dispose(mesh);
          dispose(face);
        }
        dispose(faces);
        // Breps saved without render meshes can only be shown as their edges.
        if (missing) {
          stats.unmeshed++;
          const edges = geometry.edges();
          for (let i = 0; i < edges.count; i++) {
            const edge = edges.get(i);
            addCurve(record, edge, matrix);
            dispose(edge);
          }
          dispose(edges);
        }
        return;
      }
      if (type === 'Extrusion') {
        const mesh = geometry.getMesh(r.MeshType.Any);
        if (mesh) {
          addMesh(record, mesh, matrix);
          dispose(mesh);
        } else {
          const brep = geometry.toBrep(true);
          if (brep) {
            addGeometry(record, brep, matrix, depth);
            dispose(brep);
          } else skip('Extrusion');
        }
        return;
      }
      if (type === 'InstanceReference') {
        if (depth > 4) return skip('Block (nested too deeply)');
        stats.instances++;
        const definition = definitions.findId(geometry.parentIdefId);
        if (!definition) return skip('Block (missing definition)');
        const xform = geometry.xform,
          next = multiply(matrix, transformMatrix(xform)),
          ids = definition.getObjectIds();
        for (const id of ids) {
          const member = objects.findId(id);
          if (!member) continue;
          const g = member.geometry();
          try {
            if (g) addGeometry(record, g, next, depth + 1);
          } finally {
            dispose(g);
            dispose(member);
          }
        }
        dispose(definition);
        return;
      }
      if (/Curve$/.test(type) || type === 'BrepEdge') return addCurve(record, geometry, matrix);
      skip(type);
    }

    for (let i = 0; i < total; i++) {
      if (i % 100 === 0) {
        progress(i, total);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const object = objects.get(i),
        attributes = object.attributes(),
        geometry = object.geometry();
      try {
        // Block definitions are drawn through their instance references, not directly.
        if (!geometry || attributes.isInstanceDefinitionObject || !attributes.visible) continue;
        const layer = layers[attributes.layerIndex];
        if (layer && !layerVisible(layer)) continue;
        const key = layer ? layer.path : 'Default';
        const layerIdx = builder.layer(key, layer ? layer.color : undefined, true);
        const own = attributes.colorSource.value === 1 ? to255(attributes.objectColor) : null;
        const record = builder.object(layerIdx, attributes.name || key + ' ' + (i + 1), own);
        addGeometry(record, geometry, identity(), 0);
      } catch (error) {
        console.warn('Skipped a Rhino object', error);
        skip('Unreadable object');
      } finally {
        dispose(geometry);
        dispose(attributes);
        dispose(object);
      }
    }
    progress(total, total);
    dispose(objects);
    dispose(definitions);

    if (stats.unmeshed)
      builder.warn(
        `${stats.unmeshed} Brep${stats.unmeshed > 1 ? 's have' : ' has'} no saved render mesh and appear as edges only. ` +
          'Shade the model in Rhino (or run Mesh) and save again to include surfaces.'
      );
    for (const [kind, count] of stats.skipped) builder.warn(`${count} ${kind} object${count > 1 ? 's were' : ' was'} not drawn.`);
    if (builder.triangleCount > IMPORT_TRIANGLE_WARNING)
      builder.warn(`The model has ${builder.triangleCount.toLocaleString()} triangles. Drawing may be slow.`);
  } finally {
    dispose(doc);
  }
  return registerComponents(builder.finish());
}

// --- Wavefront (.obj) -------------------------------------------------------------------------

// Parse an OBJ file. Groups ('g'/'o'/'usemtl') become layers; the file is treated as Z-up like Rhino.
function importObj(text, name, unitChoice = 'auto') {
  const metres = UNIT_CHOICES[unitChoice] || 1,
    builder = new ModelBuilder(name),
    vertices = [];
  let layer = builder.layer('OBJ'),
    record = builder.object(layer, 'OBJ');
  const index = (token) => {
    const i = parseInt(token, 10);
    return i < 0 ? vertices.length + i : i - 1;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const [command, ...rest] = line.split(/\s+/);
    if (command === 'v') vertices.push(rest.slice(0, 3).map((x) => Number(x) * metres));
    else if (command === 'g' || command === 'o' || command === 'usemtl') {
      layer = builder.layer(rest.join(' ') || 'OBJ');
      record = builder.object(layer, rest.join(' ') || 'OBJ');
    } else if (command === 'f') {
      const face = rest.map((token) => vertices[index(token.split('/')[0])]);
      if (face.some((p) => !p)) continue;
      for (let i = 1; i + 1 < face.length; i++) builder.tri(record, face[0], face[i], face[i + 1]);
    } else if (command === 'l') {
      const path = rest.map((token) => vertices[index(token.split('/')[0])]);
      for (let i = 0; i + 1 < path.length; i++) if (path[i] && path[i + 1]) builder.seg(record, path[i], path[i + 1]);
    }
  }
  if (!builder.triangleCount && !builder.layers.some((l) => l.segments))
    throw Error('No faces or lines were found in this OBJ file.');
  return registerComponents(builder.finish());
}

// --- Sample -----------------------------------------------------------------------------------

// A small four-storey block with a core, glazing, roof and site lines, so the app can be tried
// without a Rhino file. Dimensions are metres in Rhino coordinates.
function sampleModel() {
  const builder = new ModelBuilder('Sample building');
  const structure = builder.layer('Structure', [0.62, 0.64, 0.6]),
    walls = builder.layer('Walls', [0.82, 0.8, 0.74]),
    glazing = builder.layer('Glazing', [0.62, 0.78, 0.86]),
    roof = builder.layer('Roof', [0.45, 0.5, 0.47]),
    site = builder.layer('Site', [0.7, 0.78, 0.66]);
  const storey = 3.5,
    levels = 4,
    width = 24,
    depth = 14;
  const ground = builder.object(site, 'Ground');
  builder.box(ground, [-20, -16, -0.3], [20, 16, 0]);
  for (let i = 0; i < levels; i++) {
    const z = i * storey;
    builder.box(builder.object(structure, 'Slab ' + (i + 1)), [-width / 2, -depth / 2, z], [width / 2, depth / 2, z + 0.3]);
    for (let cx = -width / 2 + 1; cx <= width / 2; cx += 6)
      for (const cy of [-depth / 2 + 1, depth / 2 - 1])
        builder.box(builder.object(structure, `Column ${i + 1}`), [cx - 0.2, cy - 0.2, z + 0.3], [cx + 0.2, cy + 0.2, z + storey]);
    builder.box(builder.object(walls, 'Core ' + (i + 1)), [-2, -3, z + 0.3], [2, 3, z + storey]);
    builder.box(builder.object(walls, 'End wall W ' + (i + 1)), [-width / 2, -depth / 2, z + 0.3], [-width / 2 + 0.3, depth / 2, z + storey]);
    builder.box(builder.object(walls, 'End wall E ' + (i + 1)), [width / 2 - 0.3, -depth / 2, z + 0.3], [width / 2, depth / 2, z + storey]);
    for (const [y0, y1] of [[-depth / 2, -depth / 2 + 0.1], [depth / 2 - 0.1, depth / 2]])
      builder.box(builder.object(glazing, `Glazing ${i + 1}`), [-width / 2 + 0.3, y0, z + 0.9], [width / 2 - 0.3, y1, z + storey - 0.3]);
  }
  const top = levels * storey;
  builder.box(builder.object(roof, 'Roof'), [-width / 2 - 0.6, -depth / 2 - 0.6, top], [width / 2 + 0.6, depth / 2 + 0.6, top + 0.35]);
  builder.box(builder.object(roof, 'Plant room'), [-3, -2.5, top + 0.35], [3, 2.5, top + 3]);
  const grid = builder.object(site, 'Grid lines');
  for (let x = -18; x <= 18; x += 6) builder.seg(grid, [x, -15, 0.01], [x, 15, 0.01]);
  for (let y = -12; y <= 12; y += 6) builder.seg(grid, [-18, y, 0.01], [18, y, 0.01]);
  return registerComponents(builder.finish());
}
