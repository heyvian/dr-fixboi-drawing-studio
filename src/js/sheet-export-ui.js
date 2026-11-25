// All output formats share one dialog and start with the same rendered sheet. Drawing Studio's
// saved project format keeps the original SVG and PSD preference fields for older projects.
function createSheetExportPanel({ storageKey, getSheet, artwork, filename, prepareFloors, printSheets }) {
  const launcher = $('openSheetExport'), dialog = $('sheetExport'), form = $('sheetExportForm'),
    formats = $('exportFormats'), tabs = [...formats.querySelectorAll('[role="tab"]')],
    workspace = $('exportWorkspace'), close = $('closeSheetExport'), submit = $('confirmSheetExport'),
    feedback = $('exportError'), progress = $('exportProgress'),
    paper = $('exportPaper'), annotations = $('exportAnnotations'), paths = $('exportPaths'),
    psdPaper = $('psdPaper'), psdAnnotations = $('psdAnnotations'), resolution = $('psdResolution'),
    printScope = $('exportPrintScope'), printCurrent = $('exportPrintSheet'), printFloors = $('exportPrintFloors'),
    floorScale = $('exportFloorScale');
  let selected = tabs[0], sheetReady = false, floorCount = 0, job = null;
  const canOpen = () => sheetReady || floorCount > 0;
  const floorSet = () => floorCount > 0 && printFloors.checked;
  const psdPreferences = () => ({ paper: psdPaper.checked, annotations: psdAnnotations.checked, ppi: Number(resolution.value) });
  const preferences = () => ({
    paper: paper.checked, annotations: annotations.checked, paths: paths.value,
    psd: psdPreferences(), format: selected.dataset.format
  });

  function savePreferences() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(preferences()));
    } catch {
      // A blocked local store still allows exporting with the current options.
    }
  }
  function applyPreferences(saved) {
    paper.checked = saved?.paper !== false;
    annotations.checked = saved?.annotations !== false;
    paths.value = saved?.paths === 'individual' ? 'individual' : 'batch';
    if (saved?.psd) {
      psdPaper.checked = saved.psd.paper !== false;
      psdAnnotations.checked = saved.psd.annotations !== false;
      resolution.value = [72, 150, 300, 600].includes(saved.psd.ppi) ? String(saved.psd.ppi) : '300';
    }
    selected = tabs.find((tab) => tab.dataset.format === saved?.format) ?? selected;
    selectInspectorTab(selected);
  }
  try {
    applyPreferences(JSON.parse(localStorage.getItem(storageKey)));
  } catch {
    // The HTML supplies defaults when no export settings can be read.
  }

  function sync(checkOptions = false) {
    launcher.disabled = !canOpen() || Boolean(job);
    workspace.inert = Boolean(job);
    if (!dialog.open) return;
    const format = selected.dataset.format;
    const printingFloors = format === 'print' && floorSet();
    const actions = { svg: 'Download SVG', psd: 'Download PSD', pdf: 'Download PDF', print: printingFloors ? 'Print floor set' : 'Print sheet' };
    submit.textContent = actions[format];
    close.textContent = job ? (format === 'print' ? 'Cancel print setup' : 'Cancel export') : 'Close';
    printScope.hidden = !floorCount;
    printCurrent.disabled = !sheetReady;
    $('exportFloorCount').textContent = `One sheet per floor (${floorCount} ${floorCount === 1 ? 'page' : 'pages'})`;
    floorScale.hidden = !printingFloors;
    if (printingFloors) {
      const { scale } = getSheet();
      floorScale.textContent = scale === 'auto' ? 'Auto fit uses the full page to choose a shared scale for the floor set.' : `Every floor prints at 1:${scale}.`;
    }
    let problem = sheetReady || printingFloors ? '' : 'This sheet has no visible geometry.';
    if (format === 'psd') {
      const [width, height] = drawingPsdSize(getSheet().paper, psdPreferences().ppi);
      $('psdDimensions').value = `${width.toLocaleString()} × ${height.toLocaleString()} px`;
      if (!problem && !drawingPsdCanFit(width, height)) problem = drawingPsdTooLarge;
    }
    submit.disabled = Boolean(job) || Boolean(problem);
    if (checkOptions) feedback.textContent = problem;
  }

  bindWorkspaceTabs(formats, (tab, focus) => {
    selected = tab;
    selectInspectorTab(tab, focus);
    savePreferences();
    sync(true);
  });
  const compact = matchMedia('(max-width: 620px)');
  function syncTabOrientation() {
    formats.setAttribute('aria-orientation', compact.matches ? 'horizontal' : 'vertical');
  }
  compact.addEventListener('change', syncTabOrientation);
  syncTabOrientation();
  form.addEventListener('change', (event) => {
    if (event.target.name !== 'printScope') savePreferences();
    sync(true);
  });

  launcher.onclick = () => {
    const sheet = getSheet();
    $('exportSheetTitle').textContent = sheet.title;
    $('exportSheetContext').textContent = `${sheet.view} · ${sheet.paperLabel}`;
    printFloors.checked = !sheetReady;
    printCurrent.checked = sheetReady;
    if (!sheetReady && floorCount) {
      selected = tabs.find((tab) => tab.dataset.format === 'print');
      selectInspectorTab(selected);
    }
    dialog.showModal();
    sync(true);
    selected.focus();
  };
  dialog.addEventListener('cancel', () => job?.abort());
  close.onclick = () => {
    job?.abort();
    dialog.close();
  };

  form.onsubmit = async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const format = selected.dataset.format, printingFloors = format === 'print' && floorSet();
    const { paper: dimensions } = getSheet();
    const name = format === 'print' ? null : filename(format);
    const { signal } = (job = new AbortController());
    const report = (message) => { progress.textContent = message; };
    report(`Preparing ${format === 'print' ? 'print pages' : `${format.toUpperCase()} export`}…`);
    feedback.textContent = '';
    sync();
    close.focus();
    try {
      await yieldForDrawingOutput();
      signal.throwIfAborted();
      if (format === 'print') {
        const pages = printingFloors ? await prepareFloors(signal, report) : [artwork()];
        signal.throwIfAborted();
        dialog.close();
        printSheets(pages, dimensions);
      } else {
        let file, type;
        if (format === 'svg') {
          const svg = artwork({ includePaper: paper.checked, includeAnnotations: annotations.checked, chunkSize: paths.value === 'individual' ? 1 : 256 });
          file = new XMLSerializer().serializeToString(convertDrawingSvgToPoints(svg));
          type = 'image/svg+xml';
        } else if (format === 'psd') {
          const options = psdPreferences();
          const svg = artwork({ includePaper: options.paper, includeAnnotations: options.annotations });
          file = await createDrawingPsd(svg, dimensions, options.ppi, signal, report);
          type = 'image/vnd.adobe.photoshop';
        } else {
          file = await createBluebeamPdf(artwork(), dimensions);
          type = 'application/pdf';
        }
        signal.throwIfAborted();
        dialog.close();
        downloadBlob(file, type, name);
      }
    } catch (error) {
      if (!signal.aborted) {
        if (!dialog.open) dialog.showModal();
        feedback.textContent = format === 'psd' && error instanceof RangeError ? drawingPsdTooLarge
          : error.message || 'The output could not be prepared.';
      }
    } finally {
      job = null;
      report('');
      sync();
      if (dialog.open && !submit.disabled) submit.focus();
      else if (!dialog.open && !launcher.disabled) launcher.focus();
    }
  };

  return {
    preferences,
    restore(saved) {
      applyPreferences(saved);
      savePreferences();
    },
    setAvailable(hasSheet, floors) {
      sheetReady = hasSheet;
      floorCount = floors;
      sync();
    }
  };
}
