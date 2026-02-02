# http-request.jq - Extract HTTP request fields
# Output: timestamp, method, url, status, latency, userAgent

[.[] | select(.httpRequest != null) | {
  timestamp: .timestamp,
  method: .httpRequest.requestMethod,
  url: .httpRequest.requestUrl,
  status: .httpRequest.status,
  latency: .httpRequest.latency,
  userAgent: .httpRequest.userAgent
}]
