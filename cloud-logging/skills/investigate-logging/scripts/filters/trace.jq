# trace.jq - Extract fields for trace investigation
# Output: timestamp, severity, trace, spanId, message, latency

[.[] | {
  timestamp: .timestamp,
  severity: (.severity // "DEFAULT"),
  trace: (
    (.trace // .jsonPayload.trace // null) |
    if . then (split("/") | .[-1]) else null end
  ),
  spanId: (.spanId // .jsonPayload.spanId),
  message: (
    .textPayload //
    .jsonPayload.message //
    .jsonPayload.msg //
    .protoPayload.status.message //
    null
  ),
  latency: .httpRequest.latency
}] | sort_by(.timestamp)
