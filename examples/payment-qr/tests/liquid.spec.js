// The current version: no transform, Liquid reads the settings or the `payment` webhook data.
const { test, expect, matrix, VIEWS } = require('trmnlp-test');
const coffeeShop = require('../fixtures/coffee-shop.json');
const northbean = require('../fixtures/northbean.json');

const EPC = northbean.qr.payload;
const JANE = ['BCD', '002', '1', 'SCT', '', 'Jane Doe', 'BE71096123456769', 'EUR12.50', '', '', 'Coffee fund'].join('\n');

test('settings mode: the .trmnlp.yml fields', async ({ trmnl }) => {
  const screen = await trmnl.render();
  expect(screen).toRenderCleanly();
  await expect(screen).toHaveQr(JANE);
  await expect(screen).toShowText('Buy me a coffee');
});

test('webhook mode: the posted payment', async ({ trmnl }) => {
  const screen = await trmnl.render({ fields: { data_source: 'webhook' }, webhook: coffeeShop });
  await expect(screen).toHaveQr(EPC);
  await expect(screen.locator('[data-qr-row]')).toHaveCount(7);
});

test('webhook mode, nothing sent yet', async ({ trmnl }) => {
  const screen = await trmnl.render({ fields: { data_source: 'webhook' }, webhook: {} });
  await expect(screen).toHaveQr(null);
  await expect(screen).toShowText('Send the payment details to the webhook');
});

for (const s of matrix({ device: ['og_plus', 'v2'], orientation: ['landscape', 'portrait'], view: VIEWS })) {
  test(`fits · ${s.label}`, async ({ trmnl }) => {
    const screen = await trmnl.render({ ...s, fields: { data_source: 'webhook' }, webhook: coffeeShop });
    await expect(screen).toHaveNoOverflow();
    await expect(screen).toHaveQr(EPC);
  });
}

test('passes trmnlp lint', async ({ trmnl }) => {
  expect(await trmnl.lint()).toPassLint();
});
