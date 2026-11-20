const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { test, expect } = require('@playwright/test');

async function openFlatFallback(page) {
  await page.route('**/src/main.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: "throw new Error('Simulated renderer startup failure');",
  }));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-render', 'flat');
  await expect(page.locator('#fallback')).toBeVisible();
  await expect(page.locator('#action')).toBeEnabled();
}

function collectBrowserErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

function expectNoBrowserErrors(errors) {
  expect(errors, errors.join('\n')).toEqual([]);
}

async function finishBirthdayFlow(page) {
  const action = page.locator('#action');
  await expect(action).toHaveText(/点亮这一刻/);
  await action.click();
  await expect(page.locator('html')).toHaveAttribute('data-state', 'burning', { timeout: 3_000 });
  await expect(action).toHaveText(/许好了，吹灭蜡烛/);
  await action.click();
  await expect(page.locator('html')).toHaveAttribute('data-phase', 'celebrate', { timeout: 4_000 });
  await expect(page.locator('#wish-title')).toBeVisible();
}

async function inspectScene(page, canvas, name) {
  const screenshot = await canvas.screenshot({ path: test.info().outputPath(`${name}.png`) });
  return page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const sample = document.createElement('canvas');
    sample.width = 100;
    sample.height = 100;
    const context = sample.getContext('2d');
    context.drawImage(img, 0, 0, 100, 100);
    const { data: pixels } = context.getImageData(0, 0, 100, 100);
    let cake = 0;
    let edge = 0;
    let flame = 0;
    for (let y = 2; y < 98; y++) {
      for (let x = 2; x < 98; x++) {
        const i = (y * 100 + x) * 4;
        const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
        if (y >= 45 && r >= 95 && g >= 70 && b >= 50) {
          if (x < 8 || x > 91 || y > 92) edge++;
          else cake++;
        }
        if (x >= 44 && x <= 56 && y >= 6 && y < 26 && r >= 150 && g >= 85 && r - b >= 20) flame++;
      }
    }
    return { cake, edge, flame };
  }, screenshot.toString('base64'));
}

test('2D fallback completes the flow and supports replay', async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await openFlatFallback(page);
  await finishBirthdayFlow(page);

  await expect(page.locator('#replay')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('desktop-letter.png') });
  await page.locator('#replay').click();

  await expect(page.locator('html')).toHaveAttribute('data-state', 'burning', { timeout: 3_000 });
  await expect(page.locator('html')).toHaveAttribute('data-phase', 'wish');
  expectNoBrowserErrors(errors);
});

test('keyboard shortcuts complete the flow and the PNG download is valid', async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await openFlatFallback(page);
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-state', 'burning', { timeout: 3_000 });
  await page.keyboard.press('Space');
  await expect(page.locator('html')).toHaveAttribute('data-phase', 'celebrate', { timeout: 4_000 });

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#action').click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), '烛光来信-生日祝福.png');
  const downloadedPath = await download.path();
  assert.ok(downloadedPath, 'Chromium should save the generated PNG');
  const png = await fs.readFile(downloadedPath);
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(png.readUInt32BE(16), 1080);
  assert.ok(png.readUInt32BE(20) >= 1500);
  expectNoBrowserErrors(errors);
});

test('mobile layout shows the welcome and letter without horizontal overflow', async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 320, height: 740 });
  await openFlatFallback(page);
  await expect(page.locator('#opening-title')).toBeVisible();
  await expect(page.locator('#action')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('mobile-welcome.png') });
  await finishBirthdayFlow(page);
  await page.screenshot({ path: test.info().outputPath('mobile-letter.png') });
  await expect(page.locator('#visual')).toHaveRole('img', { name: '生日蜡烛已熄灭，烛芯还留着余温' });

  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport);
  expectNoBrowserErrors(errors);
});

test('WebGL renders the 3D scene and context loss switches to 2D', async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.addInitScript(() => {
    const prototype = WebGL2RenderingContext.prototype;
    const drawArrays = prototype.drawArrays;
    const drawElements = prototype.drawElements;
    window.__candleDrawCalls = 0;
    prototype.drawArrays = function (...args) {
      window.__candleDrawCalls += 1;
      return drawArrays.apply(this, args);
    };
    prototype.drawElements = function (...args) {
      window.__candleDrawCalls += 1;
      return drawElements.apply(this, args);
    };
  });
  await page.goto('/');
  const canvas = page.locator('#stage canvas');
  await expect(canvas).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__candleDrawCalls)).toBeGreaterThan(0);

  const pixels = await inspectScene(page, canvas, 'desktop-webgl');
  expect(pixels.cake).toBeGreaterThan(150);
  expect(pixels.edge).toBeLessThan(25);
  await expect(page.locator('#visual')).toHaveRole('img', { name: '生日蛋糕上插着一支等待点亮的蜡烛' });
  const sound = page.locator('#mute');
  await expect(sound).toHaveAccessibleName('声音');
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
  await sound.click();
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
  await expect(sound).toHaveAccessibleName('声音');
  await sound.click();
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
  await canvas.evaluate((element) => {
    element.dispatchEvent(new WebGLContextEvent('webglcontextlost', { cancelable: true }));
  });
  await expect(page.locator('html')).toHaveAttribute('data-render', 'flat');
  await expect(page.locator('#fallback')).toBeVisible();
  await expect(page.locator('#action')).toBeEnabled();
  expectNoBrowserErrors(errors);
});

test('mobile WebGL keeps the cake in frame and shows the flame after lighting it', async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const canvas = page.locator('#stage canvas');
  await expect(page.locator('#action')).toBeEnabled();
  const unlit = await inspectScene(page, canvas, 'mobile-webgl-unlit');
  expect(unlit.cake).toBeGreaterThan(120);
  expect(unlit.edge).toBeLessThan(25);
  await page.locator('#action').click();
  await expect(page.locator('html')).toHaveAttribute('data-state', 'burning', { timeout: 10_000 });
  const lit = await inspectScene(page, canvas, 'mobile-webgl-lit');
  expect(lit.flame).toBeGreaterThan(unlit.flame + 2);

  await canvas.evaluate((element) => {
    element.dispatchEvent(new WebGLContextEvent('webglcontextlost', { cancelable: true }));
  });
  await expect(page.locator('html')).toHaveAttribute('data-render', 'flat');
  await expect(page.locator('html')).toHaveAttribute('data-state', 'burning');
  await page.locator('#action').click();
  await expect(page.locator('#wish-title')).toBeFocused();
  expectNoBrowserErrors(errors);
});

test('shader compilation failure switches to the 2D fallback', async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.addInitScript(() => {
    const prototype = WebGL2RenderingContext.prototype;
    const getProgramParameter = prototype.getProgramParameter;
    window.__candleForcedShaderFailures = 0;
    prototype.getProgramParameter = function (program, parameter) {
      if (parameter === this.LINK_STATUS) {
        window.__candleForcedShaderFailures += 1;
        return false;
      }
      return getProgramParameter.call(this, program, parameter);
    };
    prototype.getProgramInfoLog = () => 'forced shader program link failure';
  });

  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-render', 'flat', { timeout: 8_000 });
  expect(await page.evaluate(() => window.__candleForcedShaderFailures)).toBeGreaterThan(0);
  await expect(page.locator('#fallback')).toBeVisible();
  await expect(page.locator('#action')).toBeEnabled();
  const unexpectedErrors = errors.filter((error) => !error.includes('forced shader program link failure'));
  expectNoBrowserErrors(unexpectedErrors);
});
