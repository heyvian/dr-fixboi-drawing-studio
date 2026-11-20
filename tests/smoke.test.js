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
  await page.waitForFunction(() => document.querySelectorAll('#drawingSheet path').length > 3, null, { timeout: 30000 });
  await shot('sample');

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
