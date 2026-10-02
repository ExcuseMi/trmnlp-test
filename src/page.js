'use strict';
// Builds the page the device screenshot is taken from: trmnlp's render_html.erb
// plus the screen classes and CSS variables the hosted service derives from the
// device model, palette and plugin settings.

const VIEWS = ['full', 'half_horizontal', 'half_vertical', 'quadrant'];
const MASHUPS = {
  full: null,
  half_horizontal: { classes: 'mashup mashup--1Tx1B', slots: 2 },
  half_vertical: { classes: 'mashup mashup--1Lx1R', slots: 2 },
  quadrant: { classes: 'mashup mashup--2x2', slots: 4 },
};
const { FRAMEWORK } = require('./framework');

const SCALES = ['xxsmall', 'xsmall', 'small', 'regular', 'large', 'xlarge', 'xxlarge'];
const TEXT_SCALES = ['small', 'regular', 'large', 'xlarge'];
const THEMES = ['dark', 'black-and-yellow', 'white-and-red'];

function oneOf(name, value, allowed) {
  if (value && !allowed.includes(value)) throw new Error(`${name} must be one of ${allowed.join(', ')} (got "${value}")`);
}

// The screen classes in the order TRMNL's page writes them, e.g. for og_png in dark mode:
//   screen screen--1bit screen--og_png screen--md screen--1x screen--dark-mode screen--fonts-trmnl screen--density-1x dark-mode
// Dark mode is classes only: framework 1.2 and 2.x invert on the bare dark-mode class (sparing
// .image elements); from 3.0 screen--dark-mode remaps the framework's colours.
function screenClasses({ model, palette, orientation, darkMode, noBleed, theme, scale, textScale, fonts = 'trmnl', extra }) {
  oneOf('scale', scale, SCALES);
  oneOf('textScale', textScale, TEXT_SCALES);
  oneOf('theme', theme, THEMES);
  oneOf('fonts', fonts, ['trmnl', 'classic']);
  const c = model.css ? model.css.classes : {};
  const density = c.density && c.density.replace('density-', '');
  return ['screen', palette.framework_class, c.device && `screen--${c.device.replace(/^screen--/, '')}`, c.size, density,
    orientation === 'portrait' && 'screen--portrait', darkMode && 'screen--dark-mode', `screen--fonts-${fonts}`, c.density,
    noBleed && 'screen--no-bleed', theme && `screen--theme-${theme}`, scale && `screen--scale-${scale}`,
    textScale && `screen--text-scale-${textScale}`, darkMode && 'dark-mode', extra].filter(Boolean).join(' ');
}

function escapeAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

// The page as TRMNL's preview writes it: the framework's release files (plugins.min.css, the JS
// imported as a module), every theme stylesheet from 3.2 on (a theme is then just its class), and
// the screen inside a "trmnl environment" wrapper with an empty style.
function buildPage({ markup, view, framework, classes, slot = 0, theme, head = '' }) {
  oneOf('view', view, VIEWS);
  if (theme && FRAMEWORK.compare(framework, '3.2.0') < 0) throw new Error(`themes need framework 3.2.0 or later (got ${framework})`);
  const mashup = MASHUPS[view];
  const ours = `<div class="view view--${view}">\n${markup}\n</div>`;
  let body = ours;
  if (mashup) {
    const views = [];
    for (let i = 0; i < mashup.slots; i++) views.push(i === slot ? ours : `<div class="view view--${view}"></div>`);
    body = `<div class="${mashup.classes}">${views.join('')}</div>`;
  }
  const themes = FRAMEWORK.compare(framework, '3.2.0') >= 0
    ? [...THEMES].sort().map((t) => `<link rel="stylesheet" href="/css/${framework}/themes/${t}-theme.css">`).join('\n    ') : '';
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width">
    <link rel="stylesheet" href="/css/${framework}/plugins.min.css" />
    ${themes}
    <script type="module">import "/js/${framework}/plugins.min.js"</script>
    ${head}
  </head>
  <body class="environment trmnl">
    <div class="trmnl environment">
      <div class="${escapeAttr(classes)}" style="">
        <div class="view view--${view}" hidden></div>
      </div>
    </div>
  </body>
</html>`.replace(`<div class="view view--${view}" hidden></div>`, () => body);
}

module.exports = { buildPage, screenClasses, VIEWS, SCALES, TEXT_SCALES, THEMES };
