# k8s-pod.jq - Extract GKE Pod metadata
# Output: timestamp, namespace, pod, container, severity, message/payload

[.[] | select(.resource.type == "k8s_container") | {
  timestamp: .timestamp,
  namespace: .resource.labels.namespace_name,
  pod: .resource.labels.pod_name,
  container: .resource.labels.container_name,
  severity: (.severity // "DEFAULT"),
  message: (
    .textPayload //
    .jsonPayload.message //
    .jsonPayload.msg //
    (.jsonPayload | if . then tostring else null end)
  )
}]
