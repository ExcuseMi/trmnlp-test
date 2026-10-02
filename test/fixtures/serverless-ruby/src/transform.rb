require 'httparty'
require 'time'

def run(input)
  fields = input['trmnl']['plugin_settings']['custom_fields_values']
  res = HTTParty.get('https://api.example.com/weather', query: { city: fields['city'] }, headers: { 'X-Key' => 'abc' })
  state = input['trmnl']['state'] || {}
  runs = (state['runs'] || 0) + 1
  { temp: res.parsed_response['temp'], units: fields['units'], city: fields['city'], runs: runs,
    fetched_at: Time.now.utc.strftime('%Y-%m-%d %H:%M'), trmnl_state: { runs: runs } }
end
