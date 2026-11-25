// App bootstrap: wires file selection, drag and drop, import status messages and the layer list to
// the drawing workspace (drawing-ui.js).

(() => {
  const status = $('importStatus'),
    fileMenu = $('fileMenu'),
    fileMenuToggle = $('fileMenuToggle'),
    dropZone = $('dropZone'),
    fileInput = $('fileInput'),
    controls = $('drawingControls'),
    workspace = $('drawingsPhase'),
    fileName = $('fileName'),
    layerList = $('layerList'),
    unitSelect = $('unitSelect'),
    saveProject = $('saveProject');
  let current = null, // the model currently drawn
    lastFile = null, // remembered so changing the unit setting can re-read it
    projectId = null,
    projectName = '',
    busy = false,
    mode = 'draw'; // 'nav' (3D navigation) or 'draw' (the drawing sheet)

  // Seed a new sheet from the camera. Later camera changes reach the sheet on explicit capture.
  function setMode(next, capture = false) {
    const snapshot = viewer.ok && next === 'draw' ? viewer.snapshot() : null;
    mode = next;
    workspace.dataset.mode = next;
    $('navStage').hidden = next !== 'nav';
    $('drawingStage').hidden = next !== 'draw';
    $('skipViewport').href = next === 'nav' ? '#navCanvas' : '#drawingSheet';
    $('modeNav').setAttribute('aria-pressed', String(next === 'nav'));
    $('modeDraw').setAttribute('aria-pressed', String(next === 'draw'));
    if (next === 'nav') viewer.redraw();
    else if (snapshot) openDrawingWorkspace.setBase(snapshot, capture);
    else if (current) openDrawingWorkspace.refresh();
  }

  // Show a message under the header. 'kind' is '' (info), 'warn' or 'error'; 'lines' are bullet points.
  function say(text, kind = '', lines = []) {
    status.hidden = !text;
    status.className = 'import-status ' + kind;
    status.replaceChildren(document.createTextNode(text));
    if (lines.length) {
      const list = document.createElement('ul');
      for (const line of lines) list.append(Object.assign(document.createElement('li'), { textContent: line }));
      status.append(list);
    }
  }
  function setImportBusy(value) {
    busy = value;
    workspace.setAttribute('aria-busy', String(value));
    workspace.inert = value;
    for (const control of [$('openFile'), $('openFileZone'), $('openProject'), $('loadSample'), $('loadSampleZone')])
      control.disabled = value;
    unitSelect.disabled = value || !lastFile;
    saveProject.disabled = value || !current;
  }
  function loadingModel(message, done, total) {
    say(message, 'loading');
    const progress = document.createElement('progress');
    progress.className = 'studio-progress';
    progress.setAttribute('aria-label', 'Model import progress');
    if (total > 0) {
      progress.max = total;
      progress.value = done;
    }
    status.append(progress);
  }
  const yieldForImport = () => new Promise((resolve) => setTimeout(resolve, 20));

  // Hand a finished model to the workspace and rebuild the layer list.
  function show(model, label, identity, reinterpret = false, project = null) {
    const unitRatio = reinterpret ? model.units.metresPerUnit / current.units.metresPerUnit : 1;
    if (reinterpret) {
      const previousLayers = new Map(current.layers.map((layer) => [layer.key, layer]));
      for (const layer of model.layers) {
        const previous = previousLayers.get(layer.key);
        if (!previous) continue;
        layer.visible = previous.visible;
        layer.overrideColor = previous.overrideColor;
      }
    }
    current = model;
    controls.inert = false;
    dropZone.hidden = true;
    $('skipViewport').hidden = false;
    fileName.hidden = false;
    fileName.textContent = label;
    fileName.title = label;
    openDrawingWorkspace(model, !reinterpret, identity, project?.drawings);
    buildLayerList(model);
    if (reinterpret) {
      if (viewer.ok) viewer.setModel(model, false, unitRatio);
    } else if (viewer.ok) {
      for (const id of ['modeNav', 'modeDraw']) $(id).disabled = false;
      setMode('nav');
      viewer.setModel(model, true);
      if (Number.isInteger(model.initialAxonometric)) viewer.axo(model.initialAxonometric);
      if (project?.navigation) {
        viewer.restoreProject(project.navigation);
        const lines = viewer.lines;
        for (const box of document.querySelectorAll('#navLines [data-line]')) box.checked = lines[box.dataset.line];
        $('navCreaseAngle').value = lines.creaseAngle;
        $('navCreaseOut').textContent = `${lines.creaseAngle}°`;
      }
      if (project?.mode === 'draw') setMode('draw');
    } else setMode('draw');
    const { units } = model;
    unitSelect.value = units.choice;
    const unitSource = { file: 'from file', override: 'override', assumed: 'assumed', sample: 'sample' }[units.source];
    const unitNote = `${units.label} (${unitSource})`;
    const fileNote = units.source !== 'file' && units.fileLabel ? ` File specifies ${units.fileLabel.toLowerCase()}.` : '';
    const unitsUsed = $('modelUnitsUsed');
    unitsUsed.textContent = `Using ${unitNote.toLowerCase()}.${fileNote}`;
    unitsUsed.hidden = false;
    const height = model.height > 0 && model.height < 1
      ? `${(model.height * 1000).toLocaleString(undefined, { maximumSignificantDigits: 4 })} mm`
      : `${model.height.toFixed(1)} m`;
    const summary = `${label}: ${model.layers.length} layer${model.layers.length === 1 ? '' : 's'}, ${model.triangleCount.toLocaleString()} triangles, ${height} tall · ${unitNote}.`;
    if (model.warnings.length) say(summary, 'warn', model.warnings);
    else say(summary);
  }

  openDrawingWorkspace.onApplyLayers = () => {
    buildLayerList(current);
    if (viewer.ok) viewer.setModel(current, false);
  };
  openDrawingWorkspace.onOpenSavedView = () => {
    if (mode === 'nav') setMode('draw');
  };

  function refreshLayerGeometry(model) {
    openDrawingWorkspace(model, false);
    if (viewer.ok) viewer.setModel(model, false);
  }

  function buildLayerList(model) {
    $('layerCount').textContent = model.layers.length;
    layerList.replaceChildren(
      ...model.layers.map((layer) => {
        const row = document.createElement('div'),
          visibility = document.createElement('label'),
          box = document.createElement('input'),
          swatch = document.createElement('span'),
          color = document.createElement('input'),
          reset = document.createElement('button');
        const original = '#' + layer.color.map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0')).join('');
        row.className = 'layer-row';
        box.type = 'checkbox';
        box.checked = layer.visible;
        box.onchange = () => {
          layer.visible = box.checked;
          refreshLayerGeometry(model);
        };
        const count = layer.triangles ? `${layer.triangles.toLocaleString()} triangles` : `${layer.segments} lines`;
        visibility.title = `${layer.label} · ${count}`;
        visibility.append(box, layer.label);
        swatch.className = 'swatch';
        swatch.style.backgroundColor = original;
        swatch.title = `Original colour · ${original}`;
        swatch.setAttribute('role', 'img');
        swatch.setAttribute('aria-label', `Original colour for ${layer.label}, ${original}`);
        color.type = 'color';
        color.setAttribute('aria-label', `Colour for ${layer.label}`);
        reset.type = 'button';
        reset.className = 'layer-colour-reset';
        reset.textContent = 'Reset colour';
        reset.setAttribute('aria-label', `Reset colour for ${layer.label}`);
        function syncColor() {
          color.value = layer.overrideColor || original;
          color.title = `Current colour · ${color.value}`;
          reset.hidden = !layer.overrideColor;
        }
        color.onchange = () => {
          layer.overrideColor = color.value === original ? '' : color.value;
          syncColor();
          refreshLayerGeometry(model);
        };
        reset.onclick = () => {
          color.focus();
          layer.overrideColor = '';
          syncColor();
          refreshLayerGeometry(model);
        };
        syncColor();
        row.append(visibility, swatch, color, reset);
        return row;
      })
    );
  }

  // Read a user-chosen model or a model embedded in a project.
  async function readModel(file, unitChoice) {
    if (!file) {
      loadingModel('Building the sample model…');
      await yieldForImport();
      return sampleModel();
    }
    const base = file.name.replace(PROJECT_MODEL_EXTENSION, '');
    if (/\.obj$/i.test(file.name)) {
      loadingModel('Reading ' + file.name + '…');
      const contents = await file.text();
      loadingModel('Building geometry…');
      await yieldForImport();
      return importObj(contents, base, unitChoice);
    }
    if (!/\.3dm$/i.test(file.name)) throw Error('Choose a Rhino .3dm, OBJ, or Drawing Studio .fixboi project.');
    loadingModel('Loading the Rhino reader…');
    const rhino = await timed(loadRhino(), 45000);
    loadingModel('Reading ' + file.name + '…');
    const bytes = new Uint8Array(await file.arrayBuffer());
    return importRhino(rhino, bytes, base, unitChoice, (done, total) =>
      loadingModel(`Building geometry… ${done} of ${total} objects`, done, total));
  }

  async function openFile(file, { unitChoice = 'auto', reinterpret = false } = {}) {
    if (busy || !file) return;
    setImportBusy(true);
    unitSelect.value = unitChoice;
    try {
      let project = null;
      if (PROJECT_EXTENSION.test(file.name)) {
        loadingModel('Reading project…');
        project = await readDrawingProject(file);
      }
      const modelFile = project ? project.modelFile : file;
      const model = await readModel(modelFile, project?.units ?? unitChoice);
      loadingModel('Preparing the model view…');
      await yieldForImport();
      const identity = project ? `project:${project.id}` : JSON.stringify([file.name, file.size, file.lastModified]);
      const label = reinterpret && projectName ? `${projectName}.fixboi` : file.name;
      show(model, label, identity, reinterpret, project);
      lastFile = modelFile;
      if (!reinterpret) {
        projectId = project?.id ?? null;
        projectName = project ? file.name.replace(PROJECT_EXTENSION, '') : '';
      }
    } catch (error) {
      unitSelect.value = current?.units.choice ?? 'auto';
      console.error('Import failed', error);
      say(
        'Could not open ' + file.name + ': ' + (error && error.message ? error.message : error),
        'error',
        /download|fetch|import|network/i.test(String(error && error.message))
          ? ['The Rhino reader loads from a CDN, so an internet connection is needed the first time. An .obj file or the sample works offline.']
          : []
      );
    } finally {
      setImportBusy(false);
    }
  }

  async function openSample() {
    if (busy) return;
    setImportBusy(true);
    try {
      const model = await readModel(null);
      loadingModel('Preparing the model view…');
      await yieldForImport();
      show(model, model.name, 'sample:valentine');
      lastFile = null;
      projectId = null;
      projectName = '';
    } catch (error) {
      console.error('Sample failed', error);
      say('Could not build the sample: ' + error.message, 'error');
    } finally {
      setImportBusy(false);
    }
  }

  saveProject.onclick = () => {
    if (!current || busy) return;
    try {
      projectId ??= projectIdentifier();
      const project = makeDrawingProject(projectId, {
        drawings: openDrawingWorkspace.projectState(),
        mode,
        units: current.units.choice,
        navigation: viewer.ok ? viewer.projectState() : null
      }, lastFile);
      const name = (projectName || current.name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'Drawing Studio';
      downloadBlob(project, PROJECT_FILE_TYPE, `${name}.fixboi`);
      closeFileMenu(true);
    } catch (error) {
      console.error('Project save failed', error);
      say('Could not save the project: ' + error.message, 'error');
    }
  };

  function closeFileMenu(restoreFocus = false) {
    if (!fileMenu.open) return;
    fileMenu.open = false;
    if (restoreFocus) fileMenuToggle.focus();
  }
  document.addEventListener('pointerdown', (event) => {
    if (!fileMenu.contains(event.target)) closeFileMenu();
  });
  fileMenu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && fileMenu.open) {
      event.preventDefault();
      closeFileMenu(true);
    }
  });
  fileMenu.addEventListener('focusout', (event) => {
    if (event.relatedTarget && !fileMenu.contains(event.relatedTarget)) closeFileMenu();
  });
  $('openCredits').onclick = () => {
    closeFileMenu(true);
    $('studioCredits').showModal();
  };
  // Controls
  $('modeNav').onclick = () => mode !== 'nav' && setMode('nav');
  $('modeDraw').onclick = () => mode !== 'draw' && setMode('draw');
  $('navToDrawing').onclick = () => {
    setMode('draw', true);
    $('drawingSheet').focus({ preventScroll: true });
  };
  $('navExtents').onclick = () => viewer.zoomExtents();
  // "Set orbit centre" arms the next click on the 3D view; it disarms itself once a point is picked.
  if (viewer.ok) {
    for (const box of document.querySelectorAll('#navLines [data-line]'))
      box.onchange = () => viewer.setLines({ [box.dataset.line]: box.checked });
    $('navCreaseAngle').oninput = (event) => {
      $('navCreaseOut').textContent = `${event.target.value}°`;
      viewer.setLines({ creaseAngle: Number(event.target.value) });
    };
    const orientationStatus = $('navOrientationStatus');
    $('syncNavOrientations').onclick = () => {
      viewer.syncOrientations();
      orientationStatus.textContent = 'Direction copied to the 3D projections.';
      orientationStatus.hidden = false;
    };
    const showHeading = createViewCompass($('navAxoCompass'), (heading) => {
      const el = viewer.snapshot().el;
      if (el > Math.PI / 2 - 0.001) viewer.plan(heading);
      else if (el === 0 && viewer.activeAxo === null) viewer.elevation(heading);
      else viewer.axo(heading / 45);
    });
    const syncNavCompass = () => {
      orientationStatus.hidden = true;
      const { az, el } = viewer.snapshot();
      const axo = viewer.activeAxo !== null;
      const elevation = el === 0 && !axo;
      const plan = el > Math.PI / 2 - 0.001 && !axo;
      $('navViewContext').textContent = axo ? 'Axonometric' : elevation ? 'Elevation' : plan ? 'Plan' : 'Orbit';
      $('navAxoCompass').setAttribute('aria-label', plan ? '3D plan orientation compass' : '3D view direction compass');
      showHeading(axo || elevation || plan ? compassHeading(az + (plan ? Math.PI : 0)) : null, plan);
      document.querySelector('#navStage [data-view="iso"]').setAttribute('aria-pressed', String(axo));
      document.querySelector('#navStage [data-view="elevation"]').setAttribute('aria-pressed', String(elevation));
      document.querySelector('#navStage [data-view="top"]').setAttribute('aria-pressed', String(plan));
    };
    viewer.onMove = syncNavCompass;
    syncNavCompass();
    const setFocus = $('navSetFocus');
    viewer.onPick = () => setFocus.setAttribute('aria-pressed', 'false');
    setFocus.onclick = () => {
      const on = setFocus.getAttribute('aria-pressed') !== 'true';
      setFocus.setAttribute('aria-pressed', String(on));
      viewer.setPicking(on);
    };
  }
  for (const button of document.querySelectorAll('[data-view]'))
    button.onclick = () => viewer.preset(button.dataset.view);
  $('navStatus').textContent = 'Drag to orbit · Shift-drag to pan · Scroll to zoom';
  if (!viewer.ok) $('modeNav').hidden = $('modeDraw').hidden = true;
  setMode(viewer.ok ? 'nav' : 'draw');
  function pickFile(accept) {
    closeFileMenu(true);
    fileInput.accept = accept;
    fileInput.click();
  }
  $('openFile').onclick = () => pickFile('.3dm,.obj');
  $('openProject').onclick = () => pickFile('.fixboi');
  $('openFileZone').onclick = () => pickFile('.3dm,.obj,.fixboi');
  $('loadSample').onclick = () => {
    closeFileMenu(true);
    openSample();
  };
  $('loadSampleZone').onclick = openSample;
  fileInput.onchange = () => {
    openFile(fileInput.files[0]);
    fileInput.value = '';
  };
  // Changing the unit re-reads the last file so the new scale applies.
  unitSelect.onchange = () => {
    if (lastFile) openFile(lastFile, { unitChoice: unitSelect.value, reinterpret: true });
  };

  // Drag and drop anywhere on the page.
  let depth = 0;
  window.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    depth++;
    dropZone.hidden = false;
    dropZone.classList.add('dragging');
  });
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('dragleave', () => {
    if (--depth > 0) return;
    dropZone.classList.remove('dragging');
    dropZone.hidden = Boolean(current);
  });
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    depth = 0;
    dropZone.classList.remove('dragging');
    dropZone.hidden = Boolean(current);
    openFile(event.dataTransfer.files[0]);
  });
})();
