// echoes the previous run's merge variables and writes state the way each mode asks
function run(input) {
  const mode = input.trmnl.plugin_settings.custom_fields_values.mode;
  const prev = input.trmnl.previous_merge_variables || {};
  const seen = ((input.trmnl.state || {}).seen || 0) + 1;
  const out = { temp: input.temp === undefined ? null : input.temp, previous: prev.temp === undefined ? null : prev.temp };
  if (mode === 'array') out.trmnl_state = [seen];
  else if (mode === 'big') out.trmnl_state = { seen, blob: 'x'.repeat(9000) };
  else out.trmnl_state = { seen };
  return out;
}
