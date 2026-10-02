# trmnlp-test

Test framework for TRMNL plugins in the trmnlp format (`src/*.liquid`, `settings.yml`, `.trmnlp.yml`), in Docker.

- **Every data path:** webhook (`deep_merge`, `stream`, 2 kB / 5 kB limits), webhook + serverless (the transform runs when data arrives and its output is stored), polling (URLs, headers and body rendered with custom fields; JSON/XML), static, serverless transforms in Python, Ruby, Node and PHP, and `trmnl_state` carried between runs.
- **Same code as trmnlp:** trmnlp's own Liquid environment, settings parsing, polling parser and serverless wrapper. The image is rebuilt on every new trmnlp release (`:latest`, `:trmnlp-X.Y.Z`) once the self-tests pass on it.
- **Every device and setting:** every model from `/api/models`, their palettes from `/api/palettes`, portrait, real mashup slots, dark mode, themes, scale, text scale, fonts, and every framework version.
- **Deterministic:** frozen clock (transform via libfaketime, Liquid `now`, browser `Date`); HTTP(S) mocks for transforms (a MITM proxy, so they work with any library) and for polling and browser requests; cached framework assets and fonts.
- **Assertions on HTML or PNG:** Playwright locators on the rendered page, plus a picture reduced to the device palette for pixel checks, QR decoding, snapshots and the device image size limit.
- **Report:** a gallery `index.html` with every device picture, transform time and memory, and problems found, linked to the Playwright HTML report.

## Install

```sh
gem install trmnlp-test        # needs Ruby and Docker; runs ghcr.io/excusemi/trmnlp-test
```

## Use

```sh
cd my-plugin
trmnlp-test init               # trmnlp-test.config.js + test/trmnl/plugin.spec.js
trmnlp-test                    # run; Playwright args pass through (-g, --update-snapshots)
trmnlp-test models | versions  # device models / framework versions
trmnlp-test update             # pull the image now (otherwise at most once a day)
trmnlp-test views.spec        # only some tests (a file or a filter); Playwright args pass through
trmnlp-test run -- --rebaseline  # args after -- reach the specs: require('trmnlp-test').args
trmnlp-test help | --version   # all commands and options / versions of trmnlp-test, trmnlp, Playwright
```

`--repo DIR` runs against another directory. `--mount DIR` mounts an extra directory.

**Parallel:** tests run in parallel workers, each with its own harness and browser (default: half the CPUs). Set the number with `workers: 4` (or `'50%'`) in the config, `TRMNLP_TEST_WORKERS=4`, or `--workers 4` / `-j 4`, in increasing priority. Separate runs can also go at the same time, for other plugins or the same one: the shared cache is safe for concurrent use. Give each run of the same repo its own `--report DIR`. The cache (assets, dependencies, mock CA) is kept in `~/.cache/trmnlp-test`.

From a clone, `bin/trmnlp-test` builds the image from source on the newest trmnlp (`TRMNLP_TEST_BUILD=1` rebuilds it; `TRMNLP_VERSION=x.y.z` picks another).

## Release

Pushing to `main`, and a daily check for a new trmnlp release, publish the image as `:latest` and `:trmnlp-X.Y.Z`. Pushing a tag `vX.Y.Z` (matching `lib/trmnlp_test/version.rb`) runs the self-tests, publishes `:X.Y.Z` and pushes the gem through rubygems.org trusted publishing (no stored key).

## GitHub Actions

```yaml
# .github/workflows/trmnl-tests.yml (trmnlp-test init writes it)
name: trmnl tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ExcuseMi/trmnlp-test@v0
        # with: { args: '--workers 2', directory: '.', report: 'test/trmnl-report', version: '', artifact: 'trmnl-report' }
```

It installs the gem, caches `~/.cache/trmnlp-test`, runs the tests, writes a summary on the run page, adds annotations at the failing lines, and uploads the report with every device picture as the `trmnl-report` artifact. Commit PNG snapshots (`__screens__/`) so `toMatchScreen` has something to compare against.

## Config: `trmnlp-test.config.js`

See [templates/trmnlp-test.config.js](templates/trmnlp-test.config.js). Transform dependencies:

```js
serverless: { dependencies: { python: ['icalendar==6.1.0'], ruby: 'Gemfile', node: ['date-fns@4'], php: ['nesbot/carbon:^3'] } }
```

`requests` (Python) and `httparty` (Ruby) are always installed, as on the hosted runtime. Each distinct list is installed once.

## Tests

```js
const { test, expect, matrix, VIEWS, DEVICES, FRAMEWORK } = require('trmnlp-test');

test('menu', async ({ trmnl }) => {
  const screen = await trmnl.render({
    device: 'og_plus', view: 'full',          // any model, orientation: 'portrait', palette, theme, scale, textScale, fonts, framework
    darkMode: true,                           // TRMNL's dark-mode classes (screen--dark-mode, dark-mode)
    qr: 'server',                             // qr_code as TRMNL's server returns it (default); 'trmnlp', 'fixed'
    crlf: true,                               // the template with CR LF newlines (e.g. pasted markup)
    fields: { data_source: 'webhook' },       // custom field values (defaults + .trmnlp.yml + these)
    webhook: { merge_variables: {...} },      // or data: {...} to render given data as is
    mocks: { 'https://api.example.com/*': { temp: 21 } },
    transform: true,                          // false: skip the transform
    now: '2026-10-02T08:00:00Z',
  });
  expect(screen).toRenderCleanly();                         // Liquid, transform, page JS, assets, unmocked requests, screen size
  await expect(screen.locator('[data-row]')).toHaveCount(7); // any Playwright locator assertion
  await expect(screen).toHaveNoOverflow();
  await expect(screen).toHaveNoOverlap('.title', 'img');
  await expect(screen).toShowText('Espresso');              // visible: not cut off by an ellipsis, clamp or the edge ({ visible: false }: content only)
  await expect(screen).toHaveQr('BCD\n002...');             // black on white; { inverted: true | 'any' } for dark codes
  await expect(screen).toMatchScreen();                     // PNG snapshot (--update-snapshots)
  await expect(screen).toFitDeviceImageLimit();
  await expect(screen).toMatchReference('refs/photo.png', { selector: '.dial', refRect, minIoU: 0.93 });  // diff attached
  const png = await screen.png();                           // pixel(x,y), colors(), inkRatio(rect), inkBounds(), crop()
});

test('transform only', async ({ trmnl }) => {
  const run = await trmnl.transform({ mocks, fields });
  expect(run).toTransformCleanly();
  expect(run).toStayWithinServerlessLimits();               // 5 s, 128 MB
  expect(run).toHaveRequested('https://api.example.com/x', { headers: { 'x-key': 'abc' } });
  expect(run.output).toMatchObject({ ... });
});

test('a device over time', async ({ trmnl }) => {
  const s = trmnl.session({ mocks });
  await s.webhook({ merge_variables: {...}, merge_strategy: 'deep_merge' });
  const screen = await s.render();                          // stored webhook data + trmnl_state from the last run
});

for (const s of matrix({ device: DEVICES.representative, view: VIEWS, darkMode: [false, true] })) {
  test(`fits · ${s.label}`, async ({ trmnl }) => { /* trmnl.render(s) */ });
}
```

**Extending:** add matchers with `expect.extend` and fixtures with `test.extend` (Playwright's own mechanisms), and plugin-wide rules with `checks: ['test/trmnl/checks.js']` in the config. Checks run after every render, and `toRenderCleanly` reports their problems. See [docs/SPEC.md](docs/SPEC.md#91-extending).

Other helpers: `trmnl.plugin('other/dir')`, `trmnl.lint()` with `toPassLint({ allow })`, `FRAMEWORK.majors()`, `FRAMEWORK.latestOf('2')`.

## How it works

See [docs/README.md](docs/README.md) for diagrams and [docs/SPEC.md](docs/SPEC.md) for the full specification.

## Examples and self-tests

- `examples/payment-qr`: the earlier webhook + serverless version of the payment QR plugin (the current version tests itself with trmnlp-test in its own repository).
- `test/self/trmnlp-vs-trmnl.spec.js`: where trmnlp's `qr_code` renders differently from TRMNL, as tests that fail on trmnlp's behaviour (marked `test.fail`, so they turn red once trmnlp matches). `TRMNLP_TEST_SHOW_DIFFERENCES=1` prints the failures.
- `test/self`: fixture plugins for every strategy and language (86 tests). Run with `bin/trmnlp-test run --root test/self`.
