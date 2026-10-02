const { test, expect } = require('trmnlp-test');

test('webhook data reaches the template', async ({ trmnl }) => {
  const screen = await trmnl.render({ webhook: { sensor: { temperature: 23, readings: [5] } } });
  await expect(screen.locator('[data-temp]')).toHaveText('23');
  await expect(screen.locator('[data-label]')).toHaveText('Living room');
});

test('without webhook data the .trmnlp.yml variables are used', async ({ trmnl }) => {
  const screen = await trmnl.render();
  await expect(screen.locator('[data-temp]')).toHaveText('18');
});

test('deep_merge and stream strategies', async ({ trmnl }) => {
  const s = trmnl.session();
  await s.webhook({ sensor: { temperature: 20, readings: [1] } });
  await s.webhook({ merge_variables: { sensor: { temperature: 21 } }, merge_strategy: 'deep_merge' });
  let screen = await s.render();
  await expect(screen.locator('[data-temp]')).toHaveText('21');
  await expect(screen.locator('[data-readings]')).toHaveText('1');

  await s.webhook({ merge_variables: { readings: [1, 2, 3] }, merge_strategy: 'stream', stream_limit: 4 });
  await s.webhook({ merge_variables: { readings: [4, 5] }, merge_strategy: 'stream', stream_limit: 4 });
  expect(s.webhookData.readings).toEqual([2, 3, 4, 5]);
});

test('payloads over 2 kB are rejected, 5 kB with TRMNL+', async ({ trmnl }) => {
  const s = trmnl.session();
  const big = { blob: 'x'.repeat(3000) };
  expect((await s.webhook(big)).status).toBe(413);
  expect((await s.webhook(big, { limit: 'plus' })).status).toBe(200);
  await expect(trmnl.render({ webhook: big })).rejects.toThrow(/3\d{3} bytes/);
});

test('webhook + serverless: the transform runs when data arrives, its output is stored', async ({ trmnl }) => {
  const s = trmnl.plugin('../fixtures/webhook-serverless').session();
  const res = await s.webhook({ orders: [{ name: 'Ann', amount: 12.5 }, { name: 'Bob', amount: 3 }] });
  expect(res.status).toBe(200);
  expect(res.transform).toTransformCleanly();
  expect(s.webhookData.summary).toEqual({ count: 2, total: 'EUR 15.50', latest: 'Bob' });

  // a settings change does not re-run the transform: the stored output is rendered as is
  const screen = await s.render({ fields: { currency: 'USD' } });
  expect(screen.transform.ran).toBe(false);
  await expect(screen.locator('[data-total]')).toHaveText('EUR 15.50');
});

test('trmnl namespace has every field the hosted service sends', async ({ trmnl }) => {
  const screen = await trmnl.render({ device: 'v2', orientation: 'portrait' });
  const t = screen.data.trmnl;
  expect(Object.keys(t).sort()).toEqual(['device', 'plugin_settings', 'state', 'system', 'user']);
  expect(t.device).toMatchObject({ model: 'v2', bit_depth: 4, width: 1404, height: 1872, orientation: 'portrait' });
  expect(t.user).toMatchObject({ time_zone_iana: 'Europe/Brussels', time_zone: 'Brussels', utc_offset: 7200 });
  expect(t.plugin_settings).toMatchObject({ instance_name: 'Sensor', strategy: 'webhook', dark_mode: 'no', no_screen_padding: 'no', data_fetched_utc: 1790928000 });
  expect(t.system.timestamp_utc).toBe(1790928000);
  await expect(screen.locator('[data-now]')).toHaveText('2026-10-02 08:00 2026-10-02');
  await expect(screen.locator('[data-model]')).toHaveText('v2 1404x1872 portrait');
});
