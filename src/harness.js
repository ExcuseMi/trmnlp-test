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
    // computed mocks: respond functions by id, called when the harness asks
    this.callbacks = new Map();
    this.nextCallback = 1;
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
        if (msg.callback) { this.answer(msg); return; }
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

  // a function the harness can call by id while a request runs
  register(fn) {
    const id = `f${this.nextCallback++}`;
    this.callbacks.set(id, fn);
    return id;
  }

  release(ids) { for (const id of ids) this.callbacks.delete(id); }

  async answer({ callback, cid, request }) {
    let response;
    try {
      const fn = this.callbacks.get(callback);
      response = fn ? await fn(request) : { status: 500, body: `trmnlp-test: no computed mock ${callback}` };
    } catch (e) {
      response = { status: 500, body: `trmnlp-test: the computed mock threw: ${e.message}` };
    }
    this.proc.stdin.write(JSON.stringify({ callbackReply: cid, response: response || {} }) + '\n');
  }

  stop() {
    if (this.proc && this.proc.exitCode === null) this.proc.kill();
  }
}

module.exports = { Harness };
