'use strict';
// expect(screen).toXxx() matchers. Failure messages carry the evidence, so a red
// run is debuggable from the report alone.
const { expect: baseExpect } = require('@playwright/test');
const { Screen, TransformResult } = require('./screen');
const { Png } = require('./png');

const list = (items) => items.map((x) => '  - ' + (typeof x === 'string' ? x : JSON.stringify(x))).join('\n');
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const result = (pass, message) => ({ pass, message: () => message });
const tr = (x) => (x instanceof Screen ? x.transform : x);

const matchers = {
  // nothing went wrong anywhere: Liquid, transform, page JS, assets
  toRenderCleanly(screen, { allow = [] } = {}) {
    const problems = screen.problems().filter((p) => !allow.some((a) => (a instanceof RegExp ? a.test(p) : p.includes(a))));
    return result(problems.length === 0, this.isNot ? `${screen.label}: expected problems, found none`
      : `${screen.label}: ${problems.length} problem(s):\n${list(problems)}`);
  },

  async toHaveNoOverflow(screen, opts = {}) {
    const { outside, clipped, error } = await screen.overflow(opts);
    if (error) return result(false, error);
    const bad = [...outside.map((o) => ({ outside: o.element, by: o.by })), ...(opts.clipped ? clipped : [])];
    return result(bad.length === 0, `${screen.label}: ${bad.length} element(s) overflow ${opts.within || 'the view'}:\n${list(bad.slice(0, 20))}`);
  },

  async toHaveNoOverlap(screen, a, b = a, opts = {}) {
    const hits = await screen.overlaps(a, b, opts);
    return result(hits.length === 0, `${screen.label}: ${a} overlaps ${b} ${hits.length} time(s):\n${list(hits.slice(0, 20))}`);
  },

  async toShowText(screen, expected, { selector = '.view' } = {}) {
    const text = await screen.text(selector);
    const pass = expected instanceof RegExp ? expected.test(text) : text.includes(expected);
    return result(pass, `${screen.label}: expected ${selector} ${this.isNot ? 'not ' : ''}to show ${JSON.stringify(String(expected))}\nit shows:\n${text.slice(0, 1500)}`);
  },

  // the QR code in the device picture decodes to `expected` (null: no QR at all)
  async toHaveQr(screen, expected, { rect } = {}) {
    const got = await screen.qr(rect);
    const pass = expected instanceof RegExp ? got != null && expected.test(got) : got === expected;
    return result(pass, `${screen.label}: QR decodes to ${JSON.stringify(got)}, expected ${expected instanceof RegExp ? expected : JSON.stringify(expected)}`);
  },

  // PNG snapshot of the device picture; --update-snapshots writes it
  async toMatchScreen(screen, name, opts = {}) {
    if (typeof name === 'object') { opts = name; name = undefined; }
    const png = await screen.png();
    const file = (name ? slug(name) : slug(screen.testTitle || 'screen') + '--' + slug(screen.label)) + '.png';
    try {
      baseExpect(png.buffer).toMatchSnapshot(file, { maxDiffPixels: 0, ...opts });
      return result(true, `${screen.label} matches ${file}`);
    } catch (e) {
      return result(false, e.message);
    }
  },

  async toFitDeviceImageLimit(screen) {
    const limit = screen.device.model.image_size_limit;
    if (!limit) return result(true, `${screen.label}: ${screen.device.model.name} has no image size limit`);
    const bytes = (await screen.png()).deviceBytes();
    return result(bytes <= limit, `${screen.label}: device image is ${bytes} bytes, ${screen.device.model.name} accepts ${limit}`);
  },

  async toBeBlank(target, rect) {
    const png = target instanceof Png ? target : await target.png();
    const colors = png.colors(rect);
    return result(colors.length <= 1, `${target.label || 'image'}${rect ? ' ' + JSON.stringify(rect) : ''}: ${colors.length} colour(s) ${colors.slice(0, 6).join(' ')}`);
  },

  // the hosted serverless limits: 5 s wall clock, 128 MB
  toStayWithinServerlessLimits(target, { timeoutMs = 5000, memoryMb = 128 } = {}) {
    const t = tr(target);
    if (!t.ran) return result(false, `transform did not run: ${t.reason || t.error}`);
    const bad = [];
    if (t.timedOut || t.durationMs > timeoutMs) bad.push(`took ${t.durationMs} ms (limit ${timeoutMs})`);
    if (t.maxRssMb != null && t.maxRssMb > memoryMb) bad.push(`peak memory ${t.maxRssMb} MB (limit ${memoryMb})`);
    return result(bad.length === 0, `${t.language} transform: ${bad.join(', ') || `${t.durationMs} ms, ${t.maxRssMb} MB`}`);
  },

  toHaveRequested(target, pattern, { method, times, headers, body } = {}) {
    const t = tr(target);
    const all = target instanceof Screen ? target.requests : t.requests;
    let hits = new TransformResult({ requests: all }).requested(pattern, method);
    if (headers) hits = hits.filter((r) => Object.entries(headers).every(([k, v]) => (r.headers || {})[k.toLowerCase()] === v));
    if (body !== undefined) hits = hits.filter((r) => (body instanceof RegExp ? body.test(r.body || '') : r.body === body));
    const pass = times === undefined ? hits.length > 0 : hits.length === times;
    return result(pass, `expected ${times ?? 'some'} request(s) to ${pattern}${method ? ` (${method})` : ''}, got ${hits.length}. Requests made:\n${list(all.map((r) => `${r.method} ${r.url} -> ${r.status ?? ''}${r.mocked ? '' : ' (unmocked)'}`))}`);
  },

  // the transform ran and returned without error (and, given a value, returned that shape)
  toTransformCleanly(target) {
    const t = tr(target);
    return result(t.ran && !t.error, `transform ${t.ran ? 'failed' : 'did not run'}: ${t.error || t.reason}\n${(t.stderr || '').slice(-2000)}`);
  },

  // trmnlp lint: no issues, except the ones allowed (each with a reason in the test)
  toPassLint(lint, { allow = [] } = {}) {
    const left = lint.issues.filter((l) => !allow.some((a) => (a instanceof RegExp ? a.test(l) : l.includes(a))));
    const crashed = !lint.ok && lint.issues.length === 0;
    return result(!crashed && left.length === 0, crashed ? `trmnlp lint failed:\n${lint.output}`
      : `trmnlp lint: ${left.length} issue(s):\n${list(left)}`);
  },
};

module.exports = { matchers, slug };
