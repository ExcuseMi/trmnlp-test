'use strict';
// Installs the serverless transform dependencies once per distinct list into the
// cache, and returns the env that points the transform runtimes at them.
//
//   serverless: { dependencies: {
//     python: ['icalendar==6.1.0'] | 'requirements.txt',
//     ruby:   ['nokogiri:1.18.0']  | 'Gemfile',
//     node:   ['date-fns@4']       | 'package.json',
//     php:    ['nesbot/carbon:^3'] | 'composer.json',
//   } }
//
// The hosted runtime ships one HTTP library per language; those are always
// installed so a transform that only uses them needs no configuration.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { cacheDir } = require('./paths');

const BUILTIN = { python: ['requests'], ruby: ['httparty'], node: [], php: [] };
const LANGS = ['python', 'ruby', 'node', 'php'];

function sh(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts });
  } catch (e) {
    throw new Error(`${cmd} ${args.join(' ')} failed:\n${(e.stderr || '') + (e.stdout || '')}`.slice(0, 4000));
  }
}

function installOne(lang, spec, root, log) {
  const file = typeof spec === 'string' ? path.resolve(root, spec) : null;
  const pkgs = file ? [] : [...BUILTIN[lang], ...(spec || [])];
  if (!file && pkgs.length === 0) return null;
  const key = crypto.createHash('sha1').update(lang + JSON.stringify(pkgs) + (file ? fs.readFileSync(file, 'utf8') : '')).digest('hex').slice(0, 12);
  const dir = path.join(cacheDir(), 'deps', `${lang}-${key}`);
  if (fs.existsSync(path.join(dir, '.ok'))) return dir;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  log(`installing ${lang} transform dependencies: ${file ? path.basename(file) : pkgs.join(' ')}`);
  switch (lang) {
    case 'python':
      sh('pip3', ['install', '--quiet', '--disable-pip-version-check', '--root-user-action=ignore', '--target', dir,
        ...(file ? ['-r', file, ...BUILTIN.python] : pkgs)]);
      break;
    case 'ruby':
      sh('gem', ['install', '--no-document', '--install-dir', dir, ...(file ? ['-g', file] : pkgs)]);
      sh('gem', ['install', '--no-document', '--install-dir', dir, ...BUILTIN.ruby]);
      break;
    case 'node':
      if (file) {
        fs.copyFileSync(file, path.join(dir, 'package.json'));
        sh('npm', ['install', '--prefix', dir, '--no-audit', '--no-fund', '--omit=dev']);
      } else sh('npm', ['install', '--prefix', dir, '--no-audit', '--no-fund', ...pkgs]);
      break;
    case 'php':
      if (file) {
        fs.copyFileSync(file, path.join(dir, 'composer.json'));
        sh('composer', ['install', '--no-interaction', '--no-progress', '--working-dir', dir]);
      } else sh('composer', ['require', '--no-interaction', '--no-progress', '--working-dir', dir, ...pkgs]);
      break;
    default:
      throw new Error(`unknown serverless language ${lang}`);
  }
  fs.writeFileSync(path.join(dir, '.ok'), new Date().toISOString());
  return dir;
}

function installDependencies(dependencies = {}, { root = process.cwd(), log = console.log } = {}) {
  const env = {};
  for (const lang of Object.keys(dependencies)) if (!LANGS.includes(lang)) throw new Error(`serverless.dependencies.${lang}: languages are ${LANGS.join(', ')}`);
  for (const lang of LANGS) {
    const dir = installOne(lang, dependencies[lang], root, log);
    if (dir) env[`TRMNLP_TEST_DEPS_${lang.toUpperCase()}`] = dir;
  }
  return env;
}

module.exports = { installDependencies, BUILTIN };
