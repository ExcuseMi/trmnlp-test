# trmnlp: differences from TRMNL

Checked against trmnlp **0.14.2** source and TRMNL's editor preview (trmnl.com, 2026-10-02, framework 3.4.0). Found while building [trmnlp-test](https://github.com/ExcuseMi/trmnlp-test), which renders plugins with trmnlp's own code.

## 1. `qr_code` differs from the hosted service (trmnl-liquid)

TRMNL returns this, with or without `"responsive"`:

```html
<svg width="N" height="N" style="max-width:100%;height:auto" ... viewBox="0 0 N N">
```

trmnl-liquid (`filters.rb#qr_code`, also on `main`) returns only a `viewBox` for `"responsive"`, and no viewBox for anything else.

Effects:

- In trmnlp a code fills its box. On TRMNL it keeps its natural size and only shrinks: a 21-module code at 11 px is 231 px wide in a 600 px box on TRMNL, and 600 px in trmnlp.
- A template that adds its own `width` (for example to use the SVG as an `<img>`) works in trmnlp. On TRMNL the duplicate attribute makes the SVG invalid XML, and the image breaks.
- On TRMNL the view argument changes nothing.

**Ask:** make trmnl-liquid and the server agree, one way or the other.

## 2. The preview page differs from TRMNL's (`web/views/render_html.erb`)

| | TRMNL (framework 3.4) | trmnlp |
|---|---|---|
| CSS | `/css/<v>/plugins.min.css` | `plugins.css` |
| JS | `<script type="module">import "/js/<v>/plugins.min.js"</script>` | classic `<script src=".../plugins.js">` |
| Themes | all three theme stylesheets (3.2+), so `screen--theme-*` works | none, so themes can't be previewed |
| Wrapper | `<body class="environment trmnl"><div class="trmnl environment"><div class="screen ..." style="">` | no inner `trmnl environment` div |
| Screen classes | e.g. `screen screen--1bit screen--og_png screen--md screen--1x screen--dark-mode screen--fonts-trmnl screen--density-1x dark-mode` | no `screen--1x`/`2x`, no default `screen--fonts-trmnl`, no bare `dark-mode` |
| Localisation | `window.I18n.andXMore` (e.g. `"En nog"` for `nl`) | not defined |

## 3. Dark mode

- trmnlp never adds the bare `dark-mode` class. TRMNL adds it next to `screen--dark-mode` (its preview script: "Framework 1.2 and 2.x invert on the bare dark-mode class"). So trmnlp's dark preview of a framework 1.2 or 2.x plugin doesn't invert.
- `dark_mode: 'yes'` in `settings.yml` reaches only `trmnl.plugin_settings.dark_mode`. `trmnlp build` and the default render never put `screen--dark-mode` on the screen; only the browser's picker does.
- `web/public/index.js` (PNG render) computes `const isDarkMode = ...` and never uses it.

## 4. The `trmnl` namespace differs from TRMNL's (`user_data_assembler.rb`)

- `trmnl.plugin_settings.instance_name` is the literal `'instance_name'`. TRMNL uses the plugin's name.
- Missing compared with TRMNL:
  - `trmnl.device.orientation`
  - `trmnl.state`
  - `trmnl.plugin_settings.no_screen_padding`
  - `trmnl.plugin_settings.data_fetched_utc`
- `polling_url` / `polling_headers` are included for webhook plugins. TRMNL doesn't send them there.
- Device defaults look dated next to a real device: `firmware_version` `1.6.3` against `1.8.16`.

## 5. Saved state and previous merge variables (help.trmnl.com, "Saved State")

- `transform_input` slices `trmnl` to `user`, `device`, `plugin_settings`, so a transform never receives `trmnl.state` or `trmnl.previous_merge_variables`. TRMNL passes both: the state the last run wrote, and the merge variables the last run stored. Plugins rely on them (ETag caches, replaying a failed feed), and they can't be developed locally.
- The polling URL, headers and body can use `{{ trmnl.state.cursor }}` on TRMNL; trmnlp renders them with the custom fields only.
- TRMNL's state rules: `trmnl_state` must be an object of at most 8192 bytes, otherwise the write is ignored and the last state kept; after a failed fetch the write is skipped. trmnlp has no saved state, so none of this can be tried locally.
- Timing: the polling URL and the transform see the previous run's state, and the markup sees what the transform wrote in this run.

## 6. Webhooks

- `POST /webhook` stores the body as is (`put_webhook` writes `JSON.parse(payload)`). TRMNL's format, `{"merge_variables": {...}}`, therefore ends up under `merge_variables.*` instead of at the top level.
- No `merge_strategy` (`deep_merge`, `stream` with `stream_limit`), and no 2 kB / 5 kB size limit.
- Webhook plus serverless:
  - On TRMNL the transform runs **when data arrives** and its output is stored in place of the data. Renders don't re-run it, and settings changes don't apply until the next post.
  - trmnlp runs the transform on every render. A plugin can work locally and behave differently once deployed.

## 7. Small

Using trmnlp as a library: 0.14.2 changed the private `Poller#parse_response(response)` to `(response, url)` in a patch release. A stable public method for "parse a polled response" would help tools that reuse trmnlp's parser.
