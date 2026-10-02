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

// screen.page is the render's frame (an iframe of the worker's host page, as in TRMNL's
// editor): locator(), evaluate(), waitForTimeout() and the rest of Playwright's Frame API.
class Screen {
  constructor(props) { Object.assign(this, props); }

  locator(selector) { return this.page.locator(selector); }
  getByText(text, opts) { return this.page.locator('.view').first().getByText(text, opts); }

  get transformResult() { return this.transform; }
  get requests() { return [...this.transform.requests, ...this.browserRequests]; }

  async rawPng() {
    if (!this._raw) {
      await this.host.activate(this);
      const buffer = await this.host.page.screenshot({ clip: { x: 0, y: 0, width: this.device.width, height: this.device.height }, animations: 'disabled', caret: 'hide' });
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

  // The QR code in the picture and its polarity: { text, inverted } (text null: none found).
  // A code is tried as drawn first, then inverted (white on black, e.g. after dark mode).
  // The picture of one element (its bounding box at the page's device scale); quantize: true
  // reduces it to the device palette like png() does
  async elementPng(selector, { quantize: reduce = false, dither = true } = {}) {
    await this.host.activate(this);
    const buffer = await this.page.locator(selector).first().screenshot({ animations: 'disabled', caret: 'hide' });
    const png = Png.fromBuffer(buffer, { palette: { framework_class: 'screen--color-full' }, model: this.device.model });
    return reduce ? new Png(quantize(png.png, this.device.palette, { dither }), { palette: this.device.palette, model: this.device.model }) : png;
  }

  // Compares part of the device picture with a reference image (a photo, a scan, an exported
  // drawing): the reference, or its refRect, is resized to the compared area and scored by the
  // IoU of the ink. => { iou, picture, reference, diff, rect }
  //   reference: an image file or a Png;  rect | selector: the area of the picture (default all)
  //   refRect: the matching area of the reference (default all);  threshold, ink: see Png.mask
  async compareReference(reference, { rect, selector, refRect, threshold = 128, ink = 'dark', filter } = {}) {
    let area = rect;
    if (selector) {
      const b = await this.box(selector);
      if (!b) throw new Error(`${this.label}: no element matches ${selector}`);
      area = b;
    }
    const full = await this.png({ dither: false });
    const picture = area ? full.crop(area) : full;
    let ref = reference instanceof Png ? reference : Png.fromFile(reference);
    if (refRect) ref = ref.crop(refRect);
    ref = ref.resize(picture.width, picture.height, filter ? { filter } : {});
    const opts = { threshold, ink };
    return { iou: picture.iou(ref, opts), picture, reference: ref, diff: picture.diff(ref, opts), rect: area || { x: 0, y: 0, width: full.width, height: full.height } };
  }

  // Turns the screen after load, as the device does when it is rotated: the iframe and the
  // picture swap their size and the screen gets (or loses) screen--portrait. The data and the
  // Liquid output stay as rendered; the framework and the plugin's own scripts see the new size.
  async setOrientation(orientation) {
    if (!['landscape', 'portrait'].includes(orientation)) throw new Error(`orientation must be landscape or portrait (got ${orientation})`);
    if (orientation === this.device.orientation) return this;
    const { width, height } = this.device;
    this.device = { ...this.device, width: height, height: width, orientation };
    await this.iframe.evaluate((f, size) => { f.style.width = size.width + 'px'; f.style.height = size.height + 'px'; }, { width: height, height: width });
    this.host.active = null;
    await this.host.activate(this);
    await this.page.evaluate((portrait) => new Promise((done) => {
      document.querySelector('.screen').classList.toggle('screen--portrait', portrait);
      window.dispatchEvent(new Event('resize'));
      requestAnimationFrame(() => requestAnimationFrame(done));
    }), orientation === 'portrait');
    this.classes = await this.page.evaluate(() => document.querySelector('.screen').className);
    this.screenBox = await this.page.locator('.screen').first().boundingBox();
    this._raw = null;
    this._png = null;
    return this;
  }

  async qrInfo(rect) {
    // decode the undithered picture: dither noise around modules only ever hurts a scanner
    const png = await this.png({ dither: false });
    const normal = png.decodeQr(rect);
    if (normal.length) return { text: normal[0], inverted: false };
    const inverted = png.inverted().decodeQr(rect);
    return inverted.length ? { text: inverted[0], inverted: true } : { text: null, inverted: null };
  }

  // the decoded text of a black-on-white code ({ inverted: true }: white on black, 'any': either)
  async qr(rect, { inverted = false } = {}) {
    const info = await this.qrInfo(rect);
    return info.text != null && (inverted === 'any' || inverted === info.inverted) ? info.text : null;
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

  // Where `expected` is in the text of `selector`, and whether each character of it is visible:
  // inside every clipping ancestor (overflow, ellipsis, line clamp) and inside the view.
  // => { found, visible, hidden: 'the part that is cut off', text }
  async findText(expected, { selector = '.view' } = {}) {
    const source = expected instanceof RegExp ? { re: expected.source, flags: expected.flags.replace('g', '') } : { str: String(expected) };
    return this.page.evaluate(({ selector, source }) => {
      const root = document.querySelector(selector);
      if (!root) return { found: false, text: '', error: `no element matches ${selector}` };
      // the text with runs of whitespace collapsed, and for each character the node and offset it came from
      const chars = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const cs = n.parentElement && getComputedStyle(n.parentElement);
        if (cs && (cs.display === 'none' || ['script', 'style', 'template'].includes(n.parentElement.tagName.toLowerCase()))) continue;
        for (let i = 0; i < n.data.length; i++) {
          const ch = /\s/.test(n.data[i]) ? ' ' : n.data[i];
          if (ch === ' ' && (chars.length === 0 || chars[chars.length - 1].ch === ' ')) continue;
          chars.push({ ch, node: n, i });
        }
      }
      const text = chars.map((c) => c.ch).join('');
      let at = -1, len = 0;
      if (source.re) { const m = new RegExp(source.re, source.flags).exec(text); if (m) { at = m.index; len = m[0].length; } }
      else { at = text.indexOf(source.str.replace(/\s+/g, ' ')); len = source.str.replace(/\s+/g, ' ').length; }
      if (at < 0) return { found: false, text: text.trim() };
      const clipsOf = (el) => {
        const boxes = [];
        for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
          const cs = getComputedStyle(e);
          if (cs.visibility === 'hidden' || cs.opacity === '0') boxes.push(null);
          if (/(hidden|clip|auto|scroll)/.test(cs.overflowX + cs.overflowY) || e === root) boxes.push(e.getBoundingClientRect());
        }
        return boxes;
      };
      let hidden = '';
      for (let k = at; k < at + len; k++) {
        const c = chars[k];
        if (c.ch === ' ') continue;
        const r = document.createRange();
        r.setStart(c.node, c.i); r.setEnd(c.node, c.i + 1);
        const rect = r.getBoundingClientRect();
        const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        const shown = rect.width > 0 && clipsOf(c.node.parentElement).every((b) => b && cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom);
        if (!shown) hidden += c.ch;
      }
      return { found: true, visible: hidden === '', hidden, text: text.trim() };
    }, { selector, source });
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
    for (const c of this.checkProblems || []) p.push(c);
    for (const u of this.missingAssets) p.push(`failed to load ${u}`);
    for (const r of this.transform.requests) {
      if (!r.mocked && r.status === 599) p.push(`unmocked ${r.via === 'polling' ? 'polling' : 'transform'} request: ${r.method} ${r.url} (add it to mocks, or network: 'live')`);
    }
    const b = this.screenBox;
    if (b && !(this.options && this.options.bare) && (Math.abs(b.width - this.device.width) > 2 || Math.abs(b.height - this.device.height) > 2)) {
      p.push(`the screen is ${Math.round(b.width)}x${Math.round(b.height)} but the device picture is ${this.device.width}x${this.device.height}`);
    }
    return p;
  }
}

module.exports = { Screen, TransformResult };
