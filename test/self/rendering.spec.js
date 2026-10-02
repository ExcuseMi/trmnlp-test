const { test, expect } = require('trmnlp-test');

// renders run in iframes of one page per worker (as TRMNL's editor previews them): each must
// still get its own clock, errors, mocks and picture
test.describe('renders in iframes', () => {
  test('the browser clock is the render\'s now', async ({ trmnl }) => {
    const a = await trmnl.renderMarkup('<span data-d></span><script>document.querySelector("[data-d]").textContent = new Date().toISOString().slice(0, 16)</script>', { now: '2030-01-02T03:04:00Z', bare: true });
    await expect(a.locator('[data-d]')).toHaveText('2030-01-02T03:04');
    const b = await trmnl.renderMarkup('<span data-d></span><script>document.querySelector("[data-d]").textContent = new Date().toISOString().slice(0, 16)</script>', { now: '2031-05-06T07:08:00Z', bare: true });
    await expect(b.locator('[data-d]')).toHaveText('2031-05-06T07:08');
  });

  test('page errors belong to the render that threw', async ({ trmnl }) => {
    const bad = await trmnl.renderMarkup('<script>throw new Error("boom")</script>', { bare: true });
    const good = await trmnl.renderMarkup('<span>fine</span>', { bare: true });
    expect(bad.pageErrors.join()).toContain('boom');
    expect(good.pageErrors).toEqual([]);
    expect(good).toRenderCleanly();
  });

  test('browser requests are mocked and recorded per render', async ({ trmnl }) => {
    const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const s = await trmnl.renderMarkup('<img data-i width="40" height="40" src="https://img.example.com/a.png">', { bare: true, mocks: [{ url: 'https://img.example.com/a.png', bodyBase64: pixel, headers: { 'content-type': 'image/png' } }] });
    expect(s).toHaveRequested('https://img.example.com/a.png', { times: 1 });
    expect(await s.page.evaluate(() => document.querySelector('[data-i]').naturalWidth)).toBe(1);
  });

  test('an earlier screen still answers after later renders', async ({ trmnl }) => {
    const first = await trmnl.render({ device: 'og_plus', webhook: { sensor: { temperature: 1 } } });
    const second = await trmnl.render({ device: 'v2', webhook: { sensor: { temperature: 2 } } });
    await expect(first.locator('[data-temp]')).toHaveText('1');
    expect((await first.png()).width).toBe(800);
    expect((await second.png()).width).toBe(1872);
    expect((await first.png()).width).toBe(800);
  });
});
