# request-summary.jq - HTTP request statistics summary
# Output: status counts, average/max latency per status

[.[] | select(.httpRequest != null)] |
group_by(.httpRequest.status) |
map({
  status: (.[0].httpRequest.status // "unknown"),
  count: length,
  avg_latency_ms: (
    [.[] | .httpRequest.latency |
      if type == "string" then
        if endswith("s") then (rtrimstr("s") | tonumber * 1000)
        elif endswith("ms") then (rtrimstr("ms") | tonumber)
        else null end
      elif type == "number" then . * 1000
      else null end
    ] | map(select(. != null)) |
    if length > 0 then (add / length | floor) else null end
  ),
  max_latency_ms: (
    [.[] | .httpRequest.latency |
      if type == "string" then
        if endswith("s") then (rtrimstr("s") | tonumber * 1000)
        elif endswith("ms") then (rtrimstr("ms") | tonumber)
        else null end
      elif type == "number" then . * 1000
      else null end
    ] | map(select(. != null)) | max
  )
}) | sort_by(-.count)
