'use strict';
// The device picture: a screenshot reduced to the device palette, plus the
// questions tests ask of it (pixels, ink, blank areas, QR codes, file size).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { PNG } = require('pngjs');

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// Floyd-Steinberg onto the palette, like trmnlp's ImageMagick quantizer does.
function quantize(png, palette, { dither = true } = {}) {
  const { width: w, height: h, data } = png;
  let colors;
  if (palette.colors) colors = palette.colors.map(parseHex);
  else if (palette.framework_class === 'screen--color-full') return png;
  else {
    const n = palette.grays || 2;
    colors = Array.from({ length: n }, (_, i) => { const v = Math.round((255 * i) / (n - 1)); return [v, v, v]; });
  }
  const gray = !palette.colors;
  const buf = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    if (gray) { const l = lum(r, g, b); buf[i * 3] = buf[i * 3 + 1] = buf[i * 3 + 2] = l; } else { buf[i * 3] = r; buf[i * 3 + 1] = g; buf[i * 3 + 2] = b; }
  }
  const nearest = (r, g, b) => {
    let best = 0, bd = Infinity;
    for (let k = 0; k < colors.length; k++) {
      const c = colors[k], d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    return colors[best];
  };
  const out = new PNG({ width: w, height: h });
  const spread = (x, y, er, eg, eb, f) => {
    if (x < 0 || x >= w || y >= h) return;
    const j = (y * w + x) * 3;
    buf[j] += er * f; buf[j + 1] += eg * f; buf[j + 2] += eb * f;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const r = buf[i * 3], g = buf[i * 3 + 1], b = buf[i * 3 + 2];
      const c = nearest(r, g, b);
      out.data[i * 4] = c[0]; out.data[i * 4 + 1] = c[1]; out.data[i * 4 + 2] = c[2]; out.data[i * 4 + 3] = 255;
      if (!dither) continue;
      const er = r - c[0], eg = g - c[1], eb = b - c[2];
      spread(x + 1, y, er, eg, eb, 7 / 16); spread(x - 1, y + 1, er, eg, eb, 3 / 16);
      spread(x, y + 1, er, eg, eb, 5 / 16); spread(x + 1, y + 1, er, eg, eb, 1 / 16);
    }
  }
  return out;
}

class Png {
  constructor(png, { palette, model } = {}) {
    this.png = png;
    this.width = png.width;
    this.height = png.height;
    this.palette = palette;
    this.model = model;
  }

  static fromBuffer(buffer, meta) { return new Png(PNG.sync.read(buffer), meta); }

  get buffer() { return this._buffer || (this._buffer = PNG.sync.write(this.png)); }

  pixel(x, y) {
    const i = (Math.floor(y) * this.width + Math.floor(x)) * 4, d = this.png.data;
    return { r: d[i], g: d[i + 1], b: d[i + 2], gray: Math.round(lum(d[i], d[i + 1], d[i + 2])), hex: hex(d[i], d[i + 1], d[i + 2]) };
  }

  rect(r) {
    const x0 = Math.max(0, Math.floor(r ? r.x : 0)), y0 = Math.max(0, Math.floor(r ? r.y : 0));
    const x1 = Math.min(this.width, Math.ceil(r ? r.x + (r.width ?? r.w) : this.width));
    const y1 = Math.min(this.height, Math.ceil(r ? r.y + (r.height ?? r.h) : this.height));
    return { x0, y0, x1, y1 };
  }

  *pixels(r) {
    const { x0, y0, x1, y1 } = this.rect(r);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) yield [x, y, this.pixel(x, y)];
  }

  crop(r) {
    const { x0, y0, x1, y1 } = this.rect(r);
    const out = new PNG({ width: x1 - x0, height: y1 - y0 });
    for (let y = y0; y < y1; y++) this.png.data.copy(out.data, ((y - y0) * out.width) * 4, (y * this.width + x0) * 4, (y * this.width + x1) * 4);
    return new Png(out, { palette: this.palette, model: this.model });
  }

  // colour -> pixel count, most common first
  histogram(r) {
    const counts = new Map();
    for (const [, , p] of this.pixels(r)) counts.set(p.hex, (counts.get(p.hex) || 0) + 1);
    return new Map([...counts].sort((a, b) => b[1] - a[1]));
  }

  colors(r) { return [...this.histogram(r).keys()]; }

  background(r) { return this.colors(r)[0]; }

  // share of pixels that differ from the background (the most common colour)
  inkRatio(r) {
    const h = this.histogram(r);
    const total = [...h.values()].reduce((a, b) => a + b, 0);
    return total ? 1 - h.values().next().value / total : 0;
  }

  isBlank(r) { return this.histogram(r).size <= 1; }

  // bounding box of everything that is not background
  inkBounds(r) {
    const bg = this.background(r);
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (const [x, y, p] of this.pixels(r)) {
      if (p.hex === bg) continue;
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
    }
    return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  }

  // the picture with every colour inverted (white on black <-> black on white)
  inverted() {
    const out = new PNG({ width: this.width, height: this.height });
    const d = this.png.data;
    for (let i = 0; i < d.length; i += 4) { out.data[i] = 255 - d[i]; out.data[i + 1] = 255 - d[i + 1]; out.data[i + 2] = 255 - d[i + 2]; out.data[i + 3] = d[i + 3]; }
    return new Png(out, { palette: this.palette, model: this.model });
  }

  // every QR code / barcode zbar finds, as text
  decodeQr(r) {
    const img = r ? this.crop(r) : this;
    const file = path.join(os.tmpdir(), `trmnlp-qr-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    fs.writeFileSync(file, img.buffer);
    try {
      const res = spawnSync('zbarimg', ['--raw', '-q', '-Sbinary', file], { encoding: 'utf8' });
      if (res.error) throw new Error('zbarimg is not installed (apt install zbar-tools)');
      if (res.status !== 0 || !res.stdout) return [];
      // -Sbinary keeps newlines inside a payload; codes are separated by a trailing newline
      return [res.stdout.replace(/\n$/, '')];
    } finally {
      fs.rmSync(file, { force: true });
    }
  }

  // size of the PNG the device would download, encoded at the palette's depth
  deviceBytes() {
    const p = this.palette || {};
    const depth = p.colors ? 8 : Math.max(1, Math.ceil(Math.log2(p.grays || 2)));
    const args = p.colors ? ['png:-', '-colors', String(p.colors.length), 'png8:-']
      : ['png:-', '-colorspace', 'Gray', '-depth', String(depth), '-define', `png:bit-depth=${depth}`, '-strip', 'png:-'];
    const out = execFileSync('convert', args, { input: this.buffer, maxBuffer: 64 * 1024 * 1024 });
    return out.length;
  }

  save(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, this.buffer); return file; }
}

module.exports = { Png, quantize, PNG };
