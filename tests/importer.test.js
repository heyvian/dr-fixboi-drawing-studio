// Node test for the importers. Loads util.js and model-import.js into one sandbox (they are classic
// browser scripts) and reads a generated .3dm with the real rhino3dm library.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { makeFixture } = require('./fixture');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'js', f), 'utf8');
const sandbox = { console, setTimeout, URL, Blob };
vm.createContext(sandbox);
// Stand-ins for globals that drawing-core.js owns in the browser.
vm.runInContext(
  read('util.js') +
    '\nlet drawingBodyMode = "layer"; const DRAWING_COMPONENTS = {};\n' +
    read('model-import.js') +
    '\nglobalThis.api = { importRhino, importObj, sampleModel, DRAWING_COMPONENTS };',
  sandbox
);
const { importRhino, importObj, sampleModel, DRAWING_COMPONENTS } = sandbox.api;

(async () => {
  const { r, bytes } = await makeFixture();
  const model = await importRhino(r, bytes, 'fixture');

  const keys = model.layers.map((l) => l.key);
  assert(!keys.includes('Hidden'), 'hidden layers are skipped');
  assert(keys.includes('Walls') && keys.includes('Lines'));
  assert.strictEqual(model.layers.find((l) => l.key === 'Walls').triangles, 12, 'mesh box = 12 triangles');
  assert.strictEqual(model.layers.find((l) => l.key === 'Walls').plotWeight, 0.66);
  assert.strictEqual(model.layers.find((l) => l.key === 'Glazing').plotWeight, 0);
  assert.strictEqual(model.layers.find((l) => l.key === 'Construction').plotWeight, -1);
  assert(!model.assemble(undefined, (layer) => layer.plotWeight >= 0).groups.some((group) => group.layer === 'Construction'));
  assert(model.warnings.some((w) => /no saved render mesh/.test(w)), 'unmeshed Breps are reported');
  // Millimetre file: the 4 m box and 8 m Brep must come out in metres, 3 m tall.
  assert(Math.abs(model.height - 3) < 1e-6, 'height ' + model.height);
  assert.strictEqual(model.units.fileLabel, 'Millimetres', 'model-space units take precedence over page-space units');
  assert.strictEqual(model.units.source, 'file');
  assert(Object.keys(DRAWING_COMPONENTS).includes('Walls'));

  // Plan convention: Rhino +Y becomes drawing +Z and Rhino +X becomes drawing -X.
  const mesh = model.assemble();
  assert(mesh.solid.length === 12 * 30 && mesh.lines.length > 0);
  assert.deepStrictEqual(Array.from(mesh.solid.slice(6, 9), (value) => Math.round(value * 255)), [200, 60, 60]);
  const colorOf = (name) => {
    const group = mesh.groups.find((group) => group.name === name);
    return Array.from(mesh.lines.slice(group.lines + 6, group.lines + 9), (value) => Math.round(value * 255));
  };
  assert.deepStrictEqual(colorOf('Material colour'), [12, 34, 56]);
  assert.deepStrictEqual(colorOf('Block member'), [85, 102, 119]);
  assert.strictEqual(mesh.groups.find((group) => group.name === 'Block member').layer, 'Glazing');
  let minY = Infinity;
  for (let i = 0; i < mesh.solid.length; i += 10) minY = Math.min(minY, mesh.solid[i + 1]);
  assert.strictEqual(minY, 0, 'lowest point is on the ground datum');

  // Layer visibility filters the buffers.
  model.layers.find((l) => l.key === 'Walls').visible = false;
  assert.strictEqual(model.assemble().solid.length, 0);

  // Unit override: pretend the file is in metres.
  const metres = await importRhino(r, bytes, 'fixture', 'm');
  assert.strictEqual(metres.height, 3000, 'override reinterprets the model coordinates');
  assert.strictEqual(metres.units.fileLabel, 'Millimetres');
  assert.strictEqual(metres.units.source, 'override');

  for (const [system, label, expectedHeight, source] of [
    ['Inches', 'Inches', 0.0254, 'file'],
    ['Feet', 'Feet', 0.3048, 'file'],
    ['PrinterPoints', 'Printer points', 0.0254 / 72, 'file'],
    ['None', 'Metres', 1, 'assumed']
  ]) {
    const doc = new r.File3dm();
    const settings = doc.settings();
    settings.modelUnitSystem = r.UnitSystem[system];
    doc.objects().addLine([0, 0, 0], [0, 0, 1], new r.ObjectAttributes());
    const imported = await importRhino(r, doc.toByteArray(), system);
    assert.strictEqual(imported.units.label, label);
    assert.strictEqual(imported.units.source, source);
    assert(Math.abs(imported.height - expectedHeight) < 1e-12);
    settings.delete();
    doc.delete();
  }

  const obj = importObj('o Box\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nv 0 0 1\nf 1 2 3 4\nf 1 2 5\n', 'obj');
  assert.strictEqual(obj.triangleCount, 3);
  assert.strictEqual(obj.units.source, 'assumed');
  assert.strictEqual(obj.units.metresPerUnit, 1);
  assert.throws(() => importObj('# nothing', 'empty'));

  const sample = sampleModel();
  assert(sample.layers.length >= 4 && sample.height > 10);
  assert.strictEqual(sample.name, 'The Optics Building');
  for (const name of ['Studio furniture', 'Studio students', 'Paper, supplies and study models', 'Recycling']) {
    assert(sample.layers.find((layer) => layer.key === name)?.triangles > 0, name);
  }
  console.log('importer tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
