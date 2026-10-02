'use strict';
// trmnlp-test.config.js in the plugin repository (all keys optional):
//
// module.exports = {
//   plugin: 'plugin',                 // directory with src/ and .trmnlp.yml
//   tests: 'test/trmnl',              // where the *.spec.js files live
//   report: 'test/trmnl-report',      // HTML report + gallery
//   defaults: { device: 'og_plus', view: 'full', now: '2026-10-02T08:00:00Z', timeZone: 'Europe/Brussels' },
//   serverless: {
//     dependencies: { python: ['icalendar==6.1.0'], ruby: ['nokogiri'], node: ['date-fns@4'], php: ['nesbot/carbon'] },
//     network: 'mock',                // 'live' lets unmocked requests through
//     timeoutMs: 5000,
//   },
//   screenshots: 'always',            // attach device pictures: 'always' | 'on-failure' | 'never'
//   workers: 4,                     // or '50%'; TRMNLP_TEST_WORKERS and --workers override it
//   retries: 0,
// };
const fs = require('fs');
const path = require('path');

const NAMES = ['trmnlp-test.config.js', 'trmnlp-test.config.cjs', 'test/trmnlp-test.config.js'];

function findConfigFile(root) {
  for (const n of NAMES) {
    const f = path.join(root, n);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function guessPlugin(root) {
  for (const d of ['plugin', '.', 'src/..']) {
    if (fs.existsSync(path.join(root, d, 'src', 'settings.yml')) || fs.existsSync(path.join(root, d, '.trmnlp.yml'))) return d;
  }
  return 'plugin';
}

function loadConfig(root = process.env.TRMNLP_TEST_ROOT || process.cwd()) {
  if (process.env.TRMNLP_TEST_CONFIG) return JSON.parse(process.env.TRMNLP_TEST_CONFIG);
  const file = findConfigFile(root);
  const user = file ? require(file) : {};
  const cfg = {
    plugin: guessPlugin(root), tests: 'test/trmnl', report: 'test/trmnl-report', screenshots: 'always',
    ...user,
    defaults: { device: 'og_plus', view: 'full', ...(user.defaults || {}) },
    serverless: { network: 'mock', timeoutMs: 5000, dependencies: {}, ...(user.serverless || {}) },
  };
  cfg.root = path.resolve(root);
  cfg.configFile = file;
  return cfg;
}

module.exports = { loadConfig };
