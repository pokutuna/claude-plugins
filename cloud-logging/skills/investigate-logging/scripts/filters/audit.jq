# audit.jq - Extract audit log fields (protoPayload)
# Output: timestamp, method, resource, principal, callerIp

[.[] | select(.protoPayload != null) | {
  timestamp: .timestamp,
  method: .protoPayload.methodName,
  resource: .protoPayload.resourceName,
  principal: (
    .protoPayload.authenticationInfo.principalEmail //
    null
  ),
  callerIp: (
    .protoPayload.requestMetadata.callerIp //
    null
  )
}]
