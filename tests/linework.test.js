const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const renderer = ['util.js', 'contrast.js', 'drawing-core.js', 'drawing-render.js']
  .map((file) => fs.readFileSync(path.join(__dirname, '..', 'src', 'js', file), 'utf8'))
  .join('\n');
const { drawingPens, drawingDepthBand, renderDrawing, sectionHatch, paperContrast, accessibleInk } = vm.runInNewContext(
  renderer + '\n({ drawingPens, drawingDepthBand, renderDrawing, sectionHatch, paperContrast, accessibleInk });'
);

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
function drawSection(lens, horizontal = false, cutTreatment = 'solid', denominator = 50) {
  return renderDrawing(
    { points, faces, lines: [{ a: 8, b: 9, component: 'Curve' }], edges: [] },
    { az: Math.PI / 2, el: horizontal ? Math.PI / 2 : 0 },
    [horizontal ? { normal: [0, 1, 0], offset: 1.5 } : { normal: [0, 0, 1], offset: 0 }],
    { width: 11, height: 8.5 }, denominator, false, { x: 0, y: 0, ground: false, center: true },
    'linework', drawingPens({ widths: [0.5] }), null, null, { planeIndex: 0, lens, cutTreatment, hatchSpacing: 2 }
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
assert.equal(orthographic.cutHatch, '', 'a solid fill has no hatch strokes');

function hatchStrokes(path) {
  return path.split('M').filter(Boolean).map((line) => line.split('L').map((point) => point.split(' ').map(Number)));
}

const outer = [[0, 0], [12, 0], [12, 12], [0, 12]];
const opening = [[4, 4], [4, 8], [8, 8], [8, 4]];
const throughOpening = hatchStrokes(sectionHatch([[outer, opening]], 2, [0, 0], false));
assert.equal(throughOpening.filter(([[x, y]]) => x === y).length, 2, 'the hatch passes on both sides of the opening');
for (const [[ax, ay], [bx, by]] of throughOpening) {
  const insideOpening = (x, y) => x > 4.001 && x < 7.999 && y > 4.001 && y < 7.999;
  assert(!Array.from({ length: 11 }, (_, i) => insideOpening(ax + (bx - ax) * i / 10, ay + (by - ay) * i / 10)).some(Boolean),
    'no hatch stroke crosses the open void');
}
assert.equal(sectionHatch([[outer, opening], [outer, opening]], 2, [0, 0], false), sectionHatch([[outer, opening]], 2, [0, 0], false),
  'overlapping sections do not double the hatch strokes');
for (const denominator of [50, 100, 250]) {
  const hatch = hatchStrokes(drawSection(35, false, 'crosshatch', denominator).cutHatch);
  assert(hatch.some(([[ax, ay], [bx, by]]) => (bx - ax) * (by - ay) > 0), 'crosshatch has both diagonals');
  const rising = hatch.filter(([[ax, ay], [bx, by]]) => (bx - ax) * (by - ay) < 0);
  const offsets = rising.map(([[x, y]]) => (x + y) * Math.SQRT1_2).sort((a, b) => a - b);
  const gaps = offsets.slice(1).map((offset, i) => offset - offsets[i]).filter((gap) => gap > 0.01);
  assert(gaps.length > 0 && gaps.every((gap) => Math.abs(gap - 2 * 88 / 25.4) < 0.002),
    '2 mm hatch spacing stays fixed on paper at every scale');
}

assert.equal(paperContrast('#000000', '#ffffff'), 21);
assert.equal(paperContrast('#000000', '#ffffff', 0), 1, 'fully faded ink appears the same as the paper');
assert.equal(accessibleInk('#000000', '#ffffff', 3, 0.2), null, 'deep fade can prevent any ink from passing');
assert.equal(accessibleInk('#35473c', '#ffffff', 3), '#35473c', 'keep qualifying ink unchanged');
for (const [ink, paper, opacity] of [['#c9bec4', '#f1efec', 0.82], ['#213040', '#25151c', 0.65]]) {
  const proposed = accessibleInk(ink, paper, 3, opacity);
  assert(proposed && proposed !== ink && paperContrast(proposed, paper, opacity) >= 3, 'choose a visible tint or shade');
}

const legacyPens = drawingPens({ distanceFrom: 10, distanceTo: 100 });
assert.deepEqual(Array.from(legacyPens.depthBreaks), [40, 70], 'older spacing restores its original boundaries');
const independentPens = drawingPens({ depthBreaks: [50, 80] });
assert.deepEqual(Array.from(independentPens.depthBreaks), [50, 80]);
assert.deepEqual([49, 50, 79, 80].map((value) => drawingDepthBand(independentPens.depthBreaks, value)), [0, 1, 1, 2]);

console.log('linework tests passed');
