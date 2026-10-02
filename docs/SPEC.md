# trmnlp-test specification

Version 0.1.12. This describes what trmnlp-test does and guarantees. [README.md](../README.md) is the short introduction, and [README.md](README.md) in this folder has the diagrams.

## 1. Purpose

trmnlp-test runs automated tests against TRMNL plugins written in the trmnlp format. A test renders the plugin the way TRMNL would and asserts on the result: the data, the serverless transform, the rendered page (HTML and DOM geometry), and the picture the device shows (PNG).

Principles:

- **Same code as trmnlp.** Liquid, settings parsing, polling, the serverless wrapper and lint come from trmnlp itself, loaded as a library.
- **Same page as TRMNL.** The page around the plugin is TRMNL's preview page, not trmnlp's. Where TRMNL is known to differ from trmnlp, TRMNL wins (section 7.6).
- **Deterministic.** Time is frozen, and network access is mocked by default.
- **Evidence in failures.** Failure messages carry the measured values, and the report carries every device picture.

## 2. Installation and running

### 2.1 Install

```sh
gem install trmnlp-test
```

Requires Ruby 3.0 or later and Docker. The gem contains only a launcher. Everything else runs in the image `ghcr.io/excusemi/trmnlp-test`.

### 2.2 Commands

`trmnlp-test [options] [command] [args]`, run from a plugin repository.

| Command | What it does |
|---|---|
| `run [playwright args]` | Runs the tests. This is the default command. Playwright arguments pass through, e.g. `-g "dark"`, `--update-snapshots`, `-j 4`, `--list`. `run --help` shows them. |
| `init` | Creates `trmnlp-test.config.js`, `test/trmnl/plugin.spec.js` and `.github/workflows/trmnl-tests.yml`, and adds the report folder to `.gitignore`. Existing files are kept. |
| `models` | Lists device models: name, kind, size, default palette, palettes. |
| `versions` | Lists the framework versions and the latest. |
| `refresh` | Re-downloads models, palettes and the framework version list. |
| `update` | Pulls the image now (otherwise at most once a day). |
| `shell` | Opens a shell in the image. |
| `version`, `-v`, `--version` | Prints the launcher, image, trmnlp-test, trmnlp, Playwright, Node, Ruby and latest framework versions. |
| `help`, `-h`, `--help` | Prints the usage. Needs no Docker. |

| Option | Meaning |
|---|---|
| `--repo DIR` | Plugin repository (default: the current directory). Mounted at the same path in the container. |
| `--mount DIR` | Also mounts `DIR` (repeatable). Must come before the command. |
| `--root DIR` | The directory containing `trmnlp-test.config.js`. |
| `--report DIR` | Report directory; overrides the config. |

| Environment variable | Meaning |
|---|---|
| `TRMNLP_TEST_WORKERS` | Parallel workers: a number, or a share of the CPUs such as `50%`. |
| `TRMNLP_TEST_IMAGE` | Image to run (default `ghcr.io/excusemi/trmnlp-test:latest`). |
| `TRMNLP_TEST_CACHE_DIR` | Cache directory (default `~/.cache/trmnlp-test`). |
| `TRMNLP_TEST_NO_PULL=1` | Never pull the image automatically. |
| `TRMNLP_TEST_SHOW_DIFFERENCES=1` | Show the failures of the trmnlp-versus-TRMNL tests (section 12). |
| `TRMNLP_TEST_DEBUG=1` | Print the harness's stderr. |

The exit code is Playwright's: 0 when all tests pass, 1 when any fail, 2 for usage errors.

### 2.3 Image updates

`:latest` is pulled at most once a day, and immediately when the launcher version changes. `:X.Y.Z` is a trmnlp-test release, and `:trmnlp-A.B.C` is built on a given trmnlp. From a clone, `bin/trmnlp-test` builds the image locally on the newest trmnlp release; `TRMNLP_TEST_BUILD=1` rebuilds it, and `TRMNLP_VERSION` picks another trmnlp.

## 3. Configuration: `trmnlp-test.config.js`

The file is looked up at `trmnlp-test.config.js`, `trmnlp-test.config.cjs` or `test/trmnlp-test.config.js`. Every key is optional.

| Key | Default | Meaning |
|---|---|---|
| `plugin` | `plugin`, or the first directory with `src/settings.yml` | The trmnlp project: `src/` and `.trmnlp.yml`. |
| `tests` | `test/trmnl` | Spec directory (`*.spec.js`, `*.test.js`). |
| `report` | `test/trmnl-report` | Report directory. |
| `defaults` | `{ device: 'og_plus', view: 'full' }` | Default render options (section 6.2). |
| `serverless.dependencies` | `{}` | Transform packages per language (section 5.6). |
| `serverless.network` | `'mock'` | `'live'` lets unmocked requests through. |
| `serverless.timeoutMs` | `5000` | Transform timeout. |
| `qr` | `'server'` | Default `qr_code` mode (section 7.6). |
| `screenshots` | `'always'` | Device pictures in the report: `always`, `on-failure` or `never`. |
| `workers` | half the CPUs | Number, or a share such as `'50%'`. |
| `retries`, `timeout` | `0`, `60000` | Playwright retries and per-test timeout (ms). |

Priority for the number of workers: `--workers` / `-j`, then `TRMNLP_TEST_WORKERS`, then `workers`.

## 4. The plugin project

A trmnlp project: `src/settings.yml`, `src/{full,half_horizontal,half_vertical,quadrant}.liquid`, an optional `src/shared.liquid` (prepended to each view), an optional `src/transform.{py,rb,js,php}`, and `.trmnlp.yml`. trmnlp-test only reads these files; it never writes to the project.

## 5. Data

### 5.1 Custom field values

These are merged in order, later sources winning:

1. the `default` of each field in `settings.yml` (fields without a value, such as `author_bio`, `copyable` and `copyable_webhook_url`, are skipped)
2. `custom_fields` in `.trmnlp.yml`
3. the test's `fields`

Values are converted to strings as on TRMNL. Arrays (multi-select) and objects keep their shape.

### 5.2 The `trmnl` namespace

Every render receives the full namespace TRMNL sends:

- `user`: `id`, `name`, `first_name`, `last_name`, `locale`, `time_zone` (Rails name, e.g. `Brussels`), `time_zone_iana`, `utc_offset` (at `now`)
- `device`: `friendly_id`, `percent_charged`, `wifi_strength`, `width`, `height` (from the model, swapped in portrait), `model`, `bit_depth`, `firmware_version`, `refresh_interval_seconds`, `sleep_mode_enabled`, `sleep_start_time`, `sleep_end_time`, `orientation`
- `system`: `timestamp_utc` (`now`)
- `plugin_settings`: `instance_name` (the plugin's name), `refresh_interval_minutes`, `strategy`, `dark_mode`, `no_screen_padding`, `custom_fields_values`, `data_fetched_utc`; plus `polling_url` and `polling_headers` for polling plugins
- `state`: the previous `trmnl_state` (section 5.5)

Overrides are layered in this order: `variables.trmnl` in `.trmnlp.yml`, then the test's `trmnl`. Test options also set `timeZone`, `locale`, `user`, `instanceName` and the device fields.

### 5.3 Sources

The source decides the merge variables. The first that applies wins:

| Source | When | Data |
|---|---|---|
| `data` | given | Used as is: the source is skipped. With `transform: false` it is exactly what the template gets. |
| `webhook` | given | The stored webhook data (section 5.4). |
| `static` | strategy `static` | `static_data` from `settings.yml`. |
| `polling` | strategy `polling` | Each URL in `polling_url`, rendered with the custom fields (Liquid); headers and body likewise. Responses come from mocks, or from the network with `network: 'live'`. Parsed by trmnlp's own parser: JSON, XML, text (sniffed JSON) and non-2xx bodies (trmnlp 0.14.2 and later). Several URLs become `IDX_0`, `IDX_1`, and so on. An array response is wrapped as `{ data: [...] }`. |

The `variables` in `.trmnlp.yml` (except `trmnl`) are the base and are deep-merged under the source data. `trmnlpYml: false` ignores `.trmnlp.yml` entirely.

### 5.4 Webhooks

A webhook body is `{ merge_variables, merge_strategy?, stream_limit? }`. A plain object is taken as `merge_variables`, and an array is a sequence of posts.

- `merge_strategy` absent: replaces the stored data. `deep_merge`: deep-merges into it. `stream`: appends to top-level arrays and keeps the last `stream_limit` items.
- Size limit: the JSON of the body must be at most 2048 bytes, or 5120 with `webhookLimit: 'plus'`. A larger body fails the render with a 413 error. `session.webhook()` returns `{ status: 413 }`.

### 5.5 Serverless transform

- The language comes from `serverless_language`, or else from the file extension. Python, Ruby, Node and PHP are supported.
- The code runs in trmnlp's own wrapper (`TRMNLP::TransformBackend::Wrapper`): `run(input)`, `transform(input)` (Node) or `result`.
- `input` is the merge variables plus `trmnl` reduced to `user`, `device`, `plugin_settings`, `state`. The output replaces the merge variables; an array output becomes `{ data: [...] }`.
- `trmnl_state` in the output is taken out and becomes `state` (the next run's `trmnl.state`).
- The runtime is a subprocess with a clean environment: `TZ=UTC`, the clock frozen at `now` (libfaketime, ticking from `now`; `freezeTime: false` disables it), HTTP(S) through the mock proxy (section 5.7), and the dependency paths.
- Limits: killed after `timeoutMs` (default 5000, TRMNL's limit). Duration and peak memory (RSS) are measured. `toStayWithinServerlessLimits` checks them against 5 s and 128 MB.
- Result: `ran`, `language`, `input`, `output`, `stdout`, `stderr`, `exitCode`, `error`, `timedOut`, `durationMs`, `maxRssMb`, `cached`, `requests`.
- Cache: an identical code, input, mocks, clock, environment and dependency set reuse the previous output in the same worker, and replay its recorded requests. It is off with `cacheTransform: false` and always off with `network: 'live'`. It assumes the transform is deterministic for a given input; a transform that uses randomness should set `cacheTransform: false`.
- `transform: false` skips the transform.

### 5.6 Transform dependencies

`serverless.dependencies` takes, per language, a list or a file:

| Language | List entries | File |
|---|---|---|
| `python` | `'icalendar==6.1.0'` | `'requirements.txt'` |
| `ruby` | `'nokogiri:1.18.0'` | `'Gemfile'` |
| `node` | `'date-fns@4'` | `'package.json'` |
| `php` | `'nesbot/carbon:^3'` | `'composer.json'` |

The hosted built-ins are always installed: `requests` for Python and `httparty` for Ruby (PHP's `curl` extension and Node's `fetch` are in the image). Each distinct set is installed once into the cache (pip `--target`, `gem --install-dir`, npm `--prefix`, composer). The install happens in a private directory that is renamed into place, so parallel runs never see a half-installed set.

### 5.7 Mocks

`mocks` is a list or an object:

```js
mocks: [{ url, method?, status?, headers?, json? | body? | bodyBase64?, times?, delayMs?, error?: 'reset' }]
mocks: { 'https://api.example.com/x': { temp: 21 } }   // plain value = json; string = body
```

- `url` is an exact URL, a glob with `*`, or a regex written `/.../`. Without `?` in the pattern, the query string is ignored.
- `times` limits how often a mock answers; the next matching mock answers after it.
- Mocks apply to the transform (through an HTTPS proxy with its own CA, so they work with any library that honours `HTTP(S)_PROXY`), to polling, and to the browser.
- A server-side request with no mock gets status 599 and is reported by `toRenderCleanly`. Unmocked browser requests (images) are fetched and cached.
- Every request is recorded: `method`, `url`, `headers`, `body`, `mocked`, `status`, `via`.

### 5.8 Sessions

`trmnl.session(base)` keeps what TRMNL keeps between events:

- `webhook(body, { limit })` stores data using the merge strategy and returns `{ status, data, transform?, error? }`.
- On a **webhook plugin with a transform**, the transform runs when data arrives, and its output is stored in place of the data. Later `render()` calls show the stored output and do not run the transform, so settings changes do not apply until the next post.
- `trmnl_state` carries over between `transform()` and `render()` calls.
- `session.webhookData` and `session.state` can be read.

## 6. Rendering

### 6.1 Pipeline

1. The harness (Ruby, one per worker) assembles the data, runs the transform, and renders `shared.liquid` + `<view>.liquid` with trmnlp's Liquid environment, including `custom_filters` from `.trmnlp.yml`. Liquid's `now` is frozen. `strictVariables: true` collects undefined variables as warnings.
2. The page is built (section 6.3) and served by a local HTTP server.
3. The page loads in an iframe of a long-lived host page (one per worker and device scale), sized to the device. The framework's files are cached by the browser, so the stylesheet is parsed once per worker.
4. The browser clock is fixed at `now`. The render waits for `load`, `document.fonts.ready`, two animation frames and `settleMs` (default 100).
5. `--pixel-ratio` is set to the model's ratio (TRMNL keeps it at 1 during layout and applies it at capture), followed by two more frames.
6. The `Screen` is returned. Its picture is taken on demand.

### 6.2 Render options

| Option | Default | Meaning |
|---|---|---|
| `device` | `og_plus` | A model name from `/api/models`; aliases `og`, `x`, `og_1bit`, `kindle`. |
| `orientation` | `landscape` | `portrait` swaps the size and adds `screen--portrait`. |
| `palette` | the model's palette for its bit depth | Any of the model's `palette_ids`. |
| `view` | `full` | `full`, `half_horizontal`, `half_vertical`, `quadrant`. |
| `slot` | `0` | Which mashup slot holds the plugin. |
| `framework` | `settings.yml`'s `framework_version`, else latest | A version, `'latest'`, or a major such as `'2'` (the newest 2.x). |
| `darkMode` | `settings.yml`'s `dark_mode` | `true` / `false` (section 7.3). |
| `noScreenPadding` | `settings.yml`'s `no_screen_padding` | Adds `screen--no-bleed`. |
| `theme` | none | `dark`, `black-and-yellow`, `white-and-red` (framework 3.2 and later). |
| `scale` | none | `xxsmall` … `xxlarge` (`screen--scale-*`). |
| `textScale` | none | `small`, `regular`, `large`, `xlarge`. |
| `fonts` | `trmnl` | `trmnl` or `classic`. |
| `screenClasses` | none | Extra screen classes. |
| `qr` | `'server'` | `qr_code` output: `'server'`, `'trmnlp'` or `'fixed'` (section 7.6). |
| `crlf` | `false` | Renders the template with CR LF newlines. |
| `now` | the config default, else the real time | ISO string, `Date`, or epoch seconds or milliseconds. |
| `timeZone`, `locale`, `user`, `instanceName`, `trmnl` | | Namespace overrides (section 5.2). |
| `fields`, `strategy`, `data`, `webhook`, `webhookStore`, `webhookLimit`, `state` | | Data (section 5). |
| `transform`, `mocks`, `network`, `timeoutMs`, `freezeTime`, `env`, `cacheTransform` | | Transform (section 5.5). |
| `strictVariables` | `false` | Undefined Liquid variables become problems. |
| `trmnlpYml` | `true` | Use `.trmnlp.yml`'s fields and variables. |
| `after` | none | Data merged after the transform, before Liquid. |
| `head` | none | Extra HTML in `<head>`. |
| `settleMs` | `100` | Extra wait after load. |
| `offline` | `false` | Never fetch uncached external files. |
| `deviceScale` | `1` | Browser device scale factor (an extra zoom on the picture). |
| `note` | none | Text added to the report label. |

### 6.3 The page

It matches TRMNL's editor preview (framework 3.4 page, observed 2026-10-02):

```html
<!DOCTYPE html>
<html><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width">
  <link rel="stylesheet" href="/css/<v>/plugins.min.css" />
  <link rel="stylesheet" href="/css/<v>/themes/<theme>-theme.css">   <!-- all three, from 3.2 -->
  <script type="module">import "/js/<v>/plugins.min.js"</script>
</head>
<body class="environment trmnl">
  <div class="trmnl environment">
    <div class="screen ..." style="">
      <div class="view view--full"> ... </div>                    <!-- full -->
      <div class="mashup mashup--1Tx1B"> <div class="view ..."> x2 </div>  <!-- half_horizontal -->
    </div>
  </div>
</body></html>
```

Screen classes, in TRMNL's order: `screen`, the palette class (`screen--1bit`, `screen--4bit`, `screen--color-*`), the device class, the size, `screen--1x`/`2x`, `screen--portrait`, `screen--dark-mode`, `screen--fonts-<fonts>`, `screen--density-*`, `screen--no-bleed`, `screen--theme-*`, `screen--scale-*`, `screen--text-scale-*`, `dark-mode`, and any extra classes.

Mashups: `half_horizontal` is `mashup--1Tx1B` (2 slots), `half_vertical` is `mashup--1Lx1R` (2 slots), `quadrant` is `mashup--2x2` (4 slots). The other slots are empty views.

### 6.4 Devices and palettes

Models and palettes come from `https://trmnl.com/api/models` and `/api/palettes`, refreshed daily, with copies bundled as a fallback. The device picture has the model's `width × height` (swapped in portrait). The default palette is the one whose number of grays equals 2^`bit_depth`; otherwise the model's first palette.

### 6.5 Framework versions

The version list is the published manifest of the design system, refreshed daily. When several copies are available, the one that knows the newest release is used. Files come from `https://trmnl.com/css|js/<v>/` and are cached on disk and in memory.

## 7. Behaviour that matches TRMNL rather than trmnlp

### 7.1 Liquid, settings, polling

These come from trmnlp's code (section 1), plus the namespace in section 5.2.

### 7.2 Pixel ratio

`--pixel-ratio` stays at 1 during layout and is applied at capture.

### 7.3 Dark mode

Dark mode is classes only: `screen--dark-mode` plus `dark-mode`. Nothing else is added.

- Framework 1.2 and 2.x invert on those classes and spare `.image` elements.
- From 3.0 the framework remaps its own colours and inverts nothing (there is no `filter: invert` in 3.4). An inline SVG and hard-coded colours keep their colours, while the screen around them turns black. So a QR code without a light quiet zone of its own loses that quiet zone in dark mode.

### 7.4 Themes

From 3.2, the three theme stylesheets are always loaded, and `theme` adds the class.

### 7.5 Views

Half and quadrant views are real mashup slots, not smaller screens.

### 7.6 `qr_code`

`qr: 'server'` (the default) returns TRMNL's SVG: `width="N" height="N" style="max-width:100%;height:auto"` plus `viewBox`, whatever the view argument. A code therefore keeps its natural size and only shrinks. `'trmnlp'` returns trmnl-liquid's SVG (only a `viewBox` for `"responsive"`). `'fixed'` has no viewBox (not observed; kept for robustness). The server mode is idempotent: if the filter already returns a width, nothing is added.

### 7.7 CR LF

`crlf: true` renders the template with CR LF newlines (for example markup pasted from Windows), so a newline typed in the template no longer matches `\n` in data.

## 8. Test API

```js
const { test, expect, matrix, DEVICES, VIEWS, FRAMEWORK, QR_MODES, SCALES, TEXT_SCALES, THEMES,
        MODELS, PALETTES, Png, quantize, config } = require('trmnlp-test');
```

`test` is Playwright's `test` with the fixture `trmnl`; `expect` is Playwright's `expect` with the matchers of section 9.

### 8.1 `trmnl`

| Method | Returns | Meaning |
|---|---|---|
| `render(opts)` | `Screen` | The full pipeline for one view on one device. |
| `renderMarkup(markup, opts)` | `Screen` | Markup as given (no Liquid, data or transform), with the same page and devices. `bare: true` leaves out the framework files (~250 ms instead of ~900 ms); `deviceScale` zooms the picture. |
| `transform(opts)` | `TransformResult` | The data pipeline only (source and transform), without rendering. |
| `session(base)` | session | Section 5.8. |
| `plugin(dir)` | `trmnl` | The same API for another plugin directory (relative to the config's root). |
| `lint()` | `{ ok, exitCode, output, issues }` | Runs `trmnlp lint`. |
| `info()` | object | Settings, fields, defaults, transform, views, framework, trmnlp version. |

### 8.2 `Screen`

| Property | Meaning |
|---|---|
| `page` | The render's frame (Playwright `Frame`: `locator`, `evaluate`, `waitForTimeout`, and so on). |
| `html`, `markup` | The page HTML and the Liquid output. |
| `data`, `mergeVariables`, `customFields`, `state`, `polling` | The data after the transform, before it, the custom field values, the next `trmnl.state`, and the polling request. |
| `transform` | A `TransformResult`. |
| `requests`, `browserRequests` | Every request (server and browser), and the browser's only. |
| `liquidError`, `liquidWarnings`, `pageErrors`, `consoleErrors`, `missingAssets` | Problems. |
| `device` | `{ model, palette, width, height, orientation }`. |
| `view`, `framework`, `classes`, `darkMode`, `label`, `now`, `screenBox` | The render's settings and the `.screen` box. |

| Method | Returns |
|---|---|
| `locator(sel)`, `getByText(text)` | Playwright locators in the render. |
| `png({ dither = true })` | The device picture: the screenshot reduced to the device palette (Floyd-Steinberg, or the nearest colour with `dither: false`). Full-colour palettes are left as they are. |
| `rawPng()` | The screenshot before reduction. |
| `elementPng(sel, { quantize, dither })` | The picture of one element. |
| `qrInfo(rect?)` | `{ text, inverted }`: tried as drawn, then inverted. |
| `qr(rect?, { inverted })` | The decoded text: black on white by default, `true` for white on black, `'any'` for either. |
| `box(sel)`, `boxes(sel)` | Bounding boxes in screen pixels. |
| `text(sel)` | `innerText`. |
| `findText(text, { selector })` | `{ found, visible, hidden, text }` (section 9). |
| `overflow({ within, ignore, tolerance })` | `{ outside, clipped }`. |
| `overlaps(a, b, { tolerance })` | Intersections. |
| `problems()` | Everything `toRenderCleanly` reports. |

### 8.3 `TransformResult`

The fields of section 5.5, plus `data`, `mergeVariables`, `polling`, `state`, and `requested(pattern, method?)`.

### 8.4 `Png`

`width`, `height`, `buffer`, `pixel(x, y)` (`{ r, g, b, gray, hex }`), `crop(rect)`, `inverted()`, `histogram(rect)`, `colors(rect)`, `background(rect)`, `inkRatio(rect)`, `isBlank(rect)`, `inkBounds(rect)`, `decodeQr(rect)` (zbar), `deviceBytes()` (PNG size at the palette's depth), `save(file)`. `quantize(png, palette, { dither })` is exported.

### 8.5 Helpers

- `matrix({ key: [values] })`: every combination of the given values, each with a readable `label` (`og_plus · portrait · dark`).
- `DEVICES`: `all`, `trmnl`, `kindle`, `byod`, `representative` (one per size, density and palette class), and `model(name)`.
- `VIEWS`: the four views.
- `FRAMEWORK`: `latest`, `versions`, `majors()`, `latestOf(prefix)`, `since(v)`, `resolve(v)`, `compare(a, b)`.
- `QR_MODES`, `SCALES`, `TEXT_SCALES`, `THEMES`, `MODELS`, `PALETTES`.

## 9. Matchers

| Matcher | Passes when |
|---|---|
| `toRenderCleanly({ allow })` | There are no Liquid errors, transform errors, page errors, console errors, failed assets, unmocked server-side requests, strict-variable warnings, or screen-size mismatches (the `.screen` box differs from the device picture by more than 2 px; skipped when `bare`). `allow` takes strings or regexes. |
| `toHaveNoOverflow({ within = '.view', ignore, tolerance = 0.5, clipped })` | No visible element extends outside `within`. With `clipped: true`, no box with `overflow` hides content (elements with `data-clamp` are exempt). |
| `toHaveNoOverlap(a, b = a, { tolerance })` | No box of `a` intersects a box of `b`. |
| `toShowText(text \| regex, { selector = '.view', visible = true })` | The text is present and every character of it is visible: inside each clipping ancestor (overflow, ellipsis, line clamp) and inside the view. `visible: false` only checks the content. |
| `toHaveQr(expected \| regex \| null, { rect, inverted = false })` | The picture's QR code decodes to `expected` with the required polarity. `null`: no code. The message says when a code only decodes inverted. |
| `toMatchScreen(name?, opts)` | The device picture equals the stored PNG (Playwright snapshot; `--update-snapshots` writes it). Stored under `<tests>/__screens__/<spec>/`. |
| `toFitDeviceImageLimit()` | `deviceBytes()` is at most the model's `image_size_limit`. |
| `toBeBlank(rect?)` | The area has one colour (on a `Screen` or a `Png`). |
| `toStayWithinServerlessLimits({ timeoutMs = 5000, memoryMb = 128 })` | The transform ran within the limits. |
| `toHaveRequested(pattern, { method, times, headers, body })` | Matching requests were made (exactly `times`, if given). |
| `toTransformCleanly()` | The transform ran without error. |
| `toPassLint({ allow })` | `trmnlp lint` reports no issues outside `allow`. |

## 10. Reports

- `<report>/index.html`: the gallery. Every test with its status, duration, errors, device pictures (framed), the transform's time and memory per picture, and the problems found. Filterable by status and text.
- `<report>/html/`: Playwright's report, with traces, snapshot diffs, and the page HTML of failed renders.
- `<report>/summary.md`: totals and failed tests in Markdown (used by the GitHub Action).
- `<report>/results/`: Playwright's output.
- Each test attaches `trmnl.json`: per render, the label, model, view, framework, classes, transform metrics, problems and request count.

## 11. GitHub Action

```yaml
- uses: ExcuseMi/trmnlp-test@v0
  with:
    directory: .                 # repository directory to test
    args: ''                     # extra arguments
    report: test/trmnl-report
    version: ''                  # gem version, default the newest
    artifact: trmnl-report       # '' skips the upload
```

The action installs Ruby and the gem, caches `~/.cache/trmnlp-test`, runs the tests with Playwright's `github` reporter (annotations at failing lines), appends `summary.md` to the run summary, uploads the report, and fails when tests fail. `v0` follows the newest release.

## 12. Parallelism, caching, determinism

- Tests run in parallel workers. Each worker has one harness process, one browser and one host page per device scale. Within a worker, tests run one after another.
- Separate runs may share the cache concurrently: the mock CA is created under a file lock, dependency sets are installed in private directories and renamed into place, and cache files are written atomically. Runs of the same repository need separate `--report` directories.
- Cache contents: framework files, fonts and external images (by URL), dependency sets, the mock CA, models, palettes and versions.
- Determinism holds when `now` is fixed, `network` is `'mock'`, and the transform does not use randomness. Snapshots additionally depend on the image, so snapshots made with another trmnlp-test or browser version may differ by a few pixels.

## 13. Releases

- **Push to `main`:** builds the image on the newest trmnlp, runs the self-tests in it, and publishes `:latest` and `:trmnlp-X.Y.Z`.
- **Daily:** the same, only when a new trmnlp is out.
- **Tag `vX.Y.Z`:** the same, plus `:X.Y.Z`, the gem (rubygems.org trusted publishing, MFA required), and the `v0` tag.
- A trmnlp release that breaks the harness fails the self-tests and is not published.

## 14. Self-tests

`test/self` uses fixture plugins in `test/fixtures` covering every strategy, every runtime, server quirks, dark mode, text visibility, devices, framework versions, rendering in iframes and speed. `trmnlp-vs-trmnl.spec.js` holds tests that fail on trmnlp's own behaviour where it differs from TRMNL; they are marked `test.fail`, so they turn red once trmnlp matches. `examples/payment-qr` tests a real plugin's webhook + serverless version.

## 15. Known limitations

- **TRMNL's own data disagrees for the Kindle PW 6th gen:** the models API says 800×600 at 1.28 and framework 3.4 says 800×592, so its screen ends about 10 px short of the panel.
- **Dark mode on framework 3.x is the framework's colour remap.** What a physical device shows has not been checked against a photo.
- **No PDF rendering in the image.** References from PDFs need a host step.
- **No built-in comparison against a reference image** (region IoU). Specs compute it from `Png`.
- **The 15 MB framework stylesheet** is parsed once per worker and device scale. Changing `deviceScale` costs one parse.
