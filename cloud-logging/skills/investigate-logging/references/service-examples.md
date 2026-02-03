# サービス別フィルタ例

Cloud Logging の各サービス向けフィルタ例。

---

## GKE (Kubernetes Engine)

**推奨 jq フィルタ:** k8s-pod.jq, error-analysis.jq, trace.jq

### コンテナログ

```bash
resource.type="k8s_container"
resource.labels.cluster_name="CLUSTER_NAME"
resource.labels.namespace_name="NAMESPACE"
resource.labels.container_name="CONTAINER"
```

### Pod ログ (特定 Pod)

```bash
resource.type="k8s_container"
resource.labels.cluster_name="CLUSTER_NAME"
resource.labels.namespace_name="NAMESPACE"
resource.labels.pod_name="POD_NAME"
```

### クラスタイベント

```bash
resource.type="k8s_cluster"
resource.labels.cluster_name="CLUSTER_NAME"
```

### Node ログ

```bash
resource.type="k8s_node"
resource.labels.cluster_name="CLUSTER_NAME"
resource.labels.node_name="NODE_NAME"
```

---

## Cloud Run

**推奨 jq フィルタ:** http-request.jq, latency.jq, request-summary.jq, trace.jq

### リクエストログ

```bash
resource.type="cloud_run_revision"
resource.labels.service_name="SERVICE_NAME"
logName="projects/PROJECT/logs/run.googleapis.com%2Frequests"
```

### アプリケーションログ

```bash
resource.type="cloud_run_revision"
resource.labels.service_name="SERVICE_NAME"
logName="projects/PROJECT/logs/run.googleapis.com%2Fstdout"
```

### エラーログ

```bash
resource.type="cloud_run_revision"
resource.labels.service_name="SERVICE_NAME"
severity>=ERROR
```

---

## App Engine

**推奨 jq フィルタ:** http-request.jq, latency.jq, error-analysis.jq

### リクエストログ

```bash
resource.type="gae_app"
resource.labels.module_id="SERVICE_NAME"
logName="projects/PROJECT/logs/appengine.googleapis.com%2Frequest_log"
```

### アプリケーションログ

```bash
resource.type="gae_app"
resource.labels.module_id="SERVICE_NAME"
```

### 特定バージョン

```bash
resource.type="gae_app"
resource.labels.module_id="SERVICE_NAME"
resource.labels.version_id="VERSION"
```

---

## Cloud Functions

**推奨 jq フィルタ:** minimal.jq, error-analysis.jq, trace.jq

### 関数ログ

```bash
resource.type="cloud_function"
resource.labels.function_name="FUNCTION_NAME"
```

### 第 2 世代 (Cloud Run ベース)

```bash
resource.type="cloud_run_revision"
resource.labels.service_name="FUNCTION_NAME"
```

### 実行ログ

```bash
resource.type="cloud_function"
resource.labels.function_name="FUNCTION_NAME"
labels.execution_id="EXECUTION_ID"
```

---

## Load Balancer

**推奨 jq フィルタ:** http-request.jq, latency.jq, client-analysis.jq, request-summary.jq

### HTTP(S) Load Balancer

```bash
resource.type="http_load_balancer"
httpRequest.requestUrl:"PATTERN"
```

### 特定 URL パターン

```bash
resource.type="http_load_balancer"
httpRequest.requestUrl:"/api/v1/"
```

### エラーレスポンス

```bash
resource.type="http_load_balancer"
httpRequest.status>=400
```

### 高レイテンシリクエスト

```bash
resource.type="http_load_balancer"
httpRequest.latency>="1s"
```

### Backend Service 別

```bash
resource.type="http_load_balancer"
resource.labels.backend_service_name="BACKEND_NAME"
```

---

## 監査ログ (Cloud Audit Logs)

**推奨 jq フィルタ:** audit.jq

### データアクセスログ

```bash
logName="projects/PROJECT/logs/cloudaudit.googleapis.com%2Fdata_access"
```

### 管理アクティビティログ

```bash
logName="projects/PROJECT/logs/cloudaudit.googleapis.com%2Factivity"
```

### 特定サービスの監査ログ

```bash
# Cloud Storage
logName="projects/PROJECT/logs/cloudaudit.googleapis.com%2Fdata_access"
protoPayload.serviceName="storage.googleapis.com"

# BigQuery
logName="projects/PROJECT/logs/cloudaudit.googleapis.com%2Fdata_access"
protoPayload.serviceName="bigquery.googleapis.com"

# Compute Engine
logName="projects/PROJECT/logs/cloudaudit.googleapis.com%2Factivity"
protoPayload.serviceName="compute.googleapis.com"
```

### 特定ユーザーの操作

```bash
logName="projects/PROJECT/logs/cloudaudit.googleapis.com%2Factivity"
protoPayload.authenticationInfo.principalEmail="user@example.com"
```

### 特定メソッド

```bash
logName="projects/PROJECT/logs/cloudaudit.googleapis.com%2Factivity"
protoPayload.methodName="storage.objects.delete"
```

---

## BigQuery

**推奨 jq フィルタ:** bigquery-job.jq

### クエリジョブ

```bash
resource.type="bigquery_resource"
protoPayload.serviceData.jobCompletedEvent.job.jobConfiguration.query:*
```

### ジョブ完了ログ

```bash
resource.type="bigquery_resource"
protoPayload.methodName="jobservice.jobcompleted"
```

### 特定データセットへのアクセス

```bash
resource.type="bigquery_resource"
protoPayload.resourceName:"datasets/DATASET_NAME"
```

### テーブル操作

```bash
resource.type="bigquery_resource"
protoPayload.resourceName:"tables/TABLE_NAME"
```

### エラーのあるジョブ

```bash
resource.type="bigquery_resource"
protoPayload.serviceData.jobCompletedEvent.job.jobStatus.error:*
```

### 高コストクエリの調査

```bash
resource.type="bigquery_resource"
protoPayload.methodName="jobservice.jobcompleted"
protoPayload.serviceData.jobCompletedEvent.job.jobStatistics.totalBilledBytes>*
```

---

## Pub/Sub

**推奨 jq フィルタ:** minimal.jq, audit.jq

### トピック操作

```bash
resource.type="pubsub_topic"
resource.labels.topic_id="TOPIC_NAME"
```

### サブスクリプション操作

```bash
resource.type="pubsub_subscription"
resource.labels.subscription_id="SUBSCRIPTION_NAME"
```

---

## Cloud SQL

**推奨 jq フィルタ:** minimal.jq, error-analysis.jq

### データベースログ

```bash
resource.type="cloudsql_database"
resource.labels.database_id="PROJECT:INSTANCE"
```

### スロークエリ

```bash
resource.type="cloudsql_database"
logName="projects/PROJECT/logs/cloudsql.googleapis.com%2Fpostgres.log"
textPayload:"duration:"
```

---

## Compute Engine

**推奨 jq フィルタ:** minimal.jq, error-analysis.jq

### インスタンスログ

```bash
resource.type="gce_instance"
resource.labels.instance_id="INSTANCE_ID"
```

### シリアルポート出力

```bash
resource.type="gce_instance"
logName="projects/PROJECT/logs/serialconsole.googleapis.com%2Fserial_port_1_output"
```
