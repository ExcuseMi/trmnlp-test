'use strict';
// The `trmnl` test fixture: render, transform, webhook sessions and lint for one plugin.
const path = require('path');
const { model: findModel, palette: findPalette } = require('./models');
const { FRAMEWORK } = require('./framework');
const { buildPage, screenClasses } = require('./page');
const { Host } = require('./host');
const { applyAll, apply, WebhookError } = require('./webhook');
const { Screen, TransformResult } = require('./screen');

const infoCache = new Map();

// Checks from the config's `checks`: modules exporting a function, or an object of named
// functions, `async (screen) => problem(s)`. They run after every render; what they return
// (a string, a list of strings, or nothing) joins the screen's problems.
let loadedChecks = null;
function checksOf(config) {
  if (loadedChecks) return loadedChecks;
  loadedChecks = [];
  for (const file of config.checks || []) {
    const mod = require(path.resolve(config.root || '.', file));
    const named = typeof mod === 'function' ? { [mod.name || path.basename(file, '.js')]: mod } : mod;
    for (const [name, fn] of Object.entries(named)) {
      if (typeof fn !== 'function') throw new Error(`checks: ${file} exports ${name}, which is not a function`);
      loadedChecks.push({ name, fn });
    }
  }
  return loadedChecks;
}

async function runChecks(screen, config, opts) {
  if (opts.checks === false) return;
  const only = Array.isArray(opts.checks) ? opts.checks : null;
  for (const { name, fn } of checksOf(config)) {
    if (only && !only.includes(name)) continue;
    try {
      const found = await fn(screen);
      for (const p of [].concat(found || [])) screen.checkProblems.push(`${name}: ${p}`);
    } catch (e) {
      screen.checkProblems.push(`${name}: the check failed: ${e.message}`);
    }
  }
}

function toSeconds(now) {
  if (now == null) return Date.now() / 1000;
  if (now instanceof Date) return now.getTime() / 1000;
  if (typeof now === 'number') return now > 1e11 ? now / 1000 : now;
  const t = Date.parse(now);
  if (Number.isNaN(t)) throw new Error(`cannot parse now: ${now}`);
  return t / 1000;
}

// mocks: [{url, json|body|bodyBase64, status, headers, method, times, delayMs}]
// or {'https://api/x': {json}} or {'https://api/x': {...plain object = json}}
function normaliseMocks(mocks) {
  if (!mocks) return [];
  if (Array.isArray(mocks)) return mocks;
  return Object.entries(mocks).map(([url, r]) => {
    const keys = ['json', 'body', 'bodyBase64', 'status', 'headers', 'error', 'delayMs', 'times', 'method'];
    if (r && typeof r === 'object' && !Array.isArray(r) && Object.keys(r).some((k) => keys.includes(k))) return { url, ...r };
    return typeof r === 'string' ? { url, body: r } : { url, json: r };
  });
}

class Trmnl {
  constructor({ harness, browser, testInfo, config, pluginDir }) {
    this.harness = harness;
    this.browser = browser;
    this.testInfo = testInfo;
    this.config = config;
    this.dir = path.resolve(pluginDir);
    this.screens = [];
    this.transforms = [];
  }

  // another plugin directory, same test
  plugin(dir) {
    const t = new Trmnl({ harness: this.harness, browser: this.browser, testInfo: this.testInfo, config: this.config, pluginDir: path.resolve(this.config.root || '.', dir) });
    t.screens = this.screens;
    t.transforms = this.transforms;
    return t;
  }

  async info() {
    if (!infoCache.has(this.dir)) infoCache.set(this.dir, await this.harness.call('info', { plugin: this.dir }));
    return infoCache.get(this.dir);
  }

  options(opts) {
    return { ...(this.config.defaults || {}), ...opts, serverless: { ...(this.config.serverless || {}), ...(opts.serverless || {}) } };
  }

  async device(o, info) {
    const m = findModel(o.device || 'og_plus');
    const portrait = o.orientation === 'portrait';
    const width = portrait ? m.height : m.width, height = portrait ? m.width : m.height;
    return {
      model: m, palette: findPalette(m, o.palette), width, height, orientation: portrait ? 'portrait' : 'landscape',
      namespace: {
        friendly_id: 'ABC123', percent_charged: 100, wifi_strength: 70, height, width, model: m.name, bit_depth: m.bit_depth,
        firmware_version: '1.8.16', refresh_interval_seconds: (Number(info.settings.refresh_interval) || 15) * 60,
        sleep_mode_enabled: false, sleep_start_time: 1320, sleep_end_time: 420, orientation: portrait ? 'portrait' : 'landscape',
      },
    };
  }

  async run(opts, views) {
    const o = this.options(opts);
    if ('server' in o) throw new Error("the server option is gone: the server's qr_code is the default (qr: 'trmnlp' for trmnlp's), and crlf: true renders CR LF newlines");
    const info = await this.info();
    const device = await this.device(o, info);
    const darkMode = darkModeOf(o.darkMode ?? info.settings.dark_mode === 'yes');
    const noBleed = o.noScreenPadding ?? info.settings.no_screen_padding === 'yes';
    const now = toSeconds(o.now);
    const trmnl = mergeDeep({
      device: { ...device.namespace },
      user: { ...(o.timeZone && { time_zone_iana: o.timeZone }), ...(o.locale && { locale: o.locale }), ...(o.user || {}) },
      plugin_settings: { dark_mode: darkMode ? 'yes' : 'no', no_screen_padding: noBleed ? 'yes' : 'no', ...(o.instanceName && { instance_name: o.instanceName }) },
    }, o.trmnl || {});
    const req = {
      plugin: this.dir, fields: o.fields, strategy: o.strategy, now, state: o.state, trmnl, device: trmnl.device,
      transform: o.transform, mocks: normaliseMocks(o.mocks), network: o.network || o.serverless.network || 'mock',
      timeoutMs: o.timeoutMs || o.serverless.timeoutMs || 5000, freezeTime: o.freezeTime, strictVariables: o.strictVariables,
      env: o.env, trmnlpYml: o.trmnlpYml, after: o.after, views, cacheTransform: o.cacheTransform, qr: qrMode(o.qr ?? this.config.qr), crlf: !!o.crlf,
    };
    if (o.data !== undefined) req.data = o.data;
    if (o.webhook !== undefined) req.webhook = applyAll(o.webhookStore || {}, o.webhook, { limit: o.webhookLimit || 'standard' });
    const run = await this.harness.call('run', req);
    return { run, o, info, device, darkMode, noBleed, now };
  }

  // Runs the data pipeline (source -> serverless transform) without rendering.
  async transform(opts = {}) {
    const { run } = await this.run(opts, []);
    const result = new TransformResult(run);
    this.transforms.push(result);
    return result;
  }

  // Renders one view on one device: the full pipeline, then the browser.
  async render(opts = {}) {
    const view = opts.view || (this.config.defaults && this.config.defaults.view) || 'full';
    const { run, o, info, device, darkMode, noBleed, now } = await this.run(opts, [view]);
    const framework = FRAMEWORK.resolve(o.framework || info.framework.setting || 'latest');
    const classes = screenClasses({ model: device.model, palette: device.palette, orientation: device.orientation, darkMode, noBleed,
      theme: o.theme, scale: o.scale, textScale: o.textScale, fonts: o.fonts, extra: o.screenClasses });
    const rendered = run.views[view];
    const html = buildPage({ markup: rendered.markup, view, framework, classes, slot: o.slot || 0, theme: o.theme, head: o.head });

    const shown = await this.openPage(html, { device, now, o });
    const label = [device.model.name + (device.orientation === 'portrait' ? ' portrait' : ''), view,
      device.palette.id !== findPalette(device.model).id && device.palette.id, darkMode && 'dark',
      o.theme && `theme ${o.theme}`, o.scale && `scale ${o.scale}`, o.textScale && `text ${o.textScale}`,
      o.fonts && `fonts ${o.fonts}`, o.framework && `v${framework}`, o.transform === false && 'no transform', o.qr && o.qr !== 'server' && `qr ${o.qr}`, o.crlf && 'crlf', o.note].filter(Boolean).join(' · ');
    const screen = new Screen({
      html, markup: rendered.markup, liquidError: rendered.error, liquidWarnings: rendered.warnings || [],
      data: run.data, mergeVariables: run.mergeVariables, customFields: run.customFields, transform: new TransformResult(run),
      state: run.nextState, polling: run.polling, ...shown,
      device, view, framework, classes, darkMode, label, options: o, now, checkProblems: [],
    });
    this.screens.push(screen);
    await runChecks(screen, this.config, o);
    return screen;
  }

  // Loads the page in an iframe of the worker's host page and waits for it as TRMNL's renderer does.
  async openPage(html, { device, now, o }) {
    const host = await Host.get(this.browser, o.deviceScale || 1);
    const ctx = { mocks: normaliseMocks(o.mocks), requests: [], offline: o.offline, missing: [], pageErrors: [], consoleErrors: [], missingAssets: [] };
    ctx.missing = ctx.missingAssets;
    const { frame, iframe, pageId } = await host.open(html, { width: device.width, height: device.height, now, ctx });
    await frame.evaluate(() => document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
    const settle = o.settleMs ?? 100;
    if (settle) await frame.waitForTimeout(settle);
    // TRMNL keeps --pixel-ratio at 1 while the page lays out and applies the panel's ratio at
    // capture (the framework then scales the screen to the device's pixels): do the same
    const ratio = (device.model.css && Object.fromEntries(device.model.css.variables)['--pixel-ratio']) || '1';
    if (!o.bare) {
      await frame.evaluate((r) => new Promise((done) => {
        const screen = document.querySelector('.screen');
        if (screen) screen.style.setProperty('--pixel-ratio', r);
        requestAnimationFrame(() => requestAnimationFrame(done));
      }), ratio);
    }
    const screenBox = await frame.locator('.screen').first().boundingBox();
    return { page: frame, host, iframe, pageId, ctx, pageErrors: ctx.pageErrors, consoleErrors: ctx.consoleErrors,
      browserRequests: ctx.requests, missingAssets: ctx.missingAssets, screenBox };
  }

  // Renders markup as given: no Liquid, data or transform. For a piece of a plugin (an svg, a
  // component) on a device, at a chosen deviceScale; bare: true leaves the framework out
  // (fast, for checks that need no framework CSS).
  async renderMarkup(markup, opts = {}) {
    const o = this.options(opts);
    const view = o.view || 'full';
    let setting = 'latest';
    try { setting = (await this.info()).framework.setting || 'latest'; } catch { /* no plugin directory */ }
    const framework = FRAMEWORK.resolve(o.framework || setting);
    const device = await this.device(o, { settings: {} });
    const darkMode = darkModeOf(o.darkMode);
    const classes = screenClasses({ model: device.model, palette: device.palette, orientation: device.orientation, darkMode,
      noBleed: o.noScreenPadding, theme: o.theme, scale: o.scale, textScale: o.textScale, fonts: o.fonts, extra: o.screenClasses });
    const html = buildPage({ markup, view, framework, classes, slot: o.slot || 0, theme: o.theme, head: o.head, bare: o.bare });
    const now = toSeconds(o.now);
    const shown = await this.openPage(html, { device, now, o });
    const label = [device.model.name, view, 'markup', o.bare && 'bare', o.deviceScale && `x${o.deviceScale}`, o.note].filter(Boolean).join(' · ');
    const screen = new Screen({
      html, markup, liquidError: null, liquidWarnings: [], data: {}, transform: new TransformResult({}), ...shown,
      device, view, framework, classes, darkMode, label, options: o, now, testTitle: this.testInfo.title, checkProblems: [],
    });
    this.screens.push(screen);
    await runChecks(screen, this.config, o);
    return screen;
  }

  // A stateful plugin instance, as the hosted service keeps it between events:
  //  - webhook posts are stored (with their merge_strategy) and rendered until the next post
  //  - on a webhook plugin with a serverless transform, the transform runs when data
  //    arrives and its output is stored in place of the data; renders do not re-run it
  //  - trmnl_state returned by a transform comes back as trmnl.state on the next run
  session(base = {}) {
    const trmnl = this;
    const s = {
      webhookData: base.webhookData || {},
      state: base.state || {},
      posted: !!base.webhookData,
      transformed: false,
      async webhook(body, { limit } = {}) {
        let merged;
        try {
          merged = apply(s.webhookData, body && 'merge_variables' in body ? body : { merge_variables: body },
            { limit: limit || base.webhookLimit || 'standard' });
        } catch (e) {
          if (e instanceof WebhookError) return { status: e.status, error: e.message };
          throw e;
        }
        s.posted = true;
        const info = await trmnl.info();
        if (info.transform && (base.strategy || info.strategy) === 'webhook' && base.transform !== false) {
          const r = await trmnl.transform({ ...base, data: merged, state: s.state });
          if (r.error) return { status: 200, transform: r, error: r.error, data: s.webhookData };
          const stored = { ...r.data };
          delete stored.trmnl;
          s.webhookData = stored;
          s.transformed = true;
          if (r.state !== undefined) s.state = r.state;
          return { status: 200, transform: r, data: stored };
        }
        s.webhookData = merged;
        return { status: 200, data: merged };
      },
      opts(opts) {
        const o = { ...base, ...opts, state: opts.state || s.state };
        delete o.webhookData;
        if (s.posted && !('data' in opts) && !('webhook' in opts)) {
          o.data = s.webhookData;
          if (s.transformed) o.transform = false;
        }
        return o;
      },
      async transform(opts = {}) {
        const r = await trmnl.transform(s.opts(opts));
        if (r.state !== undefined) s.state = r.state;
        return r;
      },
      async render(opts = {}) {
        const sc = await trmnl.render(s.opts(opts));
        if (sc.state !== undefined) s.state = sc.state;
        return sc;
      },
    };
    return s;
  }

  async lint() {
    return this.harness.call('lint', { plugin: this.dir });
  }

  async finish({ attach = 'always' } = {}) {
    const summary = [];
    for (const [i, s] of this.screens.entries()) {
      const failed = this.testInfo.status !== this.testInfo.expectedStatus;
      if (attach === 'always' || (attach === 'on-failure' && failed)) {
        try {
          const png = await s.png();
          await this.testInfo.attach(`screen ${i + 1}: ${s.label}`, { body: png.buffer, contentType: 'image/png' });
          if (failed) await this.testInfo.attach(`screen ${i + 1}: ${s.label} (html)`, { body: s.html, contentType: 'text/html' });
        } catch { /* page already gone */ }
      }
      summary.push({ label: s.label, model: s.device.model.name, view: s.view, framework: s.framework, classes: s.classes,
        transform: pick(s.transform), problems: s.problems(), requests: s.requests.length });
      await s.host.remove(s);
    }
    for (const t of this.transforms) summary.push({ label: 'transform', transform: pick(t) });
    if (summary.length) await this.testInfo.attach('trmnl.json', { body: JSON.stringify(summary, null, 2), contentType: 'application/json' });
  }
}

// dark mode is the plugin's dark_mode setting: TRMNL adds classes, the framework does the rest
function darkModeOf(value) {
  if (value === 'invert' || value === 'framework') throw new Error(`darkMode is true or false now (got ${JSON.stringify(value)}): dark mode is the framework's classes, as on TRMNL`);
  return !!value && value !== 'no';
}

// qr_code as TRMNL's server returns it (default), as trmnlp does, or without a viewBox (not seen)
const QR_MODES = ['server', 'trmnlp', 'fixed'];
function qrMode(qr) {
  if (qr === undefined) return 'server';
  if (!QR_MODES.includes(qr)) throw new Error(`qr must be one of ${QR_MODES.join(', ')} (got ${JSON.stringify(qr)})`);
  return qr;
}

function pick(t) {
  return { ran: t.ran, language: t.language, durationMs: t.durationMs, maxRssMb: t.maxRssMb, error: t.error, requests: t.requests.length };
}
function mergeDeep(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? mergeDeep(a[k], v) : v;
  }
  return out;
}

module.exports = { Trmnl, toSeconds, normaliseMocks, QR_MODES };
