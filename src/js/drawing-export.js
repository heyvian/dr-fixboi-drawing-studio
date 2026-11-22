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

// Use 72 viewBox units per inch so each numeric stroke width is its actual width in points.
// Convert the geometry itself so editors can separate layers without carrying a scaling transform.
function convertDrawingSvgToPoints(root) {
  const pointsPerUnit = 72 / DRAWING_PIXELS_PER_INCH;
  const number = /[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi;
  const points = (value) => Number((Number(value) * pointsPerUnit).toFixed(6));
  const lengthsInPoints = (values) => (values.match(number) || []).map(points).join(' ');
  const lengths = ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
    'width', 'height', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset'];
  root.setAttribute('viewBox', lengthsInPoints(root.getAttribute('viewBox')));
  for (const item of root.querySelectorAll('path, line, rect, circle, [transform]')) {
    for (const attribute of lengths) {
      const value = item.getAttribute(attribute);
      if (value !== null && value !== 'none') item.setAttribute(attribute, lengthsInPoints(value));
    }
    // The scale-bar strokes and sheet rule use the default width in the preview.
    if (item.hasAttribute('stroke') && !item.hasAttribute('stroke-width'))
      item.setAttribute('stroke-width', points(1));
    // The renderer and the outlined glyphs emit paths whose arguments are all lengths.
    if (item.hasAttribute('d'))
      item.setAttribute('d', item.getAttribute('d').replace(/([a-df-z])([^a-df-z]*)/gi,
        (_, command, values) => command + lengthsInPoints(values)));
    // Floor placement and the north arrow use translations. Arrow rotation is about its local origin.
    if (item.hasAttribute('transform'))
      item.setAttribute('transform', item.getAttribute('transform').replace(/translate\(([^)]*)\)/g,
        (_, values) => `translate(${lengthsInPoints(values)})`));
  }
  return root;
}

let pdfTools;
async function createBluebeamPdf(svg, { width, height }) {
  function loadScript(name) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'src/vendor/' + name;
      script.onload = resolve;
      script.onerror = () => {
        script.remove();
        reject(Error('The PDF exporter could not be loaded.'));
      };
      document.head.append(script);
    });
  }
  pdfTools ??= (async () => {
    if (!window.jspdf?.jsPDF) await loadScript('jspdf.umd.min.js');
    if (!window.jspdf.jsPDF.API.svg) await loadScript('svg2pdf.umd.min.js');
    return window.jspdf.jsPDF;
  })().catch((error) => {
    pdfTools = null;
    throw error;
  });
  const Pdf = await pdfTools;
  const pdf = new Pdf({
    orientation: width > height ? 'landscape' : 'portrait',
    unit: 'in',
    format: [width, height],
    compress: true
  });
  pdf.setProperties({ title: svg.querySelector('title').textContent, creator: 'Drawing Studio' });
  await pdf.svg(svg, { x: 0, y: 0, width, height, loadExternalStyleSheets: false });
  return pdf.output('blob');
}
