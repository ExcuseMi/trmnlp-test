'use strict';
// Device models and palettes from the TRMNL API (https://trmnl.com/api/models,
// /api/palettes), refreshed into the cache by the CLI, bundled copies as fallback.
const fs = require('fs');
const path = require('path');
const { cacheDir } = require('./paths');

function load(name) {
  const cached = path.join(cacheDir(), name);
  const bundled = path.join(__dirname, '..', 'data', name);
  for (const file of [cached, bundled]) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')).data; } catch { /* next */ }
  }
  throw new Error(`no ${name} available`);
}

const MODELS = load('models.json');
const PALETTES = load('palettes.json');
const byName = new Map(MODELS.map((m) => [m.name, m]));
const paletteById = new Map(PALETTES.map((p) => [p.id, p]));

// Friendly aliases used in tests and reports
const ALIASES = { og: 'og_plus', x: 'v2', trmnl_x: 'v2', og_1bit: 'og_png', kindle: 'amazon_kindle_2024' };

function model(name) {
  const m = byName.get(ALIASES[name] || name);
  if (!m) throw new Error(`unknown device model "${name}". Known: ${[...byName.keys()].join(', ')}`);
  return m;
}

// The palette the device uses by default: the one matching its bit depth.
function defaultPalette(m) {
  const ids = m.palette_ids || [];
  const wanted = ids.find((id) => paletteById.get(id) && !paletteById.get(id).colors && paletteById.get(id).grays === 2 ** m.bit_depth);
  return paletteById.get(wanted || ids[0]) || paletteById.get('bw');
}

function palette(m, id) {
  if (!id) return defaultPalette(m);
  const p = paletteById.get(id);
  if (!p) throw new Error(`unknown palette "${id}". Known: ${[...paletteById.keys()].join(', ')}`);
  return p;
}

const groups = {
  all: () => MODELS.filter((m) => m.css).map((m) => m.name),
  trmnl: () => MODELS.filter((m) => m.kind === 'trmnl').map((m) => m.name),
  kindle: () => MODELS.filter((m) => m.kind === 'kindle').map((m) => m.name),
  byod: () => MODELS.filter((m) => m.kind === 'byod' && m.css).map((m) => m.name),
  // one model per distinct css size/density/bit depth combination: broad coverage, few renders
  representative: () => {
    const seen = new Set();
    return MODELS.filter((m) => m.css).filter((m) => {
      const key = [m.css.classes.size, m.css.classes.density, defaultPalette(m).framework_class].join();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((m) => m.name);
  },
};

module.exports = { MODELS, PALETTES, model, palette, defaultPalette, groups, ALIASES };
