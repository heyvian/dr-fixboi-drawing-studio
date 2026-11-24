const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const renderer = ['util.js', 'drawing-core.js', 'drawing-render.js']
  .map((file) => fs.readFileSync(path.join(__dirname, '..', 'src', 'js', file), 'utf8'))
  .join('\n');
const { drawingPens, renderDrawing } = vm.runInNewContext(renderer + '\n({ drawingPens, renderDrawing });');

function drawSteepFace({ cover = false, segments = 1 } = {}) {
  // From this direction the depth of the face changes by much more than the tolerance in a pixel.
  const pointOnFace = (x, y) => [x, y, 25 * x];
  const points = [pointOnFace(0, 0), pointOnFace(4, 0), pointOnFace(4, 4), pointOnFace(0, 4)];
  const face = (vertices) => ({ vertices, normal: [-25, 0, 1], color: [1, 1, 1], body: 1, glazing: false });
  const faces = [face([0, 1, 2]), face([0, 2, 3])];
  const lines = [];
  for (let i = 0; i <= segments; i++) {
    const fraction = i / segments;
    points.push(pointOnFace(0.1 + 3.8 * fraction, 0.05 + 3.75 * fraction));
    if (i) lines.push({ a: 3 + i, b: 4 + i, component: 'Curve' });
  }
  if (cover) {
    const first = points.length;
    for (const [x, y] of [[1.5, 0], [2.5, 0], [2.5, 4], [1.5, 4]]) points.push([x, y, 25 * x + 1]);
    faces.push(face([first, first + 1, first + 2]), face([first, first + 2, first + 3]));
  }
  const frame = renderDrawing(
    { points, faces, lines, edges: [] },
    { az: Math.PI / 2, el: 0 }, [], { width: 11, height: 8.5 }, 50, false,
    { x: 0, y: 0, ground: false, center: true }, 'linework', drawingPens({ widths: [0.5] })
  );
  return frame.ink[0].split('M').filter(Boolean).map((line) => line.split('L'));
}

const uninterrupted = drawSteepFace();
assert.equal(uninterrupted.length, 1, 'a line on a steep face stays visible end to end');

const covered = drawSteepFace({ cover: true });
assert.equal(covered.length, 2, 'a face in front of the centre creates a real gap');
assert.equal(covered[0][0], uninterrupted[0][0]);
assert.equal(covered[1][1], uninterrupted[0][1]);

const fine = drawSteepFace({ segments: 1200 });
assert.equal(fine.length, 1200, 'subpixel parts of a curve survive');
assert(fine.every((stroke, i) => i === 0 || fine[i - 1][1] === stroke[0]), 'the parts still join end to end');
assert.equal(fine[0][0], uninterrupted[0][0]);
assert.equal(fine.at(-1)[1], uninterrupted[0][1]);

const points = [
  [-3, 0, -4], [3, 0, -4], [3, 3, -4], [-3, 3, -4],
  [-3, 0, 4], [3, 0, 4], [3, 3, 4], [-3, 3, 4],
  [-1, 1, -3], [1, 1, -3]
];
const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
  .flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]])
  .map((vertices) => ({ vertices, body: 1, cutGroup: 0, glazing: false }));
function drawSection(lens, horizontal = false) {
  return renderDrawing(
    { points, faces, lines: [{ a: 8, b: 9, component: 'Curve' }], edges: [] },
    { az: Math.PI / 2, el: horizontal ? Math.PI / 2 : 0 },
    [horizontal ? { normal: [0, 1, 0], offset: 1.5 } : { normal: [0, 0, 1], offset: 0 }],
    { width: 11, height: 8.5 }, 50, false, { x: 0, y: 0, ground: false, center: true },
    'linework', drawingPens({ widths: [0.5] }), null, null, { planeIndex: 0, lens, cutFill: true }
  );
}
const orthographic = drawSection(0);
const wideAngle = drawSection(8);
const telephoto = drawSection(200);
assert.equal(wideAngle.section, orthographic.section, 'a perspective keeps the cut at its orthographic scale');
assert.equal(telephoto.section, orthographic.section, 'changing focal length leaves the cut unchanged');
assert.notEqual(wideAngle.perspective.ink[0], telephoto.perspective.ink[0]);
assert(wideAngle.perspective.ink[0].startsWith('M'), 'the visible line behind the cut has its own strokes');
assert.equal(wideAngle.cutFills[0], orthographic.cutFills[0]);
assert.match(wideAngle.cutFills[0], /^M.*Z$/);
assert(drawSection(35, true).perspective, 'horizontal cuts support plan perspective');

console.log('linework tests passed');
