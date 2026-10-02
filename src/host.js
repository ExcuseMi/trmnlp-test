'use strict';
// Renders run in iframes of one long-lived page per worker (and device scale), the way TRMNL's
// editor previews a plugin. The browser parses the framework's 15 MB stylesheet once for the
// page and reuses it for every iframe: a render costs ~250 ms instead of ~800 ms.
// Each screen keeps its iframe until its test ends; activate() brings one to the front at its
// device size before a screenshot.
const { assetServer } = require('./server');
const { handleExternal } = require('./assets');

const hosts = new Map();

class Host {
  constructor(browser, scale) {
    this.browser = browser;
    this.scale = scale;
    this.current = null; // the render whose page is loading: gets its errors and requests
    this.active = null;
  }

  static async get(browser, scale = 1) {
    let byScale = hosts.get(browser);
    if (!byScale) hosts.set(browser, (byScale = new Map()));
    if (!byScale.has(scale)) byScale.set(scale, new Host(browser, scale).init());
    return byScale.get(scale);
  }

  async init() {
    this.server = await assetServer();
    this.page = await this.browser.newPage({ viewport: { width: 800, height: 480 }, deviceScaleFactor: this.scale });
    const ctx = () => this.current;
    this.page.on('pageerror', (e) => ctx() && ctx().pageErrors.push(e.message));
    this.page.on('console', (m) => { if (ctx() && m.type() === 'error' && !/Failed to load resource/.test(m.text())) ctx().consoleErrors.push(m.text()); });
    this.page.on('response', (r) => {
      if (ctx() && r.status() >= 400 && r.url().startsWith(this.server.origin)) ctx().missingAssets.push(`${r.url().slice(this.server.origin.length)} (${r.status()})`);
    });
    // only requests leaving the local origin are intercepted (mocks, cached images): interception
    // turns the browser cache off, and the framework's files are what it should keep
    await this.page.route((u) => /^https?:/.test(u.href) && !u.href.startsWith(this.server.origin), (route) => handleExternal(route, ctx() || { mocks: [], requests: [], missing: [] }));
    const blank = this.server.add('<!DOCTYPE html><html><body style="margin:0;background:#fff"></body></html>');
    await this.page.goto(blank.url);
    return this;
  }

  // loads html in a new iframe of the device's size and returns its frame
  async open(html, { width, height, now, ctx }) {
    this.current = ctx;
    await this.page.clock.setFixedTime(now * 1000);
    await this.page.setViewportSize({ width, height });
    const { id, url } = this.server.add(html);
    const iframe = await this.page.evaluateHandle(({ url, id, width, height }) => new Promise((done) => {
      for (const f of document.querySelectorAll('iframe')) f.style.visibility = 'hidden';
      const f = document.createElement('iframe');
      f.dataset.render = id;
      f.style.cssText = `position:absolute;left:0;top:0;border:0;width:${width}px;height:${height}px;visibility:visible`;
      f.onload = () => done(f);
      f.src = url;
      document.body.appendChild(f);
    }), { url, id, width, height });
    const frame = await iframe.contentFrame();
    this.active = id;
    return { frame, iframe, pageId: id };
  }

  async activate(screen) {
    if (this.active === screen.pageId) return;
    await this.page.setViewportSize({ width: screen.device.width, height: screen.device.height });
    await this.page.evaluate((id) => {
      for (const f of document.querySelectorAll('iframe')) f.style.visibility = f.dataset.render === id ? 'visible' : 'hidden';
    }, screen.pageId);
    this.active = screen.pageId;
  }

  async remove(screen) {
    if (this.current && this.current === screen.ctx) this.current = null;
    if (this.active === screen.pageId) this.active = null;
    await screen.iframe.evaluate((f) => f.remove()).catch(() => {});
    await screen.iframe.dispose().catch(() => {});
    this.server.remove(screen.pageId);
  }
}

module.exports = { Host };
