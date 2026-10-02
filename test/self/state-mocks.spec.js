const { test, expect } = require('trmnlp-test');

// help.trmnl.com, Saved State: state is read at the start of a run and written at the end; the
// polling URL and the transform see the previous run's; previous_merge_variables is what the last
// run stored; trmnl_state must be an object of at most 8192 bytes; no write after a failed fetch.
test.describe('saved state', () => {
  const readings = (temp) => ({ url: 'https://api.example.com/readings*', json: { temp } });

  test('the polling URL and the transform see the previous run, previous_merge_variables carries over', async ({ trmnl }) => {
    const s = trmnl.plugin('../fixtures/state').session();
    const first = await s.transform({ mocks: [readings(10)] });
    expect(first.output).toMatchObject({ temp: 10, previous: null });
    expect(first.requests[0].url).toBe('https://api.example.com/readings?since=0');
    const second = await s.transform({ mocks: [readings(12)] });
    expect(second.output).toMatchObject({ temp: 12, previous: 10 });
    expect(second.requests[0].url).toBe('https://api.example.com/readings?since=1');
    const screen = await s.render({ mocks: [readings(13)] });
    await expect(screen.locator('[data-prev]')).toHaveText('12');
    await expect(screen.locator('[data-seen]')).toHaveText('3');
  });

  test('state over 8192 bytes is ignored, reported, and the last state kept', async ({ trmnl }) => {
    const screen = await trmnl.plugin('../fixtures/state').render({ mocks: [readings(1)], fields: { mode: 'big' }, state: { seen: 5 } });
    expect(screen.state).toEqual({ seen: 5 });
    expect(screen.transform.stateError).toMatch(/trmnl_state is 90\d\d bytes; TRMNL ignores writes over 8192/);
    expect(screen).not.toRenderCleanly();
  });

  test('state that is not an object is ignored', async ({ trmnl }) => {
    const run = await trmnl.plugin('../fixtures/state').transform({ mocks: [readings(1)], fields: { mode: 'array' }, state: { seen: 2 } });
    expect(run.state).toEqual({ seen: 2 });
    expect(run.stateError).toMatch(/must be an object \(got array\)/);
  });

  test('a failed fetch gives an empty payload and skips the state write', async ({ trmnl }) => {
    const run = await trmnl.plugin('../fixtures/state').transform({ mocks: [{ url: 'https://api.example.com/readings*', error: 'reset' }], state: { seen: 4 } });
    expect(run.output).toMatchObject({ temp: null });
    expect(run.state).toEqual({ seen: 4 });
    expect(run.stateSkipped).toMatch(/fetch failed/);
    expect(run.requests[0]).toMatchObject({ error: 'reset', status: null });
  });
});

test.describe('mocks', () => {
  test('a computed mock answers from the request, in the transform and in the browser', async ({ trmnl }) => {
    const seen = [];
    const run = await trmnl.plugin('../fixtures/serverless-python').transform({
      mocks: { 'https://api.example.com/weather*': (req) => { seen.push(req); return { json: { temp: req.url.includes('Antwerp') ? 18 : 0 } }; } },
      fields: { city: 'Antwerp' },
    });
    expect(run.output.temp).toBe(18);
    expect(seen[0]).toMatchObject({ method: 'GET', headers: { 'x-key': 'abc' } });
    // the header names as sent, besides the lower-cased ones
    expect(seen[0].rawHeaders).toContainEqual(['X-Key', 'abc']);
    expect(run.requests[0].rawHeaders).toContainEqual(['X-Key', 'abc']);

    const screen = await trmnl.renderMarkup('<img data-i src="https://img.example.com/x.svg" width="10" height="10">', {
      bare: true, mocks: { 'https://img.example.com/*': (req) => ({ body: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>', headers: { 'content-type': 'image/svg+xml' }, status: req.method === 'GET' ? 200 : 405 }) },
    });
    expect(await screen.page.evaluate(() => document.querySelector('[data-i]').naturalWidth)).toBe(4);
  });

  test('a slow body: the headers come at once, the body later', async ({ trmnl }) => {
    const run = await trmnl.plugin('../fixtures/serverless-node').transform({
      mocks: [{ url: 'https://api.example.com/weather*', json: { temp: 1 }, bodyDelayMs: 1500 }], timeoutMs: 1000,
    });
    expect(run.timedOut).toBe(true);
  });

  test('a catch-all mock leaves the framework\'s own files alone', async ({ trmnl }) => {
    const screen = await trmnl.render({ webhook: { sensor: { temperature: 4 } }, mocks: [{ url: '*', status: 500, body: 'no' }] });
    expect(screen.missingAssets).toEqual([]);
    expect(screen).toRenderCleanly();
  });
});

test.describe('render options', () => {
  test('waitFor: a selector the plugin adds when it is done, or a predicate', async ({ trmnl }) => {
    const late = '<span data-late></span><script>setTimeout(() => { const s = document.querySelector("[data-late]"); s.textContent = "ready"; s.setAttribute("data-done", "") }, 400)</script>';
    const a = await trmnl.renderMarkup(late, { bare: true, waitFor: '[data-done]' });
    await expect(a.locator('[data-late]')).toHaveText('ready');
    const b = await trmnl.renderMarkup(late, { bare: true, waitFor: () => document.querySelector('[data-late]').textContent === 'ready' });
    expect(await b.text('[data-late]')).toBe('ready');
  });

  test('slotSize: a view of any size', async ({ trmnl }) => {
    const screen = await trmnl.renderMarkup('<div class="layout"><span class="title">x</span></div>', { slotSize: { width: 300, height: 200 } });
    const b = await screen.box('.view');
    expect([Math.round(b.width), Math.round(b.height)]).toEqual([300, 200]);
  });

  test('fieldDefaults: false leaves out the settings.yml defaults', async ({ trmnl }) => {
    const withDefaults = await trmnl.render({ webhook: { sensor: { temperature: 1 } } });
    expect(withDefaults.customFields.label).toBe('Living room');
    const without = await trmnl.render({ webhook: { sensor: { temperature: 1 } }, fieldDefaults: false });
    expect(without.customFields.label).toBeUndefined();
  });
});

test.describe('mocks and the transform\'s clock and signals', () => {
  test('a fetch the transform gives up on is recorded as aborted', async ({ trmnl }) => {
    const run = await trmnl.plugin('../fixtures/clock').transform({ mocks: [{ url: 'https://api.example.com/slow', json: {}, delayMs: 3000 }, { url: 'https://api.example.com/tick', body: '' }] });
    expect(run.output.status).toBe('TimeoutError');
    expect(run).toHaveRequested('https://api.example.com/slow', { times: 1 });
    expect(run.requests.find((r) => r.url.endsWith('/slow'))).toMatchObject({ aborted: true, status: null });
  });

  test('advanceClockMs moves the transform\'s clock when the mock answers', async ({ trmnl }) => {
    const run = await trmnl.plugin('../fixtures/clock').transform({ mocks: [{ url: 'https://api.example.com/slow', json: {} }, { url: 'https://api.example.com/tick', body: '', advanceClockMs: 60000 }] });
    expect(run.output.status).toBe('ok');
    expect(run.output.elapsedMs).toBeGreaterThanOrEqual(59000);
    expect(run.output.elapsedMs).toBeLessThan(65000);
  });

  test('in the browser, a catch-all mock skips trmnl.com unless it names it', async ({ trmnl }) => {
    const img = '<img data-i src="https://trmnl.com/images/plugins/trmnl--render.svg" width="10" height="10">';
    const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const a = await trmnl.renderMarkup(img, { bare: true, mocks: [{ url: '*', status: 404 }] });
    expect(a.requests.filter((r) => r.mocked)).toEqual([]);
    const b = await trmnl.renderMarkup(img, { bare: true, mocks: [{ url: 'https://trmnl.com/images/*', bodyBase64: pixel, headers: { 'content-type': 'image/png' } }] });
    expect(b.requests.filter((r) => r.mocked).length).toBe(1);
    expect(await b.page.evaluate(() => document.querySelector('[data-i]').naturalWidth)).toBe(1);
  });
});
