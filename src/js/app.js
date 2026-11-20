// App bootstrap: wires file selection, drag and drop, import status messages and the layer list to
// the drawing workspace (drawing-ui.js).

(() => {
  const status = $('importStatus'),
    dropZone = $('dropZone'),
    fileInput = $('fileInput'),
    controls = $('drawingControls'),
    workspace = $('drawingsPhase'),
    fileName = $('fileName'),
    layerList = $('layerList'),
    unitSelect = $('unitSelect');
  let current = null, // the model currently drawn
    lastFile = null, // remembered so changing the unit setting can re-read it
    busy = false,
    mode = 'draw', // 'nav' (3D navigation) or 'draw' (the drawing sheet)
    appliedRevision = 0; // the 3D camera revision the drawing was last based on

  // Switch between 3D navigation and the drawing sheet. Going to the drawing copies the 3D camera in
  // as its base when it has moved since (or when 'force' is set); sheet movements never flow back.
  function setMode(next, force = false) {
    const snapshot = viewer.ok && next === 'draw' ? viewer.snapshot() : null;
    mode = next;
    workspace.dataset.mode = next;
    $('navStage').hidden = next !== 'nav';
    $('drawingStage').hidden = next !== 'draw';
    $('modeNav').setAttribute('aria-pressed', String(next === 'nav'));
    $('modeDraw').setAttribute('aria-pressed', String(next === 'draw'));
    if (next === 'nav') viewer.redraw();
    else if (snapshot) {
      const moved = viewer.revision !== appliedRevision;
      appliedRevision = viewer.revision;
      openDrawingWorkspace.setBase(snapshot, moved || force);
    }
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

  // Hand a finished model to the workspace and rebuild the layer list.
  function show(model, label) {
    current = model;
    controls.inert = false;
    dropZone.hidden = true;
    fileName.hidden = false;
    fileName.textContent = label;
    fileName.title = label;
    buildLayerList(model);
    openDrawingWorkspace(model, true);
    if (viewer.ok) {
      for (const id of ['modeNav', 'modeDraw']) $(id).disabled = false;
      setMode('nav');
      viewer.setModel(model, true);
      appliedRevision = viewer.revision;
    } else setMode('draw');
    const summary = `${label}: ${model.layers.length} layer${model.layers.length === 1 ? '' : 's'}, ${model.triangleCount.toLocaleString()} triangles, ${model.height.toFixed(1)} m tall.`;
    if (model.warnings.length) say(summary, 'warn', model.warnings);
    else say(summary);
  }

  // One checkbox per layer. Changing visibility rebuilds the geometry but keeps drawing settings.
  function buildLayerList(model) {
    layerList.replaceChildren(
      ...model.layers.map((layer) => {
        const row = document.createElement('label'),
          box = document.createElement('input'),
          swatch = document.createElement('span'),
          count = document.createElement('span');
        box.type = 'checkbox';
        box.checked = layer.visible;
        box.onchange = () => {
          layer.visible = box.checked;
          openDrawingWorkspace(model, false);
          if (viewer.ok) viewer.setModel(model, false);
        };
        swatch.className = 'swatch';
        swatch.style.background = '#' + layer.color.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
        count.className = 'count';
        count.textContent = layer.triangles ? layer.triangles.toLocaleString() + ' tri' : layer.segments + ' lines';
        row.append(box, swatch, layer.label, count);
        row.title = layer.label;
        return row;
      })
    );
  }

  // Read a user-chosen .3dm or .obj file.
  async function openFile(file) {
    if (busy || !file) return;
    busy = true;
    lastFile = file;
    const base = file.name.replace(/\.[^.]+$/, '');
    try {
      let model;
      if (/\.obj$/i.test(file.name)) {
        say('Reading ' + file.name + '…');
        model = importObj(await file.text(), base, unitSelect.value);
      } else if (/\.3dm$/i.test(file.name)) {
        say('Loading the Rhino reader…');
        const rhino = await timed(loadRhino(), 45000);
        say('Reading ' + file.name + '…');
        const bytes = new Uint8Array(await file.arrayBuffer());
        model = await importRhino(rhino, bytes, base, unitSelect.value, (done, total) =>
          say(`Reading ${file.name}… ${done} of ${total} objects`)
        );
      } else throw Error('Choose a Rhino .3dm file or an .obj file.');
      show(model, file.name);
    } catch (error) {
      console.error('Import failed', error);
      say(
        'Could not open ' + file.name + ': ' + (error && error.message ? error.message : error),
        'error',
        /download|fetch|import|network/i.test(String(error && error.message))
          ? ['The Rhino reader loads from a CDN, so an internet connection is needed the first time. An .obj file or the sample works offline.']
          : []
      );
    } finally {
      busy = false;
    }
  }

  function openSample() {
    if (busy) return;
    lastFile = null;
    try {
      show(sampleModel(), 'Sample building');
    } catch (error) {
      console.error('Sample failed', error);
      say('Could not build the sample: ' + error.message, 'error');
    }
  }

  // Controls
  $('modeNav').onclick = () => mode !== 'nav' && setMode('nav');
  $('modeDraw').onclick = () => mode !== 'draw' && setMode('draw');
  $('navToDrawing').onclick = () => setMode('draw', true);
  $('navExtents').onclick = () => viewer.zoomExtents();
  // "Set orbit centre" arms the next click on the 3D view; it disarms itself once a point is picked.
  if (viewer.ok) {
    for (const box of document.querySelectorAll('#navLines [data-line]'))
      box.onchange = () => viewer.setLines({ [box.dataset.line]: box.checked });
    $('navCreaseAngle').oninput = (event) => {
      $('navCreaseOut').textContent = `${event.target.value}°`;
      viewer.setLines({ creaseAngle: Number(event.target.value) });
    };
    // Axo compass: eight buttons for the direction the axonometric is viewed from.
    const axoButtons = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map((label, index) => {
      const button = Object.assign(document.createElement('button'), { type: 'button', textContent: label });
      button.title = `Axonometric viewed from the ${label}`;
      button.onclick = () => viewer.axo(index);
      $('navAxoCompass').append(button);
      return button;
    });
    const syncAxo = () => {
      axoButtons.forEach((button, index) => button.setAttribute('aria-pressed', String(viewer.activeAxo === index)));
      // The compass only matters while the view is an axonometric
      $('navAxoGroup').hidden = viewer.activeAxo === null;
    };
    viewer.onMove = syncAxo;
    syncAxo();
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
  $('navStatus').textContent = 'Frame the part of the model you want to draw, then choose Draw this view.';
  if (!viewer.ok) $('modeNav').hidden = $('modeDraw').hidden = true;
  setMode(viewer.ok ? 'nav' : 'draw');
  for (const id of ['openFile', 'openFileZone']) $(id).onclick = () => fileInput.click();
  for (const id of ['loadSample', 'loadSampleZone']) $(id).onclick = openSample;
  fileInput.onchange = () => {
    openFile(fileInput.files[0]);
    fileInput.value = '';
  };
  // Changing the unit re-reads the last file so the new scale applies.
  unitSelect.onchange = () => {
    if (lastFile) openFile(lastFile);
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
