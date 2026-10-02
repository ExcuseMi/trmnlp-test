const { test, expect, matrix, VIEWS, DEVICES, FRAMEWORK } = require('trmnlp-test');

const data = { sensor: { temperature: 19, readings: [1, 2, 3] } };

for (const s of matrix({ device: DEVICES.representative, view: ['full', 'quadrant'] })) {
  test(`renders on ${s.label}`, async ({ trmnl }) => {
    const screen = await trmnl.render({ ...s, webhook: data });
    expect(screen).toRenderCleanly();
    await expect(screen).toHaveNoOverflow();
    const png = await screen.png();
    expect(png.width).toBe(screen.device.width);
    // only colours of the device palette end up in the picture
    const pal = screen.device.palette;
    if (pal.colors) expect(pal.colors.map((c) => c.toLowerCase())).toEqual(expect.arrayContaining(png.colors()));
    else if (pal.framework_class !== 'screen--color-full' && pal.grays <= 16) expect(png.colors().length).toBeLessThanOrEqual(pal.grays);
  });
}

for (const s of matrix({ darkMode: [false, true], theme: [undefined, 'black-and-yellow'], scale: [undefined, 'large'] })) {
  test(`settings: ${s.label}`, async ({ trmnl }) => {
    const screen = await trmnl.render({ ...s, device: 'v2', webhook: data });
    expect(screen.classes).toContain('screen--v2');
    if (s.darkMode) expect(screen.classes).toContain('screen--dark-mode');
    if (s.theme) expect(screen.classes).toContain(`screen--theme-${s.theme}`);
    expect(screen).toRenderCleanly();
  });
}

for (const framework of FRAMEWORK.majors().filter((v) => FRAMEWORK.compare(v, '1.0.0') >= 0)) {
  test(`framework ${framework}`, async ({ trmnl }) => {
    const screen = await trmnl.render({ framework, webhook: data });
    expect(screen.html).toContain(`/css/${framework}/plugins.css`);
    expect(screen).toRenderCleanly();
    await expect(screen).not.toBeBlank();
  });
}

test('og_png fits the 90 kB device image limit', async ({ trmnl }) => {
  const screen = await trmnl.render({ device: 'og_png', webhook: data });
  await expect(screen).toFitDeviceImageLimit();
});

test('device picture snapshot', async ({ trmnl }) => {
  const screen = await trmnl.render({ webhook: data, view: 'quadrant' });
  await expect(screen).toMatchScreen();
});

for (const s of matrix({ device: ['og_plus', 'v2', 'amazon_kindle_2024', 'kobo_sage', 'remarkable_paper_2'], orientation: ['landscape', 'portrait'] })) {
  test(`screen fills the picture · ${s.label}`, async ({ trmnl }) => {
    const screen = await trmnl.render({ ...s, webhook: data });
    expect(screen).toRenderCleanly();
  });
}
