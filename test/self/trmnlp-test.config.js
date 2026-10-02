// The framework's own suite: fixture plugins for every strategy and runtime.
module.exports = {
  plugin: '../fixtures/webhook',
  tests: '.',
  report: '../../test-results/self',
  checks: ['checks.js'],
  defaults: { now: '2026-10-02T08:00:00Z', timeZone: 'Europe/Brussels' },
};
