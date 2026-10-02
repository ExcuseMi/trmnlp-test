const { test, expect, matrix, VIEWS } = require('trmnlp-test');

// Requests made by a polling URL or a serverless transform must be mocked:
// const mocks = { 'https://api.example.com/items': { items: [] } };

// the data in .trmnlp.yml, every view, on the two TRMNL screens
for (const s of matrix({ device: ['og_plus', 'v2'], view: VIEWS })) {
  test(`renders cleanly · ${s.label}`, async ({ trmnl }) => {
    const screen = await trmnl.render({ ...s /* , mocks */ });
    expect(screen).toRenderCleanly();
    await expect(screen).toHaveNoOverflow();
    await expect(screen).not.toBeBlank();
  });
}

test('passes trmnlp lint', async ({ trmnl }) => {
  expect(await trmnl.lint()).toPassLint();
});
