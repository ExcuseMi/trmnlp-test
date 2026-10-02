'use strict';
// Framework versions from the design system's published manifest (cached by the CLI),
// falling back to the list bundled with trmnlp.
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { cacheDir } = require('./paths');

const MANIFEST_URL = 'https://raw.githubusercontent.com/usetrmnl/trmnl-framework/main/db/data/framework_versions.yml';

function cmp(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

// the cached manifest, ours, or trmnlp's: whichever knows the newest release
function load() {
  const candidates = [path.join(cacheDir(), 'framework_versions.yml'), path.join(__dirname, '..', 'data', 'framework_versions.yml'),
    '/app/db/data/framework_versions.yml'];
  let best = null;
  for (const file of candidates) {
    try {
      const doc = YAML.parse(fs.readFileSync(file, 'utf8'));
      if (doc && doc.latest && doc.versions && (!best || cmp(String(doc.latest), String(best.latest)) > 0)) best = doc;
    } catch { /* next */ }
  }
  return best || { latest: '3.4.0', versions: [{ number: '3.4.0' }] };
}

const manifest = load();
const versions = manifest.versions.map((v) => String(v.number)).sort(cmp);

const FRAMEWORK = {
  latest: String(manifest.latest),
  versions,
  // newest release of each major line: ['0.0.7', '1.2.0', '2.0.1', '3.4.0']
  majors: () => [...new Set(versions.map((v) => v.split('.')[0]))].map((m) => FRAMEWORK.latestOf(m)),
  latestOf: (prefix) => {
    const hits = versions.filter((v) => v === prefix || v.startsWith(prefix + '.'));
    if (!hits.length) throw new Error(`no framework version matches ${prefix}`);
    return hits[hits.length - 1];
  },
  since: (min) => versions.filter((v) => cmp(v, min) >= 0),
  resolve: (v) => (!v || v === 'latest' ? String(manifest.latest) : /^\d+(\.\d+)?$/.test(v) ? FRAMEWORK.latestOf(v) : v),
  compare: cmp,
};

module.exports = { FRAMEWORK, MANIFEST_URL };
