<?php
function run($input) {
  $fields = $input['trmnl']['plugin_settings']['custom_fields_values'];
  $ch = curl_init('https://api.example.com/weather?city=' . urlencode($fields['city']));
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_HTTPHEADER, ['X-Key: abc']);
  $body = json_decode(curl_exec($ch), true);
  $state = $input['trmnl']['state'] ?? [];
  $runs = ($state['runs'] ?? 0) + 1;
  return ['temp' => $body['temp'], 'units' => $fields['units'], 'city' => $fields['city'], 'runs' => $runs,
    'fetched_at' => gmdate('Y-m-d H:i'), 'trmnl_state' => ['runs' => $runs]];
}
