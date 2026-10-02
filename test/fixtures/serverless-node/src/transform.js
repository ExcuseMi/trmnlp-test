async function run(input) {
  const fields = input.trmnl.plugin_settings.custom_fields_values;
  const res = await fetch('https://api.example.com/weather?city=' + encodeURIComponent(fields.city), { headers: { 'X-Key': 'abc' } });
  const body = await res.json();
  const state = input.trmnl.state || {};
  const runs = (state.runs || 0) + 1;
  return { temp: body.temp, units: fields.units, city: fields.city, runs,
    fetched_at: new Date().toISOString().slice(0, 16).replace('T', ' '), trmnl_state: { runs } };
}
