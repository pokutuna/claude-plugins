---
name: investigate-logging
description: |
  This skill should be used when the user asks to "investigate logs", "analyze Cloud Logging", "debug with gcloud logs", "ログ調査", "ログを調べて", or needs to query and analyze Google Cloud Logging data.
allowed-tools:
  - Bash(timeout *)
  - Bash(gcloud logging *)
  - Bash(jq *)
  - Bash(gojq *)
  - Bash(duckdb *)
  - Read
  - Write
  - Glob
  - Grep
  - AskUserQuestion
user-invocable: true
---

# Cloud Logging Investigation Skill

Google Cloud Logging を効率的に調査するためのスキル。

## 原則

1. **まずログの存在と構造を確認** - いきなり本番クエリを投げない
2. **ファイルに書き出して分析** - パイプで直接処理せず、ファイルに保存して繰り返し使う
3. **インデックスフィールド優先** - resource.type, logName, timestamp, severity で絞り込む
4. **timeout を常に設定** - 結果がない場合に無限に待たないよう `timeout` コマンドを使う

## 前提条件

- gcloud CLI, jq, duckdb インストール済み
- `gcloud auth login` で認証済み

---

## 調査ワークフロー

### Phase 1: コンテキスト収集

ユーザーに確認: プロジェクト ID、調査目的、時間範囲、既知の情報 (サービス名、エラーメッセージなど)

### Phase 2: ログの存在確認と構造発見

**まず数件取得してログが存在するか、構造を確認する。**

```bash
# 1. ログが存在するか確認
timeout 30 gcloud logging read 'resource.type="k8s_container"' \
  --project PROJECT_ID --freshness 1h --limit 3 --format json | jq 'length'

# 2. ログ全体の構造を確認
timeout 30 gcloud logging read 'resource.type="k8s_container"' \
  --project PROJECT_ID --freshness 1h --limit 1 --format json | jq '.[0]'

# 3. 利用可能なリソースタイプを確認
timeout 30 gcloud logging read '' \
  --project PROJECT_ID --freshness 1h --limit 50 --format json \
  | jq '[.[].resource.type] | unique'
```

**結果が返ってこない場合**: ログが存在しない可能性が高い。フィルタ条件を緩めて確認する。

### Phase 3: ファイルに書き出して分析

```bash
# 1. ファイルに書き出し
timeout 120 gcloud logging read 'FILTER' \
  --project PROJECT_ID --freshness 7d --limit 1000 --format json > /tmp/logs.json

# 2. 件数確認
jq length /tmp/logs.json

# 3. jq で分析 or duckdb で集計
jq '[.[] | {timestamp, ...}]' /tmp/logs.json
duckdb -s "SELECT field, COUNT(*) FROM read_json('/tmp/logs.json') GROUP BY 1"
```

---

## gcloud logging read リファレンス

```bash
timeout 60 gcloud logging read 'FILTER' \
  --project PROJECT_ID \
  --freshness 1h \
  --limit 100 \
  --format json
```

### インデックス付きフィールド (高速)

`resource.type`, `resource.labels.*`, `logName`, `severity`, `timestamp`, `httpRequest.status`, `labels.*`, `trace`

### フィルタ構文

```bash
field="value"                    # 完全一致
field:substring                  # 部分一致 (遅い)
severity >= ERROR
expr1 AND expr2                  # AND はインデックス活用可
expr1 OR expr2                   # OR はインデックス活用不可 (遅い)
-field:*                         # フィールドを除外
timestamp >= "2024-01-01T00:00:00Z"
```

### よく使うフィルタ

```bash
resource.type="k8s_container"
resource.type="http_load_balancer"
resource.type="cloud_run_revision"
severity>=ERROR
httpRequest.status>=500
httpRequest.latency >= "250ms"
```

---

## jq フィルタ

`${CLAUDE_PLUGIN_ROOT}/skills/investigate-logging/scripts/filters/` にプリセットあり。
`ls` で確認して `-f` オプションで使用。

```bash
jq -f ${CLAUDE_PLUGIN_ROOT}/skills/investigate-logging/scripts/filters/minimal.jq /tmp/logs.json
```

---

## サービス別フィルタ例

### GKE

```bash
resource.type="k8s_container"
resource.labels.cluster_name="CLUSTER_NAME"
resource.labels.namespace_name="NAMESPACE"
resource.labels.container_name="CONTAINER"
```

### Cloud Run

```bash
resource.type="cloud_run_revision"
resource.labels.service_name="SERVICE_NAME"
logName="projects/PROJECT/logs/run.googleapis.com%2Frequests"
```

### App Engine

```bash
resource.type="gae_app"
resource.labels.module_id="SERVICE_NAME"
```

### Cloud Functions

```bash
resource.type="cloud_function"
resource.labels.function_name="FUNCTION_NAME"
```

### Load Balancer

```bash
resource.type="http_load_balancer"
httpRequest.requestUrl:"PATTERN"
```

### 監査ログ

```bash
logName="projects/PROJECT/logs/cloudaudit.googleapis.com%2Fdata_access"
logName="projects/PROJECT/logs/cloudaudit.googleapis.com%2Factivity"
protoPayload.serviceName="storage.googleapis.com"
```
