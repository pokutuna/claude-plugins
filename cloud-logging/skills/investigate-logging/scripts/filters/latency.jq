# latency.jq - Extract latency information, sorted by latency descending
# Output: timestamp, url, latency_ms, status

[.[] | select(.httpRequest != null and .httpRequest.latency != null) | {
  timestamp: .timestamp,
  url: .httpRequest.requestUrl,
  latency_ms: (
    .httpRequest.latency |
    if type == "string" then
      # Parse duration string like "0.123456s" or "123.456ms"
      if endswith("s") then
        (rtrimstr("s") | tonumber * 1000)
      elif endswith("ms") then
        (rtrimstr("ms") | tonumber)
      else
        null
      end
    elif type == "number" then
      . * 1000
    else
      null
    end
  ),
  status: .httpRequest.status
}] | sort_by(-.latency_ms)
