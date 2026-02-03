# DuckDB による集計パターン

DuckDB は JSON 配列を直接読み込み、フィールドに直接アクセスできる。

## 生ログを直接分析

```bash
# ステータスコード別カウント (生ログ)
duckdb -s "
SELECT httpRequest.status as status, COUNT(*) as count
FROM read_json('/tmp/logs.json')
GROUP BY 1
ORDER BY count DESC
"

# severity 別カウント
duckdb -s "
SELECT severity, COUNT(*) as count
FROM read_json('/tmp/logs.json')
GROUP BY 1
ORDER BY count DESC
"

# 時間帯別リクエスト数
duckdb -s "
SELECT
  strftime(CAST(timestamp AS TIMESTAMP), '%Y-%m-%d %H:00') as hour,
  COUNT(*) as requests
FROM read_json('/tmp/logs.json')
GROUP BY 1
ORDER BY 1
"
```

## jq 整形後のデータを分析

```bash
# latency.jq で整形後、パーセンタイル分析
jq -f ${CLAUDE_PLUGIN_ROOT}/skills/investigate-logging/scripts/filters/latency.jq /tmp/logs.json > /tmp/latency.json
duckdb -s "
SELECT
  approx_quantile(latency_ms, 0.5) as p50,
  approx_quantile(latency_ms, 0.95) as p95,
  approx_quantile(latency_ms, 0.99) as p99
FROM read_json('/tmp/latency.json')
"

# URL パス別の平均レイテンシ
duckdb -s "
SELECT
  regexp_extract(url, 'https?://[^/]+(/[^?]*)', 1) as path,
  COUNT(*) as count,
  ROUND(AVG(latency_ms), 2) as avg_ms
FROM read_json('/tmp/latency.json')
GROUP BY 1
ORDER BY avg_ms DESC
LIMIT 10
"
```
