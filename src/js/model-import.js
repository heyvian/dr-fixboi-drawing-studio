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
      async function loadFrom(base) {
        const lib = await import(base + 'rhino3dm.module.min.js');
        return lib.default({ locateFile: (name) => base + name });
      }
      if (location.protocol === 'file:') return loadFrom(RHINO_CDN);
      const bundled = new URL('vendor/rhino3dm/', document.baseURI).href;
      try {
        return await loadFrom(bundled);
      } catch {
        return loadFrom(RHINO_CDN);
      }
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
      assemble(includeStudioFloor) {
        const mesh = { solid: [], glass: [], lines: [], groups: [] };
        for (const object of builder.objects) {
          const layer = builder.layers[object.layer];
          if (!layer.visible) continue;
          const studio = object.studioFloor !== undefined;
          if (studio && includeStudioFloor && !includeStudioFloor(object.studioFloor)) continue;
          const colour = [...(object.color || layer.color), 1];
          const buffer = layer.glass ? mesh.glass : mesh.solid;
          mesh.groups.push({
            layer: layer.key,
            name: object.name,
            studio,
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
      if (!layer) continue;
      layers.push({
        index: layer.index,
        path: layer.fullPath || layer.name,
        id: layer.id,
        parent: layer.parentLayerId,
        color: to255(layer.color),
        visible: layer.visible
      });
      dispose(layer);
    }
    const byId = new Map(layers.map((layer) => [layer.id, layer]));
    const byIndex = new Map(layers.map((layer) => [layer.index, layer]));
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
      materials = doc.materials(),
      total = objects.count,
      stats = { unmeshed: 0, skipped: new Map(), instances: 0 };
    const skip = (kind) => stats.skipped.set(kind, (stats.skipped.get(kind) || 0) + 1);

    function objectColor(attributes, layer, parentColor) {
      switch (attributes.colorSource.value) {
        case r.ObjectColorSource.ColorFromObject.value:
          return to255(attributes.objectColor);
        case r.ObjectColorSource.ColorFromParent.value:
          return parentColor ?? layer?.color;
        case r.ObjectColorSource.ColorFromMaterial.value: {
          const material = materials.findFromAttributes(attributes);
          try {
            return material ? to255(material.diffuseColor) : layer?.color;
          } finally {
            dispose(material);
          }
        }
        default:
          return layer?.color;
      }
    }

    function addRhinoObject(attributes, geometry, matrix, depth, parentColor) {
      if (!geometry || !attributes.visible) return;
      const layer = byIndex.get(attributes.layerIndex);
      if (layer && !layerVisible(layer)) return;
      const key = layer?.path || 'Default';
      const color = objectColor(attributes, layer, parentColor);
      if (geometry.constructor.name === 'InstanceReference') {
        expandBlock(geometry, matrix, depth, color);
        return;
      }
      const layerIdx = builder.layer(key, layer?.color, true);
      const record = builder.object(layerIdx, attributes.name || key, color);
      addGeometry(record, geometry, matrix);
    }

    function expandBlock(geometry, matrix, depth, color) {
      if (depth >= 32) return skip('Block (nested too deeply)');
      stats.instances++;
      const definition = definitions.findId(geometry.parentIdefId);
      if (!definition) return skip('Block (missing definition)');
      const next = multiply(matrix, transformMatrix(geometry.xform));
      try {
        for (const id of definition.getObjectIds()) {
          const member = objects.findId(id);
          if (!member) continue;
          const attributes = member.attributes(), shape = member.geometry();
          try {
            addRhinoObject(attributes, shape, next, depth + 1, color);
          } finally {
            dispose(shape);
            dispose(attributes);
            dispose(member);
          }
        }
      } finally {
        dispose(definition);
      }
    }

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
    function addGeometry(record, geometry, matrix) {
      const type = geometry.constructor.name;
      if (type === 'Mesh') return addMesh(record, geometry, matrix);
      if (type === 'Brep') {
        const faces = geometry.faces();
        let missing = false;
        for (let i = 0; i < faces.count; i++) {
          const face = faces.get(i);
          const mesh = face.getMesh(r.MeshType.Render) || face.getMesh(r.MeshType.Any);
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
        const mesh = geometry.getMesh(r.MeshType.Render) || geometry.getMesh(r.MeshType.Any);
        if (mesh) {
          addMesh(record, mesh, matrix);
          dispose(mesh);
        } else {
          const brep = geometry.toBrep(true);
          if (brep) {
            addGeometry(record, brep, matrix);
            dispose(brep);
          } else skip('Extrusion');
        }
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
        if (attributes.isInstanceDefinitionObject) continue;
        addRhinoObject(attributes, geometry, identity(), 0);
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
    dispose(materials);

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

// The sample envelope comes from the supplied val.obj, converted from Y-up to Rhino Z-up.
function sampleModel() {
  const builder = new ModelBuilder('The Optics Building'),
    outline = [
      [14.57430, 14.99205],
      [-13.51675, -12.22460],
      [18.59455, -12.22460],
      [18.59455, -10.64035],
      [18.70335, -10.54887],
      [21.51568, -13.30462],
      [37.01052, 1.70855],
      [34.20510, 4.43869],
      [34.28359, 4.52703],
      [35.81238, 4.52703],
      [35.81238, 13.94976],
      [18.04852, 13.83265],
      [18.04852, 13.94976],
      [17.50250, 13.94976],
      [17.50250, 12.30321],
      [17.41274, 12.23963],
    ],
    caps = [
      [8, 10, 9], [10, 8, 7], [4, 15, 7], [5, 7, 6],
      [4, 3, 15], [5, 4, 7], [10, 7, 11], [11, 7, 14],
      [13, 12, 11], [14, 13, 11], [15, 3, 0], [15, 14, 7],
      [3, 2, 1], [1, 0, 3],
    ],
    envelopeHeight = 96.34950,
    levelCount = 28,
    storeyHeight = envelopeHeight / levelCount,
    slabDepth = 0.28;
  const slabs = builder.layer('Floor slabs', [0.62, 0.65, 0.63]),
    core = builder.layer('Core', [0.73, 0.63, 0.55]),
    glazing = builder.layer('Glazing', [0.56, 0.73, 0.79]),
    mullions = builder.layer('Façade mullions', [0.35, 0.42, 0.44]),
    roof = builder.layer('Roof', [0.44, 0.49, 0.47]),
    studioLayers = {
      furniture: builder.layer('Studio furniture', [0.71, 0.59, 0.45]),
      students: builder.layer('Studio students', [0.55, 0.42, 0.61]),
      clutter: builder.layer('Paper, supplies and study models', [0.87, 0.83, 0.69]),
      recycling: builder.layer('Recycling', [0.34, 0.61, 0.50])
    };

  const at = (index, z) => [...outline[index], z];
  function plate(layer, name, bottom, top) {
    const slab = builder.object(layer, name);
    for (const [a, b, c] of caps) {
      builder.tri(slab, at(a, bottom), at(b, bottom), at(c, bottom));
      builder.tri(slab, at(a, top), at(c, top), at(b, top));
    }
    for (let i = 0; i < outline.length; i++) {
      const next = (i + 1) % outline.length;
      builder.quad(slab, at(i, bottom), at(next, bottom), at(next, top), at(i, top));
    }
  }

  const stations = sampleStudioStations(outline);
  for (let level = 0; level < levelCount; level++) {
    const bottom = level * storeyHeight,
      sill = bottom + slabDepth,
      head = (level + 1) * storeyHeight - (level === levelCount - 1 ? slabDepth : 0),
      label = level === 0 ? 'Ground floor' : `Level ${level + 1}`;
    plate(slabs, label, bottom, sill);
    builder.box(builder.object(core, label + ' core'), [10, -2.5, sill], [17, 3.5, head]);
    const glass = builder.object(glazing, label + ' glazing');
    const frames = builder.object(mullions, label + ' mullions');
    for (let i = 0; i < outline.length; i++) {
      const next = (i + 1) % outline.length;
      builder.quad(glass, at(i, sill), at(next, sill), at(next, head), at(i, head));
      const [x, y] = outline[i], [endX, endY] = outline[next];
      const bays = Math.max(1, Math.round(Math.hypot(endX - x, endY - y) / 2.8));
      for (let bay = 1; bay < bays; bay++) {
        const t = bay / bays;
        const post = [x + (endX - x) * t, y + (endY - y) * t];
        builder.seg(frames, [...post, sill], [...post, head]);
      }
    }
    const firstDetail = builder.objects.length;
    addSampleStudio(builder, studioLayers, stations, level, sill, label);
    for (let i = firstDetail; i < builder.objects.length; i++) builder.objects[i].studioFloor = level;
  }
  plate(roof, 'Roof', envelopeHeight - slabDepth, envelopeHeight);
  builder.warn('Concept sample with approximate floors, façade divisions and fictional studios.');
  const model = builder.finish();
  model.defaultStoreyHeight = storeyHeight;
  model.studioFloorCount = levelCount;
  model.studioSlabsVisible = () => builder.layers[slabs].visible;
  model.studioEnclosed = () => [slabs, glazing, roof].every(index => builder.layers[index].visible);
  model.initialAxonometric = 0;
  return registerComponents(model);
}

function studioCoordinates(x, y, z, angle) {
  const cosine = Math.cos(angle), sine = Math.sin(angle);
  return (u, v, h) => [x + u * cosine - v * sine, y + u * sine + v * cosine, z + h];
}

function sampleStudioStations(outline) {
  // Use the long diagonal façade as the datum for the rows and their cross-aisles.
  const [a, b] = outline;
  const angle = Math.atan2(a[1] - b[1], a[0] - b[0]);
  const grid = studioCoordinates(12, 0, 0, angle);
  function inStudio(x, y) {
    if (x > 9.4 && x < 17.6 && y > -3.1 && y < 4.1) return false;
    let inside = false;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const [ax, ay] = outline[i], [bx, by] = outline[j];
      if ((ay > y) !== (by > y) && x < ax + (bx - ax) * (y - ay) / (by - ay)) inside = !inside;
    }
    return inside;
  }
  const stations = [];
  for (let row = -9; row <= 9; row++) {
    for (let column = -10; column <= 10; column++) {
      const u = column * 3.08, v = row * 2.8;
      const fits = [-1.24, 1.24].every(du => [-1.45, 1.45].every(dv => inStudio(...grid(u + du, v + dv, 0))));
      if (fits) {
        const [x, y] = grid(u, v, 0);
        stations.push({ x, y, angle: angle + (Math.abs(row % 2) ? Math.PI : 0) });
      }
    }
  }
  return stations;
}

const STUDIO_BOX_FACES = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
function studioBox(builder, object, point, [x0, y0, z0], [x1, y1, z1]) {
  const vertices = [
    point(x0, y0, z0), point(x1, y0, z0), point(x1, y1, z0), point(x0, y1, z0),
    point(x0, y0, z1), point(x1, y0, z1), point(x1, y1, z1), point(x0, y1, z1)
  ];
  for (const [a, b, c, d] of STUDIO_BOX_FACES) builder.quad(object, vertices[a], vertices[b], vertices[c], vertices[d]);
}

const STUDIO_RINGS = [4, 6, 8].map(sides => Array.from({ length: sides }, (_, i) => {
  const angle = i * Math.PI * 2 / sides;
  return [Math.cos(angle), Math.sin(angle)];
}));

function studioLoft(builder, object, rings, capBottom = false, capTop = false) {
  for (let row = 1; row < rings.length; row++) {
    const lower = rings[row - 1], upper = rings[row];
    for (let i = 0; i < lower.length; i++) {
      const j = (i + 1) % lower.length;
      builder.quad(object, lower[i], lower[j], upper[j], upper[i]);
    }
  }
  const bottom = rings[0], top = rings.at(-1);
  for (let i = 1; i + 1 < top.length; i++) {
    if (capBottom) builder.tri(object, bottom[0], bottom[i + 1], bottom[i]);
    if (capTop) builder.tri(object, top[0], top[i], top[i + 1]);
  }
}

function studioProfile(builder, object, point, levels, sides, capBottom = false, capTop = false) {
  const rings = levels.map(([x, y, z, rx, ry]) =>
    STUDIO_RINGS[sides].map(([c, s]) => point(x + rx * c, y + ry * s, z))
  );
  studioLoft(builder, object, rings, capBottom, capTop);
}

const STUDENT_POSES = {
  standing: { hip: [0, 0.94], shoulder: [-0.025, 1.40], head: [-0.04, 1.58], knee: [-0.04, 0.48], foot: [-0.06, 0.08] },
  seated: { hip: [0.04, 0.51], shoulder: [-0.12, 0.99], head: [-0.18, 1.15], knee: [-0.33, 0.48], foot: [-0.32, 0.08] },
  leaning: { hip: [0.03, 0.93], shoulder: [-0.28, 1.26], head: [-0.39, 1.43], knee: [0.04, 0.48], foot: [0.10, 0.08] },
  dozing: { hip: [0.03, 0.51], shoulder: [-0.39, 0.80], head: [-0.59, 0.93], knee: [-0.33, 0.48], foot: [-0.31, 0.08] }
};

function addStudioStudent(builder, { shirts, trousers, skin, hair }, station, u, v, z, facing, pose, random) {
  const location = studioCoordinates(station.x, station.y, z, station.angle)(u, v, 0);
  const point = studioCoordinates(...location, station.angle + facing);
  const shirt = shirts[Math.floor(random() * shirts.length)];
  const complexion = skin[Math.floor(random() * skin.length)];
  const hairstyle = hair[Math.floor(random() * hair.length)];
  const stature = 0.88 + random() * 0.23, width = 0.78 + random() * 0.58, depth = 0.77 + random() * 0.64;
  const [hipY, hipZ] = pose.hip, [shoulderY, shoulderZ] = pose.shoulder;
  const [headY, headZ] = pose.head;
  const seated = pose === STUDENT_POSES.seated || pose === STUDENT_POSES.dozing;
  const hip = seated ? hipZ : hipZ * stature;
  const shoulder = seated ? hip + (shoulderZ - hipZ) * stature : shoulderZ * stature;
  const head = shoulder + (headZ - shoulderZ) * stature;
  const lean = pose === STUDENT_POSES.leaning || pose === STUDENT_POSES.dozing;
  const headSide = (random() - 0.5) * (lean ? 0.10 : 0.035);
  studioProfile(builder, shirt, point, [
    [0, hipY, hip, 0.15 * width, 0.10 * depth],
    [0, shoulderY, shoulder, 0.205 * width, 0.085 * depth],
    [headSide, headY, shoulder + 0.04, 0.079 * width, 0.061 * depth]
  ], 1, false, true);

  const headWidth = 0.095 * (0.85 + random() * 0.30);
  const scalp = [headSide, headY, head + 0.044, headWidth, 0.092];
  studioProfile(builder, complexion, point, [
    [headSide, headY + 0.016, head - 0.055, headWidth * 0.72, 0.076], scalp
  ], 2);
  studioProfile(builder, complexion, point, [
    [headSide, headY, shoulder + 0.035, 0.043, 0.047],
    [headSide, headY + 0.016, head - 0.052, 0.043, 0.047]
  ], 0);
  const hairHeight = 0.095 + random() * 0.041;
  studioProfile(builder, hairstyle, point, [scalp,
    [headSide, headY + 0.016, head + hairHeight, headWidth * 0.67, 0.07]
  ], 2, false, true);
  builder.tri(complexion, point(headSide - 0.026, headY - 0.081, head - 0.006),
    point(headSide, headY - 0.104, head - 0.025), point(headSide + 0.025, headY - 0.081, head - 0.008));

  // Short tapered tubes make bent knees, elbows and different gestures legible.
  function limb(object, from, to, wider, narrower) {
    const axis = unit(sub(to, from));
    const normal = unit(cross(axis, Math.abs(axis[2]) < 0.85 ? [0, 0, 1] : [1, 0, 0]));
    const tangent = cross(axis, normal);
    const ring = (position, radius) => STUDIO_RINGS[0].map(([c, s]) =>
      point(...position.map((value, i) => value + radius * (c * normal[i] + s * tangent[i])))
    );
    studioLoft(builder, object, [ring(from, wider), ring(to, narrower)]);
  }
  for (const side of [-1, 1]) {
    const legWidth = 0.086 * width;
    const knee = [side * (legWidth + 0.022), pose.knee[0] + (random() - 0.5) * 0.095, pose.knee[1] * (seated ? 1 : stature)];
    const foot = [side * (legWidth + 0.035), pose.foot[0] + (random() - 0.5) * 0.078, pose.foot[1]];
    limb(trousers, [side * legWidth, hipY, hip], knee, 0.084 * width, 0.060 * width);
    limb(trousers, knee, foot, 0.062 * width, 0.039 * width);
    builder.quad(trousers, point(foot[0] - 0.055, foot[1] - 0.122, 0.02),
      point(foot[0] + 0.055, foot[1] - 0.122, 0.02), point(foot[0] + 0.051, foot[1] + 0.033, 0.08),
      point(foot[0] - 0.051, foot[1] + 0.033, 0.08));

    const reach = random();
    const wrist = lean || seated
      ? [side * (0.09 + reach * 0.10), lean ? -0.64 : -0.46 - 0.16 * reach, pose === STUDENT_POSES.leaning ? 0.87 : 0.79 + reach * 0.07]
      : [side * (0.19 + reach * 0.14), -0.07 - reach * 0.27, 0.82 + reach * 0.56];
    const elbow = [side * (0.205 * width + 0.02), (shoulderY + wrist[1]) * 0.5 + 0.10,
      shoulder - (lean ? 0.14 : 0.23)];
    limb(shirt, [side * 0.185 * width, shoulderY, shoulder - 0.035], elbow, 0.067 * width, 0.041 * width);
    limb(complexion, elbow, wrist, 0.044 * width, 0.026 * width);
  }
}

function addSampleStudio(builder, layers, stations, level, z, label) {
  let seed = Math.imul(level + 1, 0x9e3779b1);
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const paper = builder.object(layers.clutter, label + ' loose sheets', [0.94, 0.92, 0.83]);
  const cans = builder.object(layers.clutter, label + ' energy drinks', [0.70, 0.80, 0.31]);
  const glue = builder.object(layers.clutter, label + ' glue bottles', [0.95, 0.88, 0.77]);
  const penColors = [[0.23, 0.39, 0.54], [0.73, 0.25, 0.30], [0.39, 0.32, 0.50]];
  const pens = penColors.map((color, index) => builder.object(layers.clutter, label + ' pens and markers ' + (index + 1), color));
  const models = builder.object(layers.clutter, label + ' study models', [0.89, 0.62, 0.37]);
  const furniture = builder.object(layers.furniture, label + ' desks and chairs');
  const bins = builder.object(layers.recycling, label + ' recycling bins');
  function peopleGroup(name, colors) {
    return colors.map((color, i) => builder.object(layers.students, label + ' ' + name + ' ' + (i + 1), color));
  }
  const people = {
    shirts: peopleGroup('shirts', [[0.55, 0.42, 0.61], [0.34, 0.52, 0.49], [0.79, 0.43, 0.36], [0.66, 0.61, 0.50]]),
    trousers: peopleGroup('trousers', [[0.29, 0.32, 0.38]])[0],
    skin: peopleGroup('faces and hands', [[0.90, 0.72, 0.58], [0.72, 0.47, 0.34], [0.49, 0.32, 0.25], [0.82, 0.58, 0.43]]),
    hair: peopleGroup('hair', [[0.24, 0.17, 0.16], [0.46, 0.26, 0.19], [0.63, 0.50, 0.36]])
  };

  const ground = level === 0;
  for (const [index, station] of stations.entries()) {
    const group = index % 10 === level % 10;
    const open = !group && random() < (ground ? 0.59 : 0.47);
    const point = studioCoordinates(station.x, station.y, z, station.angle);
    const box = (object, a, b) => studioBox(builder, object, point, a, b);
    const student = (u, v, heading, pose) => addStudioStudent(builder, people, station, u, v, z, heading, pose, random);
    function sheet(u, v, h, curl = 0) {
      const angle = random() * Math.PI * 2, c = Math.cos(angle), s = Math.sin(angle);
      const corners = [[-0.13, -0.09], [0.13, -0.09], [0.13, 0.09], [-0.13, 0.09]];
      builder.quad(paper, ...corners.map(([a, b], i) => point(u + a * c - b * s, v + a * s + b * c,
        h + (i === 1 ? curl : 0))));
    }
    function bottle(object, u, v, h, radius, height) {
      studioProfile(builder, object, point, [[u, v, h, radius, radius],
        [u, v, h + height, radius, radius]], 0, false, true);
    }
    function study(u, v, h, size) {
      builder.quad(models, point(u - size * 0.65, v - size * 0.54, h + 0.018),
        point(u + size * 0.65, v - size * 0.54, h + 0.018),
        point(u + size * 0.65, v + size * 0.54, h + 0.018),
        point(u - size * 0.65, v + size * 0.54, h + 0.018));
      const height = size * (0.28 + random() * 0.85);
      box(models, [u - size * 0.42, v - size * 0.32, h + 0.025],
        [u + size * 0.18, v + size * 0.29, h + height]);
      if (random() < 0.35) box(models, [u - size * 0.16, v - size * 0.09, h + height],
        [u + size * 0.41, v + size * 0.36, h + height + size * 0.24]);
    }

    if (open) {
      if (ground || random() < 0.10) {
        student(-0.38, -0.18, -0.9, STUDENT_POSES.standing);
        if (ground && index % 2 === 0) student(0.46, 0.21, 1.9, STUDENT_POSES.standing);
      }
      if (random() < 0.35) {
        study(0.42, -0.65, 0, 0.42);
        sheet(-0.34, 0.42, 0.006, 0.05);
      }
      continue;
    }

    const half = group ? 1.11 : 0.93;
    box(furniture, [-half, -0.44, 0.70], [half, 0.42, 0.77]);
    for (const side of [-half + 0.12, half - 0.19])
      box(furniture, [side, -0.32, 0], [side + 0.07, 0.29, 0.70]);
    box(furniture, [-0.23, 0.50, 0.43], [0.23, 0.90, 0.50]);
    box(furniture, [-0.06, 0.62, 0], [0.06, 0.77, 0.43]);

    for (let i = 0, count = 6 + Math.floor(random() * 6); i < count; i++)
      sheet((random() - 0.5) * half * 1.67, (random() - 0.5) * 0.55, 0.772 + 0.004 * i, random() * 0.026);
    for (let i = 0; i < 3; i++) sheet((random() - 0.5) * 2.0, 0.95 + random() * 0.22, 0.006 + i * 0.002, random() * 0.07);
    for (let i = 0; i < 4; i++) {
      const pointWithAngle = studioCoordinates(...point((random() - 0.5) * 1.5, (random() - 0.5) * 0.57, 0.79),
        station.angle + random() * Math.PI);
      const radius = i % 2 === 0 ? 0.009 : 0.015;
      const a = pointWithAngle(-0.076, -radius, 0), b = pointWithAngle(0.076, -radius, 0);
      const c = pointWithAngle(0.076, 0, radius * 1.7), d = pointWithAngle(-0.076, 0, radius * 1.7);
      builder.quad(pens[i % pens.length], a, b, c, d);
      builder.quad(pens[i % pens.length], d, c, pointWithAngle(0.076, radius, 0), pointWithAngle(-0.076, radius, 0));
    }
    bottle(cans, -0.75, 0.29, 0.77, 0.034, 0.15);
    bottle(cans, 0.78, -0.26, 0.77, 0.034, 0.15);
    if (random() > 0.48) bottle(cans, 0.96, -0.67, 0, 0.034, 0.15);
    if (group || random() < 0.65) {
      bottle(glue, -0.63, -0.28, 0.77, 0.047, 0.12);
      bottle(pens[1], -0.63, -0.28, 0.89, 0.022, 0.032);
    }
    study(0.52, -0.13, 0.77, 0.26 + random() * 0.10);
    if (group || random() > 0.53) study(-0.40, -0.11, 0.77, 0.23 + random() * 0.12);
    if (random() > 0.55) study(-0.90, -0.69, 0, 0.34);

    if (group || random() < 0.79)
      student(0, 0.67, 0, random() < 0.34 ? STUDENT_POSES.dozing : STUDENT_POSES.seated);
    if (group || (ground && index % 3 === 0)) {
      student(0.48, -0.90, Math.PI - 0.26, STUDENT_POSES.leaning);
      if (ground || random() < 0.65) student(-0.59, -0.86, Math.PI + 0.40, STUDENT_POSES.standing);
    }

    if (index % 6 === level % 6) {
      box(bins, [0.63, 0.61, 0], [1.00, 0.98, 0.05]);
      box(bins, [0.63, 0.61, 0.05], [0.66, 0.98, 0.60]);
      box(bins, [0.97, 0.61, 0.05], [1.00, 0.98, 0.60]);
      box(bins, [0.66, 0.61, 0.05], [0.97, 0.64, 0.60]);
      box(bins, [0.66, 0.95, 0.05], [0.97, 0.98, 0.60]);
      for (let i = 0; i < 8; i++) {
        sheet(0.70 + random() * 0.26, 0.68 + random() * 0.27, 0.57 + i * 0.012, random() * 0.09);
        sheet(0.50 + random() * 0.57, 0.93 + random() * 0.22, 0.006 + i * 0.003, random() * 0.06);
      }
    }
  }
}
