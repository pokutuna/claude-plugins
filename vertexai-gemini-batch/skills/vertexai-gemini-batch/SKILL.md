---
name: vertexai-gemini-batch
description: This skill should be used when the user asks to "create Gemini batch request", "prepare batch input for Gemini", "run Vertex AI batch API", or needs guidance on Vertex AI batch prediction setup.
allowed-tools: Bash, Read, Edit, Write, Glob, Grep, AskUserQuestion
user-invocable: true
---

# Vertex AI Batch Prediction for Gemini

`google-genai` SDK を使用して Vertex AI 経由で Gemini のバッチ処理を実行するための支援を行います。

## 概要

| 項目 | 内容 |
|------|------|
| SDK | `google-genai` (vertexai=True) |
| 認証 | Google Cloud ADC / サービスアカウント |
| 入力ソース | GCS / BigQuery |
| 出力先 | GCS / BigQuery (指定可) |
| コスト | 標準 API の 50% OFF |
| 処理時間 | 最大 24 時間 (通常はそれより早い) |

---

## ワークフロー

### Phase 1: 設定の収集

ユーザに以下の情報を確認する:

1. **必須情報**:
   - Google Cloud プロジェクト ID
   - GCS バケットパス (例: `gs://bucket-name/batch-workspace/`)

2. **推論内容**:
   - この SKILL 起動までの文脈から推論内容を把握できない場合は尋ねる
   - バッチで処理したいプロンプトまたはプロンプトのテンプレート
   - 入力データのソース (CSV, JSONL, データベースなど)

その他の設定 (モデル、リージョン、generation_config) はスクリプトの引数やコード内で指定する

---

## 入力ファイルのデータ構造

### 入力形式 (JSONL)

各行が 1 リクエスト。`request` フィールドに `GenerateContentRequest` 相当の構造を記述:

```jsonl
{"key": "req-1", "request": {"contents": [{"role": "user", "parts": [{"text": "質問1"}]}]}}
{"key": "req-2", "request": {"contents": [{"role": "user", "parts": [{"text": "質問2"}]}], "generation_config": {"temperature": 0.7}}}
```

**`key` フィールド** (推奨): 各リクエストに一意の識別子を付与できる。出力にも同じ `key` が含まれるため、入出力の対応付けが容易になる。バッチ処理では出力順序が入力順序と異なる場合があるため、`key` の使用を推奨。

### 完全な入力例 (generation_config 含む)

```json
{
  "key": "summarize-001",
  "request": {
    "contents": [
      {
        "role": "user",
        "parts": [{"text": "この文章を要約してください: ..."}]
      }
    ],
    "generation_config": {
      "temperature": 0.7,
      "max_output_tokens": 1024,
      "top_p": 0.95,
      "top_k": 40,
      "response_mime_type": "application/json",
      "response_schema": {
        "type": "object",
        "properties": {
          "summary": {"type": "string"},
          "key_points": {
            "type": "array",
            "items": {"type": "string"}
          }
        },
        "required": ["summary", "key_points"]
      }
    },
    "safety_settings": [
      {
        "category": "HARM_CATEGORY_HARASSMENT",
        "threshold": "BLOCK_MEDIUM_AND_ABOVE"
      }
    ],
    "system_instruction": {
      "parts": [{"text": "あなたは要約の専門家です。"}]
    }
  }
}
```

### request フィールドの構造 (GenerateContentRequest)

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `contents` | array | 必須。会話履歴。各要素は `role` と `parts` を持つ |
| `contents[].role` | string | `"user"` または `"model"` |
| `contents[].parts` | array | メッセージのパーツ。`text`, `inline_data` など |
| `generation_config` | object | 生成パラメータ |
| `system_instruction` | object | システムプロンプト |
| `safety_settings` | array | 安全性設定 |

### generation_config の主要フィールド

| フィールド | 型 | デフォルト | 説明 |
|-----------|-----|-----------|------|
| `temperature` | number | 1.0 | 生成のランダム性 (0.0-2.0) |
| `max_output_tokens` | integer | モデル依存 | 最大出力トークン数 |
| `top_p` | number | 0.95 | nucleus sampling |
| `top_k` | integer | 40 | top-k sampling |
| `response_mime_type` | string | `"text/plain"` | `"application/json"` で JSON 出力を強制 |
| `response_schema` | object | - | JSON Schema 形式で出力構造を定義 |
| `stop_sequences` | array | - | 生成を停止する文字列のリスト |

---

## Phase 2: 入力ファイル生成スクリプトの作成

ユーザの要件に基づいて、JSONL 形式の入力ファイルを生成する Python スクリプトを作成する。

### SDK の型を使った JSONL 作成 (推奨)

`google.genai.types` の型を使って構造を保証する:

```python
import json
from google.genai import types


def create_batch_request(key: str, prompt: str, config: types.GenerateContentConfig | None = None) -> dict:
    """バッチリクエスト用の dict を作成"""
    content = types.Content(
        role="user",
        parts=[types.Part(text=prompt)],
    )

    request: dict = {
        "key": key,
        "request": {
            "contents": [content.to_json_dict()],
        },
    }

    if config:
        request["request"]["generation_config"] = config.to_json_dict()

    return request


# 使用例
config = types.GenerateContentConfig(
    temperature=0.7,
    max_output_tokens=1024,
    response_mime_type="application/json",
    response_schema={
        "type": "object",
        "properties": {"answer": {"type": "string"}},
        "required": ["answer"],
    },
)

requests = [
    create_batch_request("req-1", "Tell me a joke", config),
    create_batch_request("req-2", "Why is the sky blue?", config),
]

# JSONL ファイルに書き出し
with open("batch_input.jsonl", "w") as f:
    for req in requests:
        f.write(json.dumps(req, ensure_ascii=False) + "\n")
```

**ポイント**:
- `types.Content`, `types.Part`, `types.GenerateContentConfig` を使って型安全に構築
- `.to_json_dict()` で API が期待する形式に変換 (null フィールドを除外)

---

## Phase 3: バッチジョブの実行

### CLI スクリプト

プラグインに同梱の `./scripts/batch.py` を使用する。PEP 723 形式で依存関係が記述されており、`uv run` で直接実行できる。

```bash
# 入力ファイルを GCS にアップロード
gcloud storage cp input.jsonl gs://BUCKET/batch-input/

# バッチジョブ作成
uv run ./scripts/batch.py --project PROJECT_ID create \
    --input-uri gs://BUCKET/batch-input/input.jsonl \
    --output-uri gs://BUCKET/batch-output/ \
    --model MODEL_NAME

# ジョブ完了を待機する場合
uv run ./scripts/batch.py --project PROJECT_ID wait --job-name JOB_NAME

# 結果ダウンロード
gcloud storage cp -r gs://BUCKET/batch-output/ ./results/
```

詳細な使い方は `uv run ./scripts/batch.py usage` を参照。

**注意**: gcloud CLI には Batch Prediction ジョブを操作するサブコマンドは存在しない。ジョブの作成・状態確認は Python SDK を使用する

---

## Phase 4: 結果の処理

### 出力 JSONL の形式

成功時:

```json
{
  "key": "req-1",
  "status": "",
  "processed_time": "2024-01-15T10:30:00Z",
  "request": {"contents": [...]},
  "response": {
    "candidates": [{
      "content": {
        "parts": [{"text": "生成されたテキスト"}]
      },
      "finishReason": "STOP"
    }],
    "usageMetadata": {
      "promptTokenCount": 10,
      "candidatesTokenCount": 50,
      "totalTokenCount": 60
    }
  }
}
```

エラー時:

```json
{
  "key": "req-2",
  "status": "ERROR",
  "processed_time": "2024-01-15T10:30:00Z",
  "request": {"contents": [...]},
  "error": {"code": 400, "message": "Error message"}
}
```

**注意**: 出力順序は入力順序と異なる場合がある。`key` フィールドで入出力を対応付けること。

---

## 重要な注意事項

- **認証**: `gcloud auth application-default login` または サービスアカウントキーが必要
- **API 有効化**: Vertex AI API を有効化すること (`gcloud services enable aiplatform.googleapis.com`)
- **権限**: GCS バケットへの読み書き権限が必要
- **リージョン**: モデルによって利用可能なリージョンが異なる。新しいモデルは `global` リージョンのみ対応の場合がある
- **コスト**: 標準 API の 50% OFF
- Batch API では caching と RAG は使用不可
- 48 時間を超えるとジョブは期限切れになる

---

## トラブルシューティング

### よくあるエラーと対処法

| エラーメッセージ | 原因 | 対処法 |
|----------------|------|--------|
| `The PublisherModel XXX does not exist` | モデル名が間違っている、またはリージョンが対応していない | モデル名のスペルを確認し、リージョンを変更する (`global` など) |
| `Do not support publisher model XXX` | そのリージョンでモデルがサポートされていない | リージョンを `global` に変更する (新しいモデルの場合) |
| `Permission denied` | GCS バケットへのアクセス権限がない | サービスアカウントに `storage.objects.create` 権限を付与 |
| `API not enabled` | Vertex AI API が有効化されていない | `gcloud services enable aiplatform.googleapis.com` を実行 |

### エラー発生時の確認手順

1. **モデル名を変更しない** - ユーザが指定したモデルを勝手に変更しないこと
2. まずリージョンの制約を確認 (`global` が必要か)
3. 次に入力ファイルのフォーマットを確認 (JSONL の各行が有効な JSON か)
4. GCS パスの権限を確認

---

## セットアップコマンド

```bash
# 認証
gcloud auth application-default login

# API 有効化
gcloud services enable aiplatform.googleapis.com --project=PROJECT_ID
```

**注意**: スクリプトは PEP 723 形式で依存関係が記述されており、`uv run` で実行すると自動的にパッケージがインストールされる

---

## 参考リンク

不明点がある場合は以下のドキュメントを参照すること:

- [Vertex AI Batch Prediction from Cloud Storage](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/batch-prediction-from-cloud-storage) - GCS を使ったバッチ予測の詳細
- [Google Gen AI SDK ドキュメント](https://googleapis.github.io/python-genai/)
- [google-genai GitHub](https://github.com/googleapis/python-genai)
