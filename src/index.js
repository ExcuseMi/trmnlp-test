'use strict';
// Public API: const { test, expect, matrix, DEVICES, VIEWS, FRAMEWORK } = require('trmnlp-test')
const path = require('path');
const base = require('@playwright/test');
const { Harness } = require('./harness');
const { Trmnl, QR_MODES } = require('./trmnl');
const { matchers } = require('./matchers');
const models = require('./models');
const { FRAMEWORK } = require('./framework');
const { VIEWS, SCALES, TEXT_SCALES, THEMES } = require('./page');
const { loadConfig } = require('./config');
const { Png, quantize } = require('./png');

const config = loadConfig();
// arguments after `--` on the command line (trmnlp-test run -- --rebaseline)
const args = JSON.parse(process.env.TRMNLP_TEST_ARGS || '[]');

const test = base.test.extend({
  trmnlHarness: [async ({}, use) => { // eslint-disable-line no-empty-pattern
    const h = new Harness();
    await h.start();
    await use(h);
    h.stop();
  }, { scope: 'worker' }],

  trmnl: async ({ trmnlHarness, browser }, use, testInfo) => {
    const t = new Trmnl({ harness: trmnlHarness, browser, testInfo, config, pluginDir: path.resolve(config.root, config.plugin) });
    const render = t.render.bind(t);
    t.render = async (opts) => Object.assign(await render(opts), { testTitle: testInfo.title });
    await use(t);
    await t.finish({ attach: config.screenshots });
  },
});

const expect = base.expect.extend(matchers);

// Every combination of the given option lists, each with a readable label:
//   matrix({ device: ['og_plus', 'v2'], view: VIEWS, darkMode: [false, true] })
//   -> [{ device: 'og_plus', view: 'full', darkMode: false, label: 'og_plus · full' }, ...]
function matrix(axes) {
  let combos = [{}];
  for (const [key, values] of Object.entries(axes)) {
    const list = Array.isArray(values) ? values : [values];
    combos = combos.flatMap((c) => list.map((v) => ({ ...c, [key]: v })));
  }
  return combos.map((c) => ({ ...c, label: describe(c) }));
}

function describe(c) {
  return Object.entries(c).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => {
    if (v === true) return k === 'darkMode' ? 'dark' : k;
    if (v === false) return k === 'darkMode' ? 'light' : `no ${k}`;
    if (v && typeof v === 'object') return v.label || v.name || JSON.stringify(v);
    if (k === 'qr') return `qr ${v}`;
    return k === 'framework' ? `v${v}` : String(v);
  }).join(' · ');
}

const DEVICES = {
  get all() { return models.groups.all(); },
  get trmnl() { return models.groups.trmnl(); },
  get kindle() { return models.groups.kindle(); },
  get byod() { return models.groups.byod(); },
  get representative() { return models.groups.representative(); },
  model: models.model,
};

module.exports = {
  test, expect, matrix, DEVICES, VIEWS, FRAMEWORK, SCALES, TEXT_SCALES, THEMES, QR_MODES,
  MODELS: models.MODELS, PALETTES: models.PALETTES, config, args, Png, quantize,
};
