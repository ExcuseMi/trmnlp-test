'use strict';
// Builds the page the device screenshot is taken from: trmnlp's render_html.erb
// plus the screen classes and CSS variables the hosted service derives from the
// device model, palette and plugin settings.
const { FRAMEWORK } = require('./framework');

const VIEWS = ['full', 'half_horizontal', 'half_vertical', 'quadrant'];
const MASHUPS = {
  full: null,
  half_horizontal: { classes: 'mashup mashup--1Tx1B', slots: 2 },
  half_vertical: { classes: 'mashup mashup--1Lx1R', slots: 2 },
  quadrant: { classes: 'mashup mashup--2x2', slots: 4 },
};
const SCALES = ['xxsmall', 'xsmall', 'small', 'regular', 'large', 'xlarge', 'xxlarge'];
const TEXT_SCALES = ['small', 'regular', 'large', 'xlarge'];
const THEMES = ['dark', 'black-and-yellow', 'white-and-red'];

function oneOf(name, value, allowed) {
  if (value && !allowed.includes(value)) throw new Error(`${name} must be one of ${allowed.join(', ')} (got "${value}")`);
}

function screenClasses({ model, palette, orientation, darkMode, noBleed, theme, scale, textScale, fonts, extra }) {
  oneOf('scale', scale, SCALES);
  oneOf('textScale', textScale, TEXT_SCALES);
  oneOf('theme', theme, THEMES);
  oneOf('fonts', fonts, ['trmnl', 'classic']);
  const c = model.css ? model.css.classes : {};
  return ['screen', c.device && `screen--${c.device.replace(/^screen--/, '')}`, c.size, c.density,
    palette.framework_class, orientation === 'portrait' && 'screen--portrait',
    darkMode && 'screen--dark-mode', noBleed && 'screen--no-bleed', theme && `screen--theme-${theme}`,
    scale && `screen--scale-${scale}`, textScale && `screen--text-scale-${textScale}`,
    fonts && `screen--fonts-${fonts}`, extra].filter(Boolean).join(' ');
}

function escapeAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

// The model's CSS variables, as the framework's own device classes declare them: the
// -original pair keeps the landscape size, and a portrait screen swaps the live pair.
function deviceVariables(model, portrait) {
  if (!model.css) return '';
  const vars = Object.fromEntries(model.css.variables);
  const w = vars['--screen-w'], h = vars['--screen-h'];
  if (w && h) Object.assign(vars, { '--screen-w-original': w, '--screen-h-original': h, '--screen-w': portrait ? h : w, '--screen-h': portrait ? w : h });
  return Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');
}

function buildPage({ markup, view, framework, classes, model, slot = 0, invert, assetHost = 'https://trmnl.com', theme, head = '' }) {
  oneOf('view', view, VIEWS);
  const v3 = FRAMEWORK.compare(framework, '3.0.0') >= 0;
  const vars = v3 ? deviceVariables(model, /\bscreen--portrait\b/.test(classes)) : '';
  const mashup = MASHUPS[view];
  const ours = `<div class="view view--${view}">\n${markup}\n</div>`;
  let body = ours;
  if (mashup) {
    const views = [];
    for (let i = 0; i < mashup.slots; i++) views.push(i === slot ? ours : `<div class="view view--${view}"></div>`);
    body = `<div class="${mashup.classes}">${views.join('')}</div>`;
  }
  // TRMNL's dark mode: everything inverted except images
  const legacyDark = invert ? '<style>.screen{filter:invert(1)} .screen img{filter:invert(1)}</style>' : '';
  const themeCss = theme ? `<link rel="stylesheet" href="${assetHost}/css/${framework}/themes/${theme}-theme.css" />` : '';
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="${assetHost}/css/${framework}/plugins.css" />
    <script src="${assetHost}/js/${framework}/plugins.js"></script>
    ${themeCss}
    <meta name="trmnl-framework-version" content="${framework}" />
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap" rel="stylesheet">
    ${legacyDark}${head}
  </head>
  <body class="environment trmnl">
    <div class="${escapeAttr(classes)}"${vars ? ` style="${escapeAttr(vars)}"` : ''}>
      ${body}
    </div>
  </body>
</html>`;
}

module.exports = { buildPage, screenClasses, VIEWS, SCALES, TEXT_SCALES, THEMES };
