'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');

function cacheDir() {
  const dir = process.env.TRMNLP_TEST_CACHE || path.join(os.homedir(), '.cache', 'trmnlp-test');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// write to a private temp file, then rename: concurrent readers see the old or the new file, never half
function writeAtomic(file, body) {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, file);
}

module.exports = { cacheDir, writeAtomic };
