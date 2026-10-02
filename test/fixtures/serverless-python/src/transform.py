import datetime
import requests

def run(input):
    fields = input["trmnl"]["plugin_settings"]["custom_fields_values"]
    r = requests.get("https://api.example.com/weather", params={"city": fields["city"]}, headers={"X-Key": "abc"}, timeout=4)
    r.raise_for_status()
    state = input["trmnl"].get("state") or {}
    return {
        "temp": r.json()["temp"], "units": fields["units"], "city": fields["city"],
        "runs": state.get("runs", 0) + 1,
        "fetched_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M"),
        "trmnl_state": {"runs": state.get("runs", 0) + 1},
    }
