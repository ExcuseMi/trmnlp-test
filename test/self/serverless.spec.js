const { test, expect } = require('trmnlp-test');

const weather = { 'https://api.example.com/weather': { temp: 21 } };

for (const lang of ['python', 'ruby', 'node', 'php']) {
  test.describe(`${lang} serverless transform`, () => {
    test('fetches through the mocks and returns the merge variables', async ({ trmnl }) => {
      const run = await trmnl.plugin(`../fixtures/serverless-${lang}`).transform({ mocks: weather, fields: { city: 'Antwerp' } });
      expect(run).toTransformCleanly();
      expect(run.output).toMatchObject({ temp: 21, city: 'Antwerp', units: 'c', runs: 1 });
      expect(run).toHaveRequested('https://api.example.com/weather?city=Antwerp', { method: 'GET', headers: { 'x-key': 'abc' } });
      expect(run).toStayWithinServerlessLimits();
    });

    test('sees the frozen clock', async ({ trmnl }) => {
      const run = await trmnl.plugin(`../fixtures/serverless-${lang}`).transform({ mocks: weather, now: '2027-03-04T05:06:00Z' });
      expect(run.output.fetched_at).toBe('2027-03-04 05:06');
    });

    test('carries trmnl_state to the next run', async ({ trmnl }) => {
      const s = trmnl.plugin(`../fixtures/serverless-${lang}`).session({ mocks: weather });
      await s.transform();
      await s.transform();
      const screen = await s.render();
      await expect(screen.locator('[data-runs]')).toContainText('run 3');
    });

    test('an unmocked request fails the transform', async ({ trmnl }) => {
      const run = await trmnl.plugin(`../fixtures/serverless-${lang}`).transform({ mocks: {} });
      expect(run.requests[0]).toMatchObject({ mocked: false, status: 599 });
    });

    test('renders with and without the transform', async ({ trmnl }) => {
      const plugin = trmnl.plugin(`../fixtures/serverless-${lang}`);
      const withTx = await plugin.render({ mocks: weather });
      expect(withTx).toRenderCleanly();
      await expect(withTx).toShowText('21°c');
      // without: the template gets the data as given, e.g. a recorded transform output
      const without = await plugin.render({ transform: false, data: { temp: -3, units: 'f', city: 'Oslo', runs: 9 } });
      expect(without.transform.ran).toBe(false);
      await expect(without.locator('[data-temp]')).toHaveText('-3°f');
    });
  });
}

test('a slow transform hits the hosted 5 s limit', async ({ trmnl }) => {
  const run = await trmnl.plugin('../fixtures/serverless-node').transform({
    mocks: [{ url: 'https://api.example.com/weather', json: { temp: 1 }, delayMs: 1500 }], timeoutMs: 1000,
  });
  expect(run.timedOut).toBe(true);
  expect(run).not.toStayWithinServerlessLimits({ timeoutMs: 1000 });
});

test.describe('speed', () => {
  test('an identical transform input reuses the output and replays its requests', async ({ trmnl }) => {
    const plugin = trmnl.plugin('../fixtures/serverless-node');
    const opts = { mocks: weather, now: '2026-05-05T05:05:00Z' };
    const first = await plugin.transform(opts);
    const second = await plugin.transform(opts);
    expect(second.output).toEqual(first.output);
    expect(second).toHaveRequested('https://api.example.com/weather*', { times: 1 });
    const fresh = await plugin.transform({ ...opts, cacheTransform: false });
    expect(fresh.durationMs).toBeGreaterThan(0);
  });

  test('renderMarkup: a piece of markup, bare and at a device scale, and its picture', async ({ trmnl }) => {
    const svg = '<svg data-dot width="20" height="10" viewBox="0 0 2 1"><rect width="1" height="1" fill="#000"/></svg>';
    const screen = await trmnl.renderMarkup(svg, { bare: true, deviceScale: 3 });
    const png = await screen.elementPng('[data-dot]');
    expect([png.width, png.height]).toEqual([60, 30]);
    expect(png.pixel(10, 10).gray).toBe(0);
    expect(png.pixel(50, 10).gray).toBe(255);
    const framed = await trmnl.renderMarkup('<span class="title" data-t>Hi</span>', { device: 'v2' });
    expect(framed.classes).toContain('screen--v2');
    await expect(framed).toShowText('Hi');
  });
});
