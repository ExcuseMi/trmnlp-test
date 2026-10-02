'use strict';
// One rendered view on one device: the browser page, the HTML, the data behind
// it, what the transform did, and the device picture.
const { Png, quantize, PNG } = require('./png');

class TransformResult {
  constructor(run) {
    const t = run.transform || {};
    this.ran = !!t.ran;
    this.language = t.language;
    this.reason = t.reason;
    this.input = t.input;
    this.output = t.output;
    this.stdout = t.stdout || '';
    this.stderr = t.stderr || '';
    this.error = t.error || null;
    this.timedOut = !!t.timedOut;
    this.durationMs = t.durationMs;
    this.maxRssMb = t.maxRssMb;
    this.exitCode = t.exitCode;
    this.state = run.nextState;
    this.data = run.data;
    this.mergeVariables = run.mergeVariables;
    this.polling = run.polling;
    this.requests = run.requests || [];
  }

  requested(pattern, method) {
    const re = pattern instanceof RegExp ? pattern
      : new RegExp('^' + String(pattern).split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (String(pattern).includes('?') ? '$' : '(\\?.*)?$'));
    return this.requests.filter((r) => re.test(r.url) && (!method || r.method === method.toUpperCase()));
  }
}

class Screen {
  constructor(props) { Object.assign(this, props); }

  locator(selector) { return this.page.locator(selector); }
  getByText(text, opts) { return this.page.locator('.view').first().getByText(text, opts); }

  get transformResult() { return this.transform; }
  get requests() { return [...this.transform.requests, ...this.browserRequests]; }

  async rawPng() {
    if (!this._raw) {
      const buffer = await this.page.screenshot({ clip: { x: 0, y: 0, width: this.device.width, height: this.device.height }, animations: 'disabled', caret: 'hide' });
      this._raw = PNG.sync.read(buffer);
    }
    return new Png(this._raw, { palette: { framework_class: 'screen--color-full' }, model: this.device.model });
  }

  // the picture the device shows: the screenshot reduced to the device palette
  async png({ dither = this.options.dither !== false } = {}) {
    const key = dither ? 'd' : 'n';
    this._png = this._png || {};
    if (!this._png[key]) {
      const raw = await this.rawPng();
      this._png[key] = new Png(quantize(raw.png, this.device.palette, { dither }), { palette: this.device.palette, model: this.device.model });
    }
    return this._png[key];
  }

  async qr(rect) {
    // decode the undithered picture: dither noise around modules only ever hurts a scanner
    const codes = (await this.png({ dither: false })).decodeQr(rect);
    return codes.length ? codes[0] : null;
  }

  async box(selector) {
    const b = await this.page.locator(selector).first().boundingBox();
    return b;
  }

  async boxes(selector) {
    return this.page.locator(selector).evaluateAll((els) => els.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }));
  }

  async text(selector = '.view') {
    return (await this.page.locator(selector).first().innerText()).trim();
  }

  // elements drawn outside their view (or slot), and boxes whose content is clipped
  async overflow({ within = '.view', ignore = [], tolerance = 0.5 } = {}) {
    return this.page.evaluate(({ within, ignore, tolerance }) => {
      const root = document.querySelector(within);
      if (!root) return { outside: [], clipped: [], error: `no element matches ${within}` };
      const bounds = root.getBoundingClientRect();
      const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
        (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '') +
        (el.textContent && el.children.length === 0 ? ` "${el.textContent.trim().slice(0, 40)}"` : '');
      const outside = [], clipped = [];
      for (const el of root.querySelectorAll('*')) {
        if (ignore.some((s) => el.closest(s))) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const d = { left: bounds.left - r.left, top: bounds.top - r.top, right: r.right - bounds.right, bottom: r.bottom - bounds.bottom };
        const worst = Object.entries(d).filter(([, v]) => v > tolerance);
        if (worst.length) outside.push({ element: name(el), by: Object.fromEntries(worst.map(([k, v]) => [k, Math.round(v * 10) / 10])) });
        if (/(hidden|clip|auto|scroll)/.test(cs.overflow + cs.overflowX + cs.overflowY) && !el.dataset.clamp && !el.hasAttribute('data-clamp')) {
          const dx = el.scrollWidth - el.clientWidth, dy = el.scrollHeight - el.clientHeight;
          if (dx > 1 || dy > 1) clipped.push({ element: name(el), hiddenX: dx, hiddenY: dy });
        }
      }
      return { outside, clipped };
    }, { within, ignore, tolerance });
  }

  async overlaps(a, b, { tolerance = 0 } = {}) {
    const [ra, rb] = [await this.boxes(a), await this.boxes(b)];
    const hits = [];
    ra.forEach((x, i) => rb.forEach((y, j) => {
      const w = Math.min(x.x + x.width, y.x + y.width) - Math.max(x.x, y.x);
      const h = Math.min(x.y + x.height, y.y + y.height) - Math.max(x.y, y.y);
      if (w > tolerance && h > tolerance && !(a === b && i === j)) hits.push({ a: i, b: j, width: Math.round(w), height: Math.round(h) });
    }));
    return hits;
  }

  problems() {
    const p = [];
    if (this.liquidError) p.push(`Liquid: ${this.liquidError}`);
    if (this.transform.error) p.push(`transform (${this.transform.language}): ${this.transform.error}`);
    for (const e of this.pageErrors) p.push(`page error: ${e}`);
    for (const e of this.consoleErrors) p.push(`console.error: ${e}`);
    for (const w of this.liquidWarnings || []) p.push(`Liquid strict: ${w}`);
    for (const u of this.missingAssets) p.push(`failed to load ${u}`);
    for (const r of this.transform.requests) {
      if (!r.mocked && r.status === 599) p.push(`unmocked ${r.via === 'polling' ? 'polling' : 'transform'} request: ${r.method} ${r.url} (add it to mocks, or network: 'live')`);
    }
    const b = this.screenBox;
    if (b && (Math.abs(b.width - this.device.width) > 2 || Math.abs(b.height - this.device.height) > 2)) {
      p.push(`the screen is ${Math.round(b.width)}x${Math.round(b.height)} but the device picture is ${this.device.width}x${this.device.height}`);
    }
    return p;
  }
}

module.exports = { Screen, TransformResult };
