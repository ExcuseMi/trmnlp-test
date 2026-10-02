const { test, expect, matrix, QR_MODES } = require('trmnlp-test');

test.describe('toShowText sees what is cut off', () => {
  test('visible text passes', async ({ trmnl }) => {
    const screen = await trmnl.plugin('../fixtures/text').render();
    await expect(screen).toShowText('Fully visible title');
  });
  for (const [what, text] of [['an ellipsis', 'Breakfast menu of the day'], ['a line clamp', 'thirteen fourteen'], ['the edge of the view', 'Off the edge']]) {
    test(`text cut off by ${what} fails, but is in the content`, async ({ trmnl }) => {
      const screen = await trmnl.plugin('../fixtures/text').render();
      await expect(screen).not.toShowText(text);
      await expect(screen).toShowText(text, { visible: false });
      const r = await screen.findText(text);
      expect(r.hidden.length).toBeGreaterThan(0);
    });
  }
});

test.describe('qr_code and line endings as TRMNL makes them', () => {
  test("default: the server's svg, viewBox plus natural size and max-width, whatever the view argument", async ({ trmnl }) => {
    const screen = await trmnl.plugin('../fixtures/quirks').render();
    expect(screen.markup).toMatch(/<svg width="(\d+)" height="\1" style="max-width:100%;height:auto" [^>]*viewBox="0 0 \1 \1"/);
    await expect(screen.locator('[data-count]')).toHaveText('3');
  });
  test("qr: 'trmnlp': a scalable svg with only the viewBox", async ({ trmnl }) => {
    const screen = await trmnl.plugin('../fixtures/quirks').render({ qr: 'trmnlp' });
    expect(screen.markup).toMatch(/<svg[^>]*viewBox/);
    expect(screen.markup).not.toMatch(/<svg[^>]*\swidth=/);
  });
  test("qr: 'fixed' (not seen, for robustness): width and height, no viewBox", async ({ trmnl }) => {
    const screen = await trmnl.plugin('../fixtures/quirks').render({ qr: 'fixed' });
    expect(screen.markup).toMatch(/<svg[^>]*\swidth=/);
    expect(screen.markup).not.toMatch(/<svg[^>]*viewBox/);
  });
  test("crlf: with CR LF newlines, a newline typed in the template no longer splits the data", async ({ trmnl }) => {
    const screen = await trmnl.plugin('../fixtures/quirks').render({ crlf: true });
    await expect(screen.locator('[data-count]')).toHaveText('1');
  });
  test('the old server option and unknown qr modes are refused', async ({ trmnl }) => {
    await expect(trmnl.plugin('../fixtures/quirks').render({ server: true })).rejects.toThrow(/server option is gone/);
    await expect(trmnl.plugin('../fixtures/quirks').render({ qr: 'nope' })).rejects.toThrow(/qr must be one of/);
  });
  for (const s of matrix({ qr: QR_MODES, crlf: [false, true] })) {
    test(`renders · ${s.label}`, async ({ trmnl }) => {
      expect(await trmnl.plugin('../fixtures/quirks').render(s)).toRenderCleanly();
    });
  }
});

test.describe('dark mode', () => {
  // an inline svg (white margin, black square), the same as an <img>, on a white screen
  async function probe(trmnl, opts) {
    const s = await trmnl.plugin('../fixtures/dark').render({ device: 'og_png', ...opts });
    const png = await s.png({ dither: false });
    const at = async (sel, d) => { const b = await s.box(sel); return png.pixel(b.x + d, b.y + d).gray; };
    return { s, bg: png.pixel(5, 5).gray, svgMargin: await at('[data-svg]', 4), svgSquare: await at('[data-svg]', 60), imgMargin: await at('[data-img]', 4), imgSquare: await at('[data-img]', 60),
      classMargin: await at('[data-img-class]', 4), svgClassMargin: await at('[data-svg-class]', 4) };
  }
  // the v2 rule: everything inverted, `.image` elements (img or svg) kept, a plain <img> inverted too
  test('true: the screen inverted, .image elements kept', async ({ trmnl }) => {
    const p = await probe(trmnl, { darkMode: true });
    expect(p).toMatchObject({ bg: 0, svgMargin: 0, svgSquare: 255, imgMargin: 0, imgSquare: 255, classMargin: 255, svgClassMargin: 255 });
    expect(p.s.classes).not.toContain('screen--dark-mode');
    expect(p.s.data.trmnl.plugin_settings.dark_mode).toBe('yes');
  });
  test("'framework': only the class, inline svg keeps its colours", async ({ trmnl }) => {
    const p = await probe(trmnl, { darkMode: 'framework' });
    expect(p).toMatchObject({ bg: 0, svgMargin: 255, svgSquare: 0, imgMargin: 255, imgSquare: 0, svgClassMargin: 255 });
    expect(p.s.classes).toContain('screen--dark-mode');
  });
  // framework 2 does it with its own class, and spares only images with the framework's `image` class
  test('framework 2: the class inverts, except .image elements', async ({ trmnl }) => {
    const p = await probe(trmnl, { darkMode: true, framework: '2.0.1' });
    expect(p).toMatchObject({ bg: 0, svgMargin: 0, svgSquare: 255, imgMargin: 0, imgSquare: 255, classMargin: 255, svgClassMargin: 255 });
  });
});

test.describe('QR polarity', () => {
  // the fixture's inline svg and <img> both hold a black-on-white code once qr_code draws one
  test('a code inverted by dark mode is found, reported, and refused unless asked for', async ({ trmnl }) => {
    const plugin = trmnl.plugin('../fixtures/quirks');
    const light = await plugin.render();
    expect(await light.qrInfo()).toEqual({ text: 'hello', inverted: false });
    await expect(light).toHaveQr('hello');

    const dark = await plugin.render({ darkMode: true });
    expect(await dark.qrInfo()).toEqual({ text: 'hello', inverted: true });
    await expect(dark).not.toHaveQr('hello');
    await expect(dark).toHaveQr('hello', { inverted: true });
    await expect(dark).toHaveQr('hello', { inverted: 'any' });
    expect(await dark.qr()).toBeNull();
    expect(await dark.qr(undefined, { inverted: 'any' })).toBe('hello');
  });
});
