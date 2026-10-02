const { test, expect } = require('trmnlp-test');

test('polling: URLs and headers rendered with the custom fields, JSON and XML parsed', async ({ trmnl }) => {
  const screen = await trmnl.plugin('../fixtures/polling').render({
    mocks: {
      'https://api.example.com/departures?station=GNT': [{ time: '08:12', to: 'Brussels' }, { time: '08:20', to: 'Bruges' }],
      'https://api.example.com/alerts.xml': { body: '<alerts><alert><text>Works on line 50</text></alert></alerts>', headers: { 'content-type': 'application/xml' } },
    },
  });
  expect(screen).toRenderCleanly();
  await expect(screen.locator('[data-dep]')).toHaveText(['08:12 Brussels', '08:20 Bruges']);
  await expect(screen.locator('[data-alert]')).toHaveText('Works on line 50');
  expect(screen.polling.headers).toEqual({ authorization: 'Bearer secret' });
  expect(screen).toHaveRequested('https://api.example.com/departures?station=GNT', { times: 1 });
});

test('static data from settings.yml, on framework 2', async ({ trmnl }) => {
  const screen = await trmnl.plugin('../fixtures/static').render();
  expect(screen.framework).toBe('2.0.1');
  await expect(screen.locator('[data-author]')).toHaveText('Dijkstra');
  expect(screen).toRenderCleanly();
});
