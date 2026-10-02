// The webhook + serverless version: TRMNL runs transform.js when webhook data arrives and
// stores its output (one `qr` object) in place of the data; the templates only lay it out.
const { test, expect, matrix, VIEWS } = require('trmnlp-test');
const northbean = require('../fixtures/northbean.json'); // what TRMNL stored and rendered (pasted from the device)
const coffeeShop = require('../fixtures/coffee-shop.json'); // the webhook body the shop posts

const EPC = northbean.qr.payload;
const webhookMode = { fields: { data_source: 'webhook' } };
const serverless = (trmnl) => trmnl;

test.describe('transform', () => {
  test('turns the webhook data into the qr object TRMNL stored', async ({ trmnl }) => {
    const run = await serverless(trmnl).transform({ ...webhookMode, data: coffeeShop.merge_variables });
    expect(run).toTransformCleanly();
    expect(run).toStayWithinServerlessLimits();
    expect(run.output.qr).toMatchObject({ payload: EPC, title: 'Northbean Coffee', caption: 'Scan, pay, enjoy', webhook_mode: true });
    expect(run.output.qr.body).toBe(northbean.qr.body);
    // the sent data is handed back, so the next webhook can deep_merge onto it
    expect(run.output.payment).toEqual(coffeeShop.merge_variables.payment);
  });

  test('settings mode ignores webhook data', async ({ trmnl }) => {
    const run = await serverless(trmnl).transform({ fields: { data_source: 'settings' }, data: coffeeShop.merge_variables });
    expect(run.output.qr.title).toBe('Buy me a coffee');
    expect(run.output.qr.payload).toContain('Jane Doe');
  });

  for (const [amount, caption] of [['12.5', 'EUR 12.50'], ['1234.5', 'EUR 1,234.50'], ['0', 'Any amount'], ['7,5', 'EUR 7.50'], ['abc', 'Any amount']]) {
    test(`amount ${amount} -> ${caption}`, async ({ trmnl }) => {
      const run = await serverless(trmnl).transform({ fields: { data_source: 'settings', epc_amount: amount, caption: '' } });
      expect(run.output.qr.caption).toBe(caption);
    });
  }
});

test.describe('webhook session', () => {
  test('post once, every render shows the stored output', async ({ trmnl }) => {
    const shop = serverless(trmnl).session(webhookMode);
    const res = await shop.webhook(coffeeShop);
    expect(res.status).toBe(200);
    expect(res.transform).toTransformCleanly();

    const screen = await shop.render();
    expect(screen.transform.ran).toBe(false);
    expect(screen).toRenderCleanly();
    await expect(screen).toHaveQr(EPC);
    await expect(screen.locator('[data-qr-row]')).toHaveCount(7);
    await expect(screen).toShowText('Northbean Coffee');
  });

  test('a deep_merge post updates one field', async ({ trmnl }) => {
    const shop = serverless(trmnl).session(webhookMode);
    await shop.webhook(coffeeShop);
    await shop.webhook({ merge_variables: { payment: { title: 'Northbean Kiosk' } }, merge_strategy: 'deep_merge' });
    const screen = await shop.render();
    await expect(screen).toShowText('Northbean Kiosk');
    await expect(screen).toHaveQr(EPC);
  });
});

test.describe('without the transform', () => {
  // render exactly what TRMNL had stored, with the real device's trmnl namespace
  const { trmnl: ns, ...stored } = northbean;

  test('the stored output renders the same QR', async ({ trmnl }) => {
    const screen = await serverless(trmnl).render({ data: stored, transform: false, trmnl: ns });
    expect(screen.transform.ran).toBe(false);
    expect(screen.data.trmnl.user.name).toBe('Excuse Me');
    expect(screen).toRenderCleanly();
    await expect(screen).toHaveQr(EPC);
    await expect(screen.locator('[data-qr-price]')).toHaveText(['€2.40', '€3.20', '€3.60', '€3.60', '€3.80', '€2.50', '€3.20']);
  });

  test('with and without the transform draw the same picture', async ({ trmnl }) => {
    const withTx = await serverless(trmnl).render({ ...webhookMode, webhook: coffeeShop });
    const without = await serverless(trmnl).render({ ...webhookMode, data: stored, transform: false });
    const [a, b] = [await withTx.png(), await without.png()];
    expect(Buffer.compare(a.buffer, b.buffer)).toBe(0);
  });
});

for (const s of matrix({ device: ['og_plus', 'og_png', 'v2', 'amazon_kindle_2024', 'og_bwry'], view: VIEWS })) {
  test(`layout · ${s.label}`, async ({ trmnl }) => {
    const { trmnl: ns, ...stored } = northbean;
    const screen = await serverless(trmnl).render({ ...s, data: stored, transform: false });
    expect(screen).toRenderCleanly();
    await expect(screen).toHaveNoOverflow();
    await expect(screen).toHaveQr(EPC);
    await expect(screen).toHaveNoOverlap('[data-qr-row]', 'img[data-qr-img]');
  });
}

// what happened on the device: the server's svg already has width/height, the template added its own,
// and the duplicate attributes made the svg invalid XML inside the <img>
test("the server's qr_code svg breaks this version's image", async ({ trmnl }) => {
  const { trmnl: ns, ...stored } = northbean;
  const screen = await serverless(trmnl).render({ data: stored, transform: false, qr: 'server' });
  await expect(screen).toHaveQr(null);
});

// dark mode inverts everything but `.image` elements; this version's <img> has no `image` class,
// so its code comes out white on black (still a valid code)
test('dark mode inverts the QR', async ({ trmnl }) => {
  const { trmnl: ns, ...stored } = northbean;
  const screen = await serverless(trmnl).render({ data: stored, transform: false, darkMode: true });
  await expect(screen).toHaveQr(EPC, { inverted: true });
});

test('device picture', async ({ trmnl }) => {
  const { trmnl: ns, ...stored } = northbean;
  const screen = await serverless(trmnl).render({ data: stored, transform: false, trmnl: ns });
  await expect(screen).toMatchScreen('northbean-og-plus');
  await expect(screen).toFitDeviceImageLimit();
});
