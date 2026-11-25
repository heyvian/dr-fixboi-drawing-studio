// Rasterize the same named artwork used for vector export. The PSD stores cropped pixel layers,
// their sheet offsets, and a merged image for previews and other editors.
const DRAWING_PSD_MAX_PIXELS = 48_000_000;
const DRAWING_PSD_MAX_LAYER_PIXELS = 110_000_000;
// Compact ICC Profiles' sRGB-v2-micro profile describes the canvas colour space.
const drawingPsdSrgb =
  'AAAByGxjbXMCEAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwA' +
  'AAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5knZEAPUCAsD1AdCyBnqUijgAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAJZGVzYwAAAPAAAABfY3BydAAAAQwAAAAMd3RwdAAAARgAAAAUclhZ' +
  'WgAAASwAAAAUZ1hZWgAAAUAAAAAUYlhZWgAAAVQAAAAUclRSQwAAAWgAAABgZ1RSQwAAAWgAAABg' +
  'YlRSQwAAAWgAAABgZGVzYwAAAAAAAAAFdVJHQgAAAAAAAAAAAAAAAHRleHQAAAAAQ0MwAFhZWiAA' +
  'AAAAAADzVAABAAAAARbJWFlaIAAAAAAAAG+gAAA48gAAA49YWVogAAAAAAAAYpYAALeJAAAY2lhZ' +
  'WiAAAAAAAAAkoAAAD4UAALbEY3VydgAAAAAAAAAqAAAAfAD4AZwCdQODBMkGTggSChgMYg70Ec8U' +
  '9hhqHC4gQySsKWoufjPrObM/1kZXTTZUdlwXZB1shnVWfo2ILJI2nKunjLLbvpnKx9dl5Hfx+f//';

const drawingPsdSize = (paper, ppi) => [Math.round(paper.width * ppi), Math.round(paper.height * ppi)];
const drawingPsdCanFit = (width, height) => width * height <= DRAWING_PSD_MAX_PIXELS;
const drawingPsdTooLarge = 'This sheet is too large to export at this resolution in the browser. Choose a lower resolution.';

function drawingPsdGroup(layer) {
  const name = layer.dataset.layer;
  if (name === 'Paper') return '';
  if (name === 'Title and scale' || name === 'Floor labels') return 'Sheet annotations';
  if (name === 'Colour fills' || name === 'Surface texture') return 'Surfaces';
  if (name.startsWith('Cut ') || name === 'Section cuts') return 'Sections';
  if (name.startsWith('Pen ') || name.startsWith('Rhino print width')) return 'Pen weights';
  return 'Outlines and ground';
}

function drawingPsdLayers(svg, width, height) {
  const { x, y, width: sheetWidth, height: sheetHeight } = svg.viewBox.baseVal;
  const scaleX = width / sheetWidth, scaleY = height / sheetHeight;
  // getBBox measures the paths in sheet coordinates once the SVG is attached. Keep it out of
  // the layout and accessibility tree. Pad for stroke joins, caps and edge antialiasing.
  svg.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
  svg.setAttribute('aria-hidden', 'true');
  document.body.append(svg);
  try {
    return [...svg.children].filter((layer) => layer.hasAttribute('data-layer')).flatMap((layer) => {
      const name = layer.dataset.layer;
      if (name === 'Paper') return [{ name, left: 0, top: 0, width, height, fill: layer.firstElementChild.getAttribute('fill') }];
      let stroke = 1;
      for (const mark of layer.querySelectorAll('[stroke-width]'))
        stroke = Math.max(stroke, Number(mark.getAttribute('stroke-width')) || 0);
      const bounds = layer.getBBox(), pad = stroke * 2;
      const left = Math.max(0, Math.floor((bounds.x - x - pad) * scaleX) - 1);
      const top = Math.max(0, Math.floor((bounds.y - y - pad) * scaleY) - 1);
      const right = Math.min(width, Math.ceil((bounds.x + bounds.width - x + pad) * scaleX) + 1);
      const bottom = Math.min(height, Math.ceil((bounds.y + bounds.height - y + pad) * scaleY) + 1);
      if (right <= left || bottom <= top) return [];
      // Snap the crop to the output pixel grid so each bitmap lands on the same sheet coordinates.
      const viewBox = [x + left / scaleX, y + top / scaleY, (right - left) / scaleX, (bottom - top) / scaleY].join(' ');
      return [{ name, group: drawingPsdGroup(layer), layer, left, top, width: right - left, height: bottom - top, viewBox }];
    });
  } finally {
    svg.remove();
  }
}

async function drawPsdLayer(vector, layer, context) {
  if (layer.fill) {
    context.fillStyle = layer.fill;
    context.fillRect(0, 0, layer.width, layer.height);
    return;
  }
  const svg = vector.cloneNode(false);
  svg.removeAttribute('style');
  svg.setAttribute('width', layer.width);
  svg.setAttribute('height', layer.height);
  svg.setAttribute('viewBox', layer.viewBox);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.append(layer.layer.cloneNode(true));
  const xml = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    context.drawImage(image, 0, 0);
  } finally {
    URL.revokeObjectURL(url);
  }
}

let psdTools;
// Let the browser paint status before geometry preparation and the synchronous encoding step.
const drawingPsdYield = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

async function createDrawingPsd(vector, paper, ppi, signal, progress) {
  const [width, height] = drawingPsdSize(paper, ppi);
  if (!drawingPsdCanFit(width, height)) throw Error(drawingPsdTooLarge);
  const layers = drawingPsdLayers(vector, width, height);
  const pixels = layers.reduce((sum, layer) => sum + layer.width * layer.height, width * height);
  if (pixels > DRAWING_PSD_MAX_LAYER_PIXELS) throw Error(drawingPsdTooLarge);
  if (!layers.length) throw Error('There are no visible layers to export with these settings.');

  psdTools ??= loadDrawingExportScript('ag-psd.min.js', 'The Photoshop exporter could not be loaded.').catch((error) => {
    psdTools = null;
    throw error;
  });
  await psdTools;
  signal.throwIfAborted();

  const composite = document.createElement('canvas');
  const scratch = document.createElement('canvas');
  composite.width = width;
  composite.height = height;
  const merged = composite.getContext('2d', { willReadFrequently: true });
  const paint = scratch.getContext('2d', { willReadFrequently: true });
  const children = [];
  try {
    if (!merged || !paint) throw Error('The browser could not create a canvas for Photoshop export.');
    for (const [index, layer] of layers.entries()) {
      progress(`Rasterizing layer ${index + 1} of ${layers.length}…`);
      await drawingPsdYield();
      signal.throwIfAborted();
      scratch.width = layer.width;
      scratch.height = layer.height;
      await drawPsdLayer(vector, layer, paint);
      signal.throwIfAborted();
      if (paint.isContextLost?.() || merged.isContextLost?.()) throw Error(drawingPsdTooLarge);
      const { name, group, left, top } = layer;
      const imageData = paint.getImageData(0, 0, layer.width, layer.height);
      merged.drawImage(scratch, left, top);
      const bitmap = { name, left, top, imageData };
      // Group adjacent painting passes to preserve the drawing's stacking order, including in floor sets.
      if (group) {
        if (children.at(-1)?.name !== group) children.push({ name: group, children: [], opened: false });
        children.at(-1).children.push(bitmap);
      } else children.push(bitmap);
    }
    scratch.width = scratch.height = 1;
    progress('Writing Photoshop file…');
    await drawingPsdYield();
    signal.throwIfAborted();
    const imageData = merged.getImageData(0, 0, width, height);
    composite.width = composite.height = 1;
    return window.agPsd.writePsdUint8Array({
      width, height, children, imageData,
      imageResources: {
        iccProfile: Uint8Array.from(atob(drawingPsdSrgb), (character) => character.charCodeAt(0)),
        resolutionInfo: {
          horizontalResolution: ppi, verticalResolution: ppi,
          horizontalResolutionUnit: 'PPI', verticalResolutionUnit: 'PPI', widthUnit: 'Inches', heightUnit: 'Inches'
        }
      }
    }, { noBackground: true });
  } finally {
    scratch.width = scratch.height = composite.width = composite.height = 1;
  }
}
