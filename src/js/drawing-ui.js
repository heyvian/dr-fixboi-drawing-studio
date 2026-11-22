// The drawing workspace: sheet, view controls, clipping planes, floor plans, pens, SVG export and
// print. It is created once and returns the function that hands it a newly imported model.
const openDrawingWorkspace = (() => {
  const panel = $('drawingsPhase'),
    sheet = $('drawingSheet'),
    paperPicker = $('drawingPaper'),
    paperFrame = $('drawingPaperFrame'),
    status = $('drawingStatus'),
    loading = $('drawingLoading'),
    loadingLabel = $('drawingLoadingLabel'),
    progress = $('drawingProgress'),
    exportButton = $('exportDrawing'),
    bluebeamButton = $('exportBluebeam'),
    printButton = $('printDrawing'),
    storageKey = 'poly-nation-drawings-standalone-v1',
    svgNS = 'http://www.w3.org/2000/svg',
    layerNS = 'http://www.inkscape.org/namespaces/inkscape',
    clip = document.createElementNS(svgNS, 'clipPath'),
    clipRect = document.createElementNS(svgNS, 'rect'),
    drawingArea = document.createElementNS(svgNS, 'g'),
    content = document.createElementNS(svgNS, 'g'),
    floorTiles = document.createElementNS(svgNS, 'g'),
    paperLayer = document.createElementNS(svgNS, 'g'),
    sheetArtwork = document.createElementNS(svgNS, 'g'),
    footer = document.createElementNS(svgNS, 'g'),
    footerRule = document.createElementNS(svgNS, 'line'),
    footerTitle = document.createElementNS(svgNS, 'text'),
    footerIdentification = document.createElementNS(svgNS, 'text'),
    footerScale = document.createElementNS(svgNS, 'g'),
    pageStyle = document.createElement('style'),
    paperSizes = {
      letter: [8.5, 11],
      tabloid: [11, 17],
      a4: [210 / 25.4, 297 / 25.4],
      a3: [297 / 25.4, 420 / 25.4],
      a2: [420 / 25.4, 594 / 25.4]
    },
    viewNames = ['axo', 'plan', 'elevation', 'nav', 'aligned'];
  const customPaperStorageKey = storageKey + '-paper-sizes';
  const customPapers = new Map();
  const validPaperSide = (inches) => Number.isFinite(inches) && inches >= 4 - 1e-8 && inches <= 48 + 1e-8;
  function registerCustomPaper(preset) {
    customPapers.set(preset.id, preset);
    paperSizes[preset.id] = [Math.min(preset.width, preset.height), Math.max(preset.width, preset.height)];
  }
  try {
    const storedPapers = JSON.parse(localStorage.getItem(customPaperStorageKey));
    if (Array.isArray(storedPapers)) {
      for (const preset of storedPapers) {
        if (typeof preset?.id === 'string' && /^custom-[0-9a-f-]+$/.test(preset.id) &&
            typeof preset.name === 'string' && preset.name.trim() &&
            validPaperSide(preset.width) && validPaperSide(preset.height) &&
            ['in', 'mm'].includes(preset.unit)) registerCustomPaper(preset);
      }
    }
  } catch {
    // Presets remain optional when browser storage is unavailable.
  }
  const paperLabelDimension = (inches, unit) => Number((inches * (unit === 'mm' ? 25.4 : 1)).toFixed(4));
  function syncCustomPaperChoices() {
    const choices = $('customPaperChoices');
    choices.hidden = !customPapers.size;
    choices.replaceChildren(...[...customPapers.values()].map(({ id, name, width, height, unit }) =>
      new Option(`${name} · ${paperLabelDimension(width, unit)} × ${paperLabelDimension(height, unit)} ${unit}`, id)
    ));
  }
  syncCustomPaperChoices();
  footer.setAttribute('font-family', 'Arial, sans-serif');
  footer.setAttribute('font-size', '11');
  footerIdentification.setAttribute('font-size', '9');
  footer.append(footerRule, footerTitle, footerIdentification, footerScale);
  clip.id = 'drawingSheetClip';
  clip.append(clipRect);
  drawingArea.setAttribute('clip-path', 'url(#drawingSheetClip)');
  markSvgLayer(paperLayer, 'Paper');
  markSvgLayer(content, 'Artwork');
  markSvgLayer(floorTiles, 'Floor plans');
  markSvgLayer(footer, 'Title and scale');
  content.append(sheetArtwork, floorTiles);
  drawingArea.append(content);
  sheet.append(clip, paperLayer, drawingArea, footer);
  document.head.append(pageStyle);
  for (const scale of DRAWING_SCALES)
    $('drawingScale').add(new Option(`1:${scale}`, String(scale)));

  let settings = {
      view: 'axo',
      orbitLocked: true,
      azimuth: 5,
      viewHeadings: {},
      elevation: 225,
      storey: 3.5,
      bodies: 'layer',
      planSheet: 'single',
      glazing: false,
      selected: null,
      planes: [],
      paper: 'letter',
      orientation: 'landscape',
      scale: 'auto',
      mode: 'linework',
      pens: drawingPens(),
      placement: { x: 0, y: 0, ground: false, center: false }
    },
    sourceModel = null,
    modelIdentity = null,
    savedViews = [],
    base = null, // the 3D view snapshot the "From 3D view" drawing is framed from
    geometry = null,
    geometryFloor = null,
    geometryUsesPlotWidths = false,
    rendered = null,
    timer = 0,
    renderRevision = 0,
    printingFloorSet = false,
    exportingPdf = false,
    placing = false,
    drag = null;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && Array.isArray(saved.planes)) {
      const previousElevation = ['front', 'side'].includes(saved.view);
      settings = {
        ...settings,
        view: previousElevation ? 'elevation' : viewNames.includes(saved.view) ? saved.view : 'axo',
        elevation: Number.isFinite(saved.elevation)
          ? mod(saved.elevation, 360)
          : saved.view === 'side'
            ? 315
            : 225,
        storey: Number.isFinite(saved.storey) ? clamp(saved.storey, 1, 20) : 3.5,
        bodies: ['layer', 'object', 'none'].includes(saved.bodies) ? saved.bodies : 'layer',
        azimuth:
          Number.isInteger(saved.azimuth) && COMPASS_POINTS[saved.azimuth] ? saved.azimuth : 5,
        paper: Object.hasOwn(paperSizes, saved.paper) ? saved.paper : 'letter',
        orientation: saved.orientation === 'portrait' ? 'portrait' : 'landscape',
        scale: DRAWING_SCALES.includes(Number(saved.scale)) ? saved.scale : 'auto',
        mode: ['linework', 'color', 'flat'].includes(saved.mode)
          ? saved.mode
          : 'linework',
        placement: {
          x: Number.isFinite(saved.placement?.x) ? saved.placement.x : 0,
          y: Number.isFinite(saved.placement?.y) ? saved.placement.y : 0,
          ground: saved.placement?.ground === true,
          center: saved.placement?.center === true
        },
        glazing: saved.glazing === true,
        pens: drawingPens(saved.pens),
        selected: saved.selected,
        planes: saved.planes.filter(
          (plane) =>
            plane &&
            Number.isFinite(plane.id) &&
            Number.isFinite(plane.offset) &&
            Number.isFinite(plane.angle) &&
            ['horizontal', 'vertical'].includes(plane.axis)
        )
      };
    }
  } catch {
    // Drawing controls remain available when the browser blocks local storage.
  }

  const exportPaper = $('exportPaper'), exportAnnotations = $('exportAnnotations'), exportPaths = $('exportPaths');
  const exportStorageKey = storageKey + '-export';
  try {
    const preferences = JSON.parse(localStorage.getItem(exportStorageKey));
    exportPaper.checked = preferences?.paper !== false;
    exportAnnotations.checked = preferences?.annotations !== false;
    exportPaths.value = preferences?.paths === 'individual' ? 'individual' : 'batch';
  } catch {
    // The defaults are already set in the controls.
  }
  for (const control of [exportPaper, exportAnnotations, exportPaths]) {
    control.onchange = () => {
      try {
        localStorage.setItem(exportStorageKey, JSON.stringify({
          paper: exportPaper.checked,
          annotations: exportAnnotations.checked,
          paths: exportPaths.value
        }));
      } catch {
        // Export still uses the current controls.
      }
    };
  }

  const viewPicker = $('savedViews'), viewName = $('savedViewName'), viewStatus = $('savedViewStatus');
  const viewsStorageKey = () => storageKey + '-views-' + modelIdentity;
  const activeStorageKey = () => storageKey + '-active-' + modelIdentity;
  const titleFields = [$('drawingTitle'), $('drawingNumber'), $('drawingRevision')];
  function currentSnapshot() {
    return {
      settings,
      base,
      titles: titleFields.map((field) => field.value),
      hiddenLayers: sourceModel.layers.filter((layer) => !layer.visible).map((layer) => layer.key)
    };
  }
  function restoreSnapshot(snapshot) {
    base = structuredClone(snapshot.base);
    // Sheets saved before the projection toolbar used independent compass directions.
    const { viewHeading, viewHeadings, ...stored } = structuredClone(snapshot.settings);
    settings = {
      orbitLocked: false,
      ...stored,
      viewHeadings: viewHeadings ?? (Number.isFinite(viewHeading)
        ? { axo: viewHeading, plan: viewHeading, elevation: viewHeading } : {}),
      pens: drawingPens(snapshot.settings.pens)
    };
    if (!Object.hasOwn(paperSizes, settings.paper)) settings.paper = 'letter';
    titleFields.forEach((field, i) => { field.value = snapshot.titles?.[i] ?? ''; });
    if (modelIdentity === 'sample:valentine' && titleFields[0].value === 'The Valentine')
      titleFields[0].value = sourceModel.name;
    const hidden = new Set(snapshot.hiddenLayers);
    for (const layer of sourceModel.layers) layer.visible = !hidden.has(layer.key);
  }
  function refreshSavedViews(selection = '') {
    viewPicker.replaceChildren(
      new Option(savedViews.length ? 'Select a saved view' : 'No saved views', ''),
      ...savedViews.map(({ name }) => new Option(name, name))
    );
    viewPicker.value = selection;
    $('recallView').disabled = $('deleteView').disabled = !viewPicker.value;
  }
  function savedViewMessage(message) {
    viewStatus.textContent = message;
    viewStatus.hidden = !message;
  }
  function persistViews(nextViews, selection, message) {
    savedViews = nextViews;
    refreshSavedViews(selection);
    try {
      localStorage.setItem(viewsStorageKey(), JSON.stringify(savedViews));
      savedViewMessage(message);
    } catch {
      savedViewMessage('Browser storage is unavailable. Changes apply to this session only.');
    }
  }
  viewPicker.onchange = () => {
    viewName.value = viewPicker.value;
    $('recallView').disabled = $('deleteView').disabled = !viewPicker.value;
    savedViewMessage('');
  };
  $('saveView').onclick = () => {
    const name = viewName.value.trim();
    if (!name) {
      savedViewMessage('Enter a name for this view.');
      viewName.focus();
      return;
    }
    const snapshot = { name, ...structuredClone(currentSnapshot()) };
    const next = savedViews.slice();
    const index = next.findIndex((view) => view.name === name);
    if (index < 0) next.push(snapshot);
    else next[index] = snapshot;
    persistViews(next, name, `Saved “${name}”.`);
  };
  $('recallView').onclick = () => {
    const snapshot = savedViews.find(({ name }) => name === viewPicker.value);
    if (!snapshot) return;
    stopPlacing();
    restoreSnapshot(snapshot);
    load.onApplyLayers?.();
    geometry = null;
    clampPlanes();
    syncSettings();
    queueDrawing();
    savedViewMessage(`Recalled “${snapshot.name}”.`);
  };
  $('deleteView').onclick = () => {
    const name = viewPicker.value;
    if (!name) return;
    viewName.value = '';
    persistViews(savedViews.filter((view) => view.name !== name), '', `Deleted “${name}”.`);
  };

  // Storeys are measured up from the model's lowest point at the user's storey height.
  const floorCount = () => clamp(Math.ceil(sourceModel.height / settings.storey - 1e-6), 1, 60);
  const currentPlane = () => settings.planes.find((plane) => plane.id === settings.selected);
  function paperDimensions() {
    const [short, long] = paperSizes[settings.paper];
    return settings.orientation === 'portrait'
      ? { width: short, height: long }
      : { width: long, height: short };
  }
  function resizePaperPreview() {
    const { width, height } = paperDimensions(),
      inset = Number.parseFloat(getComputedStyle(paperFrame).getPropertyValue('--preview-inset')) || 0,
      previewScale = Math.min((paperFrame.clientWidth - inset * 2) / width, (paperFrame.clientHeight - inset * 2) / height);
    if (previewScale > 0) {
      sheet.style.width = width * previewScale + 'px';
      sheet.style.height = height * previewScale + 'px';
    }
    sheet.style.setProperty('--drawing-paper-width', width + 'in');
    sheet.style.setProperty('--drawing-paper-height', height + 'in');
  }
  function saveDrawing() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(settings));
      if (modelIdentity && sourceModel) localStorage.setItem(activeStorageKey(), JSON.stringify(currentSnapshot()));
    } catch {
      // Export is independent of local storage.
    }
  }
  function normalFor(plane) {
    if (plane.axis === 'horizontal') return [0, 1, 0];
    const angle = (plane.angle * Math.PI) / 180;
    return [Math.cos(angle), 0, Math.sin(angle)];
  }
  const floorDatum = (plane) =>
    plane.axis === 'horizontal' && plane.floor != null ? plane.floor * settings.storey : 0;
  const planeHeight = (plane) => floorDatum(plane) + plane.offset;
  const allPlans = () => settings.view === 'plan' && settings.planSheet === 'floors';
  function offsetLimits(plane) {
    const reach = Math.ceil(sourceModel.reach + 2);
    return plane.axis === 'horizontal'
      ? [
          Math.min(0, -floorDatum(plane)),
          Math.ceil(sourceModel.height) - floorDatum(plane)
        ]
      : [-reach, reach];
  }
  const lockedOrbit = () => settings.orbitLocked ? base : null;
  function viewCamera() {
    const top = Math.PI / 2 - 1e-7;
    const orbit = lockedOrbit();
    const heading = settings.viewHeadings[settings.view];
    const azimuth = heading == null ? orbit?.az : compassAzimuth(heading);
    if (settings.view === 'plan')
      return { az: heading == null ? orbit?.az ?? -Math.PI / 2 : compassAzimuth(heading) - Math.PI, el: top };
    if (settings.view === 'nav' && base) return { az: base.az, el: base.el };
    if (settings.view === 'elevation')
      return { az: azimuth ?? compassAzimuth(settings.elevation), el: 0 };
    const plane = currentPlane();
    if (settings.view === 'aligned' && plane) {
      if (plane.axis === 'horizontal') return { az: -Math.PI / 2, el: plane.flip ? -top : top };
      return { az: (plane.angle * Math.PI) / 180 + (plane.flip ? Math.PI : 0), el: 0 };
    }
    // Plan north is world +Z. Moving clockwise on the compass follows the plan axes.
    return { az: azimuth ?? compassAzimuth(settings.azimuth * 45), el: 0.57 };
  }
  const compass = $('drawingCompass');
  const orientationStatus = $('orientationStatus');
  const clipMenu = $('clipMenu'), penMenu = $('penMenu');
  for (const [menu, other] of [[clipMenu, penMenu], [penMenu, clipMenu]]) {
    menu.querySelector('summary').addEventListener('click', () => {
      if (!menu.open) other.open = false;
    });
    menu.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !menu.open) return;
      event.stopPropagation();
      menu.open = false;
      menu.querySelector('summary').focus();
    });
  }
  const sheetViewButtons = [...$('sheetViews').querySelectorAll('[data-sheet-view]')];
  for (const button of sheetViewButtons)
    button.onclick = () => selectSheetView(button.dataset.sheetView, true);
  const showHeading = createViewCompass(compass, (heading) => {
    settings.viewHeadings[settings.view] = heading;
    orientationStatus.hidden = true;
    syncCompass();
    queueDrawing();
  });
  function syncCompass() {
    const elevation = settings.view === 'elevation';
    const plan = settings.view === 'plan';
    compass.hidden = $('drawingOrientationHelp').hidden = settings.view !== 'axo' && !elevation && !plan;
    compass.setAttribute('aria-label', plan ? 'Plan orientation compass' : 'View direction compass');
    $('drawingOrbitField').hidden = !elevation;
    const viewPicker = $('drawingView');
    viewPicker.querySelector('[value="aligned"]').disabled = !currentPlane();
    viewPicker.value = settings.view;
    clipMenu.classList.toggle('view-aligned', settings.view === 'aligned');
    $('useNavView').disabled = !viewer.ok;
    for (const button of sheetViewButtons) {
      const view = button.dataset.sheetView;
      button.disabled = view === 'nav' && !base;
      viewPicker.querySelector(`[value="${view}"]`).disabled = button.disabled;
      button.setAttribute('aria-pressed', String(view === settings.view));
    }
    const heading = compassHeading(viewCamera().az + (plan ? Math.PI : 0));
    $('drawingOrbit').value = heading;
    $('drawingOrbitAngle').textContent = heading + '°';
    showHeading(heading, plan);
    $('drawingPlanSheetField').hidden = $('printFloorSet').hidden = settings.view !== 'plan';
    $('drawingPlanSheet').value = settings.planSheet;
    sheet.classList.toggle('planset', allPlans());
    $('placeDrawingPlane').disabled = allPlans();
    $('centerDrawing').disabled = allPlans();
  }
  $('syncViewOrientations').onclick = () => {
    const heading = compassHeading(viewCamera().az + (settings.view === 'plan' ? Math.PI : 0));
    settings.viewHeadings = { axo: heading, plan: heading, elevation: heading };
    orientationStatus.hidden = false;
    orientationStatus.textContent = 'Direction copied to Axonometric, Plan, and Elevation.';
    syncCompass();
    queueDrawing();
  };

  function floorPlans() {
    const selected = currentPlane();
    const base =
      selected?.axis === 'horizontal'
        ? selected
        : settings.planes.find((plane) => plane.axis === 'horizontal');
    const cut = base ? (base.floor != null ? base.offset : mod(base.offset, settings.storey)) : 1.2;
    // Each plan has its own height cut. Vertical sections can still crop the full set.
    const otherPlanes = settings.planes.filter((plane) => plane.axis === 'vertical');
    return Array.from({ length: floorCount() }, (_, floor) => ({
      label:
        (floor === 0 ? 'Ground floor' : 'Level ' + (floor + 1)) +
        ' · Cut ' +
        (floor * settings.storey + cut).toFixed(2) +
        ' m',
      planes: drawingClips([...otherPlanes, { axis: 'horizontal', offset: cut, floor }])
    }));
  }

  function svgElement(name, attributes) {
    const element = document.createElementNS(svgNS, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  }

  // Layer metadata exposes ordinary SVG groups as editable layers in Inkscape.
  function markSvgLayer(group, name) {
    group.setAttributeNS(layerNS, 'inkscape:groupmode', 'layer');
    group.setAttributeNS(layerNS, 'inkscape:label', name);
    group.setAttribute('data-layer', name);
    return group;
  }
  function sheetInk(paper) {
    return dot(rgb(paper), [0.21, 0.72, 0.07]) < 0.45 ? '#ebeee8' : '#243c30';
  }

  function drawingNorthArrow({ right, up }, x, y, ink) {
    // The drawing's north is +Z (Rhino +Y). Project it onto the sheet so the arrow follows orbit and cut views.
    const projected = Math.hypot(right[2], up[2]),
      northX = right[2] / projected,
      northY = -up[2] / projected,
      angle = (Math.atan2(northX, -northY) * 180) / Math.PI;
    const arrow = svgElement('g', { 'aria-label': 'North arrow', 'data-north-arrow': '' });
    const ring = svgElement('g', { transform: `translate(${x} ${y}) rotate(${angle})` });
    // A narrow ring with three tabs; the fourth tab is the north pointer.
    ring.append(
      svgElement('circle', { r: 6, fill: 'none', stroke: ink, 'stroke-width': 0.85 }),
      svgElement('path', {
        d: 'M-8 0h2 M6 0h2 M0 6v2',
        fill: 'none',
        stroke: ink,
        'stroke-width': 0.85
      }),
      svgElement('path', { d: 'M0 -13l3.2 8.5L0 -6.5l-3.2 2Z', fill: ink })
    );
    const north = svgElement('text', {
      x: x + northX * 18,
      y: y + northY * 18 + 2.7,
      'text-anchor': 'middle',
      'font-size': 8,
      'font-weight': 650
    });
    north.textContent = 'N';
    arrow.append(ring, north);
    return arrow;
  }

  function drawScaleIndicator(indicator, denominator, end, baseline, ink, mapBasis) {
    // Pick a readable ground distance on the 1–2–5 series and keep the bar under 26 mm on paper.
    const capacity = (denominator * 26) / 1000,
      magnitude = 10 ** Math.floor(Math.log10(capacity)),
      metres = [5, 2, 1].map((step) => step * magnitude).find((length) => length <= capacity),
      barLength = (metres * 1000 * DRAWING_PIXELS_PER_INCH) / (denominator * 25.4),
      right = end - 53,
      left = right - barLength,
      y = baseline - 1;
    const bar = svgElement('line', {
      x1: left,
      x2: right,
      y1: y,
      y2: y,
      stroke: ink,
      'data-scale-metres': metres
    });
    const ticks = svgElement('path', {
      d: `M${left} ${y - 2}v4 M${right} ${y - 2}v4`,
      stroke: ink,
      fill: 'none'
    });
    const startLabel = svgElement('text', { x: left, y: y - 5, 'font-size': 8 });
    startLabel.textContent = '0';
    const endLabel = svgElement('text', {
      x: right,
      y: y - 5,
      'font-size': 8,
      'text-anchor': 'end'
    });
    endLabel.textContent = `${metres} m`;
    const ratio = svgElement('text', {
      x: end,
      y: baseline,
      'text-anchor': 'end',
      'data-scale-ratio': denominator
    });
    ratio.textContent = `1:${denominator}`;
    indicator.replaceChildren(bar, ticks, startLabel, endLabel, ratio);
    if (mapBasis) indicator.prepend(drawingNorthArrow(mapBasis, end - 178, baseline - 4, ink));
  }

  function renderPens(target, frame, identified = false) {
    const { pens, ink, texture, section, heaviest, palette: { widths, colors } } = frame;
    const colorLayer = markSvgLayer(svgElement('g', {}), 'Colour wash');
    if (frame.wash)
      colorLayer.append(
        svgElement('image', { width: frame.width, height: frame.height, href: frame.wash })
      );
    const textureLayer = markSvgLayer(svgElement('g', {}), 'Surface texture');
    function path(d, width, stroke) {
      return svgElement('path', {
        d,
        fill: 'none',
        stroke,
        'stroke-width': (width * DRAWING_PIXELS_PER_INCH) / 25.4,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      });
    }
    const layers = [colorLayer, textureLayer];
    const firstInk = ink.findIndex(Boolean);
    const baseWidths = pens.mode === 'rhino' ? widths : pens.widths;
    const order = widths.map((_, i) => i).sort((a, b) => baseWidths[a] - baseWidths[b]);
    for (const i of order) {
      const width = widths[i],
        stroke = colors[i];
      if (texture[i]) textureLayer.append(path(texture[i], width, stroke));
      const layer = markSvgLayer(
        svgElement('g', { 'data-weight-mm': width }),
        pens.mode === 'rhino' ? `Rhino print width · ${width} mm` : `Pen ${i + 1} · ${width.toFixed(2)} mm`
      );
      if (ink[i]) {
        const linework = path(ink[i], width, stroke);
        if (identified && i === firstInk) linework.id = 'drawingLinework';
        layer.append(linework);
      }
      layers.push(layer);
      if (i === heaviest && section) {
        const cuts = markSvgLayer(svgElement('g', { 'data-weight-mm': width }), 'Section cuts');
        const cut = path(section, width, stroke);
        if (identified) cut.id = 'drawingSections';
        cuts.append(cut);
        layers.push(cuts);
      }
    }
    for (const [key, strokes] of [
      ['componentOutlines', frame.componentInk],
      ['silhouette', frame.silhouetteInk],
      ['groundLine', frame.groundLine]
    ]) {
      if (!strokes) continue;
      const { width, color } = pens.detailPens[key];
      const layer = markSvgLayer(svgElement('g', { 'data-weight-mm': width }), DRAWING_DETAIL_PENS[key].label);
      layer.append(path(strokes, width, color));
      layers.push(layer);
    }
    target.replaceChildren(...layers);
  }

  // Each view uses the same physical drawing units. The tile bounds crop its own wash and strokes.
  function floorView(frame, label, x = 0, y = 0, print = false) {
    const { width, height, margin, drawingHeight, denominator } = frame;
    const tile = svgElement('svg', { x, y, width, height, viewBox: `0 0 ${width} ${height}` });
    const area = svgElement('svg', {
      x: margin,
      y: margin,
      width: width - margin * 2,
      height: drawingHeight,
      viewBox: `${margin} ${margin} ${width - margin * 2} ${drawingHeight}`,
      overflow: 'hidden'
    });
    renderPens(area, frame);
    const ink = sheetInk(frame.pens.paper),
      baseline = height - (print ? margin : Math.min(12, margin));
    const name = svgElement('text', {
      x: margin,
      y: baseline,
      fill: ink,
      'font-family': 'system-ui, sans-serif',
      'font-size': 11
    });
    name.textContent = print ? label : `${label} · 1:${denominator}`;
    if (print) tile.append(svgElement('rect', { width, height, fill: frame.pens.paper }));
    tile.append(area, name);
    if (print) {
      const indicator = svgElement('g', {
        fill: ink,
        'font-family': 'system-ui, sans-serif',
        'font-size': 11
      });
      drawScaleIndicator(indicator, denominator, width - margin, baseline, ink, frame.basis);
      tile.append(indicator);
    }
    return tile;
  }

  function geometryFor(camera, planes, seeThrough, bodies, pens) {
    const usesPlotWidths = pens.mode === 'rhino';
    let floor = null;
    if (sourceModel.studioFloorCount) {
      if (!seeThrough && planes.length === 0 && sourceModel.studioEnclosed()) floor = -1;
      if (Math.abs(camera.el - Math.PI / 2) < 1e-6 && sourceModel.studioSlabsVisible()) {
        const topCuts = planes.filter(plane => !plane.flip && plane.normal[1] === 1);
        if (topCuts.length) {
          const level = Math.floor(Math.min(...topCuts.map(plane => plane.offset)) / sourceModel.defaultStoreyHeight);
          floor = level >= sourceModel.studioFloorCount ? null : Math.max(-1, level);
        }
      }
    }
    if (!geometry || geometryFloor !== floor || drawingBodyMode !== bodies || geometryUsesPlotWidths !== usesPlotWidths) {
      drawingBodyMode = bodies;
      const includeStudioFloor = floor === null ? undefined : (level) => level === floor;
      const includeLayer = usesPlotWidths ? (layer) => rhinoPlotWidth(layer) > 0 : undefined;
      geometry = drawingGeometry(sourceModel.assemble(includeStudioFloor, includeLayer), sourceModel);
      geometryFloor = floor;
      geometryUsesPlotWidths = usesPlotWidths;
    }
    return geometry;
  }

  async function renderFloorSheet(paper, camera, revision) {
    const width = Math.round(paper.width * DRAWING_PIXELS_PER_INCH),
      height = Math.round(paper.height * DRAWING_PIXELS_PER_INCH),
      margin = (10 * DRAWING_PIXELS_PER_INCH) / 25.4,
      drawingHeight = height - margin * 3.2;
    const plans = floorPlans(),
      drawingWidth = width - 2 * margin;
    // Choose the grid that leaves the most room for each circular plan and its label.
    let columns = 1,
      bestSize = 0;
    for (let count = 1; count <= plans.length; count++) {
      const cellSize = Math.min(
        drawingWidth / count - 2 * DRAWING_TILE_MARGIN,
        drawingHeight / Math.ceil(plans.length / count) - DRAWING_TILE_RESERVED_HEIGHT
      );
      if (cellSize <= bestSize) continue;
      bestSize = cellSize;
      columns = count;
    }
    const rows = Math.ceil(plans.length / columns),
      region = {
        width: Math.floor(drawingWidth / columns),
        height: Math.floor(drawingHeight / rows)
      };
    const denominator = floorSetScale(plans, camera, paper, region, settings.scale, settings.glazing, settings.bodies, settings.pens);
    let cropped = false,
      populated = false;
    const regionFills = [];
    const tiles = [];
    for (const [i, { planes, label }] of plans.entries()) {
      setDrawingProgress(`Drawing floor ${i + 1} of ${plans.length}…`, i, plans.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!currentRender(revision)) return null;
      const frame = renderDrawing(
        geometryFor(camera, planes, settings.glazing, settings.bodies, settings.pens),
        camera,
        planes,
        paper,
        denominator,
        settings.glazing,
        { x: 0, y: 0, ground: false, center: true },
        settings.mode,
        settings.pens,
        region
      );
      cropped ||= frame.cropped;
      populated ||= frame.populated;
      regionFills.push(frame.exportFills);
      tiles.push(floorView(
        frame,
        label,
        margin + (i % columns) * region.width,
        margin + Math.floor(i / columns) * region.height
      ));
    }
    floorTiles.replaceChildren(...tiles);
    return {
      width,
      height,
      margin,
      drawingHeight,
      denominator,
      cropped,
      populated,
      regionFills
    };
  }

  function floorSetScale(plans, camera, paper, region, scale, glazing, bodies, pens) {
    if (scale !== 'auto') return scale;
    // Every lower plan keeps a subset of the model retained by the highest horizontal cut.
    const { planes } = plans.at(-1);
    const model = geometryFor(camera, planes, glazing, bodies, pens);
    const { bounds } = drawingProjection(model, camera, planes);
    return fittedDrawingScale(bounds, drawingViewport(paper, region));
  }

  const currentRender = (revision) =>
    revision === renderRevision && sourceModel && !panel.hidden && !$('drawingStage').hidden;

  function setDrawingProgress(message, done, total) {
    loading.hidden = !message;
    paperFrame.setAttribute('aria-busy', String(Boolean(message)));
    if (!message) return;
    loadingLabel.textContent = status.textContent = message;
    if (total > 0) {
      progress.max = total;
      progress.value = done;
    } else progress.removeAttribute('value');
  }

  async function render(revision) {
    timer = 0;
    try {
      if (!currentRender(revision)) return;
      const paper = paperDimensions();
      const camera = viewCamera(),
        clips = drawingClips(settings.planes),
        framing = settings.view === 'nav' ? base : settings.view === 'aligned' ? null : lockedOrbit();
      const groundButton = $('groundDrawing');
      groundButton.disabled = Math.abs(Math.cos(camera.el)) <= 0.01;
      groundButton.title = groundButton.disabled
        ? 'Ground alignment is available in elevations and axonometrics.'
        : 'Align ground 5 mm above the bottom drawing margin';
      if (!allPlans()) floorTiles.replaceChildren();
      const next = allPlans()
        ? await renderFloorSheet(paper, camera, revision)
        : renderDrawing(
            geometryFor(camera, clips, settings.glazing, settings.bodies, settings.pens),
            camera,
            clips,
            paper,
            settings.scale,
            settings.glazing,
            settings.placement,
            settings.mode,
            settings.pens,
            null,
            framing
          );
      if (!next || !currentRender(revision)) return;
      rendered = next;
      const { width, height, margin, denominator } = rendered,
        ruleY = height - margin * 1.8,
        textY = height - margin,
        viewLabel = allPlans()
          ? 'Floor plans'
          : settings.view === 'aligned'
            ? currentPlane()?.axis === 'vertical'
              ? 'Section'
              : 'Plan section'
            : $('drawingView').selectedOptions[0].text;
      // Keep SVG coordinates tied to the exact physical paper size. Only raster buffers round to pixels.
      const pageWidth = paper.width * DRAWING_PIXELS_PER_INCH,
        pageHeight = paper.height * DRAWING_PIXELS_PER_INCH;
      sheet.setAttribute('viewBox', `0 0 ${pageWidth} ${pageHeight}`);
      clipRect.setAttribute('x', margin);
      clipRect.setAttribute('y', margin);
      clipRect.setAttribute('width', width - margin * 2);
      clipRect.setAttribute('height', rendered.drawingHeight);
      content.removeAttribute('transform');
      paperLayer.replaceChildren(svgElement('rect', { width: pageWidth, height: pageHeight, fill: settings.pens.paper }));
      if (allPlans()) sheetArtwork.replaceChildren();
      else renderPens(sheetArtwork, rendered, true);
      footerRule.setAttribute('x1', margin);
      const sheetText = sheetInk(settings.pens.paper);
      footer.setAttribute('fill', sheetText);
      footerRule.setAttribute('stroke', sheetText);
      footerRule.setAttribute('opacity', '0.45');
      footerRule.setAttribute('x2', width - margin);
      footerRule.setAttribute('y1', ruleY);
      footerRule.setAttribute('y2', ruleY);
      footerTitle.setAttribute('x', margin);
      footerTitle.setAttribute('y', textY);
      footerTitle.textContent = sheetTitle() + ' \u00b7 ' + viewLabel;
      footerIdentification.setAttribute('x', margin);
      footerIdentification.setAttribute('y', textY + 13);
      const [number, sheetRevision] = titleFields.slice(1).map((field) => field.value.trim());
      footerIdentification.textContent = [number, sheetRevision && `REV ${sheetRevision}`].filter(Boolean).join(' · ');
      // Elevations and upright sections have an edge-on plan. Their footer only needs the scale.
      const mapBasis = Math.abs(camera.el) > 0.01 ? orbitBasis(camera) : null;
      drawScaleIndicator(footerScale, denominator, width - margin, textY, sheetText, mapBasis);
      syncPenScaleNote(denominator);
      syncPenDepth();
      setDrawingOutputAvailable(rendered.populated);
      $('printFloorSet').disabled = printingFloorSet;
      resizePaperPreview();
      setDrawingProgress('');
      showStatus();
    } catch (error) {
      if (!currentRender(revision)) return;
      console.error('Drawing render failed', error);
      status.textContent = 'The drawing could not be rendered.';
    } finally {
      if (revision === renderRevision && !loading.hidden) setDrawingProgress('');
    }
  }
  const sheetTitle = () => $('drawingTitle').value.trim() || sourceModel.name;
  function showStatus() {
    if (!loading.hidden) return;
    status.textContent = placing
      ? 'Click the drawing to place the selected plane.'
      : rendered?.cropped
        ? allPlans()
          ? 'Some plans extend past their panels. Use Fit to scale the set.'
          : 'Drawing extends past the sheet. Drag to choose the part to export.'
        : exportButton.disabled
          ? 'No printable geometry is visible on this sheet.'
          : allPlans()
            ? 'Floor plans share a drawing scale.'
            : base && settings.scale !== 'auto' && !settings.placement.center &&
                (settings.view === 'nav' || (settings.view !== 'aligned' && settings.orbitLocked))
              ? 'Using the captured 3D framing. Drag the drawing or use the arrow keys to pan the sheet.'
              : 'Drag the drawing or use the arrow keys to reposition it.';
  }
  function setDrawingOutputAvailable(available) {
    exportButton.disabled = printButton.disabled = !available;
    bluebeamButton.disabled = !available || exportingPdf;
  }
  function queueDrawing() {
    saveDrawing();
    setDrawingOutputAvailable(false);
    $('printFloorSet').disabled = true;
    clearTimeout(timer);
    timer = 0;
    const revision = ++renderRevision;
    if (currentRender(revision)) {
      setDrawingProgress(allPlans() ? 'Preparing floor plans…' : 'Generating drawing…');
      timer = setTimeout(() => render(revision), 45);
    } else setDrawingProgress('');
  }
  new ResizeObserver(() => {
    if (!panel.hidden && !$('drawingStage').hidden) resizePaperPreview();
  }).observe(paperFrame);

  function syncOffset(plane) {
    const [min, max] = offsetLimits(plane);
    for (const input of [$('drawingPlaneOffset'), $('drawingPlaneMove')]) {
      input.min = min;
      input.max = max;
      input.value = plane.offset;
    }
    const elevation = $('drawingCutElevation');
    elevation.hidden = plane.axis !== 'horizontal';
    elevation.value = `Cut elevation ${planeHeight(plane).toFixed(2)} m`;
  }
  function drawingClips(planes) {
    return planes.map((plane) => ({
      normal: normalFor(plane),
      flip: plane.flip,
      offset: planeHeight(plane)
    }));
  }
  function stopPlacing() {
    placing = false;
    $('placeDrawingPlane').setAttribute('aria-pressed', 'false');
    sheet.dataset.placing = 'false';
  }
  function syncPenScaleNote(denominator) {
    const pens = settings.pens;
    const widths = printedDrawingPenWidths(pens, denominator).map((width) => width.toFixed(2));
    $('drawingPenScaleNote').textContent = pens.adaptToScale
      ? `Your settings apply at 1:${DRAWING_PEN_REFERENCE_SCALE}. At 1:${denominator} the numbered pens print at ${widths.join(' / ')} mm.`
      : 'Widths stay fixed on paper at every scale.';
  }

  const detailPenControls = Object.entries(DRAWING_DETAIL_PENS).map(([key, { id, label, help }]) => {
    const row = document.createElement('div'),
      toggleLabel = document.createElement('label'),
      toggle = document.createElement('input'),
      note = document.createElement('p'),
      fields = document.createElement('div'),
      width = document.createElement('input'),
      color = document.createElement('input');
    row.className = 'detail-pen';
    toggleLabel.className = 'check';
    toggle.id = id;
    toggle.type = 'checkbox';
    note.id = `${id}Help`;
    note.className = 'hint';
    note.textContent = help;
    toggle.setAttribute('aria-describedby', note.id);
    toggleLabel.append(toggle, label);
    fields.className = 'detail-pen-fields';
    width.type = 'number';
    Object.assign(width, DRAWING_PEN_LIMITS);
    color.type = 'color';
    for (const [input, caption] of [[width, 'Width (mm)'], [color, 'Colour']]) {
      const fieldLabel = document.createElement('label');
      input.setAttribute('aria-label', `${label} ${caption.toLowerCase()}`);
      fieldLabel.append(caption, input);
      fields.append(fieldLabel);
    }
    toggle.onchange = () => {
      settings.pens[key] = toggle.checked;
      fields.hidden = !toggle.checked;
      queueDrawing();
    };
    width.onchange = () => {
      const pen = settings.pens.detailPens[key];
      if (Number.isFinite(width.valueAsNumber))
        pen.width = clamp(width.valueAsNumber, DRAWING_PEN_LIMITS.min, DRAWING_PEN_LIMITS.max);
      width.value = pen.width;
      queueDrawing();
    };
    color.onchange = () => {
      settings.pens.detailPens[key].color = color.value;
      queueDrawing();
    };
    row.append(toggleLabel, note, fields);
    $('drawingDetailPens').append(row);
    return { key, toggle, width, color, fields };
  });

  function penLegendRow(label, value) {
    const row = document.createElement('li');
    for (const text of [label, value]) {
      const item = document.createElement('span');
      item.textContent = text;
      row.append(item);
    }
    return row;
  }

  function syncPenDepth() {
    const pens = settings.pens;
    if (pens.mode !== 'distance') return;
    const [start, end] = drawingPenDepthRange(pens);
    const ranked = drawingPensByWeight(pens.widths);
    const widths = printedDrawingPenWidths(pens, rendered?.denominator ?? DRAWING_PEN_REFERENCE_SCALE);
    const row = $('drawingDepthBands'), strip = $('drawingDepthStrip');
    $('drawingDepthAdjust').hidden = ranked.length === 1;
    $('drawingDistanceFrom').value = start;
    $('drawingDistanceTo').value = end;
    $('drawingDistanceFromOut').textContent = `${start}%`;
    $('drawingDistanceToOut').textContent = `${end}%`;
    row.replaceChildren();
    strip.replaceChildren();
    const percent = (depth) => `${Number(depth.toFixed(1))}%`;
    const boundary = (i) => start + (end - start) * i / ranked.length;
    ranked.forEach((index, band) => {
      const from = band === 0 ? 0 : boundary(band);
      const to = band === ranked.length - 1 ? 100 : boundary(band + 1);
      const segment = document.createElement('span');
      segment.style.flexBasis = `${to - from}%`;
      segment.style.setProperty('--depth-stroke', `${Math.max(1, 7 * widths[index] / widths[ranked[0]])}px`);
      strip.append(segment);
      row.append(penLegendRow(`Pen ${index + 1} · ${widths[index].toFixed(2)} mm`, `${percent(from)}–${percent(to)}`));
    });
  }

  // Rebuild the paired controls only when the pen set or assignment scheme changes.
  function syncPenControls() {
    const pens = settings.pens;
    const modes = $('drawingPenMode');
    const rhino = modes.querySelector('[value="rhino"]');
    rhino.disabled = !sourceModel?.layers.some((layer) => Number.isFinite(layer.plotWeight));
    if (rhino.disabled && pens.mode === 'rhino') pens.mode = 'distance';
    modes.value = pens.mode;
    const useRhino = pens.mode === 'rhino';
    $('drawingCustomPens').hidden = $('drawingPenScaling').hidden = useRhino;
    $('drawingRhinoPens').hidden = !useRhino;
    if (useRhino) {
      const rows = sourceModel.layers.map((layer) => {
        const plotWidth = rhinoPlotWidth(layer);
        return penLegendRow(layer.label, plotWidth < 0 ? 'No print' : `${plotWidth} mm`);
      });
      $('drawingRhinoLayerWeights').replaceChildren(...rows);
    }
    $('drawingPaperColor').value = pens.paper;
    $('drawingInkColor').value = pens.colors[0];
    $('drawingPenCount').value = pens.widths.length;
    $('drawingAdaptWeights').checked = pens.adaptToScale;
    for (const { key, toggle, width, color, fields } of detailPenControls) {
      toggle.checked = pens[key];
      fields.hidden = !toggle.checked;
      width.value = pens.detailPens[key].width;
      color.value = pens.detailPens[key].color;
    }
    $('drawingCurves').checked = pens.curves;
    $('drawingOpenEdges').checked = pens.openEdges;
    $('drawingSilhouettes').checked = pens.silhouettes;
    $('drawingCreases').checked = pens.creases;
    $('drawingCreaseAngle').value = pens.creaseAngle;
    $('drawingCreaseAngle').disabled = !pens.creases;
    $('drawingCreaseOut').textContent = pens.creaseAngle + '°';
    $('drawingDistanceFields').hidden = pens.mode !== 'distance';
    syncPenDepth();
    const components = $('drawingPenComponents');
    components.hidden = pens.mode !== 'component';
    components.replaceChildren(
      ...Object.entries(DRAWING_COMPONENTS).map(([key, [name]]) => {
        const label = document.createElement('label'),
          select = document.createElement('select');
        label.className = 'drawing-view-field';
        select.setAttribute('aria-label', name);
        label.append(name, select);
        for (const [i, width] of pens.widths.entries())
          select.add(new Option(`Pen ${i + 1} · ${width.toFixed(2)} mm`, i));
        select.value = pens.components[key];
        select.onchange = () => {
          pens.components[key] = Number(select.value);
          queueDrawing();
        };
        return label;
      })
    );
    $('drawingPenWidths').replaceChildren(
      ...pens.widths.map((width, i) => {
        const row = document.createElement('div'),
          name = document.createElement('span'),
          slider = document.createElement('input'),
          number = document.createElement('input'),
          color = document.createElement('input');
        row.className = 'drawing-pen-row';
        name.textContent = `Pen ${i + 1} · mm`;
        slider.type = 'range';
        number.type = 'number';
        color.type = 'color';
        color.value = pens.colors[i];
        color.setAttribute('aria-label', `Pen ${i + 1} colour`);
        color.onchange = () => {
          pens.colors[i] = color.value;
          queueDrawing();
        };
        for (const input of [slider, number]) {
          Object.assign(input, DRAWING_PEN_LIMITS);
          input.value = width;
          input.setAttribute(
            'aria-label',
            `Pen ${i + 1} ${input === slider ? 'width slider' : 'width in millimetres'}`
          );
        }
        const update = (value) => {
          const next = Number.isFinite(value)
            ? clamp(value, DRAWING_PEN_LIMITS.min, DRAWING_PEN_LIMITS.max)
            : pens.widths[i];
          pens.widths[i] = next;
          slider.value = number.value = next;
          for (const select of components.querySelectorAll('select'))
            select.options[i].textContent = `Pen ${i + 1} · ${next.toFixed(2)} mm`;
          syncPenDepth();
          queueDrawing();
        };
        slider.oninput = () => {
          number.value = slider.value;
        };
        slider.onchange = () => update(slider.valueAsNumber);
        number.onchange = () => update(number.valueAsNumber);
        row.append(name, slider, number, color);
        return row;
      })
    );
  }
  $('drawingPenMode').onchange = (event) => {
    settings.pens.mode = event.target.value;
    syncPenControls();
    queueDrawing();
  };
  // The two distance thresholds push each other so they always stay at least 5% apart.
  for (const [id, key] of [['drawingDistanceFrom', 'distanceFrom'], ['drawingDistanceTo', 'distanceTo']])
    $(id).oninput = (event) => {
      const pens = settings.pens,
        value = Number(event.target.value);
      pens[key] = value;
      if (key === 'distanceFrom') pens.distanceTo = Math.max(pens.distanceTo, value + 5);
      else pens.distanceFrom = Math.min(pens.distanceFrom, value - 5);
      syncPenDepth();
      queueDrawing();
    };
  $('drawingPenCount').onchange = (event) => {
    settings.pens = drawingPens({
      ...settings.pens,
      components: undefined,
      widths: DRAWING_PEN_PRESETS[Number(event.target.value)]
    });
    syncPenControls();
    queueDrawing();
  };
  $('drawingAdaptWeights').onchange = (event) => {
    settings.pens.adaptToScale = event.target.checked;
    queueDrawing();
  };
  for (const [id, key] of [
    ['drawingCurves', 'curves'],
    ['drawingOpenEdges', 'openEdges'],
    ['drawingSilhouettes', 'silhouettes'],
    ['drawingCreases', 'creases']
  ])
    $(id).onchange = (event) => {
      settings.pens[key] = event.target.checked;
      syncPenControls();
      queueDrawing();
    };
  $('drawingCreaseAngle').oninput = (event) => {
    settings.pens.creaseAngle = Number(event.target.value);
    syncPenControls();
    queueDrawing();
  };
  $('drawingPaperColor').onchange = (event) => {
    settings.pens.paper = event.target.value;
    queueDrawing();
  };
  $('drawingInkColor').onchange = (event) => {
    settings.pens.colors.fill(event.target.value);
    for (const pen of Object.values(settings.pens.detailPens)) pen.color = event.target.value;
    syncPenControls();
    queueDrawing();
  };

  function syncSettings() {
    if (!currentPlane()) settings.selected = settings.planes[0]?.id ?? null;
    const plane = currentPlane();
    if (!plane && settings.view === 'aligned') settings.view = 'axo';
    if (!base && settings.view === 'nav') settings.view = 'axo';
    $('drawingView').value = settings.view;
    $('drawingStorey').value = Number(settings.storey.toFixed(3));
    $('drawingBodies').value = settings.bodies;
    syncCompass();
    $('drawingRendering').value = settings.mode;
    syncPenControls();
    paperPicker.value = settings.paper;
    $('drawingOrientation').value = settings.orientation;
    $('drawingScale').value = settings.scale;
    $('drawingGlazing').checked = settings.glazing;
    $('drawingNoPlanes').hidden = Boolean(plane);
    $('drawingPlaneFields').hidden = !plane;
    $('drawingPlanes').replaceChildren(
      ...settings.planes.map((item, index) => {
        const row = document.createElement('div'),
          choose = document.createElement('button'),
          remove = document.createElement('button');
        row.className = 'drawing-plane-row';
        choose.type = remove.type = 'button';
        choose.textContent = `Plane ${index + 1} · ${item.axis === 'horizontal' ? 'Horizontal' : 'Vertical'}`;
        choose.setAttribute('aria-pressed', String(item.id === settings.selected));
        choose.onclick = () => {
          settings.selected = item.id;
          stopPlacing();
          syncSettings();
          $('drawingPlaneAxis').focus();
          queueDrawing();
        };
        remove.textContent = '×';
        remove.setAttribute('aria-label', 'Remove plane ' + (index + 1));
        remove.onclick = () => {
          settings.planes = settings.planes.filter((candidate) => candidate.id !== item.id);
          stopPlacing();
          syncSettings();
          $('addDrawingPlane').focus();
          queueDrawing();
        };
        row.append(choose, remove);
        return row;
      })
    );
    if (!plane) return;
    $('drawingPlaneAxis').value = plane.axis;
    $('drawingAngleField').hidden = plane.axis !== 'vertical';
    $('drawingFloorField').hidden = plane.axis !== 'horizontal';
    $('centerDrawingPlane').hidden = plane.axis !== 'vertical';
    $('drawingPlaneMove').setAttribute(
      'list',
      plane.axis === 'vertical' ? 'drawingCenterTick' : ''
    );
    $('drawingFloor').value = plane.floor == null ? '' : String(plane.floor);
    $('drawingPlaneAngle').value = plane.angle;
    $('flipDrawingPlane').checked = plane.flip;
    syncOffset(plane);
  }

  function selectSheetView(view, lockOrbit = settings.orbitLocked) {
    if (settings.view === view && settings.orbitLocked === lockOrbit) return;
    if (view === 'plan' && settings.view !== 'plan') settings.planSheet = 'single';
    settings.view = view;
    settings.orbitLocked = lockOrbit;
    orientationStatus.hidden = true;
    stopPlacing();
    syncCompass();
    queueDrawing();
  }
  $('drawingView').onchange = (event) => selectSheetView(event.target.value);
  $('drawingOrbit').oninput = (event) => {
    settings.viewHeadings.elevation = event.target.valueAsNumber;
    orientationStatus.hidden = true;
    syncCompass();
    queueDrawing();
  };
  $('drawingStorey').onchange = (event) => {
    settings.storey = Number.isFinite(event.target.valueAsNumber)
      ? clamp(event.target.valueAsNumber, 1, 20)
      : settings.storey;
    event.target.value = settings.storey;
    clampPlanes();
    fillFloors();
    queueDrawing();
  };
  $('drawingBodies').onchange = (event) => {
    settings.bodies = event.target.value;
    geometry = null;
    queueDrawing();
  };
  for (const field of titleFields) field.oninput = queueDrawing;
  $('drawingPlanSheet').onchange = (event) => {
    settings.planSheet = event.target.value;
    stopPlacing();
    syncCompass();
    queueDrawing();
  };
  $('drawingRendering').onchange = (event) => {
    settings.mode = event.target.value;
    queueDrawing();
  };
  function selectDrawingPaper(id) {
    settings.paper = paperPicker.value = id;
    const preset = customPapers.get(id);
    if (preset) settings.orientation = $('drawingOrientation').value = preset.width >= preset.height ? 'landscape' : 'portrait';
    queueDrawing();
  }
  const paperDialog = $('customPaperDialog');
  const paperUnit = $('customPaperUnit'), paperName = $('customPaperName'),
    paperWidth = $('customPaperWidth'), paperHeight = $('customPaperHeight'), paperError = $('customPaperError');
  let currentPaperUnit = 'mm';
  paperPicker.onchange = () => {
    if (paperPicker.value !== 'custom') {
      selectDrawingPaper(paperPicker.value);
      return;
    }
    paperPicker.value = settings.paper;
    const preset = customPapers.get(settings.paper);
    const { width, height } = preset ?? paperDimensions();
    currentPaperUnit = paperUnit.value = preset?.unit ?? 'mm';
    paperName.value = preset?.name ?? '';
    paperWidth.value = paperLabelDimension(width, currentPaperUnit);
    paperHeight.value = paperLabelDimension(height, currentPaperUnit);
    paperError.hidden = true;
    paperDialog.showModal();
    paperName.select();
  };
  $('cancelCustomPaper').onclick = () => paperDialog.close();
  paperUnit.onchange = () => {
    for (const input of [paperWidth, paperHeight]) {
      const inches = input.valueAsNumber / (currentPaperUnit === 'mm' ? 25.4 : 1);
      if (Number.isFinite(inches)) input.value = paperLabelDimension(inches, paperUnit.value);
    }
    currentPaperUnit = paperUnit.value;
  };
  $('customPaperForm').onsubmit = (event) => {
    event.preventDefault();
    const name = paperName.value.trim(), unit = paperUnit.value;
    const factor = unit === 'mm' ? 25.4 : 1;
    const width = paperWidth.valueAsNumber / factor, height = paperHeight.valueAsNumber / factor;
    if (!name || !validPaperSide(width) || !validPaperSide(height)) {
      paperError.textContent = 'Enter a name and dimensions within the supported range.';
      paperError.hidden = false;
      return;
    }
    const previous = [...customPapers.values()].find((preset) => preset.name.toLowerCase() === name.toLowerCase());
    const id = previous?.id ?? `custom-${Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, '0')).join('')}`;
    const preset = { id, name, width, height, unit };
    const updated = new Map(customPapers).set(id, preset);
    try {
      localStorage.setItem(customPaperStorageKey, JSON.stringify([...updated.values()]));
    } catch {
      paperError.textContent = 'This browser could not save the paper size.';
      paperError.hidden = false;
      return;
    }
    registerCustomPaper(preset);
    syncCustomPaperChoices();
    selectDrawingPaper(id);
    paperDialog.close();
  };
  $('drawingOrientation').onchange = (event) => {
    settings.orientation = event.target.value;
    queueDrawing();
  };
  $('drawingScale').onchange = (event) => {
    const choice = event.target.value;
    if (choice === 'auto') fitDrawing();
    else {
      keepCenterAtScale(choice);
      if (settings.scale === 'auto') settings.placement.center = true;
      settings.scale = choice;
      queueDrawing();
    }
  };
  // The drawing is placed relative to the model's centre, so a new scale would swing it back to the
  // middle. Adjust the placement so whatever sits at the sheet centre stays there.
  function keepCenterAtScale(choice) {
    const denominator = Number(choice);
    if (!rendered || allPlans() || !Number.isFinite(rendered.midX) || !denominator) return;
    const { originX, originY, scale, midX, midY, width, margin, drawingHeight } = rendered,
      atX = (width / 2 - originX) / scale,
      atY = (margin + drawingHeight / 2 - originY) / scale,
      millimetresPerUnit = 1000 / denominator;
    settings.placement.x = (midX - atX) * millimetresPerUnit;
    if (!settings.placement.ground)
      settings.placement.y = (midY - atY) * millimetresPerUnit;
  }
  $('drawingGlazing').onchange = (event) => {
    settings.glazing = event.target.checked;
    queueDrawing();
  };
  function fitDrawing() {
    settings.scale = 'auto';
    $('drawingScale').value = settings.scale;
    settings.placement = { x: 0, y: 0, ground: false, center: true };
    queueDrawing();
  }
  $('fitDrawing').onclick = fitDrawing;
  $('centerDrawing').onclick = () => {
    settings.placement = { x: 0, y: 0, ground: false, center: true };
    queueDrawing();
  };
  $('groundDrawing').onclick = () => {
    settings.placement.y = 0;
    settings.placement.ground = true;
    queueDrawing();
  };
  $('addDrawingPlane').onclick = () => {
    const id = Math.max(0, ...settings.planes.map((plane) => plane.id)) + 1,
      horizontal = settings.view === 'plan',
      angle = Math.round((viewCamera().az * 180) / Math.PI);
    settings.planes.push({
      id,
      axis: horizontal ? 'horizontal' : 'vertical',
      offset: horizontal ? 1.2 : 0,
      angle: mod(angle, 360),
      flip: false
    });
    settings.selected = id;
    stopPlacing();
    syncSettings();
    $('drawingPlaneAxis').focus();
    queueDrawing();
  };
  $('drawingPlaneAxis').onchange = (event) => {
    const plane = currentPlane();
    plane.axis = event.target.value;
    plane.floor = null;
    plane.offset = plane.axis === 'horizontal' ? 1.2 : 0;
    syncSettings();
    queueDrawing();
  };
  $('drawingFloor').onchange = (event) => {
    const plane = currentPlane(),
      selected = event.target.value;
    if (selected === '') plane.offset = planeHeight(plane);
    else if (plane.floor == null && Math.abs(plane.offset) > settings.storey)
      plane.offset = Math.round(mod(plane.offset, settings.storey) * 10) / 10;
    plane.floor = selected === '' ? null : Number(selected);
    movePlane(plane.offset);
  };
  $('centerDrawingPlane').onclick = () => movePlane(0);
  $('drawingPlaneAngle').onchange = (event) => {
    currentPlane().angle = Number.isFinite(event.target.valueAsNumber)
      ? mod(event.target.valueAsNumber, 360)
      : currentPlane().angle;
    event.target.value = currentPlane().angle;
    queueDrawing();
  };
  function movePlane(value) {
    const plane = currentPlane();
    if (Number.isFinite(value)) {
      const [min, max] = offsetLimits(plane);
      plane.offset = Math.round(clamp(value, min, max) * 10) / 10;
    }
    syncOffset(plane);
    queueDrawing();
  }
  $('drawingPlaneMove').oninput = (event) => movePlane(event.target.valueAsNumber);
  let sliderPointer = false;
  $('drawingPlaneMove').onpointerdown = () => {
    sliderPointer = true;
  };
  $('drawingPlaneMove').onpointercancel = $('drawingPlaneMove').onkeydown = () => {
    sliderPointer = false;
  };
  $('drawingPlaneMove').onchange = (event) => {
    const plane = currentPlane();
    if (sliderPointer && plane.axis === 'vertical') {
      const reach = +event.target.max - +event.target.min;
      if (Math.abs(plane.offset) <= clamp((reach * 4) / event.target.clientWidth, 0.25, 2.5))
        movePlane(0);
    }
    sliderPointer = false;
  };
  $('drawingPlaneOffset').onchange = (event) => movePlane(event.target.valueAsNumber);
  $('flipDrawingPlane').onchange = (event) => {
    currentPlane().flip = event.target.checked;
    queueDrawing();
  };
  $('alignDrawingPlane').onclick = () => {
    selectSheetView('aligned');
    clipMenu.open = false;
    $('clipMenuToggle').focus();
  };
  $('placeDrawingPlane').onclick = () => {
    placing = !placing;
    $('placeDrawingPlane').setAttribute('aria-pressed', String(placing));
    sheet.dataset.placing = String(placing);
    if (placing) {
      clipMenu.open = false;
      sheet.focus({ preventScroll: true });
    }
    showStatus();
  };
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && placing) {
      stopPlacing();
      showStatus();
    }
  });
  function moveDrawing(x, y) {
    settings.placement.x += x;
    settings.placement.y += y;
    queueDrawing();
  }
  function sheetPoint(event) {
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(
      sheet.getScreenCTM().inverse()
    );
  }
  sheet.addEventListener('keydown', (event) => {
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
      event.key
    ];
    if (!delta || placing || allPlans()) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 2;
    moveDrawing(delta[0] * step, delta[1] * step);
  });
  sheet.addEventListener('pointerdown', (event) => {
    if (placing || !loading.hidden || !rendered || allPlans() || event.button !== 0) return;
    drag = { id: event.pointerId, start: sheetPoint(event), x: 0, y: 0 };
    sheet.focus({ preventScroll: true });
    sheet.setPointerCapture(event.pointerId);
    sheet.dataset.dragging = 'true';
    setDrawingOutputAvailable(false);
  });
  sheet.addEventListener('pointermove', (event) => {
    if (drag?.id !== event.pointerId) return;
    const at = sheetPoint(event);
    drag.x = at.x - drag.start.x;
    drag.y = at.y - drag.start.y;
    // Preview the last rendered strokes while dragging and recalculate visibility at the new crop.
    content.setAttribute('transform', `translate(${drag.x} ${drag.y})`);
  });
  sheet.addEventListener('lostpointercapture', (event) => {
    if (drag?.id !== event.pointerId) return;
    if (drag.x || drag.y)
      moveDrawing(
        (drag.x * 25.4) / DRAWING_PIXELS_PER_INCH,
        (drag.y * 25.4) / DRAWING_PIXELS_PER_INCH
      );
    else if (loading.hidden) setDrawingOutputAvailable(rendered.populated);
    drag = null;
    sheet.dataset.dragging = 'false';
  });
  sheet.addEventListener('click', (event) => {
    if (!placing || !rendered || !loading.hidden) return;
    const point = sheetPoint(event);
    const { basis, width, height, depth, scale, originX, originY } = rendered;
    if (point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) return;
    const z = depth[Math.floor(point.y) * width + Math.floor(point.x)],
      normal = normalFor(currentPlane()),
      toward = dot(normal, basis.back);
    if (!Number.isFinite(z) && Math.abs(toward) > 0.1) {
      status.textContent = 'Click a visible surface or enter an offset.';
      return;
    }
    const offset =
      ((point.x - originX) / scale) * dot(normal, basis.right) -
      ((point.y - originY) / scale) * dot(normal, basis.up) +
      (Number.isFinite(z) ? z * toward : 0);
    stopPlacing();
    movePlane(offset - floorDatum(currentPlane()));
  });

  function exportArtwork(item, target, chunkSize, crop) {
    if (item.localName === 'path') {
      // The renderer packs disconnected strokes into each path. Bound the number of subpaths per
      // object so large sheets remain practical to select and edit in a vector application.
      const strokes = drawingExportStrokes(item.getAttribute('d'), crop, Number(item.getAttribute('stroke-width')) || 0);
      for (let first = 0; first < strokes.length; first += chunkSize) {
        const path = item.cloneNode(false);
        path.removeAttribute('id');
        path.setAttribute('d', strokes.slice(first, first + chunkSize).join(''));
        target.append(path);
      }
      return;
    }
    target.append(item.cloneNode(true));
  }

  function vectorDrawingSheet({
    includePaper = exportPaper.checked,
    includeAnnotations = exportAnnotations.checked,
    chunkSize = exportPaths.value === 'individual' ? 1 : 256
  } = {}) {
    const { width, height } = paperDimensions();
    const root = svgElement('svg', {
      version: '1.1',
      width: width + 'in',
      height: height + 'in',
      viewBox: sheet.getAttribute('viewBox')
    });
    const title = svgElement('title', {}),
      layers = new Map();
    title.textContent = `${footerTitle.textContent} · 1:${rendered.denominator}`;
    root.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:inkscape', layerNS);
    root.setAttribute('data-poly-nation-export', '2');
    root.append(title);
    if (includePaper) root.append(paperLayer.cloneNode(true));

    // SVG groups contain geometrically cropped artwork so Illustrator needs no clipping masks.
    function addRegion(source, crop, placement, number, makeFills) {
      for (const template of source.children) {
        const previewWash = template.dataset.layer === 'Colour wash',
          name = previewWash ? 'Colour fills' : template.dataset.layer;
        if (!layers.has(name)) layers.set(name, markSvgLayer(template.cloneNode(false), name));
        const part = svgElement('g', {});
        if (placement) {
          part.setAttribute('transform', placement);
          part.setAttribute('data-floor', number + 1);
        }
        if (previewWash) {
          for (const { fill, d } of makeFills?.() || []) {
            const id = `Fill_${number + 1}_${fill.slice(1)}`;
            part.append(svgElement('path', { id, fill, d }));
          }
        } else {
          for (const item of template.children) exportArtwork(item, part, chunkSize, crop);
        }
        if (part.hasChildNodes()) layers.get(name).append(part);
      }
    }

    const labels = markSvgLayer(svgElement('g', {}), 'Floor labels');
    if (allPlans()) {
      // Keep each floor in its own positioned group inside each exported pen layer.
      [...floorTiles.children].forEach((tile, i) => {
        const [area, label] = tile.children,
          x = tile.getAttribute('x'),
          y = tile.getAttribute('y'),
          crop = svgElement('rect', {});
        for (const attribute of ['x', 'y', 'width', 'height'])
          crop.setAttribute(attribute, area.getAttribute(attribute));
        const placement = `translate(${x} ${y})`;
        addRegion(area, crop, placement, i, rendered.regionFills[i]);
        const caption = label.cloneNode(true);
        caption.setAttribute('transform', placement);
        if (includeAnnotations) labels.append(caption);
      });
    } else addRegion(sheetArtwork, clipRect.cloneNode(true), null, 0, rendered.exportFills);

    root.append(...[...layers.values(), labels].filter((layer) => layer.hasChildNodes()));
    if (includeAnnotations) {
      root.append(footer.cloneNode(true));
      outlineDrawingLabels(root);
    }
    // The ASCII IDs survive import in editors that ignore the readable Inkscape layer labels.
    [...root.children]
      .filter((node) => node.localName === 'g')
      .forEach((layer, i) => {
        const order = String(i + 1).padStart(2, '0'),
          name = layer.dataset.layer.replace(/ · /g, ' ').replace(/\./g, 'p').replace(/[^a-zA-Z0-9_]+/g, '_');
        layer.id = `PN_${order}_${name}`;
        [...layer.querySelectorAll('[data-floor]')].forEach((region) => {
          region.id = `${layer.id}_floor_${region.dataset.floor}`.replace(/^PN_/, 'Floor_');
        });
      });
    return root;
  }

  function drawingFilename(extension) {
    const view = allPlans() ? 'floor-plans' : settings.view;
    const paper = customPapers.get(settings.paper);
    return `${fileStem(sheetTitle())}-${view}-${paper ? fileStem(paper.name) : settings.paper}-1-${rendered.denominator}.${extension}`;
  }
  exportButton.onclick = () => {
    downloadBlob(
      new XMLSerializer().serializeToString(convertDrawingSvgToPoints(vectorDrawingSheet())),
      'image/svg+xml',
      drawingFilename('svg')
    );
  };
  bluebeamButton.onclick = async () => {
    exportingPdf = bluebeamButton.disabled = true;
    bluebeamButton.textContent = 'Preparing PDF…';
    bluebeamButton.setAttribute('aria-busy', 'true');
    try {
      const file = drawingFilename('pdf');
      const paper = paperDimensions();
      const svg = vectorDrawingSheet({ includePaper: true, includeAnnotations: true, chunkSize: 256 });
      const pdf = await createBluebeamPdf(svg, paper);
      downloadBlob(pdf, 'application/pdf', file);
    } catch (error) {
      console.error('PDF export failed', error);
      if (loading.hidden) status.textContent = 'The PDF could not be prepared. Try exporting again.';
    } finally {
      exportingPdf = false;
      bluebeamButton.disabled = exportButton.disabled;
      bluebeamButton.textContent = 'PDF for Bluebeam';
      bluebeamButton.removeAttribute('aria-busy');
    }
  };
  printButton.onclick = () => {
    const { width, height } = paperDimensions();
    pageStyle.textContent = `@page { size: ${width}in ${height}in; margin: 0; }`;
    window.print();
  };
  $('printFloorSet').onclick = async () => {
    if (!geometry || settings.view !== 'plan') return;
    const button = $('printFloorSet'),
      pages = $('floorPrintPages'),
      paper = paperDimensions(),
      plans = floorPlans(),
      model = sourceModel,
      camera = viewCamera(),
      { scale, glazing, mode, pens, bodies } = settings;
    printingFloorSet = button.disabled = true;
    button.textContent = 'Preparing floor set…';
    try {
      const denominator = floorSetScale(plans, camera, paper, null, scale, glazing, bodies, pens);
      const sheets = [];
      for (const { planes, label } of plans) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (sourceModel !== model) return;
        const frame = renderDrawing(
          geometryFor(camera, planes, glazing, bodies, pens),
          camera,
          planes,
          paper,
          denominator,
          glazing,
          { x: 0, y: 0, ground: false, center: true },
          mode,
          pens
        );
        const page = floorView(frame, sheetTitle() + ' \u00b7 ' + label, 0, 0, true);
        page.setAttribute('width', paper.width + 'in');
        page.setAttribute('height', paper.height + 'in');
        sheets.push(page);
      }
      if (panel.hidden) return;
      pages.replaceChildren(...sheets);
      document.body.classList.add('printing-floor-set');
      pageStyle.textContent = `@page { size: ${paper.width}in ${paper.height}in; margin: 0; }`;
      window.print();
    } catch (error) {
      console.error('Floor set failed', error);
      status.textContent = 'The floor set could not be prepared.';
    } finally {
      printingFloorSet = false;
      button.disabled = !loading.hidden;
      button.textContent = 'Print floor set';
    }
  };
  window.addEventListener('afterprint', () => {
    pageStyle.textContent = '';
    document.body.classList.remove('printing-floor-set');
    $('floorPrintPages').replaceChildren();
  });
  const fileStem = (text) => text.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'drawing';
  function clampPlanes() {
    for (const plane of settings.planes) {
      plane.floor = Number.isInteger(plane.floor) ? clamp(plane.floor, 0, floorCount() - 1) : null;
      plane.offset = clamp(plane.offset, ...offsetLimits(plane));
    }
  }
  function fillFloors() {
    $('drawingFloor').replaceChildren(
      new Option('Project datum', ''),
      ...Array.from(
        { length: floorCount() },
        (_, i) =>
          new Option(
            (i === 0 ? 'Ground floor' : 'Level ' + (i + 1)) +
              ' \u00b7 ' +
              (i * settings.storey).toFixed(1) +
              ' m',
            String(i)
          )
      )
    );
    const plane = currentPlane();
    if (plane) $('drawingFloor').value = plane.floor == null ? '' : String(plane.floor);
  }

  // Called by the app with each imported (or re-filtered) model. 'fresh' marks a different file.
  function load(model, fresh = true, identity) {
    sourceModel = model;
    geometry = null;
    if (fresh) {
      if (identity !== modelIdentity) {
        modelIdentity = identity;
        base = null;
        try {
          const saved = JSON.parse(localStorage.getItem(viewsStorageKey()));
          savedViews = Array.isArray(saved)
            ? saved.filter((view) => typeof view?.name === 'string' && Array.isArray(view.settings?.planes))
            : [];
        } catch {
          savedViews = [];
        }
        viewName.value = '';
        savedViewMessage('');
        refreshSavedViews();
      }
      titleFields[0].value = model.name;
      titleFields[1].value = titleFields[2].value = '';
      settings.planSheet = 'single';
      settings.viewHeadings = {};
      if (model.defaultStoreyHeight) settings.storey = model.defaultStoreyHeight;
      try {
        const working = JSON.parse(localStorage.getItem(activeStorageKey()));
        if (Array.isArray(working?.settings?.planes)) restoreSnapshot(working);
      } catch {
        // A missing or unreadable working sheet starts with the current preferences.
      }
      for (const [key, [, portion]] of Object.entries(DRAWING_COMPONENTS))
        if (!Number.isInteger(settings.pens.components[key]))
          settings.pens.components[key] = Math.round((settings.pens.widths.length - 1) * portion);
    }
    clampPlanes();
    fillFloors();
    stopPlacing();
    syncSettings();
    queueDrawing();
  }

  // Remember the 3D view as the drawing's base. Selecting it also restores the captured direction
  // and clears sheet panning. Manual scales then use the captured target as their centre.
  function setBase(snapshot, select) {
    if (select || !base) base = snapshot;
    if (select) {
      settings.view = 'nav';
      settings.orbitLocked = true;
      orientationStatus.hidden = true;
      settings.placement = { x: 0, y: 0, ground: false, center: false };
      stopPlacing();
    }
    syncSettings();
    queueDrawing();
  }
  $('useNavView').onclick = () => setBase(viewer.snapshot(), true);

  load.setBase = setBase;
  load.refresh = queueDrawing;
  return load;
})();
