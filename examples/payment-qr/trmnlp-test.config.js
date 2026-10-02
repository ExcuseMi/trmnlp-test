// Tests for ExcuseMi/trmnl-payment-qr-code-plugin: the current Liquid version (plugin/)
// and the earlier webhook + serverless version (plugin-serverless/).
module.exports = {
  plugin: 'plugin',
  tests: 'tests',
  report: '../../test-results/payment-qr',
  defaults: { device: 'og_plus', now: 1790941996, timeZone: 'Europe/Brussels', locale: 'nl' },
};
