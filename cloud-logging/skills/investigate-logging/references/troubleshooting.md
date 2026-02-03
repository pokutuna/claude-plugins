# Troubleshooting

## DEADLINE_EXCEEDED / タイムアウト

**症状:** `gcloud logging read` が `DEADLINE_EXCEEDED` で失敗、または `timeout` で終了

**原因:**
- フィルタ条件が広すぎる (スキャン範囲が膨大)
- インデックスされていないフィールドで検索している

**解決策:**
1. `--freshness` を短くする (1h → 30m → 10m)
2. `--limit` を減らす
3. インデックス付きフィールド (resource.type, severity, timestamp) を必ず含める
4. 部分一致 (`:`) より完全一致 (`=`) を使う

```bash
# 悪い例: インデックスなし、部分一致
gcloud logging read 'jsonPayload.message:"error"' --freshness 7d

# 良い例: インデックスあり、完全一致
gcloud logging read 'resource.type="k8s_container" AND severity>=ERROR' --freshness 1h
```

---

## ログが 0 件

**症状:** クエリは成功するが結果が空

**確認手順:**
1. フィルタなしで該当リソースのログが存在するか確認
2. タイムスタンプ形式を確認 (RFC3339)
3. プロジェクト ID が正しいか確認
4. Log Router でログが除外されていないか確認

```bash
# 1. フィルタを緩めてログ存在確認
timeout 30 gcloud logging read 'resource.type="k8s_container"' \
  --project PROJECT_ID --freshness 24h --limit 5 --format json | jq 'length'

# 2. 利用可能な severity を確認
timeout 30 gcloud logging read 'resource.type="k8s_container"' \
  --project PROJECT_ID --freshness 1h --limit 100 --format json \
  | jq '[.[].severity] | group_by(.) | map({(.[0] // "null"): length}) | add'
```
