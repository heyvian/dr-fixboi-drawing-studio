// Defaults to file:// in Edge. Set APP_URL for a running dev server, BROWSER_EXECUTABLE for a
// local Chromium browser, or SHOT to capture screenshots.
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');
const { makeFixture, makeRhinoRevision } = require('./fixture');
const { version } = require('../package.json');

(async () => {
  const browser = await chromium.launch(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE }
    : { channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const appUrl = process.env.APP_URL || pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
  await page.goto(appUrl);
  assert.strictEqual(await page.locator('.app-identity #appVersion').textContent(), `V${version}`);

  const shot = async (name) => process.env.SHOT && (await page.screenshot({ path: path.join(process.env.SHOT, name + '.png') }));
  const exportDialog = page.getByRole('dialog', { name: 'Export and print' });
  async function openOutput(tab, format) {
    if (!(await tab.locator('#sheetExport').isVisible())) await tab.click('#openSheetExport');
    const choice = tab.locator(`#exportFormats [data-format="${format}"]`);
    if (await choice.getAttribute('aria-selected') === 'false') await choice.click();
  }
  async function downloadSvg() {
    await openOutput(page, 'svg');
    const [file] = await Promise.all([page.waitForEvent('download'), page.click('#confirmSheetExport')]);
    await exportDialog.waitFor({ state: 'hidden' });
    return file;
  }

  async function showPanel(selector) {
    const id = await page.locator(selector).evaluate((el) => el.closest('[role="tabpanel"]')?.getAttribute('aria-labelledby'));
    if (id && await page.locator(`#${id}`).getAttribute('aria-selected') === 'false') await page.click(`#${id}`);
  }
  async function choose(selector, value) {
    await showPanel(selector);
    await page.selectOption(selector, value);
  }
  const activeProjection = () => page.locator('[data-sheet-view][aria-pressed="true"]').getAttribute('data-sheet-view');
  const savedRow = (name) => page.locator('#savedViews').getByRole('button', { name: new RegExp(`^${name}`) });

  await page.locator('#fileMenuToggle').press('Enter');
  assert(await page.locator('#loadSample').isVisible());
  await page.click('#loadSample');
  assert.strictEqual(await page.locator('#fileMenu[open]').count(), 0);
  // A new model opens in 3D navigation. Orbit and zoom, then draw that view.
  await page.waitForSelector('#navStage:not([hidden])');
  await page.waitForTimeout(500);
  await shot('nav-home');
  assert.ok(await page.evaluate(() => viewer.edgeCount) > 0, 'mesh edges are drawn');
  await page.locator('#skipViewport').focus();
  await page.keyboard.press('Enter');
  assert(await page.locator('#navCanvas').evaluate(el => el === document.activeElement));
  await page.locator('#cameraTab').press('ArrowRight');
  assert.strictEqual(await page.locator('#displayTab').getAttribute('aria-selected'), 'true');
  assert(await page.locator('#displayTab').evaluate((el) => el === document.activeElement));
  assert(await page.locator('#sheetInspector').isHidden());
  for (const name of ['objects', 'open', 'creases', 'silhouettes']) await page.uncheck(`[data-line=${name}]`);
  await page.waitForTimeout(300);
  assert.strictEqual(await page.evaluate(() => viewer.edgeCount), 0, 'edge toggles turn the linework off');
  for (const name of ['objects', 'open', 'creases', 'silhouettes']) await page.check(`[data-line=${name}]`);
  await page.waitForTimeout(300);
  await page.locator('#displayTab').press('Home');
  await page.click('#navAxoCompass button:nth-child(2)');
  assert.strictEqual(await page.evaluate(() => viewer.activeAxo), 1, 'axo compass selects NE');
  const navView = (name) => page.locator(`#navStage [data-view="${name}"]`).click();
  const navDirection = (name) => page.locator(`#navAxoCompass [data-compass-point="${name}"]`);
  await navView('top');
  await navDirection('SE').click();
  await navView('elevation');
  await navDirection('W').click();
  await navView('iso');
  assert.strictEqual(await navDirection('NE').getAttribute('aria-pressed'), 'true');
  await navView('top');
  assert.strictEqual(await navDirection('SE').getAttribute('aria-pressed'), 'true');
  await navView('elevation');
  assert.strictEqual(await navDirection('W').getAttribute('aria-pressed'), 'true');
  await page.click('#syncNavOrientations');
  await navView('top');
  assert.strictEqual(await navDirection('W').getAttribute('aria-pressed'), 'true');
  await navDirection('N').click();
  await navView('iso');
  assert.strictEqual(await navDirection('W').getAttribute('aria-pressed'), 'true');
  await navDirection('NE').click();
  const canvas = await page.locator('#navCanvas').boundingBox();
  const navCompass = await page.locator('#navAxoCompass').boundingBox();
  assert(navCompass.x >= canvas.x + canvas.width, 'the compass sits beside the model viewport');
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width / 2 + 120, canvas.y + canvas.height / 2 - 40, { steps: 8 });
  await page.mouse.up();
  assert(await page.locator('#navAxoCompass').isVisible(), 'the compass stays visible after a free orbit');
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(300);
  await shot('nav-moved');

  // Orbit centre: double-click a point, then orbiting keeps it still on screen and a preset centres it.
  const focusBefore = await page.evaluate(() => viewer.focus);
  await page.mouse.dblclick(canvas.x + canvas.width * 0.7, canvas.y + canvas.height * 0.4);
  const focusAfter = await page.evaluate(() => viewer.focus);
  assert.notDeepStrictEqual(focusAfter, focusBefore, 'double-click sets a new orbit centre');
  const markerAt = () => page.evaluate(() => {
    const m = document.querySelector('.nav-focus');
    return [parseFloat(m.style.left), parseFloat(m.style.top)];
  });
  await page.waitForTimeout(200);
  const markerBefore = await markerAt();
  await page.mouse.move(canvas.x + 200, canvas.y + 200);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 300, canvas.y + 230, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const markerOrbited = await markerAt();
  assert.ok(Math.abs(markerOrbited[0] - markerBefore[0]) < 0.5 && Math.abs(markerOrbited[1] - markerBefore[1]) < 0.5, 'orbit centre stays still on screen');
  await page.click('.nav-views [data-view=top]');
  await page.waitForTimeout(200);
  const markerPreset = await markerAt();
  assert.ok(Math.abs(markerPreset[0] - 50) < 0.5 && Math.abs(markerPreset[1] - 50) < 0.5, 'standard views centre on the orbit centre');
  await shot('nav-focus');
  await page.click('#navToDrawing');
  await page.waitForFunction(() => document.querySelectorAll('#drawingSheet path').length > 3, null, { timeout: 30000 });
  assert.strictEqual(await activeProjection(), 'nav', 'drawing uses the 3D view');
  assert(await page.locator('#groundDrawing').isDisabled(), 'plan views have no vertical ground datum');
  await shot('draw-from-nav');

  // Changing scale keeps the framing: the sheet centre must not jump back to the model centre.
  const sheetBefore = await page.locator('#drawingSheet').innerHTML();
  await choose('#drawingScale', '1000');
  await page.waitForTimeout(600);
  await shot('draw-rescaled');
  assert.notStrictEqual(await page.locator('#drawingSheet').innerHTML(), sheetBefore);

  const capturedPlan = await page.locator('#drawingLinework').getAttribute('d');
  // Camera changes only reach the sheet through the explicit capture action.
  await page.click('#modeNav');
  await page.waitForTimeout(300);
  await shot('nav-again');
  await page.click('.nav-views [data-view=iso]');
  await page.click('#navExtents');
  await page.click('#modeDraw');
  await page.locator('#openSheetExport:enabled').waitFor();
  assert.strictEqual(await page.locator('#drawingLinework').getAttribute('d'), capturedPlan);
  assert.strictEqual(await page.inputValue('#drawingScale'), '1000');
  await page.click('#modeNav');
  await page.click('#navToDrawing');
  await page.waitForFunction(() => document.querySelectorAll('#drawingSheet path').length > 3, null, { timeout: 30000 });
  await page.locator('#groundDrawing:enabled').waitFor();
  const beforeGround = await page.locator('#drawingSheet').innerHTML();
  await page.click('#groundDrawing');
  await page.waitForFunction((before) => document.querySelector('#drawingSheet').innerHTML !== before, beforeGround);
  const grounded = await page.locator('#drawingSheet').innerHTML();
  const currentScale = await page.inputValue('#drawingScale');
  await page.click('#centerDrawing');
  await page.waitForFunction((before) => document.querySelector('#drawingSheet').innerHTML !== before, grounded);
  assert.strictEqual(await page.inputValue('#drawingScale'), currentScale);
  await page.click('#fitDrawing');
  await page.locator('#openSheetExport:enabled').waitFor();
  assert.strictEqual(await page.inputValue('#drawingScale'), 'auto');
  const workingSheet = await page.locator('#drawingSheet').innerHTML();
  const workingWidth = (await page.locator('#drawingSheet').boundingBox()).width;
  await page.click('#expandDrawing');
  const expanded = page.getByRole('dialog', { name: 'Sheet preview' });
  const expandedPage = expanded.locator('.expanded-sheet-page');
  const fittedWidth = (await expandedPage.boundingBox()).width;
  assert(fittedWidth > workingWidth, 'expanded sheet uses the space freed by the project and property panels');
  assert.strictEqual(await expandedPage.locator('[clip-path]').getAttribute('clip-path'), 'url(#expandedSheetClip)');
  await expanded.getByRole('button', { name: 'Zoom in' }).click();
  assert.strictEqual(await page.locator('#sheetPreviewZoom').textContent(), '150%');
  assert(Math.abs((await expandedPage.boundingBox()).width - fittedWidth * 1.5) < 1);
  await page.locator('#sheetPreviewViewport').press('0');
  assert.strictEqual(await page.locator('#sheetPreviewZoom').textContent(), '100%');
  await page.keyboard.press('Escape');
  assert(await expanded.isHidden());
  assert(await page.locator('#expandDrawing').evaluate((el) => el === document.activeElement));
  assert.strictEqual(await page.locator('#drawingSheet').innerHTML(), workingSheet);
  assert.strictEqual(await page.inputValue('#drawingScale'), 'auto');
  const framing = await page.evaluate(() => {
    const drawing = document.querySelector('#drawingSheet [data-layer="Artwork"]').getBBox();
    const region = document.querySelector('#drawingSheetClip rect').getBBox();
    return {
      relativeHeight: drawing.height / region.height,
      centred: Math.abs(drawing.x + drawing.width / 2 - (region.x + region.width / 2)) < 2
    };
  });
  assert(framing.relativeHeight > 0.8 && framing.relativeHeight < 1 && framing.centred);
  const capturedCamera = await page.evaluate(() => viewer.snapshot());
  await page.locator('[data-sheet-view="plan"]').click();
  await page.locator('#openSheetExport:enabled').waitFor();
  assert.strictEqual(await activeProjection(), 'plan');
  assert.strictEqual(await page.inputValue('#drawingPlanSheet'), 'single');
  const planPaths = await page.locator('#drawingLinework').getAttribute('d');
  await choose('#drawingPlanSheet', 'floors');
  assert(await page.locator('#drawingSheet').evaluate(sheet => sheet.classList.contains('planset')));
  await page.locator('[data-sheet-view="elevation"]').click();
  await page.locator('#openSheetExport:enabled').waitFor();
  const elevationPaths = await page.locator('#drawingLinework').getAttribute('d');
  assert.notStrictEqual(elevationPaths, planPaths);
  await page.locator('#drawingSheet').press('ArrowRight');
  await page.waitForFunction((before) => document.querySelector('#drawingLinework')?.getAttribute('d') !== before, elevationPaths);
  await page.locator('[data-sheet-view="plan"]').click();
  assert.strictEqual(await page.inputValue('#drawingPlanSheet'), 'single');
  await page.locator('[data-sheet-view="nav"]').click();
  assert.deepStrictEqual(await page.evaluate(() => viewer.snapshot()), capturedCamera);
  assert(await page.locator('#navStage').isHidden());
  await page.locator('[data-sheet-view="axo"]').click();
  await page.locator('#openSheetExport:enabled').waitFor();
  const axo = await page.locator('#drawingLinework').getAttribute('d');
  await page.click('#viewTab');
  const southwest = page.locator('#drawingCompass [data-compass-point="SW"]');
  await southwest.click();
  assert.strictEqual(await southwest.getAttribute('aria-pressed'), 'true');
  await page.locator('#openSheetExport:enabled').waitFor();
  assert.notStrictEqual(await page.locator('#drawingLinework').getAttribute('d'), axo);
  assert.deepStrictEqual(await page.evaluate(() => viewer.snapshot()), capturedCamera);

  const projection = (name) => page.locator(`[data-sheet-view="${name}"]`).click();
  const direction = (point) => page.locator(`#drawingCompass [data-compass-point="${point}"]`);
  await projection('plan');
  await direction('E').click();
  await projection('elevation');
  await direction('NW').click();
  await projection('axo');
  assert.strictEqual(await direction('SW').getAttribute('aria-pressed'), 'true');
  await projection('plan');
  assert.strictEqual(await direction('E').getAttribute('aria-pressed'), 'true');
  await projection('elevation');
  assert.strictEqual(await direction('NW').getAttribute('aria-pressed'), 'true');
  await page.click('#syncViewOrientations');
  await projection('axo');
  assert.strictEqual(await direction('NW').getAttribute('aria-pressed'), 'true');
  await projection('plan');
  assert.strictEqual(await direction('NW').getAttribute('aria-pressed'), 'true');
  await direction('N').click();
  await projection('axo');
  assert.strictEqual(await direction('NW').getAttribute('aria-pressed'), 'true', 'sync copies once');

  await page.click('#paperTab');
  await page.fill('#drawingNumber', 'A-101');
  await page.fill('#drawingRevision', 'B');
  await choose('#drawingPaper', 'a3');
  await choose('#drawingScale', 'auto');
  await page.click('#clipMenuToggle');
  assert(await page.locator('#drawingNoPlanes').isVisible());
  await page.click('#addDrawingPlane');
  assert.strictEqual(await page.locator('[data-sheet-view="aligned"]').isDisabled(), false);
  await page.click('#alignDrawingPlane');
  assert.strictEqual(await activeProjection(), 'aligned');
  assert.strictEqual(await page.locator('#clipMenuToggle').getAttribute('aria-selected'), 'true');
  assert(await page.locator('#drawingSectionProjection').evaluate((el) => el === document.activeElement));
  assert.strictEqual(await page.inputValue('#drawingCutTreatment'), 'solid');
  await choose('#drawingSectionProjection', 'perspective');
  assert(await page.locator('#drawingSectionLensNumber').isVisible());
  assert(await page.locator('#drawingPerspectiveFade').isVisible());
  assert.strictEqual(await page.inputValue('#drawingPerspectiveOrigin'), 'sheet');
  await page.locator('#openSheetExport:enabled').waitFor();
  await page.click('#placePerspectiveOrigin');
  const marker = page.locator('#perspectiveOriginMarker');
  assert(await marker.isVisible());
  const centeredMarker = await marker.getAttribute('transform');
  await page.locator('#drawingSheet').press('ArrowLeft');
  const movedMarker = await marker.getAttribute('transform');
  assert.notStrictEqual(movedMarker, centeredMarker);
  await page.locator('#drawingSheet').press('Enter');
  assert(await marker.isHidden());
  await choose('#drawingPerspectiveOrigin', 'camera');
  assert(await page.locator('#capturePerspectiveCamera').isVisible());
  await choose('#drawingPerspectiveOrigin', 'sheet');
  await page.click('#placePerspectiveOrigin');
  assert.strictEqual(await marker.getAttribute('transform'), movedMarker);
  await page.click('#centerPerspectiveOrigin');
  await page.click('#placePerspectiveOrigin');
  assert.strictEqual(await marker.getAttribute('transform'), centeredMarker);
  await choose('#drawingSectionProjection', 'orthographic');
  await projection('axo');
  await page.click('#penMenuToggle');
  const penBoundary = page.getByRole('spinbutton', { name: 'Pen 1 to Pen 2 boundary in percent' });
  assert(await penBoundary.isVisible());
  assert.strictEqual(await penBoundary.inputValue(), '33.3');
  await penBoundary.fill('50');
  await penBoundary.press('Tab');
  assert.deepStrictEqual(await page.locator('#drawingDepthBands li span:last-child').allTextContents(),
    ['0%–50%', '50%–66.7%', '66.7%–100%']);
  assert.strictEqual(await page.inputValue('#depthBoundaryValue2'), '66.7', 'a boundary moves independently');
  assert.strictEqual(await page.getByRole('checkbox', { name: 'Adapt weights to scale' }).count(), 0);
  const firstLayer = page.locator('#layerList input[type=checkbox]').first();
  await firstLayer.uncheck();
  await page.click('#newView');
  await page.fill('#savedViewName', 'Issue axonometric');
  await page.click('#saveView');
  assert.strictEqual(await savedRow('Issue axonometric').getAttribute('aria-pressed'), 'true');
  await firstLayer.check();
  await choose('#drawingPaper', 'letter');
  await page.fill('#drawingRevision', 'C');
  await page.click('#penMenuToggle');
  await page.click('#drawingDepthReset');
  assert.strictEqual(await penBoundary.inputValue(), '33.3');
  await page.click('#recallView');
  assert.strictEqual(await page.inputValue('#drawingPaper'), 'a3');
  assert.strictEqual(await page.inputValue('#drawingRevision'), 'B');
  assert.strictEqual(await penBoundary.inputValue(), '50');
  assert.strictEqual(await firstLayer.isChecked(), false);
  await page.waitForFunction(() => document.querySelector('#drawingSheet').textContent.includes('A-101 · REV B'));

  let svgDownloads = 0;
  page.on('download', (file) => {
    if (file.suggestedFilename().endsWith('.svg')) svgDownloads++;
  });
  await openOutput(page, 'svg');
  assert(await exportDialog.isVisible());
  await exportDialog.getByText('Create named layers in Illustrator', { exact: true }).click();
  assert.strictEqual(await exportDialog.getByRole('listitem').count(), 5);
  const [script] = await Promise.all([
    page.waitForEvent('download'),
    exportDialog.getByRole('link', { name: 'Download the Illustrator script' }).click()
  ]);
  assert.match(script.suggestedFilename(), /\.jsx$/);
  assert.match(await fs.promises.readFile(await script.path(), 'utf8'), /File\.openDialog/);
  await page.uncheck('#exportPaper');
  await page.uncheck('#exportAnnotations');
  await choose('#exportPaths', 'individual');
  await page.click('#closeSheetExport');
  assert(await exportDialog.isHidden());
  assert.strictEqual(svgDownloads, 0, 'opening the options and cancelling does not download an SVG');
  await openOutput(page, 'svg');
  assert.strictEqual(await page.isChecked('#exportPaper'), false);
  assert.strictEqual(await page.isChecked('#exportAnnotations'), false);
  assert.strictEqual(await page.inputValue('#exportPaths'), 'individual');
  const download = await downloadSvg();
  const svg = await fs.promises.readFile(await download.path(), 'utf8');
  assert.match(download.suggestedFilename(), /-a3-1-\d+\.svg$/);
  const exported = await page.evaluate((source) => {
    const root = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
    const layers = Array.from(root.querySelectorAll(':scope > g'));
    const strokes = Array.from(root.querySelectorAll('[data-weight-mm] path'));
    return {
      tag: root.localName,
      width: parseFloat(root.getAttribute('width')) * 25.4,
      height: parseFloat(root.getAttribute('height')) * 25.4,
      viewBoxWidth: root.viewBox.baseVal.width,
      viewBoxHeight: root.viewBox.baseVal.height,
      names: layers.map((layer) => layer.dataset.layer),
      strokes: strokes.map((stroke) => stroke.getAttribute('d')),
      widths: strokes.map((stroke) => [
        Number(stroke.getAttribute('stroke-width')),
        Number(stroke.closest('[data-weight-mm]').dataset.weightMm) * 72 / 25.4
      ])
    };
  }, svg);
  assert.strictEqual(exported.tag, 'svg');
  assert(Math.abs(exported.width - 420) < 1e-6, 'A3 landscape is exported at its physical width');
  assert(Math.abs(exported.height - 297) < 1e-6);
  assert(Math.abs(exported.viewBoxWidth - 420 * 72 / 25.4) < 1e-4, 'the SVG uses 72 units per inch');
  assert(Math.abs(exported.viewBoxHeight - 297 * 72 / 25.4) < 1e-4);
  assert(exported.widths.every(([actual, expected]) => Math.abs(actual - expected) < 1e-6),
    'exported pen and section widths equal the sheet weights in points');
  assert(exported.names.some((name) => name.startsWith('Pen ')));
  assert(exported.names.includes('Section cuts'));
  assert(!exported.names.includes('Paper') && !exported.names.includes('Title and scale'));
  assert(exported.strokes.length > 10 && exported.strokes.every((stroke) => (stroke.match(/M/g) || []).length === 1));

  // Toggle the first layer off and on again.
  await page.click('#clipMenuToggle');
  await page.getByRole('button', { name: 'Remove plane 1' }).click();
  await page.click('#viewTab');
  await firstLayer.check();
  await firstLayer.uncheck();
  await page.waitForTimeout(500);
  await firstLayer.check();
  await page.waitForFunction(() => document.querySelectorAll('#drawingSheet path').length > 3, null, { timeout: 30000 });

  const obj = 'o Box\nv 0 0 0\nv 10 0 0\nv 10 8 0\nv 0 8 0\nv 0 0 6\nv 10 0 6\nv 10 8 6\nv 0 8 6\n' +
    'f 1 2 3 4\nf 5 6 7 8\nf 1 2 6 5\nf 2 3 7 6\nf 3 4 8 7\nf 4 1 5 8\n';
  await page.setInputFiles('#fileInput', { name: 'smoke.obj', mimeType: 'text/plain', buffer: Buffer.from(obj) });
  await page.waitForFunction(() => document.querySelector('#importStatus').textContent.includes('smoke.obj:'));
  assert.strictEqual(await page.inputValue('#unitSelect'), 'auto');
  assert.match(await page.locator('#importStatus').textContent(), /Metres \(assumed\)/);
  await page.click('#modeDraw');
  await page.waitForFunction(() => {
    const sheet = document.querySelector('#drawingSheet');
    return sheet.textContent.includes('smoke') && sheet.querySelectorAll('path').length > 1;
  });
  assert.strictEqual(await page.locator('#savedViews button').count(), 0, 'saved views are isolated by model');
  await shot('obj');

  await choose('#drawingPaper', 'custom');
  await page.fill('#customPaperName', 'Desk proof');
  await page.fill('#customPaperWidth', '250');
  await page.fill('#customPaperHeight', '400');
  await page.getByRole('button', { name: 'Save and use' }).click();
  assert.strictEqual(await page.inputValue('#drawingOrientation'), 'portrait');
  await projection('elevation');
  await choose('#drawingBodies', 'none');
  await page.click('#penMenuToggle');
  const originalPenCount = await page.inputValue('#drawingPenCount');
  await choose('#drawingPenCount', '1');
  const penWidth = page.getByRole('spinbutton', { name: 'Pen 1 width in millimetres' });
  await page.locator('#drawingInkColor').evaluate(input => {
    input.value = '#cccccc';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('#openSheetExport:enabled').waitFor();
  await page.click('#paperTab');
  await page.locator('#sheetContrast summary').click();
  await page.locator('#applySheetContrast:enabled').waitFor();
  assert.match(await page.locator('#sheetContrastResults').textContent(), /Pen 1/);
  await page.click('#applySheetContrast');
  await page.waitForFunction(() => document.getElementById('sheetContrastStatus').textContent.startsWith('Visible ink passes'));
  await page.click('#penMenuToggle');
  await penWidth.fill('0.50');
  await penWidth.press('Tab');
  for (const scale of ['50', '250', '5000']) {
    await choose('#drawingScale', scale);
    await page.locator('#openSheetExport:enabled').waitFor();
    const previewWidth = await page.locator('#drawingLinework').evaluate((stroke) =>
      Number(stroke.getAttribute('stroke-width')) * 250 / stroke.ownerSVGElement.viewBox.baseVal.width);
    assert(Math.abs(previewWidth - 0.50) < 1e-6, `preview width stays at 0.50 mm at 1:${scale}`);
    const penDownload = await downloadSvg();
    assert(penDownload.suggestedFilename().endsWith(`-1-${scale}.svg`));
    const penSvg = await fs.promises.readFile(await penDownload.path(), 'utf8');
    const exportedWidths = await page.evaluate((source) => {
      const svg = new DOMParser().parseFromString(source, 'image/svg+xml');
      return [...svg.querySelectorAll('[data-layer^="Pen 1"] path')].map((path) => Number(path.getAttribute('stroke-width')));
    }, penSvg);
    assert(exportedWidths.length && exportedWidths.every((width) => Math.abs(width - 0.50 * 72 / 25.4) < 1e-6),
      `exported width stays at 0.50 mm at 1:${scale}`);
  }
  await choose('#drawingPenCount', originalPenCount);
  await choose('#drawingScale', 'auto');
  assert.strictEqual(await page.isChecked('#drawingGroundLine'), false);
  await page.check('#drawingSilhouette');
  await page.getByRole('spinbutton', { name: 'Overall silhouette width (mm)' }).fill('0.82');
  await page.getByRole('spinbutton', { name: 'Overall silhouette width (mm)' }).press('Tab');
  await page.check('#drawingGroundLine');
  const customDownload = await downloadSvg();
  assert.match(customDownload.suggestedFilename(), /-Desk_proof-1-\d+\.svg$/);
  const customSvg = await fs.promises.readFile(await customDownload.path(), 'utf8');
  assert.match(customSvg, /data-weight-mm="0.82"[^>]+data-layer="Overall silhouette"/);
  assert.match(customSvg, /data-weight-mm="0.25"[^>]+data-layer="Ground line"/);
  const customBox = customSvg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number);
  assert(customBox.every((value, index) => Math.abs(value - [250, 400][index] * 72 / 25.4) < 1e-6));
  await page.uncheck('#drawingSilhouette');
  await page.uncheck('#drawingGroundLine');
  await choose('#drawingBodies', 'layer');
  await page.check('#drawingComponentOutlines');
  await page.locator('#drawingSheet [data-layer="Key outlines"] path').waitFor();
  await page.uncheck('#drawingComponentOutlines');

  const elevationOnPaper = async () => {
    await page.locator('#openSheetExport:enabled').waitFor();
    return page.locator('#drawingSheet').evaluate((sheet) => ({
      ratio: Number(sheet.querySelector('[data-scale-ratio]').dataset.scaleRatio),
      height: sheet.querySelector('[data-layer="Artwork"]').getBBox().height * 400 / sheet.viewBox.baseVal.height
    }));
  };
  await choose('#drawingScale', '50');
  let elevation = await elevationOnPaper();
  assert.strictEqual(elevation.ratio, 50);
  assert(Math.abs(elevation.height - 120) < 0.05, 'a six-metre elevation measures 120 mm at 1:50');
  await page.click('#fileMenuToggle');
  await choose('#unitSelect', 'ft');
  await page.waitForFunction(() => document.querySelector('#importStatus').textContent.includes('Feet (override)'));
  await page.locator('#fileMenuToggle').press('Escape');
  assert.strictEqual(await activeProjection(), 'elevation', 'reinterpreting units preserves the drawing view');
  elevation = await elevationOnPaper();
  assert.strictEqual(elevation.ratio, 50);
  assert(Math.abs(elevation.height - 36.576) < 0.05, 'a six-foot elevation measures 36.576 mm at 1:50');
  await choose('#drawingScale', 'auto');
  elevation = await elevationOnPaper();
  assert(Math.abs(elevation.height - 1828.8 / elevation.ratio) < 0.05, 'Auto fit uses the newly interpreted feet');

  await page.click('#fileMenuToggle');
  await choose('#unitSelect', 'cm');
  await page.waitForFunction(() => document.querySelector('#importStatus').textContent.includes('Centimetres (override)'));
  await page.locator('#fileMenuToggle').press('Escape');
  await choose('#drawingScale', '1');
  elevation = await elevationOnPaper();
  assert.strictEqual(elevation.ratio, 1);
  assert(Math.abs(elevation.height - 60) < 0.05, 'a 60 mm model measures 60 mm at 1:1');
  assert.match(await page.locator('#drawingSheet [data-layer="Title and scale"]').textContent(), /20 mm/);
  await choose('#drawingScale', 'auto');

  if (process.env.APP_URL) {
    const { r, bytes } = await makeFixture();
    const reader = page.waitForResponse((response) => response.url().endsWith('/vendor/rhino3dm/rhino3dm.wasm'));
    await page.setInputFiles('#fileInput', { name: 'fixture.3dm', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
    assert((await reader).ok(), 'the browser loaded the local Rhino WebAssembly reader');
    await page.waitForFunction(() => document.querySelector('#importStatus').textContent.includes('12 triangles'));
    assert.strictEqual(await page.inputValue('#unitSelect'), 'auto', 'a new file clears the old override');
    assert.match(await page.locator('#importStatus').textContent(), /3\.0 m tall · Millimetres \(from file\)/);
    await page.click('#modeDraw');
    await choose('#drawingRendering', 'flat');
    await page.waitForFunction(() => document.querySelectorAll('#drawingSheet path').length > 3);
    await openOutput(page, 'svg');
    await page.check('#exportAnnotations');
    const rhinoDownload = await downloadSvg();
    const rhinoSvg = await fs.promises.readFile(await rhinoDownload.path(), 'utf8');
    assert.match(rhinoSvg, /fill="#c83c3c"/, 'The authored Rhino layer colour survives into vector fills');
    assert.match(rhinoSvg, /data-layer="Title and scale"/);
    assert.match(rhinoSvg, /<path[^>]*aria-label="fixture/);
    assert.doesNotMatch(rhinoSvg, /clip-path=|<clipPath\b|<text\b|font-family=|<image\b/);
    const wallColour = page.getByLabel('Colour for Walls', { exact: true });
    const originalWallColour = page.getByRole('img', { name: 'Original colour for Walls, #c83c3c' });
    assert.strictEqual(await wallColour.inputValue(), '#c83c3c');
    await wallColour.evaluate((el) => {
      el.value = '#3068a7';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    assert(await originalWallColour.isVisible());
    const recolouredDownload = await downloadSvg();
    assert.match(await fs.promises.readFile(await recolouredDownload.path(), 'utf8'), /fill="#3068a7"/);
    const customPaper = await page.locator('#customPaperChoices option').getAttribute('value');
    await choose('#drawingPaper', customPaper);
    await page.click('#newView');
    await page.fill('#savedViewName', 'Blue walls');
    await page.click('#saveView');
    await page.getByRole('button', { name: 'Reset colour for Walls' }).click();
    assert.strictEqual(await wallColour.inputValue(), '#c83c3c');
    await page.click('#recallView');
    assert.strictEqual(await wallColour.inputValue(), '#3068a7');
    assert(await originalWallColour.isVisible());
    const scaleBar = await page.evaluate((source) => {
      const svg = new DOMParser().parseFromString(source, 'image/svg+xml');
      const bar = svg.querySelector('[data-scale-metres]');
      return {
        length: Number(bar.getAttribute('x2')) - Number(bar.getAttribute('x1')),
        expected: Number(bar.dataset.scaleMetres) * 1000 * 72 / (25.4 * Number(svg.querySelector('[data-scale-ratio]').dataset.scaleRatio))
      };
    }, rhinoSvg);
    assert(Math.abs(scaleBar.length - scaleBar.expected) < 1e-6, 'exported geometry and scale bar share physical point coordinates');
    await choose('#drawingPenMode', 'rhino');
    await page.locator('#drawingRhinoLayerWeights').getByText('No print').waitFor();
    await openOutput(page, 'svg');
    await page.uncheck('#exportAnnotations');
    const plotDownload = await downloadSvg();
    const plotSvg = await fs.promises.readFile(await plotDownload.path(), 'utf8');
    assert.match(plotSvg, /data-layer="Rhino print width · 0.66 mm"/);
    const plotStroke = await page.evaluate((source) => {
      const svg = new DOMParser().parseFromString(source, 'image/svg+xml');
      return Number(svg.querySelector('[data-layer="Rhino print width · 0.66 mm"] path').getAttribute('stroke-width'));
    }, plotSvg);
    assert(Math.abs(plotStroke - 0.66 * 72 / 25.4) < 1e-6);
    await choose('#drawingPaper', 'tabloid');
    await choose('#drawingOrientation', 'landscape');
    await openOutput(page, 'pdf');
    const [pdfDownload] = await Promise.all([page.waitForEvent('download'), page.click('#confirmSheetExport')]);
    assert.match(pdfDownload.suggestedFilename(), /-tabloid-1-\d+\.pdf$/);
    const pdf = await fs.promises.readFile(await pdfDownload.path(), 'latin1');
    assert.match(pdf, /^%PDF-/);
    assert.strictEqual(pdf.match(/\/MediaBox \[[^\]]+\]/)?.[0], '/MediaBox [0 0 1224. 792.]');
    assert.doesNotMatch(pdf, /\/Subtype \/Image\b/);

    await page.click('#fileMenuToggle');
    const [projectDownload] = await Promise.all([page.waitForEvent('download'), page.click('#saveProject')]);
    assert.match(projectDownload.suggestedFilename(), /\.fixboi$/);
    const projectData = await fs.promises.readFile(await projectDownload.path());
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    try {
      const reopened = await context.newPage();
      await reopened.goto(appUrl);
      await reopened.setInputFiles('#fileInput', { name: projectDownload.suggestedFilename(), mimeType: 'application/octet-stream', buffer: projectData });
      await reopened.locator('#openSheetExport:enabled').waitFor();
      await reopened.click('#openSheetExport');
      assert.strictEqual(await reopened.locator('#exportPdfTab').getAttribute('aria-selected'), 'true');
      await reopened.keyboard.press('Escape');
      assert.strictEqual(await reopened.inputValue('#drawingPaper'), 'tabloid');
      assert.strictEqual(await reopened.inputValue('#unitSelect'), 'auto');
      assert.strictEqual(await reopened.getByLabel('Colour for Walls', { exact: true }).inputValue(), '#3068a7');
      await reopened.locator('#savedViews').getByRole('button', { name: /^Blue walls/ }).click();
      await reopened.click('#recallView');
      assert.strictEqual(await reopened.locator('#drawingPaper option:checked').textContent(), 'Desk proof · 250 × 400 mm');
      const sourceMatches = await reopened.evaluate(async (projectBytes) => {
        const file = new File([Uint8Array.from(projectBytes)], 'fixture.fixboi');
        const { modelFile } = await readDrawingProject(file);
        return [...new Uint8Array(await modelFile.arrayBuffer())];
      }, Array.from(projectData));
      assert(Buffer.from(sourceMatches).equals(Buffer.from(bytes)), 'project carries the exact Rhino source bytes');

      await reopened.click('#paperTab');
      await reopened.fill('#drawingRevision', 'R2');
      await reopened.selectOption('#drawingScale', '50');
      await reopened.getByRole('checkbox', { name: 'Lines', exact: true }).uncheck();
      await reopened.click('#penMenuToggle');
      await reopened.selectOption('#drawingPenMode', 'component');
      const penFor = (tab, name) => tab.locator('#drawingPenComponents').getByLabel(name, { exact: true });
      await penFor(reopened, 'Walls').selectOption('2');
      await reopened.click('#clipMenuToggle');
      await reopened.click('#addDrawingPlane');
      await reopened.selectOption('#drawingPlaneAxis', 'horizontal');
      await reopened.fill('#drawingPlaneOffset', '2.8');
      await reopened.locator('#drawingPlaneOffset').press('Tab');
      await reopened.locator('#openSheetExport:enabled').waitFor();
      const drawingBefore = await reopened.locator('#drawingSheet').innerHTML();
      const cameraBefore = await reopened.evaluate(() => viewer.projectState());

      async function replaceModel(tab, name, buffer, statusText) {
        await tab.click('#fileMenuToggle');
        const [picker] = await Promise.all([tab.waitForEvent('filechooser'), tab.click('#replaceRhinoModel')]);
        await picker.setFiles({ name, mimeType: 'application/octet-stream', buffer });
        await tab.waitForFunction((text) => document.querySelector('#importStatus').textContent.includes(text), statusText);
      }
      const revisionBytes = Buffer.from(makeRhinoRevision(r, bytes));
      await replaceModel(reopened, 'revision.3dm', revisionBytes, 'Model updated from revision.3dm');
      await reopened.locator('#openSheetExport:enabled').waitFor();
      assert.notStrictEqual(await reopened.locator('#drawingSheet').innerHTML(), drawingBefore);
      assert.deepStrictEqual(await reopened.evaluate(() => viewer.projectState()), cameraBefore);
      assert.strictEqual(await reopened.inputValue('#drawingScale'), '50');
      assert.strictEqual(await reopened.inputValue('#drawingPlaneOffset'), '2.8', 'a cut above the new geometry stays at its saved height');
      assert.strictEqual(await reopened.getByLabel('Colour for Envelope', { exact: true }).inputValue(), '#3068a7');
      assert.strictEqual(await reopened.getByLabel('Colour for Walls', { exact: true }).inputValue(), '#467837');
      await reopened.click('#penMenuToggle');
      assert.strictEqual(await penFor(reopened, 'Envelope').inputValue(), '2');
      await reopened.click('#fileMenuToggle');
      assert.match(await reopened.locator('#modelUnitsUsed').textContent(), /metres \(from file\)/);
      assert.match(await reopened.locator('#projectModelSource').textContent(), /revision\.3dm/);
      await reopened.locator('#fileMenuToggle').press('Escape');
      await replaceModel(reopened, 'unreadable.3dm', Buffer.from('unreadable'), 'Could not replace the Rhino model');
      assert.strictEqual(await reopened.inputValue('#drawingScale'), '50');
      assert.strictEqual(await reopened.getByLabel('Colour for Envelope', { exact: true }).inputValue(), '#3068a7');
      await reopened.click('#fileMenuToggle');
      const [revisedProject] = await Promise.all([reopened.waitForEvent('download'), reopened.click('#saveProject')]);
      const revisedData = await fs.promises.readFile(await revisedProject.path());
      const clean = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      try {
        await clean.goto(appUrl);
        await clean.setInputFiles('#fileInput', { name: revisedProject.suggestedFilename(), mimeType: 'application/octet-stream', buffer: revisedData });
        await clean.locator('#openSheetExport:enabled').waitFor();
        assert.strictEqual(await clean.inputValue('#drawingRevision'), 'R2');
        assert.strictEqual(await clean.inputValue('#drawingScale'), '50');
        await clean.click('#clipMenuToggle');
        assert.strictEqual(await clean.inputValue('#drawingPlaneOffset'), '2.8');
        assert.strictEqual(await clean.getByLabel('Colour for Envelope', { exact: true }).inputValue(), '#3068a7');
        await clean.click('#fileMenuToggle');
        await clean.selectOption('#unitSelect', 'm');
        await clean.waitForFunction(() => document.querySelector('#importStatus').textContent.includes('Metres (override)'));
        await clean.locator('#fileMenuToggle').press('Escape');
        await replaceModel(clean, 'restored.3dm', Buffer.from(bytes), 'Model updated from restored.3dm');
        assert.strictEqual(await clean.inputValue('#unitSelect'), 'auto');
        assert.strictEqual(await clean.inputValue('#drawingPlaneOffset'), '2.8');
        assert.strictEqual(await clean.getByRole('checkbox', { name: 'Lines', exact: true }).isChecked(), false,
          'a returning layer recovers its visibility');
        await clean.locator('#savedViews').getByRole('button', { name: /^Blue walls/ }).click();
        await clean.click('#recallView');
        assert.strictEqual(await clean.locator('#drawingPaper option:checked').textContent(), 'Desk proof · 250 × 400 mm');
        assert.strictEqual(await clean.getByLabel('Colour for Walls', { exact: true }).inputValue(), '#3068a7');
      } finally {
        await clean.close();
      }
    } finally {
      await context.close();
    }
  }

  await page.reload();
  assert.strictEqual(await page.locator('#customPaperChoices option').textContent(), 'Desk proof · 250 × 400 mm');
  await page.click('#fileMenuToggle');
  await page.click('#loadSample');
  await page.click('#modeDraw');
  assert.strictEqual(await page.inputValue('#drawingNumber'), 'A-101');
  assert.strictEqual(await page.inputValue('#drawingRevision'), 'B');
  await savedRow('Issue axonometric').click();
  await page.click('#recallView');
  assert.strictEqual(await page.inputValue('#drawingPaper'), 'a3');
  assert.strictEqual(await page.locator('#drawingPlanes button[aria-pressed=true]').count(), 1);
  assert.strictEqual(await firstLayer.isChecked(), false);
  await openOutput(page, 'svg');
  assert.strictEqual(await page.isChecked('#exportPaper'), false);
  assert.strictEqual(await page.isChecked('#exportAnnotations'), false);
  assert.strictEqual(await page.inputValue('#exportPaths'), 'individual');
  await page.keyboard.press('Escape');
  assert(await exportDialog.isHidden());

  await page.click('#renameView');
  await page.fill('#savedViewName', 'Issued axonometric');
  await page.click('#saveView');
  assert(await savedRow('Issued axonometric').isVisible());
  await page.click('#newView');
  await page.fill('#savedViewName', 'issued axonometric');
  await page.click('#saveView');
  assert.match(await page.locator('#savedViewError').textContent(), /already in use/);
  await page.keyboard.press('Escape');
  await page.click('#paperTab');
  await page.fill('#drawingRevision', 'D');
  await page.click('#updateView');
  await page.click('#saveView');
  await page.fill('#drawingRevision', 'E');
  await savedRow('Issued axonometric').press('Enter');
  assert.strictEqual(await page.inputValue('#drawingRevision'), 'D');
  await page.click('#deleteView');
  assert(await page.locator('#cancelViewAction').evaluate(el => el === document.activeElement));
  await page.keyboard.press('Escape');
  assert(await savedRow('Issued axonometric').isVisible());

  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.locator('#drawingControls').isHidden());
  assert(await page.locator('#openSheetExport').isHidden());
  assert(await page.locator('#drawingStage .mobile-view-note').isVisible());
  assert(await page.locator('#drawingSheet').isVisible());
  await page.locator('#expandDrawing:enabled').waitFor();
  await page.click('#expandDrawing');
  assert(await expanded.isVisible());
  assert((await expanded.boundingBox()).width === 390);
  await expanded.getByRole('button', { name: 'Close', exact: true }).click();
  await savedRow('Issued axonometric').click();
  await page.click('#recallView');
  assert.strictEqual(await page.inputValue('#drawingRevision'), 'D');
  await page.click('#modeNav');
  assert(await page.locator('#navCanvas').isVisible());
  assert(await page.locator('#navToDrawing').isHidden());
  await savedRow('Issued axonometric').click();
  await page.click('#recallView');
  assert(await page.locator('#drawingSheet').isVisible(), 'a saved sheet opens from model space');
  await projection('plan');
  assert.strictEqual(await activeProjection(), 'plan');
  assert(await page.evaluate(() => document.documentElement.scrollWidth === window.innerWidth));
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.click('#deleteView');
  await page.click('#saveView');
  assert.strictEqual(await page.locator('#savedViews button').count(), 0);

  const exportPage = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  exportPage.on('pageerror', (error) => errors.push(error.message));
  try {
    const { readPsd, initializeCanvas } = require('../src/vendor/ag-psd.min.js');
    initializeCanvas(() => { throw Error('PSD tests read raw pixel data'); }, (width, height) =>
      ({ width, height, data: new Uint8ClampedArray(width * height * 4) }));
    const readOptions = { useImageData: true, skipThumbnail: true };
    await exportPage.goto(appUrl);
    // The bottom face must point outwards for the section to enclose a hatchable solid.
    const closedBox = Buffer.from(obj.replace('f 1 2 3 4', 'f 1 4 3 2'));
    const openBox = () => exportPage.setInputFiles('#fileInput', { name: 'psd-test.obj', buffer: closedBox, mimeType: 'text/plain' });
    await openBox();
    await exportPage.click('#modeDraw');
    await exportPage.click('#paperTab');
    await exportPage.selectOption('#drawingPaper', 'tabloid');
    await exportPage.selectOption('#drawingOrientation', 'landscape');
    await exportPage.click('#clipMenuToggle');
    await exportPage.click('#addDrawingPlane');
    await exportPage.click('#alignDrawingPlane');
    await exportPage.selectOption('#drawingCutTreatment', 'crosshatch');
    const output = exportPage.getByRole('dialog', { name: 'Export and print' });
    const exportLauncher = exportPage.locator('#openSheetExport:enabled');
    const svgTab = exportPage.getByRole('tab', { name: 'SVG Illustrator' });
    const psdTab = exportPage.getByRole('tab', { name: 'PSD Photoshop' });
    await exportLauncher.waitFor();
    await exportLauncher.press('Enter');
    assert.strictEqual(await output.getByRole('tab').count(), 4);
    assert.match(await exportPage.locator('#exportSheetContext').textContent(), /Section · 1:\d+ · Tabloid · 17 × 11 in/);
    assert(await svgTab.evaluate((tab) => tab === document.activeElement));
    await svgTab.press('ArrowDown');
    assert.strictEqual(await psdTab.getAttribute('aria-selected'), 'true');
    assert(await psdTab.evaluate((tab) => tab === document.activeElement));
    await psdTab.press('End');
    assert.strictEqual(await exportPage.locator('#exportPrintTab').getAttribute('aria-selected'), 'true');
    assert(await exportPage.locator('#exportPrintScope').isHidden());
    await exportPage.locator('#exportPrintTab').press('Home');
    await exportPage.setViewportSize({ width: 475, height: 640 });
    await exportPage.waitForFunction(() => document.getElementById('exportFormats').getAttribute('aria-orientation') === 'horizontal');
    await svgTab.press('ArrowRight');
    assert.strictEqual(await psdTab.getAttribute('aria-selected'), 'true');
    const box = await output.boundingBox();
    assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= 475 && box.y + box.height <= 640);
    const action = await output.getByRole('button', { name: 'Download PSD' }).boundingBox();
    assert(action.y + action.height <= 640);
    await exportPage.setViewportSize({ width: 1400, height: 900 });
    await exportPage.keyboard.press('Escape');
    assert(await exportLauncher.evaluate((button) => button === document.activeElement));
    await exportPage.click('#openSheetExport');
    assert.strictEqual(await psdTab.getAttribute('aria-selected'), 'true');
    assert.strictEqual(await exportPage.inputValue('#psdResolution'), '300');
    const dimensions = await exportPage.locator('#psdDimensions').textContent();
    assert.match(dimensions.replace(/[^\d×]/g, ''), /^5100×3300$/);
    await exportPage.selectOption('#psdResolution', '600');
    assert(await exportPage.locator('#confirmSheetExport').isDisabled());
    assert.match(await output.getByRole('alert').textContent(), /Choose a lower resolution/);
    await exportPage.selectOption('#psdResolution', '300');
    await exportPage.uncheck('#psdPaper');

    async function readExport() {
      const [download] = await Promise.all([exportPage.waitForEvent('download'), exportPage.click('#confirmSheetExport')]);
      assert.match(download.suggestedFilename(), /-tabloid-1-\d+\.psd$/);
      return readPsd(await fs.promises.readFile(await download.path()), readOptions);
    }
    {
      const file = await readExport();
      assert.deepStrictEqual([file.width, file.height], [5100, 3300]);
      assert.strictEqual(file.imageResources.resolutionInfo.horizontalResolution, 300);
      assert.strictEqual(file.imageResources.resolutionInfo.verticalResolutionUnit, 'PPI');
      assert(file.imageResources.iccProfile.length > 0);
      assert.strictEqual(file.imageData.data[3], 0, 'paper off retains transparency in the merged image');
      assert.deepStrictEqual(file.children.map(({ name }) => name), ['Pen weights', 'Sections', 'Sheet annotations']);
      assert.deepStrictEqual(file.children[1].children.map(({ name }) => name), ['Cut hatch backing', 'Cut hatch', 'Section cuts']);
      const hatch = file.children[1].children[1];
      assert(hatch.left > 0 && hatch.right < file.width, 'the hatch bitmap is positioned within the sheet');
      assert(hatch.imageData.data.some((channel, i) => i % 4 === 3 && channel > 0), 'the hatch has visible pixels');
      assert.strictEqual(file.children[2].children[0].name, 'Title and scale');
    }

    // A 0.50 mm stroke should cover about 5.91 pixels at 300 ppi, counting antialiased edges.
    const straightLine = await exportPage.evaluate(async () => {
      const sheet = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88">
        <g data-layer="Pen 1"><path d="M10 44H78" stroke="black" stroke-width="${0.5 * 88 / 25.4}" /></g>
        </svg>`, 'image/svg+xml');
      return [...await createDrawingPsd(sheet.documentElement, { width: 1, height: 1 }, 300, new AbortController().signal, () => {})];
    });
    const stroke = readPsd(Uint8Array.from(straightLine), readOptions).children[0].children[0].imageData;
    let coverage = 0;
    for (let row = 0; row < stroke.height; row++) coverage += stroke.data[(row * stroke.width + (stroke.width >> 1)) * 4 + 3] / 255;
    assert(Math.abs(coverage - 0.5 * 300 / 25.4) < 0.2, `0.50 mm stroke exported with ${coverage} px coverage`);

    await openOutput(exportPage, 'psd');
    await exportPage.selectOption('#psdResolution', '150');
    await exportPage.check('#psdPaper');
    await exportPage.uncheck('#psdAnnotations');
    const second = await readExport();
    assert.deepStrictEqual([second.width, second.height], [2550, 1650]);
    assert.strictEqual(second.imageResources.resolutionInfo.verticalResolution, 150);
    assert.strictEqual(second.children[0].name, 'Paper');
    assert.strictEqual(second.imageData.data[3], 255);
    assert(!second.children.some(({ name }) => name === 'Sheet annotations'));
    assert.deepStrictEqual(await exportPage.evaluate(() => openDrawingWorkspace.projectState().export.psd),
      { ppi: 150, paper: true, annotations: false }, 'PSD preferences are included in project settings');
    await exportPage.reload();
    await openBox();
    await exportPage.click('#modeDraw');
    await openOutput(exportPage, 'psd');
    assert.strictEqual(await exportPage.inputValue('#psdResolution'), '150');
    assert.strictEqual(await exportPage.isChecked('#psdAnnotations'), false);
    await exportPage.keyboard.press('Escape');
    await openOutput(exportPage, 'svg');
    assert.strictEqual(await exportPage.isChecked('#exportAnnotations'), true, 'PSD preferences are independent of SVG preferences');
    await exportPage.keyboard.press('Escape');
    await exportPage.click('[data-sheet-view="plan"]');
    await exportPage.click('#paperTab');
    await exportPage.selectOption('#drawingPlanSheet', 'floors');
    await openOutput(exportPage, 'psd');
    await exportPage.check('#psdAnnotations');
    const floorSet = await readExport();
    assert.deepStrictEqual(floorSet.children.find(({ name }) => name === 'Sheet annotations').children.map(({ name }) => name),
      ['Floor labels', 'Title and scale']);
    await exportPage.evaluate(() => {
      window.print = () => {
        window.printPreview = {
          dialogOpen: document.getElementById('sheetExport').open,
          sheets: [...document.querySelectorAll('#drawingPrintPages > svg')].map((page) => ({
            width: page.getAttribute('width'), height: page.getAttribute('height'), paths: page.querySelectorAll('path').length
          }))
        };
        window.dispatchEvent(new Event('afterprint'));
      };
    });
    await openOutput(exportPage, 'print');
    assert(await output.getByRole('radio', { name: 'Current sheet' }).isChecked());
    await output.getByRole('button', { name: 'Print sheet' }).click();
    await exportPage.waitForFunction(() => window.printPreview?.sheets.length === 1);
    assert.strictEqual(await exportPage.evaluate(() => window.printPreview.dialogOpen), false);
    await openOutput(exportPage, 'print');
    await output.getByRole('radio', { name: 'One sheet per floor (2 pages)' }).check();
    await output.getByRole('button', { name: 'Print floor set' }).click();
    await exportPage.waitForFunction(() => window.printPreview?.sheets.length === 2);
    const pages = await exportPage.evaluate(() => window.printPreview);
    assert.strictEqual(pages.dialogOpen, false);
    assert(pages.sheets.every(({ width, height, paths }) => width === '17in' && height === '11in' && paths > 0));
  } finally {
    await exportPage.close();
  }

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('smoke test passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
