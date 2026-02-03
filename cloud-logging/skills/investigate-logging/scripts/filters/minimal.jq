# minimal.jq - Extract minimal fields for overview
# Output: timestamp, severity, logName, resource.type, message

[.[] | {
  timestamp: .timestamp,
  severity: (.severity // "DEFAULT"),
  logName: (.logName | split("/") | .[-1]),
  resource: .resource.type,
  message: (
    .textPayload //
    .jsonPayload.message //
    .jsonPayload.msg //
    .protoPayload.status.message //
    (.jsonPayload | if . then tostring else null end)
  )
}]
