// Builds a small Rhino file with rhino3dm for the tests: a mesh, a Brep without a render mesh,
// an extrusion, curves, a hidden layer and a block instance. Shared by both test scripts.
const rhino3dm = require('rhino3dm');

async function makeFixture() {
  const r = await rhino3dm();
  const doc = new r.File3dm();
  doc.settings().modelUnitSystem = r.UnitSystem.Millimeters;
  doc.settings().pageUnitSystem = r.UnitSystem.Inches;
  const layer = (name, color, visible = true, plotWeight = 0) => {
    const l = new r.Layer();
    l.name = name;
    l.color = color;
    l.visible = visible;
    l.plotWeight = plotWeight;
    doc.layers().add(l);
  };
  layer('Walls', { r: 200, g: 60, b: 60, a: 255 }, true, 0.66);
  layer('Glazing', { r: 90, g: 150, b: 200, a: 255 });
  layer('Hidden', { r: 0, g: 0, b: 0, a: 255 }, false);
  layer('Lines', { r: 0, g: 0, b: 0, a: 255 }, true, 0.16);
  layer('Construction', { r: 0, g: 0, b: 0, a: 255 }, true, -1);
  const on = (layerIndex, name = '') => {
    const a = new r.ObjectAttributes();
    a.layerIndex = layerIndex;
    a.name = name;
    return a;
  };
  const mm = (v) => v * 1000;

  // A 4 m x 4 m x 3 m mesh box (millimetres).
  const mesh = new r.Mesh();
  const corners = [[0, 0, 0], [4, 0, 0], [4, 4, 0], [0, 4, 0], [0, 0, 3], [4, 0, 3], [4, 4, 3], [0, 4, 3]];
  for (const c of corners) mesh.vertices().add(mm(c[0]), mm(c[1]), mm(c[2]));
  for (const f of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]])
    mesh.faces().addQuadFace(...f);
  mesh.normals().computeNormals();
  doc.objects().add(mesh, on(0, 'Mesh box'));

  // A Brep box without render meshes: expected to come in as edges only.
  const brep = r.Brep.createFromBox(new r.Box(new r.BoundingBox([mm(6), 0, 0], [mm(8), mm(2), mm(2)])));
  doc.objects().add(brep, on(0, 'Brep box'));

  const poly = new r.Polyline(3);
  poly.add(0, 0, 0);
  poly.add(mm(2), mm(2), 0);
  poly.add(mm(4), 0, 0);
  doc.objects().add(poly.toPolylineCurve(), on(3, 'Polyline'));
  doc.objects().addLine([0, 0, 0], [mm(5), mm(5), 0], on(3, 'Line'));
  doc.objects().addLine([0, mm(4), mm(1)], [mm(1), mm(4), mm(1)], on(4, 'No print line'));
  doc.objects().addCircle(new r.Circle([0, 0, 0], mm(2)), on(3, 'Circle'));
  doc.objects().add(mesh, on(2, 'Hidden mesh'));

  const material = new r.Material();
  material.diffuseColor = { r: 12, g: 34, b: 56, a: 255 };
  doc.materials().add(material);
  const materialLine = on(3, 'Material colour');
  materialLine.colorSource = r.ObjectColorSource.ColorFromMaterial;
  materialLine.materialSource = r.ObjectMaterialSource.MaterialFromObject;
  materialLine.materialIndex = 0;
  doc.objects().addLine([0, 0, 0], [mm(1), 0, 0], materialLine);

  const member = on(1, 'Block member');
  member.colorSource = r.ObjectColorSource.ColorFromParent;
  const definitions = doc.instanceDefinitions();
  const index = definitions.add('Colour block', '', '', '', [0, 0, 0],
    [new r.LineCurve([0, 0, 0], [mm(1), 0, 0])], [member]);
  const instance = on(0, 'Block instance');
  instance.colorSource = r.ObjectColorSource.ColorFromObject;
  instance.objectColor = { r: 85, g: 102, b: 119, a: 255 };
  doc.objects().add(new r.InstanceReference(definitions.findIndex(index).id, r.Transform.translationXYZ(0, mm(2), 0)), instance);
  doc.objects().add(new r.InstanceReference(definitions.findIndex(index).id, r.Transform.translationXYZ(0, mm(3), 0)),
    on(0, 'Layer-coloured instance'));

  return { r, bytes: doc.toByteArray() };
}

module.exports = { makeFixture };
