const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect, args, Png } = require('trmnlp-test');
const { PNG } = require('pngjs');

// a reference drawn independently of the plugin: black where `ink(x, y)`, white elsewhere,
// at a different size than the render, as a photo or a scan would be
function referenceFile(name, width, height, ink) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, v = ink(x / width, y / height) ? 0 : 255;
    png.data[i] = png.data[i + 1] = png.data[i + 2] = v; png.data[i + 3] = 255;
  }
  const file = path.join(os.tmpdir(), `trmnlp-test-ref-${process.pid}-${name}.png`);
  fs.writeFileSync(file, PNG.sync.write(png));
  return file;
}

// the left half black: a 200 x 100 drawing
const drawing = '<svg data-shape width="200" height="100" viewBox="0 0 2 1"><rect width="2" height="1" fill="#fff"/><rect width="1" height="1" fill="#000"/></svg>';

test.describe('reference images', () => {
  test('a drawing matches its reference at another size', async ({ trmnl }) => {
    const screen = await trmnl.renderMarkup(drawing, { bare: true });
    const same = referenceFile('same', 600, 300, (x) => x < 0.5);
    const r = await screen.compareReference(same, { selector: '[data-shape]' });
    expect(r.iou).toBeGreaterThan(0.97);
    await expect(screen).toMatchReference(same, { selector: '[data-shape]', minIoU: 0.97 });
  });

  test('a shifted drawing does not, and the score says how far off it is', async ({ trmnl }) => {
    const screen = await trmnl.renderMarkup(drawing, { bare: true });
    const shifted = referenceFile('shifted', 600, 300, (x) => x > 0.25 && x < 0.75);
    const r = await screen.compareReference(shifted, { selector: '[data-shape]' });
    expect(r.iou).toBeGreaterThan(0.25);
    expect(r.iou).toBeLessThan(0.4);
    await expect(screen).not.toMatchReference(shifted, { selector: '[data-shape]', minIoU: 0.9 });
  });

  test('refRect picks the matching part of a larger reference', async ({ trmnl }) => {
    const screen = await trmnl.renderMarkup(drawing, { bare: true });
    // the drawing sits in the right half of a 1200 x 300 photo
    const photo = referenceFile('photo', 1200, 300, (x) => x >= 0.5 && x < 0.75);
    await expect(screen).toMatchReference(photo, { selector: '[data-shape]', refRect: { x: 600, y: 0, width: 600, height: 300 }, minIoU: 0.97 });
  });

  test('Png reads, resizes and compares images', async () => {
    const a = Png.fromFile(referenceFile('a', 40, 20, (x) => x < 0.5));
    const b = a.resize(80, 40);
    expect([b.width, b.height]).toEqual([80, 40]);
    expect(b.iou(b)).toBe(1);
    expect(b.diff(b.inverted()).colors().sort()).toEqual(['#0046dc', '#dc0000']);
  });
});

test.describe('orientation after load', () => {
  test('setOrientation turns the screen and the picture', async ({ trmnl }) => {
    const screen = await trmnl.render({ device: 'og_plus', webhook: { sensor: { temperature: 3 } } });
    await screen.setOrientation('portrait');
    expect(screen.classes).toContain('screen--portrait');
    expect(screen).toRenderCleanly();
    expect([(await screen.png()).width, (await screen.png()).height]).toEqual([480, 800]);
    await screen.setOrientation('landscape');
    expect([(await screen.png()).width, (await screen.png()).height]).toEqual([800, 480]);
    expect(screen).toRenderCleanly();
  });
});

test('command-line arguments after -- reach the specs', () => {
  expect(Array.isArray(args)).toBe(true);
  if (process.env.TRMNLP_TEST_EXPECT_ARGS) expect(args).toEqual(JSON.parse(process.env.TRMNLP_TEST_EXPECT_ARGS));
});

test('a skipped test says why', () => {
  test.skip(true, 'demonstrates skip reasons in the console and the report');
});
