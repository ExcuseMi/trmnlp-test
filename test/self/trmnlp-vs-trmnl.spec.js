// Where trmnlp renders differently from TRMNL (trmnl.com, observed 2026-10-02).
// Each `trmnlp:` test renders exactly as trmnlp does and asserts what TRMNL showed, so it fails.
// They are marked test.fail(): the suite stays green while trmnlp differs, and turns red the day
// trmnlp matches TRMNL, which is when trmnlp-test's workarounds (qr: 'server', darkMode: 'invert')
// can go. Each has a `trmnlp-test:` control with the same assertion, which must pass.
// TRMNLP_TEST_SHOW_DIFFERENCES=1 drops the marker, so the failures print as evidence.
const { test, expect } = require('trmnlp-test');

const differs = (why) => test.fail(!process.env.TRMNLP_TEST_SHOW_DIFFERENCES, why);

// what trmnlp itself does: trmnl-liquid's qr_code, and the framework's dark-mode class alone
const TRMNLP = { qr: 'trmnlp', darkMode: 'framework' };
const SERVER_SVG = /<svg width="(\d+)" height="\1" style="max-width:100%;height:auto" [^>]*viewBox="0 0 \1 \1"/;

test.describe('qr_code returns the svg with its natural size and a max-width', () => {
  test('trmnlp', async ({ trmnl }) => {
    differs('trmnl-liquid returns only the viewBox');
    const screen = await trmnl.plugin('../fixtures/qrbox').render(TRMNLP);
    expect(screen.markup).toMatch(SERVER_SVG);
  });
  test('trmnlp-test', async ({ trmnl }) => {
    const screen = await trmnl.plugin('../fixtures/qrbox').render();
    expect(screen.markup).toMatch(SERVER_SVG);
  });
});

test.describe('a code never grows past its natural size (231 px in a 600 px box)', () => {
  test('trmnlp', async ({ trmnl }) => {
    differs('without width, the svg fills its box');
    const screen = await trmnl.plugin('../fixtures/qrbox').render(TRMNLP);
    expect(Math.round((await screen.box('[data-box] svg')).width)).toBe(231);
  });
  test('trmnlp-test', async ({ trmnl }) => {
    const screen = await trmnl.plugin('../fixtures/qrbox').render();
    expect(Math.round((await screen.box('[data-box] svg')).width)).toBe(231);
  });
});

test.describe('qr_code ignores the view argument: "fixed" still has a viewBox', () => {
  test('trmnlp', async ({ trmnl }) => {
    differs('trmnl-liquid drops the viewBox for anything but "responsive"');
    const screen = await trmnl.plugin('../fixtures/qrbox').render(TRMNLP);
    expect(await screen.locator('[data-fixed] svg').getAttribute('viewBox')).toBeTruthy();
  });
  test('trmnlp-test', async ({ trmnl }) => {
    const screen = await trmnl.plugin('../fixtures/qrbox').render();
    expect(await screen.locator('[data-fixed] svg').getAttribute('viewBox')).toBeTruthy();
  });
});

// seen in the server's preview on framework 3.4; not yet confirmed on a device
test.describe('dark mode inverts an inline svg (everything but images)', () => {
  async function svgMargin(trmnl, opts) {
    const s = await trmnl.plugin('../fixtures/dark').render({ device: 'og_png', ...opts });
    const b = await s.box('[data-svg]');
    return (await s.png({ dither: false })).pixel(b.x + 4, b.y + 4).gray;
  }
  test('trmnlp', async ({ trmnl }) => {
    differs("the v3 dark-mode class leaves an inline svg's colours as they are");
    expect(await svgMargin(trmnl, { ...TRMNLP, darkMode: 'framework' })).toBe(0);
  });
  test('trmnlp-test', async ({ trmnl }) => {
    expect(await svgMargin(trmnl, { darkMode: true })).toBe(0);
  });
});
