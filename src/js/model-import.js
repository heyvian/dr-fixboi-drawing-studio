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

// The Valentine envelope comes from the supplied val.obj, converted from Y-up to Rhino Z-up.
function sampleModel() {
  const builder = new ModelBuilder('The Valentine'),
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
    roof = builder.layer('Roof', [0.44, 0.49, 0.47]);

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
  }
  plate(roof, 'Roof', envelopeHeight - slabDepth, envelopeHeight);
  builder.warn('Calgary’s former Nexen Building. The supplied shell is shown with approximate floors, core and façade divisions.');
  const model = builder.finish();
  model.defaultStoreyHeight = storeyHeight;
  model.initialAxonometric = 0;
  return registerComponents(model);
}
