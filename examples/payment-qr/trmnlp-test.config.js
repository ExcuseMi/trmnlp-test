// The earlier webhook + serverless version of ExcuseMi/trmnl-payment-qr-code-plugin (git 5460d5c^).
// The current version is tested in its own repository with trmnlp-test.
module.exports = {
  plugin: 'plugin-serverless',
  tests: 'tests',
  report: '../../test-results/payment-qr',
  defaults: { device: 'og_plus', now: 1790941996, timeZone: 'Europe/Brussels', locale: 'nl' },
};
