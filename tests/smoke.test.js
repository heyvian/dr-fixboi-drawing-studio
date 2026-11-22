// Defaults to file:// in Edge. Set APP_URL for a running dev server, BROWSER_EXECUTABLE for a
// local Chromium browser, or SHOT to capture screenshots.
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');
const { makeFixture } = require('./fixture');

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

  const shot = async (name) => process.env.SHOT && (await page.screenshot({ path: path.join(process.env.SHOT, name + '.png') }));

  await page.locator('#fileMenuToggle').press('Enter');
  assert(await page.locator('#loadSample').isVisible());
  await page.click('#loadSample');
  assert.strictEqual(await page.locator('#fileMenu[open]').count(), 0);
  // A new model opens in 3D navigation. Orbit and zoom, then draw that view.
  await page.waitForSelector('#navStage:not([hidden])');
  await page.waitForTimeout(500);
  await shot('nav-home');
  assert.ok(await page.evaluate(() => viewer.edgeCount) > 0, 'mesh edges are drawn');
  for (const name of ['objects', 'open', 'creases', 'silhouettes']) await page.uncheck(`[data-line=${name}]`);
  await page.waitForTimeout(300);
  assert.strictEqual(await page.evaluate(() => viewer.edgeCount), 0, 'edge toggles turn the linework off');
  for (const name of ['objects', 'open', 'creases', 'silhouettes']) await page.check(`[data-line=${name}]`);
  await page.waitForTimeout(300);
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
  assert(navCompass.y + navCompass.height <= canvas.y, 'the compass sits above the model viewport');
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
  await page.click('#modeDraw');
  await page.waitForFunction(() => document.querySelectorAll('#drawingSheet path').length > 3, null, { timeout: 30000 });
  assert.strictEqual(await page.inputValue('#drawingView'), 'nav', 'drawing uses the 3D view');
  assert(await page.locator('#groundDrawing').isDisabled(), 'plan views have no vertical ground datum');
  await shot('draw-from-nav');

  // Changing scale keeps the framing: the sheet centre must not jump back to the model centre.
  const sheetBefore = await page.locator('#drawingSheet').innerHTML();
  await page.selectOption('#drawingScale', { index: 6 });
  await page.waitForTimeout(600);
  await shot('draw-rescaled');
  assert.notStrictEqual(await page.locator('#drawingSheet').innerHTML(), sheetBefore);

  // Going back to 3D keeps its own camera.
  await page.click('#modeNav');
  await page.waitForTimeout(300);
  await shot('nav-again');
  await page.click('.nav-views [data-view=iso]');
  await page.click('#navExtents');
  await page.click('#modeDraw');
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
  await page.locator('#exportDrawing:enabled').waitFor();
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
  await page.locator('#exportDrawing:enabled').waitFor();
  assert.strictEqual(await page.inputValue('#drawingView'), 'plan');
  assert.strictEqual(await page.inputValue('#drawingPlanSheet'), 'single');
  const planPaths = await page.locator('#drawingLinework').getAttribute('d');
  await page.selectOption('#drawingPlanSheet', 'floors');
  assert(await page.locator('#drawingSheet').evaluate(sheet => sheet.classList.contains('planset')));
  await page.locator('[data-sheet-view="elevation"]').click();
  await page.locator('#exportDrawing:enabled').waitFor();
  const elevationPaths = await page.locator('#drawingLinework').getAttribute('d');
  assert.notStrictEqual(elevationPaths, planPaths);
  await page.locator('#drawingSheet').press('ArrowRight');
  await page.waitForFunction((before) => document.querySelector('#drawingLinework')?.getAttribute('d') !== before, elevationPaths);
  await page.locator('[data-sheet-view="plan"]').click();
  assert.strictEqual(await page.inputValue('#drawingPlanSheet'), 'single');
  await page.locator('[data-sheet-view="nav"]').click();
  assert.deepStrictEqual(await page.evaluate(() => viewer.snapshot()), capturedCamera);
  assert(await page.locator('#navStage').isHidden());
  await page.selectOption('#drawingView', 'axo');
  await page.locator('#exportDrawing:enabled').waitFor();
  const axo = await page.locator('#drawingLinework').getAttribute('d');
  const southwest = page.locator('#drawingCompass [data-compass-point="SW"]');
  await southwest.click();
  assert.strictEqual(await southwest.getAttribute('aria-pressed'), 'true');
  await page.locator('#exportDrawing:enabled').waitFor();
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

  await page.fill('#savedViewName', 'Issue axonometric');
  await page.fill('#drawingNumber', 'A-101');
  await page.fill('#drawingRevision', 'B');
  await page.selectOption('#drawingPaper', 'a3');
  await page.selectOption('#drawingScale', 'auto');
  await page.click('#clipMenuToggle');
  assert(await page.locator('#drawingNoPlanes').isVisible());
  await page.click('#addDrawingPlane');
  assert.strictEqual(await page.locator('#drawingView option[value="aligned"]').isDisabled(), false);
  await page.click('#alignDrawingPlane');
  assert.strictEqual(await page.inputValue('#drawingView'), 'aligned');
  await projection('axo');
  await page.locator('.drawing-pen-settings summary').click();
  assert(await page.locator('.sheet-toolbar #drawingDistanceFrom').isVisible());
  await page.locator('#drawingDistanceFrom').press('ArrowRight');
  const nearWeight = await page.inputValue('#drawingDistanceFrom');
  assert.deepStrictEqual(await page.locator('#drawingDepthBands li span:last-child').allTextContents(),
    ['0%–34%', '34%–67%', '67%–100%']);
  assert.strictEqual(await page.isChecked('#drawingAdaptWeights'), false);
  const firstLayer = page.locator('#layerList input[type=checkbox]').first();
  await firstLayer.uncheck();
  await page.click('#saveView');
  await firstLayer.check();
  await page.selectOption('#drawingPaper', 'letter');
  await page.fill('#drawingRevision', 'C');
  await page.locator('#drawingDistanceFrom').press('Home');
  await page.click('#recallView');
  assert.strictEqual(await page.inputValue('#drawingPaper'), 'a3');
  assert.strictEqual(await page.inputValue('#drawingRevision'), 'B');
  assert.strictEqual(await page.inputValue('#drawingDistanceFrom'), nearWeight);
  assert.strictEqual(await firstLayer.isChecked(), false);
  await page.waitForFunction(() => document.querySelector('#drawingSheet').textContent.includes('A-101 · REV B'));

  await page.locator('.drawing-export-help summary').click();
  await page.uncheck('#exportPaper');
  await page.uncheck('#exportAnnotations');
  await page.selectOption('#exportPaths', 'individual');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportDrawing')]);
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
  await page.locator('#clipMenuToggle').press('Escape');
  await firstLayer.check();
  await firstLayer.uncheck();
  await page.waitForTimeout(500);
  await firstLayer.check();
  await page.waitForFunction(() => document.querySelectorAll('#drawingSheet path').length > 3, null, { timeout: 30000 });

  const obj = 'o Box\nv 0 0 0\nv 10 0 0\nv 10 8 0\nv 0 8 0\nv 0 0 6\nv 10 0 6\nv 10 8 6\nv 0 8 6\n' +
    'f 1 2 3 4\nf 5 6 7 8\nf 1 2 6 5\nf 2 3 7 6\nf 3 4 8 7\nf 4 1 5 8\n';
  await page.setInputFiles('#fileInput', { name: 'smoke.obj', mimeType: 'text/plain', buffer: Buffer.from(obj) });
  await page.waitForFunction(() => document.querySelector('#importStatus').textContent.includes('smoke.obj:'));
  await page.click('#modeDraw');
  await page.waitForFunction(() => {
    const sheet = document.querySelector('#drawingSheet');
    return sheet.textContent.includes('smoke') && sheet.querySelectorAll('path').length > 1;
  });
  assert.strictEqual(await page.locator('#savedViews option').count(), 1, 'saved views are isolated by model');
  await shot('obj');

  await page.selectOption('#drawingPaper', 'custom');
  await page.fill('#customPaperName', 'Desk proof');
  await page.fill('#customPaperWidth', '250');
  await page.fill('#customPaperHeight', '400');
  await page.getByRole('button', { name: 'Save and use' }).click();
  assert.strictEqual(await page.inputValue('#drawingOrientation'), 'portrait');
  await projection('elevation');
  await page.selectOption('#drawingBodies', 'none');
  await page.click('#penMenuToggle');
  assert.strictEqual(await page.isChecked('#drawingGroundLine'), false);
  await page.check('#drawingSilhouette');
  await page.getByRole('spinbutton', { name: 'Overall silhouette width (mm)' }).fill('0.82');
  await page.getByRole('spinbutton', { name: 'Overall silhouette width (mm)' }).press('Tab');
  await page.check('#drawingGroundLine');
  const [customDownload] = await Promise.all([page.waitForEvent('download'), page.click('#exportDrawing')]);
  assert.match(customDownload.suggestedFilename(), /-Desk_proof-1-\d+\.svg$/);
  const customSvg = await fs.promises.readFile(await customDownload.path(), 'utf8');
  assert.match(customSvg, /data-weight-mm="0.82"[^>]+data-layer="Overall silhouette"/);
  assert.match(customSvg, /data-weight-mm="0.25"[^>]+data-layer="Ground line"/);
  const customBox = customSvg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number);
  assert(customBox.every((value, index) => Math.abs(value - [250, 400][index] * 72 / 25.4) < 1e-6));
  await page.uncheck('#drawingSilhouette');
  await page.uncheck('#drawingGroundLine');
  await page.selectOption('#drawingBodies', 'layer');
  await page.check('#drawingComponentOutlines');
  await page.locator('#drawingSheet [data-layer="Key outlines"] path').waitFor();
  await page.uncheck('#drawingComponentOutlines');

  if (process.env.APP_URL) {
    const { bytes } = await makeFixture();
    const reader = page.waitForResponse((response) => response.url().endsWith('/vendor/rhino3dm/rhino3dm.wasm'));
    await page.setInputFiles('#fileInput', { name: 'fixture.3dm', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
    assert((await reader).ok(), 'the browser loaded the local Rhino WebAssembly reader');
    await page.waitForFunction(() => document.querySelector('#importStatus').textContent.includes('12 triangles'));
    await page.click('#modeDraw');
    await page.selectOption('#drawingRendering', 'flat');
    await page.waitForFunction(() => document.querySelectorAll('#drawingSheet path').length > 3);
    await page.check('#exportAnnotations');
    const [rhinoDownload] = await Promise.all([page.waitForEvent('download'), page.click('#exportDrawing')]);
    const rhinoSvg = await fs.promises.readFile(await rhinoDownload.path(), 'utf8');
    assert.match(rhinoSvg, /fill="#c83c3c"/, 'The authored Rhino layer colour survives into vector fills');
    assert.match(rhinoSvg, /data-layer="Title and scale"/);
    assert.match(rhinoSvg, /<path[^>]*aria-label="fixture/);
    assert.doesNotMatch(rhinoSvg, /clip-path=|<clipPath\b|<text\b|font-family=|<image\b/);
    const scaleBar = await page.evaluate((source) => {
      const svg = new DOMParser().parseFromString(source, 'image/svg+xml');
      const bar = svg.querySelector('[data-scale-metres]');
      return {
        length: Number(bar.getAttribute('x2')) - Number(bar.getAttribute('x1')),
        expected: Number(bar.dataset.scaleMetres) * 1000 * 72 / (25.4 * Number(svg.querySelector('[data-scale-ratio]').dataset.scaleRatio))
      };
    }, rhinoSvg);
    assert(Math.abs(scaleBar.length - scaleBar.expected) < 1e-6, 'exported geometry and scale bar share physical point coordinates');
    await page.selectOption('#drawingPenMode', 'rhino');
    await page.locator('#drawingRhinoLayerWeights').getByText('No print').waitFor();
    const [plotDownload] = await Promise.all([page.waitForEvent('download'), page.click('#exportDrawing')]);
    const plotSvg = await fs.promises.readFile(await plotDownload.path(), 'utf8');
    assert.match(plotSvg, /data-layer="Rhino print width · 0.66 mm"/);
    const plotStroke = await page.evaluate((source) => {
      const svg = new DOMParser().parseFromString(source, 'image/svg+xml');
      return Number(svg.querySelector('[data-layer="Rhino print width · 0.66 mm"] path').getAttribute('stroke-width'));
    }, plotSvg);
    assert(Math.abs(plotStroke - 0.66 * 72 / 25.4) < 1e-6);
    await page.uncheck('#exportAnnotations');
    await page.selectOption('#drawingPaper', 'tabloid');
    await page.selectOption('#drawingOrientation', 'landscape');
    const [pdfDownload] = await Promise.all([page.waitForEvent('download'), page.click('#exportBluebeam')]);
    assert.match(pdfDownload.suggestedFilename(), /-tabloid-1-\d+\.pdf$/);
    const pdf = await fs.promises.readFile(await pdfDownload.path(), 'latin1');
    assert.match(pdf, /^%PDF-/);
    assert.strictEqual(pdf.match(/\/MediaBox \[[^\]]+\]/)?.[0], '/MediaBox [0 0 1224. 792.]');
    assert.doesNotMatch(pdf, /\/Subtype \/Image\b/);
  }

  await page.reload();
  assert.strictEqual(await page.locator('#customPaperChoices option').textContent(), 'Desk proof · 250 × 400 mm');
  await page.click('#fileMenuToggle');
  await page.click('#loadSample');
  await page.click('#modeDraw');
  assert.strictEqual(await page.inputValue('#drawingNumber'), 'A-101');
  assert.strictEqual(await page.inputValue('#drawingRevision'), 'B');
  await page.selectOption('#savedViews', 'Issue axonometric');
  await page.click('#recallView');
  assert.strictEqual(await page.inputValue('#drawingPaper'), 'a3');
  assert.strictEqual(await page.locator('#drawingPlanes button[aria-pressed=true]').count(), 1);
  assert.strictEqual(await firstLayer.isChecked(), false);
  assert.strictEqual(await page.isChecked('#exportPaper'), false);
  assert.strictEqual(await page.inputValue('#exportPaths'), 'individual');

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('smoke test passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
