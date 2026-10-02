'use strict';
// A local HTTP server per test worker for the rendered pages and the framework's files.
// Pages load from it like from trmnl.com (relative /css/, /js/, /fonts/ paths), the files
// come from the asset cache held in memory, and they carry cache headers, so the browser
// keeps them between renders. Playwright's request interception would disable that cache.
const http = require('http');
const { cachedFetch } = require('./assets');

let instance = null;

class AssetServer {
  constructor({ assetHost = 'https://trmnl.com' } = {}) {
    this.assetHost = assetHost;
    this.pages = new Map();
    this.files = new Map();
    this.nextId = 1;
  }

  async start() {
    this.server = http.createServer((req, res) => this.handle(req, res).catch(() => { res.writeHead(500); res.end(); }));
    await new Promise((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.origin = `http://127.0.0.1:${this.server.address().port}`;
    return this;
  }

  // a page is served once per render; it is dropped when the render closes
  add(html, { offline } = {}) {
    const id = String(this.nextId++);
    this.pages.set(id, { html, offline });
    return { id, url: `${this.origin}/render/${id}` };
  }

  remove(id) { this.pages.delete(id); }

  async handle(req, res) {
    const page = /^\/render\/(\d+)/.exec(req.url);
    if (page) {
      const p = this.pages.get(page[1]);
      if (!p) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(p.html);
    }
    const url = this.assetHost + req.url;
    let file = this.files.get(url);
    if (!file) {
      file = await cachedFetch(url, {});
      if (file && file.status < 400) this.files.set(url, file);
    }
    if (!file) { res.writeHead(404); return res.end(); }
    res.writeHead(file.status, { 'content-type': file.contentType, 'cache-control': 'public, max-age=31536000, immutable', 'access-control-allow-origin': '*' });
    res.end(file.body);
  }

  stop() { this.server && this.server.close(); }
}

async function assetServer() {
  if (!instance) instance = await new AssetServer().start();
  return instance;
}

module.exports = { assetServer, AssetServer };
