---
name: investigate-logging
description: |
  Google Cloud Logging を gcloud logging read で取得し、jq/duckdb で分析するスキル。
  Use when: "Cloud Logging", "gcloud logging", "GCP ログ調査", "GKE ログ", "Cloud Run ログ", "Cloud Audit Logs", "resource.type", "httpRequest.latency"
  Do NOT use for: 一般的なログファイル操作、AWS CloudWatch、Azure Monitor、ローカルログ
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

## Examples

### Example 1: エラー調査

**User says:** 「本番で 500 エラーが発生しているので調べて」

**Actions:**
1. プロジェクト ID、サービス名、発生時間帯を確認
2. ログの存在確認 (severity>=ERROR, limit 3)
3. エラーログをファイルに書き出し
4. jq でエラーメッセージとスタックトレースを抽出
5. 発生パターンを分析 (時間帯、エンドポイント、頻度)

**Result:** エラーの原因特定と発生パターンのサマリを報告

### Example 2: レイテンシ調査

**User says:** 「API のレスポンスが遅いので原因を調べて」

**Actions:**
1. プロジェクト ID、対象 API、時間範囲を確認
2. HTTP リクエストログを取得 (httpRequest.latency あり)
3. latency.jq でレイテンシ情報を抽出
4. duckdb でパーセンタイル分析 (p50, p95, p99)
5. 遅いリクエストの共通点を特定 (エンドポイント、クライアント等)

**Result:** レイテンシ分布と遅延の原因候補を報告

### Example 3: トレース調査

**User says:** 「このリクエストの処理の流れを追いたい」

**Actions:**
1. 対象リクエストの trace ID を特定 (エラーログや特定リクエストから)
2. trace ID でフィルタしてログを取得
3. trace.jq で時系列にソートして処理フローを可視化
4. 各 span の処理時間を確認

```bash
# trace ID でフィルタ
timeout 60 gcloud logging read 'trace="projects/PROJECT_ID/traces/TRACE_ID"' \
  --project PROJECT_ID --freshness 1h --format json > /tmp/trace.json

# 時系列でソート
jq -f ${CLAUDE_PLUGIN_ROOT}/skills/investigate-logging/scripts/filters/trace.jq /tmp/trace.json
```

**Result:** リクエストの処理フローと各サービスでの処理時間を報告

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

```bash
# 一覧表示
ls ${CLAUDE_PLUGIN_ROOT}/skills/investigate-logging/scripts/filters/

# 使用例
jq -f ${CLAUDE_PLUGIN_ROOT}/skills/investigate-logging/scripts/filters/minimal.jq /tmp/logs.json
```

### フィルタ一覧

| フィルタ | 用途 | 出力フィールド |
|---------|------|---------------|
| minimal.jq | 概要把握 | timestamp, severity, logName, resource, message |
| http-request.jq | HTTP リクエスト詳細 | timestamp, method, url, status, latency, userAgent |
| latency.jq | レイテンシ分析 (降順ソート) | timestamp, url, latency_ms, status |
| error-analysis.jq | エラー調査 | timestamp, severity, message, stack, trace, spanId |
| trace.jq | トレース調査 (時系列ソート) | timestamp, severity, trace, spanId, message, latency |
| audit.jq | 監査ログ | timestamp, method, resource, principal, callerIp |
| client-analysis.jq | クライアント分析 | timestamp, remoteIp, userAgent, status, path |
| k8s-pod.jq | GKE Pod メタデータ | timestamp, namespace, pod, container, severity, message |
| bigquery-job.jq | BigQuery ジョブ | timestamp, jobId, state, query (truncated), bytesProcessed |
| request-summary.jq | HTTP 統計サマリ | status 別カウント、平均/最大レイテンシ |

---

## DuckDB による集計

詳細は `${CLAUDE_PLUGIN_ROOT}/skills/investigate-logging/references/duckdb-patterns.md` を参照。

```bash
# 基本パターン: JSON を直接読み込んで集計
duckdb -s "SELECT field, COUNT(*) FROM read_json('/tmp/logs.json') GROUP BY 1"
```

---

## Troubleshooting

詳細は `${CLAUDE_PLUGIN_ROOT}/skills/investigate-logging/references/troubleshooting.md` を参照。

- **DEADLINE_EXCEEDED**: フィルタが広すぎる → freshness/limit を絞る、インデックスフィールドを使う
- **ログが 0 件**: フィルタなしで存在確認、プロジェクト ID 確認、Log Router 除外確認

---

## サービス別フィルタ例

詳細は `${CLAUDE_PLUGIN_ROOT}/skills/investigate-logging/references/service-examples.md` を参照。

- GKE (k8s_container, k8s_cluster, k8s_node)
- Cloud Run
- App Engine
- Cloud Functions
- Load Balancer
- 監査ログ (Cloud Audit Logs)
- BigQuery
- Pub/Sub
- Cloud SQL
- Compute Engine
