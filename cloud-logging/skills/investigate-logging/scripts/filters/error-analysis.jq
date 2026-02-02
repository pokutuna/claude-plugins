# error-analysis.jq - Extract fields for error investigation
# Output: timestamp, severity, message, stack, trace, spanId

[.[] | {
  timestamp: .timestamp,
  severity: (.severity // "DEFAULT"),
  message: (
    .textPayload //
    .jsonPayload.message //
    .jsonPayload.msg //
    .jsonPayload.error //
    .protoPayload.status.message //
    null
  ),
  stack: (
    .jsonPayload.stack //
    .jsonPayload.stackTrace //
    .jsonPayload.exception //
    null
  ),
  trace: (
    (.trace // .jsonPayload.trace // null) |
    if . then (split("/") | .[-1]) else null end
  ),
  spanId: (
    .spanId //
    .jsonPayload.spanId //
    null
  )
}]
