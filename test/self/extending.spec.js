// Extending trmnlp-test: your own matchers and fixtures (Playwright's expect.extend and
// test.extend), and checks that run after every render (the config's `checks`).
const { test: base, expect: baseExpect } = require('trmnlp-test');

const expect = baseExpect.extend({
  async toHaveTemperature(screen, value) {
    const text = await screen.locator('[data-temp]').innerText();
    return { pass: text === String(value), message: () => `${screen.label}: temperature ${text}, expected ${value}` };
  },
});

const test = base.extend({
  sensor: async ({ trmnl }, use) => use((t) => trmnl.render({ webhook: { sensor: { temperature: t } } })),
});

test('a custom matcher and fixture', async ({ sensor }) => {
  const screen = await sensor(7);
  await expect(screen).toHaveTemperature(7);
  await expect(screen).not.toHaveTemperature(8);
});

test.describe('checks after every render', () => {
  test('a clean render passes them', async ({ trmnl }) => {
    const screen = await trmnl.renderMarkup('<span>ok</span>', { bare: true });
    expect(screen.checkProblems).toEqual([]);
    expect(screen).toRenderCleanly();
  });

  test('their problems fail toRenderCleanly and name the check', async ({ trmnl }) => {
    const screen = await trmnl.renderMarkup('<span data-forbidden>no</span>', { bare: true });
    expect(screen.problems()).toContain('forbidden: 1 element(s) marked data-forbidden');
    expect(screen).not.toRenderCleanly();
    expect(screen).toRenderCleanly({ allow: ['forbidden:'] });
  });

  test('a render can skip them, all or by name', async ({ trmnl }) => {
    expect((await trmnl.renderMarkup('<span data-forbidden>no</span>', { bare: true, checks: false })).checkProblems).toEqual([]);
    expect((await trmnl.renderMarkup('<span data-forbidden>no</span>', { bare: true, checks: ['other'] })).checkProblems).toEqual([]);
  });
});
