# bigquery-job.jq - Extract BigQuery job information
# Output: timestamp, jobId, state, query (truncated), bytesProcessed

[.[] | select(.protoPayload.serviceData.jobCompletedEvent != null) |
  .protoPayload.serviceData.jobCompletedEvent.job as $job |
  {
    timestamp: .timestamp,
    jobId: $job.jobName.jobId,
    state: $job.jobStatus.state,
    query: (
      ($job.jobConfiguration.query.query // null) |
      if . and (. | length > 200) then (.[0:200] + "...") else . end
    ),
    bytesProcessed: $job.jobStatistics.totalProcessedBytes,
    bytesBilled: $job.jobStatistics.totalBilledBytes,
    slotMs: $job.jobStatistics.totalSlotMs,
    error: $job.jobStatus.error.message
  }
]
