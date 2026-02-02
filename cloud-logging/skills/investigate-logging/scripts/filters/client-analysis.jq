# client-analysis.jq - Extract client information
# Output: timestamp, remoteIp, userAgent, status, path

[.[] | select(.httpRequest != null) | {
  timestamp: .timestamp,
  remoteIp: .httpRequest.remoteIp,
  userAgent: (
    (.httpRequest.userAgent // null) |
    if . and (. | length > 100) then (.[0:100] + "...") else . end
  ),
  status: .httpRequest.status,
  path: (
    (.httpRequest.requestUrl // null) |
    if . then
      split("?")[0] | split("://") | .[-1] | split("/") | .[1:] | "/" + join("/")
    else
      null
    end
  )
}]
