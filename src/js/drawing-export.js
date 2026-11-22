// Clip the renderer's independent line and quadratic strokes to a sheet region.
function drawingExportStrokes(data, crop, strokeWidth) {
  const inset = strokeWidth / 2 + 0.005;
  const left = Number(crop.getAttribute('x')) + inset,
    top = Number(crop.getAttribute('y')) + inset,
    right = left + Number(crop.getAttribute('width')) - 2 * inset,
    bottom = top + Number(crop.getAttribute('height')) - 2 * inset;
  const planes = [
    { x: -1, y: 0, z: 0, level: -left },
    { x: 1, y: 0, z: 0, level: right },
    { x: 0, y: -1, z: 0, level: -top },
    { x: 0, y: 1, z: 0, level: bottom }
  ];
  const inside = ([x, y]) => x >= left && x <= right && y >= top && y <= bottom;
  const point = (x, y) => [x, y, 0];
  const coordinate = ([x, y]) => x.toFixed(3) + ' ' + y.toFixed(3);
  const strokes = [];
  for (const command of data.match(/M[^M]+/g) || []) {
    const numbers = command.match(/-?\d+(?:\.\d+)?/g).map(Number);
    const start = point(numbers[0], numbers[1]);
    const end = point(numbers.at(-2), numbers.at(-1));
    const control = numbers.length === 6 ? point(numbers[2], numbers[3]) : null;
    if (inside(start) && inside(end) && (!control || inside(control))) {
      strokes.push(command);
      continue;
    }
    if (!control) {
      const line = clipDrawingLine(start, end, planes);
      if (line) strokes.push('M' + coordinate(line[0]) + 'L' + coordinate(line[1]));
      continue;
    }
    // Crossing pencil curves are short. Sample them finely, then join consecutive clipped pieces.
    let previous = start, last = '', path = '';
    for (let step = 1; step <= 16; step++) {
      const t = step / 16;
      const next = drawingMix(drawingMix(start, control, t), drawingMix(control, end, t), t);
      const line = clipDrawingLine(previous, next, planes);
      if (line) {
        const from = coordinate(line[0]), to = coordinate(line[1]);
        if (from !== last) {
          if (path) strokes.push(path);
          path = 'M' + from;
        }
        path += 'L' + to;
        last = to;
      }
      previous = next;
    }
    if (path) strokes.push(path);
  }
  return strokes;
}

let drawingExportFont;
function outlineDrawingLabels(root) {
  drawingExportFont ??= opentype.parse(Uint8Array.from(atob(drawingLabelFont), (char) => char.charCodeAt(0)).buffer);
  for (const text of root.querySelectorAll('text')) {
    const size = Number(text.getAttribute('font-size') || text.parentElement.closest('[font-size]')?.getAttribute('font-size') || 11);
    const content = text.textContent.normalize('NFC');
    const advance = drawingExportFont.getAdvanceWidth(content, size);
    const anchor = text.getAttribute('text-anchor');
    const x = Number(text.getAttribute('x')) - (anchor === 'end' ? advance : anchor === 'middle' ? advance / 2 : 0);
    const y = Number(text.getAttribute('y'));
    const outline = document.createElementNS(text.namespaceURI, 'path');
    for (const attribute of ['fill', 'transform', 'data-scale-ratio'])
      if (text.hasAttribute(attribute)) outline.setAttribute(attribute, text.getAttribute(attribute));
    outline.setAttribute('d', drawingExportFont.getPath(content, x, y, size).toPathData(3));
    outline.setAttribute('aria-label', content);
    if (content.trim()) text.replaceWith(outline);
    else text.remove();
  }
  for (const node of root.querySelectorAll('[font-family], [font-size], [font-weight]'))
    for (const attribute of ['font-family', 'font-size', 'font-weight']) node.removeAttribute(attribute);
}
