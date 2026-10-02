#!/usr/bin/env node
'use strict';
// The command inside the image. Usage: lib/trmnlp_test/usage.txt (shared with the gem launcher).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { cacheDir, writeAtomic } = require('./paths');

const ROOT = path.join(__dirname, '..');
const USAGE = path.join(ROOT, 'lib', 'trmnlp_test', 'usage.txt');
const ALIASES = { '-h': 'help', '--help': 'help', '-v': 'version', '--version': 'version' };

const COMMANDS = ['run', 'init', 'models', 'versions', 'refresh', 'help', 'version'];
const argv = process.argv.slice(2);
// everything after `--` is for the specs: require('trmnlp-test').args
const dashes = argv.indexOf('--');
const specArgs = dashes >= 0 ? argv.splice(dashes).slice(1) : [];
if (ALIASES[argv[0]]) argv[0] = ALIASES[argv[0]];
// anything else in first place (a spec file, a filter) is a run of those tests
const cmd = argv[0] && COMMANDS.includes(argv[0]) ? argv.shift() : 'run';

function versions() {
  const read = (file, re) => { try { return fs.readFileSync(file, 'utf8').match(re)[1]; } catch { return null; } };
  const own = read(path.join(ROOT, 'lib', 'trmnlp_test', 'version.rb'), /VERSION = '([^']+)'/);
  const trmnlpLib = process.env.TRMNLP_LIB || '';
  let trmnlp = read(path.join(trmnlpLib, 'trmnlp', 'version.rb'), /VERSION = '([^']+)'/);
  if (!trmnlp) trmnlp = (spawnSync('trmnlp', ['version'], { encoding: 'utf8' }).stdout || '').trim() || 'not found';
  const ruby = (spawnSync('ruby', ['-e', 'print RUBY_VERSION'], { encoding: 'utf8' }).stdout || '?');
  const { FRAMEWORK } = require('./framework');
  return [`trmnlp-test ${own}`, `trmnlp ${trmnlp}`, `Playwright ${require('@playwright/test/package.json').version}`,
    `Node ${process.versions.node}, Ruby ${ruby}`, `framework latest ${FRAMEWORK.latest}`].join('\n');
}

// --root <dir> picks the plugin repository (default: cwd); --report <dir> overrides the report directory
const rootAt = argv.indexOf('--root');
if (rootAt >= 0) { process.env.TRMNLP_TEST_ROOT = path.resolve(argv[rootAt + 1]); argv.splice(rootAt, 2); }
const reportAt = argv.indexOf('--report');
let reportOverride = null;
if (reportAt >= 0) { reportOverride = path.resolve(argv[reportAt + 1]); argv.splice(reportAt, 2); }

async function refresh({ force = false } = {}) {
  const files = {
    'models.json': 'https://trmnl.com/api/models',
    'palettes.json': 'https://trmnl.com/api/palettes',
    'framework_versions.yml': require('./framework').MANIFEST_URL,
  };
  for (const [name, url] of Object.entries(files)) {
    const file = path.join(cacheDir(), name);
    const fresh = fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 24 * 3600e3;
    if (fresh && !force) continue;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const body = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (name.endsWith('.json')) JSON.parse(body).data.length;
      else if (!/latest:/.test(body)) throw new Error('not a version manifest');
      writeAtomic(file, body);
    } catch (e) {
      console.error(`trmnlp-test: could not refresh ${name} (${e.message}); using the cached or bundled copy`);
    }
  }
}

// a number, or a share of the CPUs such as '50%'
function workersValue(w) {
  return /^\d+$/.test(String(w)) ? Number(w) : String(w);
}

function playwrightConfig(cfg) {
  const report = path.resolve(cfg.root, cfg.report);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'trmnlp-test-')), 'playwright.config.js');
  const conf = {
    testDir: path.resolve(cfg.root, cfg.tests),
    testMatch: '**/*.@(spec|test).@(js|cjs|mjs|ts)',
    outputDir: path.join(report, 'results'),
    snapshotPathTemplate: '{testDir}/__screens__/{testFilePath}/{arg}{ext}',
    fullyParallel: true,
    timeout: cfg.timeout || 60000,
    retries: cfg.retries || 0,
    // TRMNLP_TEST_WORKERS > config workers > Playwright's default (half the CPUs); --workers/-j wins over all
    ...((process.env.TRMNLP_TEST_WORKERS || cfg.workers) && { workers: workersValue(process.env.TRMNLP_TEST_WORKERS || cfg.workers) }),
    // in CI also the github reporter: annotations at the failing lines
    reporter: [['list'], ...(process.env.CI ? [['github']] : []), ['html', { outputFolder: path.join(report, 'html'), open: 'never' }],
      [path.join(__dirname, 'gallery-reporter.js'), { outputFolder: report }]],
    use: { headless: true, launchOptions: { args: ['--font-render-hinting=none', '--disable-lcd-text'] } },
  };
  fs.writeFileSync(file, `module.exports = ${JSON.stringify(conf, null, 2)};\n`);
  return file;
}

async function run() {
  if (argv.includes('--help') || argv.includes('-h')) {
    const res = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--help'], { stdio: 'inherit' });
    process.exit(res.status ?? 0);
  }
  await refresh();
  const { loadConfig } = require('./config');
  const cfg = loadConfig();
  if (reportOverride) cfg.report = reportOverride;
  if (!fs.existsSync(path.resolve(cfg.root, cfg.plugin))) {
    console.error(`trmnlp-test: plugin directory ${cfg.plugin} not found under ${cfg.root} (set "plugin" in trmnlp-test.config.js)`);
    process.exit(2);
  }
  if (!fs.existsSync(path.resolve(cfg.root, cfg.tests))) {
    console.error(`trmnlp-test: no tests in ${cfg.tests}. Run "trmnlp-test init" to create a first one.`);
    process.exit(2);
  }
  const { installDependencies } = require('./deps');
  const depsEnv = installDependencies(cfg.serverless.dependencies, { root: cfg.root, log: (m) => console.log(`trmnlp-test: ${m}`) });
  const pwCli = require.resolve('@playwright/test/cli');
  const res = spawnSync(process.execPath, [pwCli, 'test', '--config', playwrightConfig(cfg), ...argv], {
    stdio: 'inherit', cwd: cfg.root,
    env: { ...process.env, ...depsEnv, TRMNLP_TEST_CONFIG: JSON.stringify(cfg), TRMNLP_TEST_ARGS: JSON.stringify(specArgs),
      NODE_PATH: [path.join(__dirname, '..', 'node_modules'), path.join(__dirname, '..', '..'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter) },
  });
  console.log(`\ntrmnlp-test: report in ${path.join(cfg.report, 'index.html')} (Playwright report: ${path.join(cfg.report, 'html', 'index.html')})`);
  process.exit(res.status ?? 1);
}

function init() {
  const root = process.env.TRMNLP_TEST_ROOT || process.cwd();
  const { loadConfig } = require('./config');
  const cfg = loadConfig(root);
  const write = (rel, body) => {
    const f = path.join(root, rel);
    if (fs.existsSync(f)) return console.log(`exists, kept: ${rel}`);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
    console.log(`created ${rel}`);
  };
  write('trmnlp-test.config.js', fs.readFileSync(path.join(__dirname, '..', 'templates', 'trmnlp-test.config.js'), 'utf8').replace("plugin: 'plugin'", `plugin: '${cfg.plugin}'`));
  write(path.join(cfg.tests, 'plugin.spec.js'), fs.readFileSync(path.join(__dirname, '..', 'templates', 'plugin.spec.js'), 'utf8'));
  write('.github/workflows/trmnl-tests.yml', fs.readFileSync(path.join(__dirname, '..', 'templates', 'trmnl-tests.yml'), 'utf8'));
  const gi = path.join(root, '.gitignore');
  const ignore = `${cfg.report}/\n`;
  if (!fs.existsSync(gi) || !fs.readFileSync(gi, 'utf8').includes(cfg.report)) fs.appendFileSync(gi, ignore);
}

async function main() {
  switch (cmd) {
    case 'run': return run();
    case 'init': return init();
    case 'refresh': return refresh({ force: true });
    case 'models': {
      await refresh();
      const { MODELS, defaultPalette } = require('./models');
      for (const m of MODELS) console.log([m.name.padEnd(44), m.kind.padEnd(7), `${m.width}x${m.height}`.padEnd(10), defaultPalette(m).id.padEnd(12), (m.palette_ids || []).join(',')].join(' '));
      return;
    }
    case 'versions': {
      await refresh();
      const { FRAMEWORK } = require('./framework');
      console.log(`latest ${FRAMEWORK.latest}\n${FRAMEWORK.versions.join(' ')}`);
      return;
    }
    case 'help':
      process.stdout.write(fs.readFileSync(USAGE, 'utf8'));
      return;
    case 'version':
      console.log(versions());
      return;
    default:
      throw new Error(`unhandled command ${cmd}`);
  }
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
