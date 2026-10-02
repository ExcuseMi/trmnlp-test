'use strict';
// Talks to ruby/harness.rb over JSON lines. One Ruby process per test worker.
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const SCRIPT = path.join(__dirname, '..', 'ruby', 'harness.rb');

class Harness {
  constructor() {
    this.pending = new Map();
    this.nextId = 1;
    this.stderr = '';
  }

  start() {
    if (this.ready) return this.ready;
    const args = [];
    if (process.env.TRMNLP_LIB) args.push('-I', process.env.TRMNLP_LIB);
    if (process.env.BUNDLE_GEMFILE) args.push('-rbundler/setup');
    args.push(SCRIPT);
    this.proc = spawn(process.env.TRMNLP_RUBY || 'ruby', args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, TZ: 'UTC' } });
    this.proc.stderr.on('data', (d) => {
      this.stderr = (this.stderr + d).slice(-20000);
      if (process.env.TRMNLP_TEST_DEBUG) process.stderr.write(d);
    });
    const lines = readline.createInterface({ input: this.proc.stdout });
    this.ready = new Promise((resolve, reject) => {
      this.proc.on('error', reject);
      this.proc.on('exit', (code) => {
        const err = new Error(`trmnlp harness exited (${code}):\n${this.stderr.slice(-3000)}`);
        reject(err);
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
        this.ready = null;
      });
      lines.on('line', (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.ready) { this.trmnlpVersion = msg.trmnlp; resolve(this); return; }
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(`${msg.error}\n    ${(msg.backtrace || []).join('\n    ')}`));
      });
    });
    return this.ready;
  }

  async call(op, payload = {}) {
    await this.start();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ id, op, ...payload }) + '\n');
    });
  }

  stop() {
    if (this.proc && this.proc.exitCode === null) this.proc.kill();
  }
}

module.exports = { Harness };
