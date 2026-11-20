// Browser smoke test: opens index.html from file:// in Edge, loads the sample and an OBJ,
// and fails on any console or page error. Set SHOT=dir to save screenshots.
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('file://' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/'));

  const paths = () => page.locator('#drawingSheet path').count();
  const shot = async (name) => process.env.SHOT && (await page.screenshot({ path: path.join(process.env.SHOT, name + '.png') }));

  await page.click('#loadSample');
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
  const canvas = await page.locator('#navCanvas').boundingBox();
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width / 2 + 120, canvas.y + canvas.height / 2 - 40, { steps: 8 });
  await page.mouse.up();
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
  await page.click('#navExtents');
  await page.click('#modeDraw');
  await page.waitForFunction(() => document.querySelectorAll('#drawingSheet path').length > 3, null, { timeout: 30000 });
  await page.selectOption('#drawingView', 'axo');

  // Toggle the first layer off and on again.
  const box = page.locator('#layerList input[type=checkbox]').first();
  await box.uncheck();
  await page.waitForTimeout(500);
  await box.check();
  await page.waitForFunction(() => document.querySelectorAll('#drawingSheet path').length > 3, null, { timeout: 30000 });

  const obj = path.join(os.tmpdir(), 'smoke.obj');
  fs.writeFileSync(obj, 'o Box\nv 0 0 0\nv 10 0 0\nv 10 8 0\nv 0 8 0\nv 0 0 6\nv 10 0 6\nv 10 8 6\nv 0 8 6\n' +
    'f 1 2 3 4\nf 5 6 7 8\nf 1 2 6 5\nf 2 3 7 6\nf 3 4 8 7\nf 4 1 5 8\n');
  await page.setInputFiles('#fileInput', obj);
  await page.waitForTimeout(2500);
  assert((await paths()) > 1, 'OBJ renders');
  await shot('obj');

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('smoke test passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
