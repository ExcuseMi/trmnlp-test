'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');

function cacheDir() {
  const dir = process.env.TRMNLP_TEST_CACHE || path.join(os.homedir(), '.cache', 'trmnlp-test');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { cacheDir };
