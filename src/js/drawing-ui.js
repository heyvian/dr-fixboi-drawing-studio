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
    expandButton = $('expandDrawing'),
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
    projectionNames = { axo: 'Axonometric', plan: 'Plan', elevation: 'Elevation', nav: 'Captured view', aligned: 'Cut' },
    viewNames = Object.keys(projectionNames);
  const customPaperStorageKey = storageKey + '-paper-sizes';
  const customPapers = new Map();
  const validPaperSide = (inches) => Number.isFinite(inches) && inches >= 4 - 1e-8 && inches <= 48 + 1e-8;
  const validCustomPaper = (preset) => typeof preset?.id === 'string' && /^custom-[0-9a-f-]+$/.test(preset.id) &&
    typeof preset.name === 'string' && preset.name.trim() && validPaperSide(preset.width) && validPaperSide(preset.height) &&
    ['in', 'mm'].includes(preset.unit);
  function registerCustomPaper(preset) {
    customPapers.set(preset.id, preset);
    paperSizes[preset.id] = [Math.min(preset.width, preset.height), Math.max(preset.width, preset.height)];
  }
  try {
    const storedPapers = JSON.parse(localStorage.getItem(customPaperStorageKey));
    if (Array.isArray(storedPapers)) {
      for (const preset of storedPapers) {
        if (validCustomPaper(preset)) registerCustomPaper(preset);
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
  const perspectiveMarker = svgElement('g', { id: 'perspectiveOriginMarker', display: 'none', 'aria-hidden': 'true', 'pointer-events': 'none' });
  for (const [stroke, width] of [['#ffffff', 4], ['#53326f', 2]]) {
    const pen = { stroke, 'stroke-width': width, 'vector-effect': 'non-scaling-stroke' };
    perspectiveMarker.append(svgElement('line', { x1: -11, x2: 11, ...pen }), svgElement('line', { y1: -11, y2: 11, ...pen }));
  }
  sheet.append(clip, paperLayer, drawingArea, footer, perspectiveMarker);
  document.head.append(pageStyle);
  for (const scale of DRAWING_SCALES)
    $('drawingScale').add(new Option(`1:${scale}`, String(scale)));

  const cutTreatments = ['none', 'solid', 'diagonal', 'crosshatch'];
  const validHatchSpacing = (spacing) => clamp(Math.round(spacing * 10) / 10, 0.5, 20);
  function sectionPreferences(saved = {}) {
    const position = saved.sectionPoint;
    return {
      sectionProjection: saved.sectionProjection === 'perspective' ? 'perspective' : 'orthographic',
      sectionLens: Number.isFinite(saved.sectionLens) ? clamp(Math.round(saved.sectionLens), 8, 200) : 35,
      sectionOrigin: saved.sectionOrigin === 'camera' ? 'camera' : 'sheet',
      sectionPoint: Array.isArray(position) && position.length === 2 && position.every(Number.isFinite)
        ? position.map((value) => clamp(value, 0, 1)) : [0.5, 0.5],
      sectionCamera: validSavedCamera(saved.sectionCamera) ? structuredClone(saved.sectionCamera) : null,
      perspectiveFade: Number.isFinite(saved.perspectiveFade) ? clamp(saved.perspectiveFade, 0, 100) : 55,
      cutTreatment: cutTreatments.includes(saved.cutTreatment) ? saved.cutTreatment : saved.cutFill === false ? 'none' : 'solid',
      cutColor: paintHex(saved.cutColor) || '#000000',
      hatchSpacing: Number.isFinite(saved.hatchSpacing) ? validHatchSpacing(saved.hatchSpacing) : 2
    };
  }
  let settings = {
      ...sectionPreferences(),
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
    placing = null,
    perspectivePickPoint = null,
    drag = null;
  function readDrawingSettings(saved) {
    const previousElevation = ['front', 'side'].includes(saved.view);
    const headings = Object.fromEntries(['axo', 'plan', 'elevation'].flatMap((view) => {
      const heading = saved.viewHeadings?.[view] ?? saved.viewHeading;
      return Number.isFinite(heading) ? [[view, mod(heading, 360)]] : [];
    }));
    const planes = saved.planes.filter((plane) => plane && Number.isFinite(plane.id) && Number.isFinite(plane.offset) &&
      Number.isFinite(plane.angle) && ['horizontal', 'vertical'].includes(plane.axis)).map(({ id, offset, angle, axis, floor, flip }) =>
      ({ id, offset, angle: mod(angle, 360), axis, floor: Number.isInteger(floor) ? clamp(floor, 0, 59) : null, flip: flip === true }));
    return {
      ...sectionPreferences(saved),
      view: previousElevation ? 'elevation' : viewNames.includes(saved.view) ? saved.view : 'axo',
      viewHeadings: headings,
      orbitLocked: saved.orbitLocked === true,
      elevation: Number.isFinite(saved.elevation) ? mod(saved.elevation, 360) : saved.view === 'side' ? 315 : 225,
      storey: Number.isFinite(saved.storey) ? clamp(saved.storey, 1, 20) : 3.5,
      bodies: ['layer', 'object', 'none'].includes(saved.bodies) ? saved.bodies : 'layer',
      azimuth: Number.isInteger(saved.azimuth) && COMPASS_POINTS[saved.azimuth] ? saved.azimuth : 5,
      paper: Object.hasOwn(paperSizes, saved.paper) ? saved.paper : 'letter',
      orientation: saved.orientation === 'portrait' ? 'portrait' : 'landscape',
      scale: DRAWING_SCALES.includes(Number(saved.scale)) ? String(saved.scale) : 'auto',
      mode: ['linework', 'color', 'flat'].includes(saved.mode) ? saved.mode : 'linework',
      placement: {
        x: Number.isFinite(saved.placement?.x) ? saved.placement.x : 0,
        y: Number.isFinite(saved.placement?.y) ? saved.placement.y : 0,
        ground: saved.placement?.ground === true,
        center: saved.placement?.center === true
      },
      planSheet: saved.planSheet === 'floors' ? 'floors' : 'single',
      glazing: saved.glazing === true,
      pens: drawingPens(saved.pens),
      selected: Number.isFinite(saved.selected) ? saved.selected : null,
      planes
    };
  }
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(saved?.planes)) settings = readDrawingSettings(saved);
  } catch {
    // Drawing controls remain available when the browser blocks local storage.
  }

  const viewList = $('savedViews'), viewName = $('savedViewName'), viewStatus = $('savedViewStatus'),
    viewDialog = $('savedViewDialog'), viewError = $('savedViewError');
  let selectedViewName = '', viewAction = '';
  const viewsStorageKey = () => storageKey + '-views-' + modelIdentity;
  const activeStorageKey = () => storageKey + '-active-' + modelIdentity;
  const titleFields = [$('drawingTitle'), $('drawingNumber'), $('drawingRevision')];
  const modelFrameScale = (model) => model.sourceReference?.frameScale ?? model.units.metresPerUnit;
  let hiddenLayerKeys = new Set(), layerColours = new Map();

  // Update settings for present layers only. Missing layers keep their overrides across revisions.
  function rememberLayers() {
    for (const { key, visible, overrideColor } of sourceModel.layers) {
      if (visible) hiddenLayerKeys.delete(key);
      else hiddenLayerKeys.add(key);
      if (overrideColor) layerColours.set(key, overrideColor);
      else layerColours.delete(key);
    }
  }
  function applyLayers(layers) {
    for (const layer of layers) {
      layer.visible = !hiddenLayerKeys.has(layer.key);
      layer.overrideColor = layerColours.get(layer.key) ?? '';
    }
  }
  function currentSnapshot() {
    rememberLayers();
    return {
      settings,
      base,
      metresPerUnit: sourceModel.units.metresPerUnit,
      frameScale: modelFrameScale(sourceModel),
      titles: titleFields.map((field) => field.value),
      hiddenLayers: [...hiddenLayerKeys],
      layerColours: Object.fromEntries(layerColours)
    };
  }
  function projectDrawingState() {
    const working = currentSnapshot();
    const paperIds = new Set([working, ...savedViews].map((snapshot) => snapshot.settings.paper));
    return {
      working,
      views: savedViews,
      papers: [...paperIds].map((id) => customPapers.get(id)).filter(Boolean),
      export: exportPanel.preferences()
    };
  }
  function restoreProjectDrawings(project) {
    const paperIds = new Map();
    const presets = Array.isArray(project.papers) ? project.papers.filter(validCustomPaper) : [];
    for (const { id, name, width, height, unit } of presets) {
      const existing = customPapers.get(id);
      const match = [...customPapers.values()].find((preset) =>
        preset.name === name && preset.width === width && preset.height === height && preset.unit === unit);
      const localId = match?.id ?? (existing ? `custom-${projectIdentifier()}` : id);
      paperIds.set(id, localId);
      if (!match) registerCustomPaper({ id: localId, name, width, height, unit });
    }
    syncCustomPaperChoices();
    const mapPaper = (snapshot) => ({ ...snapshot,
      settings: { ...snapshot.settings, paper: paperIds.get(snapshot.settings.paper) ?? snapshot.settings.paper } });
    const names = new Set();
    savedViews = [];
    for (const snapshot of project.views) {
      const name = typeof snapshot?.name === 'string' ? snapshot.name.trim().slice(0, 80) : '';
      if (!name || names.has(name.toLowerCase()) || !Array.isArray(snapshot.settings?.planes)) continue;
      names.add(name.toLowerCase());
      savedViews.push({ ...mapPaper(snapshot), name });
    }
    refreshSavedViews();
    restoreSnapshot(mapPaper(project.working));
    if (project.export) exportPanel.restore(project.export);
    try {
      localStorage.setItem(customPaperStorageKey, JSON.stringify([...customPapers.values()]));
      localStorage.setItem(viewsStorageKey(), JSON.stringify(savedViews));
    } catch {
      // The project file remains available when this browser cannot persist a working copy.
    }
  }
  function rescaleCapturedView(ratio) {
    if (ratio === 1) return;
    for (const camera of [base, settings.sectionCamera]) {
      if (!camera) continue;
      camera.target = camera.target.map((coordinate) => coordinate * ratio);
      camera.halfWidth *= ratio;
      camera.halfHeight *= ratio;
    }
  }
  function restoreSnapshot(snapshot) {
    const camera = snapshot.base;
    base = validSavedCamera(camera) ? structuredClone(camera) : null;
    settings = readDrawingSettings(snapshot.settings);
    // Projects saved before model replacement used the source unit scale as their frame scale.
    const savedScale = snapshot.frameScale ?? snapshot.metresPerUnit;
    if (Number.isFinite(savedScale) && savedScale > 0)
      rescaleCapturedView(modelFrameScale(sourceModel) / savedScale);
    titleFields.forEach((field, i) => { field.value = typeof snapshot.titles?.[i] === 'string' ? snapshot.titles[i] : ''; });
    if (modelIdentity === 'sample:valentine' && titleFields[0].value === 'The Valentine')
      titleFields[0].value = sourceModel.name;
    hiddenLayerKeys = new Set(Array.isArray(snapshot.hiddenLayers) ? snapshot.hiddenLayers.filter((key) => typeof key === 'string') : []);
    // Views from before layer recolouring leave the current colours in place.
    if (snapshot.layerColours && typeof snapshot.layerColours === 'object')
      layerColours = new Map(Object.entries(snapshot.layerColours).map(([key, color]) => [key, paintHex(color)])
        .filter(([, color]) => color));
    applyLayers(sourceModel.layers);
  }
  function refreshSavedViews(selection = '') {
    viewList.replaceChildren(...savedViews.map(({ name, settings: saved }) => {
      const row = document.createElement('button'), label = document.createElement('strong'), detail = document.createElement('small');
      row.type = 'button';
      row.className = 'saved-view-row';
      row.dataset.name = name;
      label.textContent = name;
      const projection = saved.view === 'aligned' && saved.sectionProjection === 'perspective'
        ? 'Perspective cut' : projectionNames[saved.view] || 'Drawing';
      detail.textContent = `${projection} · ${saved.scale === 'auto' || !saved.scale ? 'Auto fit' : `1:${saved.scale}`}`;
      row.append(label, detail);
      row.onclick = () => {
        selectSavedView(name);
        savedViewMessage('');
      };
      row.ondblclick = openSavedView;
      row.onkeydown = (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        selectSavedView(name);
        openSavedView();
      };
      return row;
    }));
    $('savedViewsEmpty').hidden = Boolean(savedViews.length);
    $('savedViewCount').textContent = savedViews.length;
    selectSavedView(selection);
  }
  function selectSavedView(name) {
    selectedViewName = name;
    for (const row of viewList.children) row.setAttribute('aria-pressed', String(row.dataset.name === name));
    for (const id of ['recallView', 'updateView', 'renameView', 'deleteView']) $(id).disabled = !name;
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
  function openSavedView() {
    const snapshot = savedViews.find(({ name }) => name === selectedViewName);
    if (!snapshot) return;
    stopPlacing();
    restoreSnapshot(snapshot);
    load.onApplyLayers?.();
    geometry = null;
    fillFloors();
    syncSettings();
    load.onOpenSavedView?.();
    queueDrawing();
    savedViewMessage(`Opened “${snapshot.name}”.`);
  }
  $('recallView').onclick = openSavedView;
  for (const [button, action, title, confirm] of [
    ['newView', 'create', 'Save drawing view', 'Save view'], ['renameView', 'rename', 'Rename drawing view', 'Rename view'],
    ['updateView', 'update', 'Update drawing view', 'Update view'], ['deleteView', 'delete', 'Delete drawing view', 'Delete view']
  ]) {
    $(button).onclick = () => {
      viewAction = action;
      const needsName = action === 'create' || action === 'rename';
      const note = $('savedViewDialogNote');
      note.hidden = needsName;
      note.textContent = action === 'update' ? `Replace “${selectedViewName}” with the current drawing settings?` :
        `Remove “${selectedViewName}” from the project browser?`;
      viewError.hidden = true;
      $('savedViewNameField').hidden = !needsName;
      $('savedViewDialogTitle').textContent = title;
      $('saveView').textContent = confirm;
      $('saveView').classList.toggle('delete-confirm', action === 'delete');
      viewName.value = action === 'rename' ? selectedViewName : '';
      viewDialog.showModal();
      if (needsName) viewName.select();
      else $('cancelViewAction').focus();
    };
  }
  $('cancelViewAction').onclick = () => viewDialog.close();
  $('savedViewForm').onsubmit = (event) => {
    event.preventDefault();
    const needsName = viewAction === 'create' || viewAction === 'rename';
    const name = needsName ? viewName.value.trim() : selectedViewName;
    if (needsName && (!name || savedViews.some((view) =>
      view.name.toLowerCase() === name.toLowerCase() && (viewAction !== 'rename' || view.name !== selectedViewName)))) {
      viewError.textContent = name ? 'That name is already in use.' : 'Enter a name for this view.';
      viewError.hidden = false;
      viewName.focus();
      return;
    }
    let next = savedViews.slice();
    const index = next.findIndex((view) => view.name === selectedViewName);
    const snapshot = () => ({ name, ...structuredClone(currentSnapshot()) });
    if (viewAction === 'create') next.push(snapshot());
    else if (viewAction === 'rename') next[index] = { ...next[index], name };
    else if (viewAction === 'update') next[index] = snapshot();
    else next.splice(index, 1);
    const deleted = viewAction === 'delete';
    const verb = { create: 'Saved', rename: 'Renamed', update: 'Updated', delete: 'Deleted' }[viewAction];
    viewDialog.close();
    persistViews(next, deleted ? '' : name, `${verb} “${name}”.`);
    (deleted ? $('newView') : [...viewList.children].find((row) => row.dataset.name === name))?.focus();
  };

  // Storeys are measured from the project's original ground datum.
  const floorCount = () => clamp(Math.ceil(sourceModel.elevations[1] / settings.storey - 1e-6), 1, 60);
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

  const previewDialog = $('sheetPreviewDialog'), previewViewport = $('sheetPreviewViewport'),
    previewContent = $('sheetPreviewContent'), previewZoomOut = $('sheetPreviewZoomOut'), previewZoomIn = $('sheetPreviewZoomIn');
  let previewZoom = 1;
  function resizeExpandedSheet(zoom = previewZoom) {
    if (!previewDialog.open) return;
    const page = previewContent.firstElementChild;
    const { width, height } = page.viewBox.baseVal;
    const viewport = previewViewport.getBoundingClientRect(), before = page.getBoundingClientRect();
    const css = getComputedStyle(previewContent);
    const paddingX = parseFloat(css.paddingLeft) + parseFloat(css.paddingRight);
    const paddingY = parseFloat(css.paddingTop) + parseFloat(css.paddingBottom);
    const fit = Math.min((previewViewport.clientWidth - paddingX) / width, (viewport.height - paddingY) / height);
    if (!(fit > 0)) return;
    const centerX = viewport.left + viewport.width / 2, centerY = viewport.top + viewport.height / 2;
    const x = clamp((centerX - before.left) / before.width, 0, 1);
    const y = clamp((centerY - before.top) / before.height, 0, 1);
    previewZoom = clamp(zoom, 1, 4);
    page.style.width = `${width * fit * previewZoom}px`;
    page.style.height = `${height * fit * previewZoom}px`;
    const after = page.getBoundingClientRect();
    previewViewport.scrollLeft += after.left + after.width * x - centerX;
    previewViewport.scrollTop += after.top + after.height * y - centerY;
    $('sheetPreviewZoom').value = `${Math.round(previewZoom * 100)}%`;
    previewZoomOut.setAttribute('aria-disabled', String(previewZoom === 1));
    previewZoomIn.setAttribute('aria-disabled', String(previewZoom === 4));
  }
  expandButton.onclick = () => {
    // Copy the live sheet so preview scrolling and zoom never edit the working sheet.
    const page = sheet.cloneNode(true);
    page.querySelector('#perspectiveOriginMarker').remove();
    for (const attribute of ['id', 'style', 'tabindex', 'aria-describedby', 'data-dragging', 'data-placing'])
      page.removeAttribute(attribute);
    page.setAttribute('class', 'expanded-sheet-page');
    for (const item of page.querySelectorAll('[id]')) item.removeAttribute('id');
    page.querySelector('clipPath').id = 'expandedSheetClip';
    page.querySelector(`[clip-path="url(#${clip.id})"]`).setAttribute('clip-path', 'url(#expandedSheetClip)');
    previewContent.replaceChildren(page);
    $('sheetPreviewContext').textContent = `${sheetTitle()} · ${$('sheetViewContext').textContent}`;
    previewDialog.showModal();
    resizeExpandedSheet(1);
    previewViewport.scrollTo(0, 0);
  };
  $('closeSheetPreview').onclick = () => previewDialog.close();
  previewDialog.onclose = () => previewContent.replaceChildren();
  previewZoomOut.onclick = () => resizeExpandedSheet(previewZoom - 0.5);
  previewZoomIn.onclick = () => resizeExpandedSheet(previewZoom + 0.5);
  $('sheetPreviewFit').onclick = () => resizeExpandedSheet(1);
  previewViewport.onkeydown = (event) => {
    const value = { '+': previewZoom + 0.5, '=': previewZoom + 0.5, '-': previewZoom - 0.5, '0': 1 }[event.key];
    if (value === undefined || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    resizeExpandedSheet(value);
  };
  new ResizeObserver(() => resizeExpandedSheet()).observe(previewViewport);

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
  function offsetLimits(plane, includeCurrent = true) {
    const reach = Math.ceil(sourceModel.reach + 2);
    const [min, max] = plane.axis === 'horizontal'
      ? [
          Math.floor(Math.min(0, sourceModel.elevations[0])) - floorDatum(plane),
          Math.ceil(Math.max(0, sourceModel.elevations[1])) - floorDatum(plane)
        ]
      : [-reach, reach];
    // An existing cut can legitimately sit outside the extents of a revised model.
    return includeCurrent ? [Math.min(min, plane.offset), Math.max(max, plane.offset)] : [min, max];
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
      if (plane.axis === 'horizontal') return { az: -Math.PI / 2, el: (plane.flip ? -1 : 1) * Math.PI / 2 };
      return { az: (plane.angle * Math.PI) / 180 + (plane.flip ? Math.PI : 0), el: 0 };
    }
    // Plan north is world +Z. Moving clockwise on the compass follows the plan axes.
    return { az: azimuth ?? compassAzimuth(settings.azimuth * 45), el: 0.57 };
  }
  const compass = $('drawingCompass');
  const orientationStatus = $('orientationStatus');
  const sheetViewButtons = [...$('sheetViews').querySelectorAll('[data-sheet-view]')];
  for (const button of sheetViewButtons) {
    button.onclick = () => {
      selectSheetView(button.dataset.sheetView, true);
      if (button.dataset.sheetView === 'aligned') selectInspectorTab($('clipMenuToggle'));
    };
  }
  const showHeading = createViewCompass(compass, (heading) => {
    settings.viewHeadings[settings.view] = heading;
    orientationStatus.hidden = true;
    syncCompass();
    queueDrawing();
  });
  function syncCompass() {
    const elevation = settings.view === 'elevation';
    const plan = settings.view === 'plan';
    $('drawingOrientationGroup').hidden = settings.view !== 'axo' && !elevation && !plan;
    $('drawingOrientationHelp').hidden = false;
    compass.setAttribute('aria-label', plan ? 'Plan orientation compass' : 'View direction compass');
    $('drawingOrbitField').hidden = !elevation;
    $('useNavView').disabled = !viewer.ok;
    for (const button of sheetViewButtons) {
      const view = button.dataset.sheetView;
      button.disabled = (view === 'nav' && !base) || (view === 'aligned' && !currentPlane());
      button.setAttribute('aria-pressed', String(view === settings.view));
    }
    const heading = compassHeading(viewCamera().az + (plan ? Math.PI : 0));
    $('drawingOrbit').value = heading;
    $('drawingOrbitAngle').textContent = heading + '°';
    showHeading(heading, plan);
    $('drawingPlanSheetField').hidden = settings.view !== 'plan';
    $('drawingPlanSheet').value = settings.planSheet;
    sheet.classList.toggle('planset', allPlans());
    $('placeDrawingPlane').disabled = allPlans();
    $('centerDrawing').disabled = allPlans();
    syncSectionControls();
  }
  $('syncViewOrientations').onclick = () => {
    const heading = compassHeading(viewCamera().az + (settings.view === 'plan' ? Math.PI : 0));
    settings.viewHeadings = { axo: heading, plan: heading, elevation: heading };
    orientationStatus.hidden = false;
    orientationStatus.textContent = 'Direction copied to Axonometric, Plan, and Elevation.';
    syncCompass();
    queueDrawing();
  };

  const sectionProjection = $('drawingSectionProjection'), lensSlider = $('drawingSectionLens');
  const perspectiveOrigin = $('drawingPerspectiveOrigin'), perspectiveCameraStatus = $('drawingPerspectiveCameraStatus');
  const lensPosition = (mm) => Math.round(1000 * Math.log(mm / 8) / Math.log(200 / 8));
  const lensMillimetres = (position) => Math.round(8 * (200 / 8) ** (position / 1000));
  const lensStops = [8, 14, 20, 24, 28, 35, 50, 85, 105, 135, 200];
  $('drawingLensTicks').replaceChildren(...lensStops.map((mm) => new Option(`${mm} mm`, lensPosition(mm))));
  const perspectiveOpacity = () => (100 - settings.perspectiveFade) / 100;
  function syncPerspectiveFade() {
    const value = `${settings.perspectiveFade}%`;
    $('drawingPerspectiveFade').value = settings.perspectiveFade;
    $('drawingPerspectiveFade').setAttribute('aria-valuetext', value);
    $('drawingPerspectiveFadeValue').value = value;
  }
  function syncSectionControls() {
    const plane = currentPlane();
    const kind = plane?.axis === 'horizontal' ? 'Plan' : 'Section';
    const aligned = settings.view === 'aligned' && Boolean(plane);
    $('drawingSectionView').hidden = !aligned;
    $('drawingCutProjectionHint').hidden = aligned;
    $('drawingProjectionTitle').textContent = `${kind} projection`;
    sectionProjection.options[1].text = `${kind} perspective`;
    sectionProjection.value = settings.sectionProjection;
    $('drawingSectionLensField').hidden = settings.sectionProjection !== 'perspective';
    $('drawingSectionLensNumber').value = settings.sectionLens;
    lensSlider.value = lensPosition(settings.sectionLens);
    lensSlider.setAttribute('aria-valuetext', `${settings.sectionLens} millimetres`);
    syncPerspectiveOrigin();
    syncPerspectiveFade();
    syncCutStyle();
  }
  function syncPerspectiveOrigin() {
    const useCamera = settings.sectionOrigin === 'camera';
    perspectiveOrigin.value = settings.sectionOrigin;
    $('drawingPerspectiveSheet').hidden = useCamera;
    $('drawingPerspectiveCamera').hidden = !useCamera;
    $('capturePerspectiveCamera').disabled = !viewer.ok;
  }
  function setPerspectivePoint(position) {
    settings.sectionPoint = position.map((value) => Math.round(clamp(value, 0, 1) * 1000) / 1000);
    queueDrawing();
  }
  perspectiveOrigin.onchange = (event) => {
    stopPlacing();
    settings.sectionOrigin = event.target.value;
    if (settings.sectionOrigin === 'camera' && !settings.sectionCamera && viewer.ok)
      settings.sectionCamera = viewer.snapshot();
    syncPerspectiveOrigin();
    queueDrawing();
  };
  $('capturePerspectiveCamera').onclick = () => {
    settings.sectionCamera = viewer.snapshot();
    queueDrawing();
  };
  $('centerPerspectiveOrigin').onclick = () => {
    stopPlacing();
    setPerspectivePoint([0.5, 0.5]);
  };
  function facingCutIndex(camera, planes) {
    const { back } = orbitBasis(camera);
    let index = -1, cutLimit = Infinity;
    for (const [i, { normal, flip, offset }] of planes.entries()) {
      const sign = flip ? -1 : 1;
      if (sign * dot(normal, back) > 0.999999 && sign * offset < cutLimit) {
        cutLimit = sign * offset;
        index = i;
      }
    }
    return index;
  }
  function sectionView(camera, planes) {
    const plane = settings.view === 'aligned' ? currentPlane() : null;
    const planeIndex = plane ? settings.planes.indexOf(plane) : facingCutIndex(camera, planes);
    if (planeIndex < 0) return null;
    return {
      planeIndex,
      lens: plane && settings.sectionProjection === 'perspective' ? settings.sectionLens : 0,
      sheetPoint: settings.sectionPoint,
      useCamera: settings.sectionOrigin === 'camera',
      camera: settings.sectionCamera ?? base,
      cutTreatment: settings.cutTreatment,
      hatchSpacing: settings.hatchSpacing
    };
  }
  function syncCutStyle() {
    const { cutTreatment, cutColor, hatchSpacing } = settings;
    $('drawingCutStyle').hidden = !allPlans() && !sectionView(viewCamera(), drawingClips(settings.planes));
    $('drawingCutTreatment').value = cutTreatment;
    $('drawingCutColor').value = cutColor;
    $('drawingHatchSpacing').value = hatchSpacing;
    $('drawingCutFields').hidden = cutTreatment === 'none';
    $('drawingHatchField').hidden = !['diagonal', 'crosshatch'].includes(cutTreatment);
  }
  sectionProjection.onchange = (event) => {
    stopPlacing();
    settings.sectionProjection = event.target.value;
    syncSectionControls();
    queueDrawing();
  };
  $('drawingCutTreatment').onchange = (event) => {
    settings.cutTreatment = event.target.value;
    syncCutStyle();
    queueDrawing();
  };
  $('drawingCutColor').onchange = (event) => {
    settings.cutColor = event.target.value;
    queueDrawing();
  };
  $('drawingHatchSpacing').onchange = (event) => {
    const { valueAsNumber } = event.target;
    if (Number.isFinite(valueAsNumber)) settings.hatchSpacing = validHatchSpacing(valueAsNumber);
    event.target.value = settings.hatchSpacing;
    queueDrawing();
  };
  $('drawingPerspectiveFade').oninput = (event) => {
    settings.perspectiveFade = event.target.valueAsNumber;
    syncPerspectiveFade();
    for (const stroke of sheetArtwork.querySelectorAll('[data-perspective-stroke]'))
      stroke.setAttribute('stroke-opacity', perspectiveOpacity());
    saveDrawing();
    checkSheetContrast();
  };
  function setLens(mm) {
    settings.sectionLens = clamp(Math.round(mm), 8, 200);
    $('drawingSectionLensNumber').value = settings.sectionLens;
    lensSlider.setAttribute('aria-valuetext', `${settings.sectionLens} millimetres`);
    queueDrawing();
  }
  let lensPointer = false;
  lensSlider.onpointerdown = () => { lensPointer = true; };
  lensSlider.onpointercancel = lensSlider.onkeydown = () => { lensPointer = false; };
  lensSlider.oninput = () => setLens(lensMillimetres(lensSlider.valueAsNumber));
  lensSlider.onchange = () => {
    const position = lensSlider.valueAsNumber;
    const stop = lensStops.find((mm) => Math.abs(lensPosition(mm) - position) <= 18);
    if (lensPointer && stop !== undefined) {
      lensSlider.value = lensPosition(stop);
      setLens(stop);
    }
    lensPointer = false;
  };
  $('drawingSectionLensNumber').onchange = (event) => {
    const mm = event.target.valueAsNumber;
    setLens(Number.isFinite(mm) ? mm : settings.sectionLens);
    lensSlider.value = lensPosition(settings.sectionLens);
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
    const preferred = dot(rgb(paper), [0.21, 0.72, 0.07]) < 0.45 ? '#ebeee8' : '#243c30';
    return accessibleInk(preferred, paper, 4.5);
  }

  const contrastPanel = $('sheetContrast'), contrastStatus = $('sheetContrastStatus'),
    contrastResults = $('sheetContrastResults'), applyContrast = $('applySheetContrast');
  let contrastSuggestions = new Map(), recommendedFade = null;
  function checkSheetContrast() {
    if (!contrastPanel.open) return;
    if (!loading.hidden) {
      contrastStatus.textContent = 'Checking the current sheet…';
      contrastResults.hidden = applyContrast.disabled = true;
      return;
    }
    const paper = settings.pens.paper;
    const entries = new Map();
    for (const mark of sheet.querySelectorAll('[data-contrast-ink]')) {
      const key = mark.dataset.contrastInk;
      const faded = mark.hasAttribute('data-perspective-stroke');
      const opacity = faded ? perspectiveOpacity() : 1;
      if (!opacity) continue;
      entries.set(`${key}/${faded}`, { key, faded, opacity, ink: mark.getAttribute('stroke') || mark.getAttribute('fill') });
    }
    const fails = [...entries.values()].map((entry) => ({ ...entry, ratio: paperContrast(entry.ink, paper, entry.opacity) }))
      .filter(({ ratio }) => ratio < 3);
    recommendedFade = settings.perspectiveFade;
    if (fails.some(({ faded }) => faded)) {
      // Find the strongest fade that still permits black or white ink to reach the target.
      const maxContrast = (fade) => Math.max(...['#000000', '#ffffff'].map((ink) => paperContrast(ink, paper, (100 - fade) / 100)));
      while (recommendedFade > 0 && maxContrast(recommendedFade) < 3) recommendedFade--;
    }
    contrastSuggestions = new Map();
    for (const { key, faded, ink } of fails.sort((a, b) => Number(a.faded) - Number(b.faded))) {
      const opacity = faded ? (100 - recommendedFade) / 100 : 1;
      contrastSuggestions.set(key, accessibleInk(ink, paper, 3, opacity));
    }
    const ratioLabel = (ratio) => `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;
    const labels = ratioLabel(paperContrast(sheetInk(paper), paper));
    contrastStatus.textContent = !entries.size ? 'Draw something to check the sheet ink.' : fails.length
      ? `${fails.length} ink ${fails.length === 1 ? 'treatment needs' : 'treatments need'} more contrast. Labels ${labels}.`
      : `Visible ink passes the paper contrast check. Labels ${labels}.`;
    contrastResults.replaceChildren(...fails.map(({ key, faded, ink, ratio }) => {
      const item = document.createElement('li');
      const label = key === 'cut' ? 'Cut fill or hatch' : DRAWING_DETAIL_PENS[key]?.label ||
        (settings.pens.mode === 'rhino' ? 'Rhino print ink' : `Pen ${Number(key.split('-')[1]) + 1}`);
      const suggested = contrastSuggestions.get(key);
      item.textContent = `${label}${faded ? ' behind cut' : ''} · ${ratioLabel(ratio)}${suggested !== ink ? ` → ${suggested}` : ''}`;
      return item;
    }));
    if (recommendedFade !== settings.perspectiveFade) {
      const item = document.createElement('li');
      item.textContent = `Lighten beyond cut · ${settings.perspectiveFade}% → ${recommendedFade}%`;
      contrastResults.append(item);
    }
    contrastResults.hidden = !contrastResults.children.length;
    applyContrast.disabled = !fails.length;
  }
  contrastPanel.ontoggle = checkSheetContrast;
  applyContrast.onclick = () => {
    for (const [key, ink] of contrastSuggestions) {
      if (key === 'cut') settings.cutColor = ink;
      else if (Object.hasOwn(settings.pens.detailPens, key)) settings.pens.detailPens[key].color = ink;
      else settings.pens.colors[Number(key.split('-')[1])] = ink;
    }
    settings.perspectiveFade = recommendedFade;
    syncPenControls();
    syncCutStyle();
    syncPerspectiveFade();
    applyContrast.disabled = true;
    contrastStatus.focus();
    queueDrawing();
  };

  function drawingNorthArrow({ right, up }, x, y, ink) {
    // The drawing's north is +Z (Rhino +Y). Project it onto the sheet so the arrow follows orbit and cut views.
    const projected = Math.hypot(right[2], up[2]),
      northX = right[2] / projected,
      northY = -up[2] / projected,
      angle = (Math.atan2(northX, -northY) * 180) / Math.PI;
    const arrow = svgElement('g', { role: 'img', 'aria-label': 'North arrow', 'data-north-arrow': '' });
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
    endLabel.textContent = metres < 1 ? `${Math.round(metres * 1000)} mm` : `${metres} m`;
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

  function renderPens(target, frame, identified = false, vector = false) {
    const { pens, ink, section, perspective, cutFills, cutHatch, heaviest, palette: { widths, colors } } = frame;
    const strokes = perspective ? [[perspective, true], [frame, false]] : [[frame, false]];
    const colorLayer = markSvgLayer(svgElement('g', {}), vector ? 'Colour fills' : 'Colour wash');
    if (vector) appendColourFills(colorLayer, frame.exportFills, 0);
    else if (frame.wash)
      colorLayer.append(
        svgElement('image', { width: frame.width, height: frame.height, href: frame.wash })
      );
    const textureLayer = markSvgLayer(svgElement('g', {}), 'Surface texture');
    function path(d, width, stroke, contrastInk, receding = false) {
      const line = svgElement('path', {
        d,
        fill: 'none',
        stroke,
        'stroke-width': (width * DRAWING_PIXELS_PER_INCH) / 25.4,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'data-contrast-ink': contrastInk
      });
      if (receding) {
        line.setAttribute('data-perspective-stroke', '');
        line.setAttribute('stroke-opacity', perspectiveOpacity());
      }
      return line;
    }
    const layers = [colorLayer, textureLayer];
    const firstInk = ink.findIndex((mark, i) => mark || perspective?.ink[i]);
    const order = widths.map((_, i) => i).sort((a, b) => widths[a] - widths[b]);
    const penKey = (i) => `pen-${pens.mode === 'rhino' ? 0 : i}`;
    for (const i of order) {
      const width = widths[i],
        stroke = colors[i];
      for (const [paths, receding] of strokes)
        if (paths.texture[i]) textureLayer.append(path(paths.texture[i], width, stroke, penKey(i), receding));
      const layer = markSvgLayer(
        svgElement('g', { 'data-weight-mm': width }),
        pens.mode === 'rhino' ? `Rhino print width · ${width} mm` : `Pen ${i + 1} · ${width.toFixed(2)} mm`
      );
      for (const [paths, receding] of strokes) {
        if (!paths.ink[i]) continue;
        const linework = path(paths.ink[i], width, stroke, penKey(i), receding);
        if (identified && i === firstInk && !layer.hasChildNodes()) linework.id = 'drawingLinework';
        layer.append(linework);
      }
      layers.push(layer);
      if (i === heaviest && perspective?.section)
        layer.append(path(perspective.section, width, stroke, penKey(i), true));
    }
    for (const [key, field] of [
      ['componentOutlines', 'componentInk'],
      ['silhouette', 'silhouetteInk'],
      ['groundLine', 'groundLine']
    ]) {
      const { width, color } = pens.detailPens[key];
      const layer = markSvgLayer(svgElement('g', { 'data-weight-mm': width }), DRAWING_DETAIL_PENS[key].label);
      for (const [paths, receding] of strokes)
        if (paths[field]) layer.append(path(paths[field], width, color, key, receding));
      if (layer.hasChildNodes()) layers.push(layer);
    }
    if (cutFills?.length) {
      const hatched = settings.cutTreatment !== 'solid';
      const fills = markSvgLayer(svgElement('g', { fill: hatched ? pens.paper : settings.cutColor }),
        hatched ? 'Cut hatch backing' : 'Cut fill');
      if (!hatched) fills.dataset.contrastInk = 'cut';
      for (const d of cutFills) fills.append(svgElement('path', { d, 'fill-rule': 'nonzero' }));
      layers.push(fills);
      if (cutHatch) {
        const hatch = markSvgLayer(svgElement('g', {}), 'Cut hatch');
        const pattern = path(cutHatch, 0.15, settings.cutColor, 'cut');
        pattern.setAttribute('stroke-linecap', 'butt');
        hatch.append(pattern);
        layers.push(hatch);
      }
    }
    if (section) {
      const cuts = markSvgLayer(svgElement('g', { 'data-weight-mm': widths[heaviest] }), 'Section cuts');
      const cut = path(section, widths[heaviest], colors[heaviest], penKey(heaviest));
      if (identified) cut.id = 'drawingSections';
      cuts.append(cut);
      layers.push(cuts);
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
    renderPens(area, frame, false, print);
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
        region, null, sectionView(camera, planes)
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
        section = sectionView(camera, clips),
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
            framing,
            section
          );
      if (!next || !currentRender(revision)) return;
      rendered = next;
      const { width, height, margin, denominator } = rendered,
        ruleY = height - margin * 1.8,
        textY = height - margin,
        viewLabel = allPlans()
          ? 'Floor plans'
          : settings.view === 'aligned'
            ? next.optics
              ? `${currentPlane()?.axis === 'horizontal' ? 'Plan' : 'Section'} perspective · ${section.lens} mm`
              : currentPlane()?.axis === 'vertical' ? 'Section' : 'Plan section'
            : projectionNames[settings.view];
      $('sheetViewContext').textContent = `${viewLabel} · 1:${denominator}`;
      sheet.setAttribute('aria-label', `${viewLabel} drawing sheet, scale 1 to ${denominator}`);
      // Keep SVG coordinates tied to the exact physical paper size. Only raster buffers round to pixels.
      const pageWidth = paper.width * DRAWING_PIXELS_PER_INCH,
        pageHeight = paper.height * DRAWING_PIXELS_PER_INCH;
      sheet.setAttribute('viewBox', `0 0 ${pageWidth} ${pageHeight}`);
      updatePerspectiveMarker();
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
      setDrawingOutputAvailable(rendered.populated, true);
      resizePaperPreview();
      setDrawingProgress('');
      const cameraNote = next.perspectiveCameraFallback
        ? 'The camera is unavailable or behind the cut. Using the point on the sheet.'
        : next.optics && section?.useCamera ? 'Using the captured 3D camera.' : '';
      if (perspectiveCameraStatus.textContent !== cameraNote) perspectiveCameraStatus.textContent = cameraNote;
      perspectiveCameraStatus.hidden = !cameraNote;
      showStatus();
      checkSheetContrast();
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
    if (placing) {
      status.textContent = placing === 'eye'
        ? 'Click to place the point, or move it with the arrow keys and press Enter.'
        : 'Click the drawing to place the selected plane.';
      return;
    }
    status.textContent = rendered?.cropped
      ? allPlans()
        ? 'Some plans extend past their panels. Use Fit to scale the set.'
        : 'Drawing extends past the sheet. Drag to choose the part to export.'
      : !rendered?.populated
        ? 'No printable geometry is visible on this sheet.'
        : allPlans()
          ? 'Floor plans share a drawing scale.'
          : base && settings.scale !== 'auto' && !settings.placement.center &&
              (settings.view === 'nav' || (settings.view !== 'aligned' && settings.orbitLocked))
            ? 'Using the captured 3D framing. Drag the drawing or use the arrow keys to pan the sheet.'
            : 'Drag the drawing or use the arrow keys to reposition it.';
  }
  function setDrawingOutputAvailable(available, ready = false) {
    expandButton.disabled = !available;
    exportPanel.setAvailable(available, ready && settings.view === 'plan' ? floorCount() : 0);
  }
  function queueDrawing() {
    saveDrawing();
    setDrawingOutputAvailable(false);
    clearTimeout(timer);
    timer = 0;
    const revision = ++renderRevision;
    if (currentRender(revision)) {
      setDrawingProgress(allPlans() ? 'Preparing floor plans…' : 'Generating drawing…');
      checkSheetContrast();
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
  function setPlacementMode(mode) {
    placing = mode;
    perspectivePickPoint = mode === 'eye' ? [...settings.sectionPoint] : null;
    $('placeDrawingPlane').setAttribute('aria-pressed', String(mode === 'plane'));
    $('placePerspectiveOrigin').setAttribute('aria-pressed', String(mode === 'eye'));
    sheet.dataset.placing = String(Boolean(mode));
    updatePerspectiveMarker();
  }
  function stopPlacing() { setPlacementMode(null); }
  function updatePerspectiveMarker() {
    perspectiveMarker.setAttribute('display', perspectivePickPoint ? 'inline' : 'none');
    if (perspectivePickPoint) {
      const [left, top] = perspectivePickPoint;
      const { width, height } = sheet.viewBox.baseVal;
      perspectiveMarker.setAttribute('transform', `translate(${left * width} ${top * height})`);
    }
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

  function depthBoundaryLimits(boundaries, index) {
    return [Math.ceil(((boundaries[index - 1] ?? 0) + 1) * 10) / 10,
      Math.floor(((boundaries[index + 1] ?? 100) - 1) * 10) / 10];
  }
  const depthControls = Array.from({ length: DRAWING_PEN_PRESETS.length - 2 }, (_, index) => {
    const row = document.createElement('div'), label = document.createElement('label'),
      slider = document.createElement('input'), field = document.createElement('span'), number = document.createElement('input'),
      unit = document.createElement('span');
    row.className = 'depth-boundary';
    slider.id = `depthBoundary${index + 1}`;
    slider.type = 'range';
    Object.assign(slider, { min: 1, max: 99, step: 0.1 });
    slider.setAttribute('aria-describedby', 'drawingDepthHelp');
    label.htmlFor = slider.id;
    number.id = `depthBoundaryValue${index + 1}`;
    number.type = 'number';
    number.step = 'any';
    field.className = 'depth-percent';
    unit.textContent = '%';
    unit.setAttribute('aria-hidden', 'true');
    function changeBoundary(event) {
      const boundaries = settings.pens.depthBreaks;
      const value = event.target.valueAsNumber;
      if (Number.isFinite(value)) {
        boundaries[index] = clamp(Math.round(value * 10) / 10, ...depthBoundaryLimits(boundaries, index));
        queueDrawing();
      }
      syncPenDepth();
    }
    slider.oninput = number.onchange = changeBoundary;
    field.append(number, unit);
    row.append(label, slider, field);
    $('drawingDepthBoundaries').append(row);
    return { row, label, slider, number };
  });
  $('drawingDepthReset').onclick = () => {
    settings.pens.depthBreaks = drawingDepthBoundaries(settings.pens.widths.length);
    syncPenDepth();
    queueDrawing();
  };

  function syncPenDepth() {
    const pens = settings.pens;
    if (pens.mode !== 'distance') return;
    const { widths, depthBreaks } = pens, ranked = drawingPensByWeight(widths);
    const row = $('drawingDepthBands'), strip = $('drawingDepthStrip');
    $('drawingDepthAdjust').hidden = !depthBreaks.length;
    row.replaceChildren();
    strip.replaceChildren();
    const percent = (depth) => `${Number(depth.toFixed(1))}%`;
    ranked.forEach((index, band) => {
      const from = depthBreaks[band - 1] ?? 0, to = depthBreaks[band] ?? 100;
      const segment = document.createElement('span');
      segment.style.flexBasis = `${to - from}%`;
      segment.style.setProperty('--depth-stroke', `${Math.max(1, 7 * widths[index] / widths[ranked[0]])}px`);
      strip.append(segment);
      row.append(penLegendRow(`Pen ${index + 1} · ${widths[index].toFixed(2)} mm`, `${percent(from)}–${percent(to)}`));
    });
    depthControls.forEach(({ row, label, slider, number }, index) => {
      const value = depthBreaks[index];
      row.hidden = value === undefined;
      if (row.hidden) return;
      const first = ranked[index] + 1, next = ranked[index + 1] + 1;
      label.textContent = `Pen ${first} to Pen ${next}`;
      label.title = `Where Pen ${first} ends and Pen ${next} begins`;
      const [min, max] = depthBoundaryLimits(depthBreaks, index);
      Object.assign(number, { min, max });
      number.setAttribute('aria-label', `Pen ${first} to Pen ${next} boundary in percent`);
      slider.value = number.value = Number(value.toFixed(1));
      slider.setAttribute('aria-valuetext', percent(value));
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
    $('drawingCustomPens').hidden = useRhino;
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
          sample = document.createElement('i'),
          number = document.createElement('input'),
          color = document.createElement('input');
        row.className = 'drawing-pen-row';
        name.className = 'pen-sample-label';
        name.textContent = `Pen ${i + 1}`;
        sample.className = 'pen-sample';
        sample.setAttribute('aria-hidden', 'true');
        const showSample = () => {
          sample.style.setProperty('--sample-width', `${pens.widths[i]}mm`);
          sample.style.setProperty('--sample-ink', pens.colors[i]);
          sample.style.setProperty('--sample-paper', pens.paper);
        };
        showSample();
        number.type = 'number';
        color.type = 'color';
        color.value = pens.colors[i];
        color.setAttribute('aria-label', `Pen ${i + 1} colour`);
        color.onchange = () => {
          pens.colors[i] = color.value;
          showSample();
          syncPenDepth();
          queueDrawing();
        };
        Object.assign(number, DRAWING_PEN_LIMITS);
        number.value = width;
        number.setAttribute('aria-label', `Pen ${i + 1} width in millimetres`);
        const update = (value) => {
          const next = Number.isFinite(value)
            ? clamp(value, DRAWING_PEN_LIMITS.min, DRAWING_PEN_LIMITS.max)
            : pens.widths[i];
          pens.widths[i] = next;
          number.value = next;
          showSample();
          for (const select of components.querySelectorAll('select'))
            select.options[i].textContent = `Pen ${i + 1} · ${next.toFixed(2)} mm`;
          syncPenDepth();
          queueDrawing();
        };
        number.onchange = () => update(number.valueAsNumber);
        name.append(sample);
        row.append(name, number, color);
        return row;
      })
    );
  }
  $('drawingPenMode').onchange = (event) => {
    settings.pens.mode = event.target.value;
    syncPenControls();
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
    syncPenControls();
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
    syncCutStyle();
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
    syncCutStyle();
    queueDrawing();
  };
  $('alignDrawingPlane').onclick = () => {
    selectSheetView('aligned');
    $('drawingSectionProjection').focus();
  };
  function togglePlacement(mode) {
    setPlacementMode(placing === mode ? null : mode);
    if (placing) sheet.focus({ preventScroll: true });
    showStatus();
  }
  $('placeDrawingPlane').onclick = () => togglePlacement('plane');
  $('placePerspectiveOrigin').onclick = () => togglePlacement('eye');
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
    if (placing === 'eye') {
      if (delta) {
        event.preventDefault();
        const step = event.shiftKey ? 0.05 : 0.01;
        perspectivePickPoint = perspectivePickPoint.map((value, i) => clamp(value + delta[i] * step, 0, 1));
        updatePerspectiveMarker();
      } else if (event.key === 'Enter' && rendered && loading.hidden) {
        event.preventDefault();
        const point = perspectivePickPoint;
        stopPlacing();
        setPerspectivePoint(point);
      }
      return;
    }
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
    else if (loading.hidden) setDrawingOutputAvailable(rendered.populated, true);
    drag = null;
    sheet.dataset.dragging = 'false';
  });
  sheet.addEventListener('click', (event) => {
    if (!placing || !rendered || !loading.hidden) return;
    const point = sheetPoint(event);
    if (placing === 'eye') {
      const { width, height } = sheet.viewBox.baseVal;
      stopPlacing();
      setPerspectivePoint([point.x / width, point.y / height]);
      return;
    }
    const { basis, width, height, depth, scale, originX, originY, optics } = rendered;
    if (point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) return;
    const z = depth[Math.floor(point.y) * width + Math.floor(point.x)],
      normal = normalFor(currentPlane()),
      toward = dot(normal, basis.back);
    if (!Number.isFinite(z) && (optics || Math.abs(toward) > 0.1)) {
      status.textContent = 'Click a visible surface or enter an offset.';
      return;
    }
    const [x, y, viewDepth] = optics ? optics.unproject([point.x, point.y, z]) : [point.x, point.y, z];
    const offset =
      ((x - originX) / scale) * dot(normal, basis.right) -
      ((y - originY) / scale) * dot(normal, basis.up) +
      (Number.isFinite(viewDepth) ? viewDepth * toward : 0);
    stopPlacing();
    movePlane(offset - floorDatum(currentPlane()));
  });

  function exportArtwork(item, target, chunkSize, crop) {
    if (item.localName === 'path' && !item.hasAttribute('fill-rule')) {
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

  function appendColourFills(target, makeFills, number) {
    for (const { fill, d } of makeFills?.() || []) {
      const id = `Fill_${number + 1}_${fill.slice(1)}`;
      target.append(svgElement('path', { id, fill, d }));
    }
  }

  function vectorDrawingSheet({
    includePaper = true,
    includeAnnotations = true,
    chunkSize = 256
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
        if (previewWash) appendColourFills(part, makeFills, number);
        else {
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
    const view = allPlans() ? 'floor-plans' : rendered.optics
      ? currentPlane()?.axis === 'horizontal' ? 'plan-perspective' : 'section-perspective'
      : settings.view;
    const paper = customPapers.get(settings.paper);
    return `${fileStem(sheetTitle())}-${view}-${paper ? fileStem(paper.name) : settings.paper}-1-${rendered.denominator}.${extension}`;
  }
  const drawingPrintPages = $('drawingPrintPages');
  function printPages(sheets, { width, height }) {
    drawingPrintPages.replaceChildren(...sheets);
    document.body.classList.add('printing-drawing');
    pageStyle.textContent = `@page { size: ${width}in ${height}in; margin: 0; }`;
    window.print();
  }

  async function prepareFloorPrint(signal, report) {
    const paper = paperDimensions(), plans = floorPlans(), revision = renderRevision, camera = viewCamera();
    const { scale, glazing, mode, pens, bodies } = settings;
    const denominator = floorSetScale(plans, camera, paper, null, scale, glazing, bodies, pens);
    const sheets = [];
    for (const [index, { planes, label }] of plans.entries()) {
      report(`Preparing floor ${index + 1} of ${plans.length}…`);
      await yieldForDrawingOutput();
      signal.throwIfAborted();
      if (!currentRender(revision)) throw Error('The drawing changed while preparing the floor set. Try printing again.');
      const frame = renderDrawing(
        geometryFor(camera, planes, glazing, bodies, pens), camera, planes, paper, denominator, glazing,
        { x: 0, y: 0, ground: false, center: true }, mode, pens, null, null, sectionView(camera, planes)
      );
      const page = floorView(frame, `${sheetTitle()} · ${label}`, 0, 0, true);
      page.setAttribute('width', paper.width + 'in');
      page.setAttribute('height', paper.height + 'in');
      page.setAttribute('viewBox', `0 0 ${paper.width * DRAWING_PIXELS_PER_INCH} ${paper.height * DRAWING_PIXELS_PER_INCH}`);
      outlineDrawingLabels(page);
      sheets.push(page);
    }
    return sheets;
  }

  const exportPanel = createSheetExportPanel({
    storageKey: storageKey + '-export',
    getSheet() {
      const paper = paperDimensions(), preset = customPapers.get(settings.paper),
        label = preset?.name ?? paperPicker.selectedOptions[0].textContent.split(' · ')[0],
        unit = preset?.unit ?? (settings.paper.startsWith('a') ? 'mm' : 'in'),
        factor = unit === 'mm' ? 25.4 : 1;
      const size = [paper.width, paper.height].map((side) =>
        (side * factor).toLocaleString(undefined, { maximumFractionDigits: 2 })).join(' × ');
      return { title: sheetTitle(), view: $('sheetViewContext').textContent, paper, paperLabel: `${label} · ${size} ${unit}`, scale: settings.scale };
    },
    artwork: vectorDrawingSheet,
    filename: drawingFilename,
    prepareFloors: prepareFloorPrint,
    printSheets: printPages
  });
  window.addEventListener('afterprint', () => {
    pageStyle.textContent = '';
    document.body.classList.remove('printing-drawing');
    drawingPrintPages.replaceChildren();
  });
  const fileStem = (text) => text.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'drawing';
  function clampPlanes() {
    for (const plane of settings.planes) {
      plane.floor = Number.isInteger(plane.floor) ? clamp(plane.floor, 0, floorCount() - 1) : null;
      plane.offset = clamp(plane.offset, ...offsetLimits(plane, false));
    }
  }
  function fillFloors() {
    const count = settings.planes.reduce((maximum, { floor }) => Math.max(maximum, (floor ?? -1) + 1), floorCount());
    $('drawingFloor').replaceChildren(
      new Option('Project datum', ''),
      ...Array.from(
        { length: count },
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

  // A replacement is a new set of geometry in the existing project coordinate system. Unit
  // reinterpretation deliberately rescales the camera because it changes what the units mean.
  function load(model, { fresh = true, identity, project = null, replace = false } = {}) {
    const reuse = !fresh && sourceModel && model !== sourceModel;
    if (reuse) {
      rememberLayers();
      applyLayers(model.layers);
      if (!replace) rescaleCapturedView(modelFrameScale(model) / modelFrameScale(sourceModel));
    }
    sourceModel = model;
    geometry = null;
    let restored = false;
    if (fresh) {
      hiddenLayerKeys = new Set();
      layerColours = new Map();
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
        savedViewMessage('');
        refreshSavedViews();
      }
      titleFields[0].value = model.name;
      titleFields[1].value = titleFields[2].value = '';
      settings.planSheet = 'single';
      settings.viewHeadings = {};
      settings.sectionCamera = null;
      if (model.defaultStoreyHeight) settings.storey = model.defaultStoreyHeight;
      if (project) {
        restoreProjectDrawings(project);
        restored = true;
      }
      else {
        try {
          const working = JSON.parse(localStorage.getItem(activeStorageKey()));
          if (Array.isArray(working?.settings?.planes)) {
            restoreSnapshot(working);
            restored = true;
          }
        } catch {
          // A missing or unreadable working sheet starts with the current preferences.
        }
      }
    }
    const defaultPens = Object.fromEntries(Object.entries(DRAWING_COMPONENTS).map(([key, [, portion]]) =>
      [key, Math.round((settings.pens.widths.length - 1) * portion)]));
    settings.pens.components = { ...defaultPens, ...settings.pens.components };
    if (fresh && !restored) clampPlanes();
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
  load.projectState = projectDrawingState;
  return load;
})();
