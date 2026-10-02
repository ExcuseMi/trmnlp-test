'use strict';
// Serves the rendered page and every request it makes. Framework CSS/JS, fonts
// (asked for by absolute /fonts/ paths) and remote images are fetched once and
// kept in the cache, so renders are fast, repeatable and measured in real fonts.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { cacheDir, writeAtomic } = require('./paths');


function matchMock(mocks, method, url) {
  for (const m of mocks || []) {
    if (m.method && m.method.toUpperCase() !== method) continue;
    const p = m.url;
    let hit;
    if (p.length > 1 && p.startsWith('/') && p.endsWith('/')) hit = new RegExp(p.slice(1, -1)).test(url);
    else {
      const target = p.includes('?') ? url : url.split('?')[0];
      hit = new RegExp('^' + p.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(target);
    }
    if (hit) return m;
  }
  return null;
}

function mockBody(m) {
  if ('json' in m) return { body: JSON.stringify(m.json), contentType: 'application/json' };
  if (m.bodyBase64) return { body: Buffer.from(m.bodyBase64, 'base64') };
  return { body: m.body == null ? '' : m.body };
}

const inflight = new Map();
async function cachedFetch(url, { offline }) {
  const dir = path.join(cacheDir(), 'assets');
  fs.mkdirSync(dir, { recursive: true });
  const key = crypto.createHash('sha1').update(url).digest('hex');
  const file = path.join(dir, key), meta = file + '.json';
  if (fs.existsSync(meta)) return { ...JSON.parse(fs.readFileSync(meta, 'utf8')), body: fs.readFileSync(file) };
  if (offline) return null;
  if (!inflight.has(url)) {
    inflight.set(url, (async () => {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'trmnlp-test' } });
      const body = Buffer.from(await res.arrayBuffer());
      const info = { status: res.status, contentType: res.headers.get('content-type') || 'application/octet-stream' };
      if (res.ok) {
        // body first, metadata last: the metadata file is what marks an entry complete
        writeAtomic(file, body);
        writeAtomic(meta, JSON.stringify(info));
      }
      return { ...info, body };
    })().finally(() => setTimeout(() => inflight.delete(url), 0)));
  }
  return inflight.get(url);
}

// A request that leaves the page's origin: a mock first, then the asset cache.
// ctx: { mocks, requests, offline, missing }
async function handleExternal(route, ctx, assetHost = 'https://trmnl.com') {
  const req = route.request();
  const url = req.url();
  const mock = matchMock(ctx.mocks, req.method(), url);
  if (mock) {
    ctx.requests.push({ method: req.method(), url, mocked: true, via: 'browser', status: mock.status || 200 });
    const { body, contentType } = mockBody(mock);
    return route.fulfill({ status: mock.status || 200, headers: mock.headers, contentType, body });
  }
  const framework = url.startsWith(assetHost) || url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com');
  if (!framework) ctx.requests.push({ method: req.method(), url, mocked: false, via: 'browser' });
  if (req.method() !== 'GET') return route.abort();
  try {
    const res = await cachedFetch(url, { offline: ctx.offline });
    if (!res) { ctx.missing.push(url); return route.abort(); }
    if (res.status >= 400) ctx.missing.push(`${url} (${res.status})`);
    return route.fulfill({ status: res.status, contentType: res.contentType, body: res.body, headers: { 'access-control-allow-origin': '*' } });
  } catch (e) {
    ctx.missing.push(`${url} (${e.message})`);
    return route.abort();
  }
}

module.exports = { handleExternal, matchMock, cachedFetch };
