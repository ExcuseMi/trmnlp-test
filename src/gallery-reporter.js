'use strict';
// Writes <report>/index.html: every test with its device pictures, transform
// metrics and problems, filterable, next to Playwright's own HTML report.
const fs = require('fs');
const path = require('path');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const strip = (s) => String(s || '').replace(/\u001b\[[0-9;]*m/g, '');

class GalleryReporter {
  constructor({ outputFolder }) {
    this.out = outputFolder;
    this.tests = [];
  }

  onBegin(config, suite) {
    this.started = Date.now();
    this.rootDir = config.rootDir;
    this.total = suite.allTests().length;
    fs.rmSync(path.join(this.out, 'img'), { recursive: true, force: true });
    fs.mkdirSync(path.join(this.out, 'img'), { recursive: true });
  }

  onTestEnd(test, res) {
    const n = this.tests.length;
    const images = [];
    let meta = [];
    for (const a of res.attachments) {
      if (a.name === 'trmnl.json') {
        try { meta = JSON.parse((a.body || fs.readFileSync(a.path)).toString()); } catch { /* ignore */ }
      } else if (a.contentType === 'image/png') {
        const file = `img/${n}-${images.length}.png`;
        try {
          if (a.body) fs.writeFileSync(path.join(this.out, file), a.body);
          else fs.copyFileSync(a.path, path.join(this.out, file));
          images.push({ name: a.name, file });
        } catch { /* ignore */ }
      }
    }
    this.tests.push({
      file: path.relative(this.rootDir, test.location.file), line: test.location.line,
      title: test.titlePath().slice(3).join(' › ') || test.title, status: res.status, expected: test.expectedStatus,
      duration: res.duration, errors: res.errors.map((e) => strip(e.message || e.value)).slice(0, 3), images, meta,
    });
  }

  onEnd(result) {
    const by = (s) => this.tests.filter((t) => t.status === s).length;
    const failed = this.tests.filter((t) => t.status !== t.expected && t.status !== 'skipped').length;
    const transforms = this.tests.flatMap((t) => t.meta.map((m) => m.transform)).filter((x) => x && x.ran);
    const avg = transforms.length ? Math.round(transforms.reduce((a, t) => a + (t.durationMs || 0), 0) / transforms.length) : null;
    const maxMem = transforms.reduce((a, t) => Math.max(a, t.maxRssMb || 0), 0);
    const renders = this.tests.reduce((a, t) => a + t.images.length, 0);
    const files = [...new Set(this.tests.map((t) => t.file))].sort();

    const card = (t) => {
      const ok = t.status === t.expected;
      const shots = t.images.map((img, i) => {
        const m = t.meta.filter((x) => x.label !== 'transform')[i] || {};
        const label = img.name.replace(/^screen \d+: /, '');
        const probs = (m.problems || []).map((p) => `<li>${esc(p)}</li>`).join('');
        const tx = m.transform && m.transform.ran ? `<span class="chip">${esc(m.transform.language)} ${m.transform.durationMs} ms · ${m.transform.maxRssMb ?? '?'} MB</span>` : '';
        return `<figure><a href="${img.file}" target="_blank"><img loading="lazy" src="${img.file}" alt="${esc(label)}"></a>
          <figcaption>${esc(label)} ${tx}${probs ? `<ul class="probs">${probs}</ul>` : ''}</figcaption></figure>`;
      }).join('');
      const txOnly = t.meta.filter((m) => m.label === 'transform').map((m) => m.transform)
        .map((x) => `<span class="chip">${esc(x.language)} transform ${x.durationMs ?? '-'} ms · ${x.maxRssMb ?? '?'} MB · ${x.requests} request(s)${x.error ? ' · error' : ''}</span>`).join('');
      const wide = !ok || t.images.length > 1 ? ' wide' : '';
      return `<article class="test${wide} ${ok ? 'pass' : t.status === 'skipped' ? 'skip' : 'fail'}" data-status="${ok ? 'pass' : t.status}" data-search="${esc((t.file + ' ' + t.title).toLowerCase())}">
        <header><span class="pill">${ok ? (t.status === 'skipped' ? 'skipped' : 'passed') : esc(t.status)}</span>
        <h3>${esc(t.title)}</h3><span class="muted">${(t.duration / 1000).toFixed(1)} s · ${esc(t.file)}:${t.line}</span></header>
        ${txOnly ? `<div class="chips">${txOnly}</div>` : ''}
        ${t.errors.length ? `<pre class="err">${esc(t.errors.join('\n\n')).slice(0, 6000)}</pre>` : ''}
        ${shots ? `<div class="shots">${shots}</div>` : ''}
      </article>`;
    };

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TRMNL plugin tests</title><style>
:root{--bg:#f4f3ef;--card:#fff;--ink:#1d1d1b;--muted:#6b6a65;--line:#e2e0d9;--pass:#2f7d4f;--fail:#b3261e;--skip:#8a7a2a;--bezel:#2a2a28}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--card:#1f1f1d;--ink:#ecebe6;--muted:#9c9a92;--line:#33322f;--bezel:#000}}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;background:var(--bg);color:var(--ink)}
.wrap{max-width:1500px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 10px;color:var(--muted);font-weight:600}
.muted{color:var(--muted);font-size:12px}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}
.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px;min-width:110px}
.stat b{display:block;font-size:22px}.stat.fail b{color:var(--fail)}.stat.pass b{color:var(--pass)}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;position:sticky;top:0;background:var(--bg);padding:10px 0;z-index:2}
.bar button{border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:999px;padding:6px 12px;cursor:pointer}
.bar button.on{background:var(--ink);color:var(--bg)}
.bar input{flex:1;min-width:160px;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:8px;padding:7px 10px}
.bar a{color:inherit}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,360px),1fr));gap:12px;align-items:start}
.test{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--pass);border-radius:10px;padding:12px 14px;min-width:0}
.test.wide{grid-column:1/-1}
.test.fail{border-left-color:var(--fail)}.test.skip{border-left-color:var(--skip)}
.test header{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}
.test h3{font-size:15px;margin:0;flex:1;min-width:200px}
.pill{font-size:11px;text-transform:uppercase;letter-spacing:.04em;padding:2px 8px;border-radius:999px;color:#fff;background:var(--pass)}
.fail .pill{background:var(--fail)}.skip .pill{background:var(--skip)}
.err{background:color-mix(in srgb,var(--fail) 10%,transparent);border-radius:8px;padding:10px;overflow:auto;font-size:12px;white-space:pre-wrap}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;margin-top:10px}
figure{margin:0}figure img{width:100%;display:block;background:#fff;border:10px solid var(--bezel);border-radius:12px;image-rendering:pixelated}
figcaption{font-size:12px;color:var(--muted);margin-top:6px}
.chips{margin-top:6px}.chip{display:inline-block;font-size:11px;border:1px solid var(--line);border-radius:999px;padding:1px 8px;margin:2px 4px 2px 0;color:var(--muted)}
.probs{margin:4px 0 0;padding-left:16px;color:var(--fail)}
</style></head><body><div class="wrap">
<h1>TRMNL plugin tests</h1>
<div class="muted">${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC · ${(((Date.now() - this.started) / 1000)).toFixed(1)} s · ${esc(result.status)}</div>
<div class="stats">
<div class="stat pass"><b>${by('passed')}</b>passed</div>
<div class="stat fail"><b>${failed}</b>failed</div>
<div class="stat"><b>${by('skipped')}</b>skipped</div>
<div class="stat"><b>${renders}</b>device pictures</div>
<div class="stat"><b>${transforms.length}</b>transform runs</div>
${avg != null ? `<div class="stat"><b>${avg} ms</b>avg transform · peak ${maxMem} MB</div>` : ''}
</div>
<div class="bar"><button data-f="all" class="on">All</button><button data-f="fail">Failed</button><button data-f="pass">Passed</button>
<input type="search" placeholder="Filter tests…"><a href="html/index.html">Playwright report →</a></div>
${files.map((f) => `<section><h2>${esc(f)}</h2><div class="grid">${this.tests.filter((t) => t.file === f).sort((a, b) => a.line - b.line || a.title.localeCompare(b.title)).map(card).join('')}</div></section>`).join('')}
</div><script>
let mode='all',q='';const tests=[...document.querySelectorAll('.test')];
function apply(){tests.forEach(t=>{const s=t.dataset.status;const okMode=mode==='all'||(mode==='pass'?s==='pass':s!=='pass'&&s!=='skipped');t.hidden=!(okMode&&t.dataset.search.includes(q))});
document.querySelectorAll('section').forEach(s=>s.hidden=![...s.querySelectorAll('.test')].some(t=>!t.hidden))}
document.querySelectorAll('.bar button').forEach(b=>b.onclick=()=>{mode=b.dataset.f;document.querySelectorAll('.bar button').forEach(x=>x.classList.toggle('on',x===b));apply()});
document.querySelector('.bar input').oninput=e=>{q=e.target.value.toLowerCase();apply()};
</script></body></html>`;
    fs.writeFileSync(path.join(this.out, 'index.html'), html);
  }

  printsToStdio() { return false; }
}

module.exports = GalleryReporter;
