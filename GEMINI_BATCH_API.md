# Gemini Batch API 実行ガイド

Gemini のバッチ処理を使用して、大量のリクエストを非同期で効率的に処理する方法を説明します。

## 2 つのバッチ処理方法

Gemini でバッチ処理を行う方法は 2 つあります:

| 特徴 | Gemini API Batch Mode | Vertex AI Batch Prediction |
|------|----------------------|---------------------------|
| エンドポイント | `generativelanguage.googleapis.com` | `aiplatform.googleapis.com` |
| 認証 | API キー | Google Cloud サービスアカウント |
| 入力ソース | File API / インライン | GCS / BigQuery |
| 出力先 | File API (自動) / インライン | GCS / BigQuery (指定可) |
| 出力先の指定 | **不可** | **可能** |
| ファイルサイズ上限 | 2GB | 1GB |
| SDK | `google-genai` | `google-cloud-aiplatform` |
| CLI | curl | gcloud |
| コスト | 標準の 50% OFF | 標準の 50% OFF |

**推奨**: シンプルに始めるなら **Gemini API Batch Mode** (`google-genai`)。GCP に統合された MLOps パイプラインがあるなら **Vertex AI Batch Prediction**。

---

# 方法 1: Gemini API Batch Mode (google-genai)

API キーで認証する軽量な方法。ローカル開発やスクリプトに最適。

## 概要

- **コスト**: 標準 API の 50% OFF
- **処理時間**: 最大 24 時間 (多くの場合はそれより早い)
- **用途**: 評価、データ前処理、バルク生成など即時性が不要なタスク

## 2 つの入力方式

| 方式 | 入力 | 出力先 | サイズ制限 | 用途 |
|------|------|--------|-----------|------|
| **Inline requests** | `src=list[dict]` | API レスポンス内 (`inlined_responses`) | 20MB | 小規模バッチ |
| **Input file** | `src=file_name` (File API) | File API 上に自動生成 (`file_name`) | 2GB | 大規模バッチ |

**重要**:
- 両方とも**非同期**。`create()` は即座にジョブ名を返し、ポーリングで完了を待つ
- **出力先は指定不可**。結果は自動的に File API またはレスポンス内に格納される
  - 出力先を制御したい場合は Vertex AI Batch Prediction を使う

## セットアップ

```bash
# google-genai SDK をインストール
uv add google-genai
```

API キーを環境変数に設定:

```bash
export GEMINI_API_KEY="your-api-key"
```

---

## Inline 方式 (小規模バッチ向け)

リクエストをリストとして直接渡す。ファイルアップロード不要。

### 実行フロー

```
1. リクエストのリストを作成
2. batches.create() でジョブ作成 (即座に返る)
3. ポーリングで状態確認 (PENDING → RUNNING → SUCCEEDED)
4. batch_job.dest.inlined_responses から結果取得
```

### サンプルコード

```python
import time
from google import genai

client = genai.Client()

# 1. リクエストのリストを作成
inline_requests = [
    {"contents": [{"parts": [{"text": "Tell me a joke."}], "role": "user"}]},
    {"contents": [{"parts": [{"text": "Why is the sky blue?"}], "role": "user"}]},
]

# 2. バッチジョブ作成 (非同期、即座に返る)
batch_job = client.batches.create(
    model="gemini-2.0-flash",
    src=inline_requests,
    config={"display_name": "inline-job"},
)
print(f"Created job: {batch_job.name}")

# 3. ポーリングで完了待機
completed_states = {"JOB_STATE_SUCCEEDED", "JOB_STATE_FAILED", "JOB_STATE_CANCELLED", "JOB_STATE_EXPIRED"}
while batch_job.state.name not in completed_states:
    print(f"State: {batch_job.state.name}")
    time.sleep(30)
    batch_job = client.batches.get(name=batch_job.name)

# 4. 結果取得 (Inline の場合は inlined_responses に格納)
if batch_job.state.name == "JOB_STATE_SUCCEEDED":
    for i, resp in enumerate(batch_job.dest.inlined_responses):
        if resp.response:
            print(f"Response {i}: {resp.response.text}")
        elif resp.error:
            print(f"Error {i}: {resp.error}")
```

---

## File 方式 (大規模バッチ向け)

JSONL ファイルを File API にアップロードして処理。

### 実行フロー

```
1. 入力ファイル (JSONL) を作成
2. File API でファイルをアップロード
3. batches.create() でジョブ作成
4. ポーリングで状態確認
5. batch_job.dest.file_name から結果ファイルをダウンロード
```

### 入力ファイルの形式 (JSONL)

各行が 1 リクエスト。`key` でリクエストを識別し、`request` に `GenerateContentRequest` を記述:

```jsonl
{"key": "request-1", "request": {"contents": [{"parts": [{"text": "質問1"}]}], "generation_config": {"temperature": 0.7}}}
{"key": "request-2", "request": {"contents": [{"parts": [{"text": "質問2"}]}]}}
```

### SDK の型を使った JSONL 作成 (推奨)

`google.genai.types` の型を使うと、構造を保証しながら JSONL を作成できる:

```python
import json
from google.genai import types


def create_batch_request(key: str, prompt: str, config: types.GenerateContentConfig | None = None) -> dict:
    """バッチリクエスト用の dict を作成"""
    content = types.Content(
        role="user",
        parts=[types.Part(text=prompt)],
    )

    request = {
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
        "properties": {
            "answer": {"type": "string"},
        },
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
- `model_dump(exclude_none=True)` でも同様の結果が得られる

### サンプルコード (File 方式)

```python
#!/usr/bin/env python3
"""
Gemini Batch API 実行スクリプト

Usage:
    uv run python run_batch.py --input input.jsonl --output-dir ./results
"""

import argparse
import json
import time
from pathlib import Path

from google import genai
from google.genai import types


def upload_input_file(client: genai.Client, input_path: Path) -> str:
    """入力ファイルを File API にアップロード"""
    uploaded_file = client.files.upload(
        file=str(input_path),
        config=types.UploadFileConfig(
            display_name=input_path.name,
            mime_type="jsonl",
        ),
    )
    print(f"Uploaded file: {uploaded_file.name}")
    return uploaded_file.name


def create_batch_job(
    client: genai.Client,
    file_name: str,
    model: str = "gemini-2.0-flash",
    display_name: str = "batch-job",
) -> str:
    """バッチジョブを作成"""
    batch_job = client.batches.create(
        model=model,
        src=file_name,
        config={"display_name": display_name},
    )
    print(f"Created batch job: {batch_job.name}")
    return batch_job.name


def wait_for_completion(
    client: genai.Client,
    job_name: str,
    poll_interval: int = 30,
) -> types.Batch:
    """ジョブの完了を待機"""
    completed_states = {
        "JOB_STATE_SUCCEEDED",
        "JOB_STATE_FAILED",
        "JOB_STATE_CANCELLED",
        "JOB_STATE_EXPIRED",
    }

    print(f"Polling status for job: {job_name}")
    batch_job = client.batches.get(name=job_name)

    while batch_job.state.name not in completed_states:
        print(f"  Current state: {batch_job.state.name}")
        time.sleep(poll_interval)
        batch_job = client.batches.get(name=job_name)

    print(f"Job finished with state: {batch_job.state.name}")
    return batch_job


def download_results(client: genai.Client, batch_job: types.Batch, output_path: Path) -> None:
    """結果をダウンロード"""
    if batch_job.state.name != "JOB_STATE_SUCCEEDED":
        print(f"Job did not succeed. State: {batch_job.state.name}")
        if batch_job.error:
            print(f"Error: {batch_job.error}")
        return

    if batch_job.dest and batch_job.dest.file_name:
        result_file_name = batch_job.dest.file_name
        print(f"Downloading results from: {result_file_name}")

        file_content = client.files.download(file=result_file_name)
        output_path.write_bytes(file_content)
        print(f"Saved results to: {output_path}")
    else:
        print("No result file found")


def main():
    parser = argparse.ArgumentParser(description="Gemini Batch API runner")
    parser.add_argument("--input", type=str, required=True, help="入力 JSONL ファイル")
    parser.add_argument("--output-dir", type=str, default="./results", help="出力ディレクトリ")
    parser.add_argument("--model", type=str, default="gemini-2.0-flash", help="モデル名")
    parser.add_argument("--poll-interval", type=int, default=30, help="ポーリング間隔 (秒)")
    parser.add_argument("--job-name", type=str, default=None, help="既存ジョブ名 (再開時)")
    args = parser.parse_args()

    client = genai.Client()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.job_name:
        # 既存ジョブの結果取得
        job_name = args.job_name
    else:
        # 新規ジョブ作成
        input_path = Path(args.input)
        file_name = upload_input_file(client, input_path)
        job_name = create_batch_job(
            client,
            file_name,
            model=args.model,
            display_name=input_path.stem,
        )

    # 完了待機
    batch_job = wait_for_completion(client, job_name, args.poll_interval)

    # 結果ダウンロード
    output_path = output_dir / f"{Path(job_name).name}_results.jsonl"
    download_results(client, batch_job, output_path)


if __name__ == "__main__":
    main()
```

---

## ジョブ管理

### ジョブ一覧の確認

```python
from google import genai

client = genai.Client()

for batch_job in client.batches.list():
    print(f"{batch_job.name}: {batch_job.state.name} - {batch_job.display_name}")
```

### ジョブのキャンセル

```python
client.batches.cancel(name="batches/123456789")
```

### ジョブの削除

```python
client.batches.delete(name="batches/123456789")
```

---

## このディレクトリでの使い方

### Step 1: バッチ入力ファイルの作成

```bash
uv run python prepare_batch_input.py --output data/batch_input/relevance_evaluation_all.jsonl
```

### Step 2: バッチジョブの実行

```bash
uv run python run_batch.py \
    --input data/batch_input/relevance_evaluation_all.jsonl \
    --output-dir data/batch_results \
    --model gemini-2.0-flash
```

### Step 3: 結果のマージ

```bash
uv run python merge_batch_results.py
```

## リクエスト形式の詳細

`prepare_batch_input.py` が生成するリクエスト形式:

```json
{
  "key": "query_1",
  "request": {
    "contents": [{"role": "user", "parts": [{"text": "プロンプト"}]}],
    "generation_config": {
      "max_output_tokens": 8192,
      "response_mime_type": "application/json",
      "response_schema": {
        "type": "object",
        "properties": {
          "noise_threshold_rank": {"type": "integer", "nullable": true},
          "reasoning": {"type": "string"}
        },
        "required": ["noise_threshold_rank", "reasoning"]
      }
    }
  }
}
```

## レスポンス形式

成功時のレスポンス例:

```json
{
  "key": "query_1",
  "response": {
    "candidates": [{
      "content": {
        "parts": [{"text": "{\"noise_threshold_rank\": 45, \"reasoning\": \"...\"}"}]
      },
      "finishReason": "STOP"
    }]
  }
}
```

エラー時:

```json
{
  "key": "query_1",
  "error": {
    "code": 400,
    "message": "Error message"
  }
}
```

## ジョブの状態

| 状態 | 説明 |
|------|------|
| `JOB_STATE_PENDING` | ジョブ作成済み、処理待ち |
| `JOB_STATE_RUNNING` | 処理中 |
| `JOB_STATE_SUCCEEDED` | 成功完了 |
| `JOB_STATE_FAILED` | 失敗 |
| `JOB_STATE_CANCELLED` | ユーザーによるキャンセル |
| `JOB_STATE_EXPIRED` | 48 時間超過で期限切れ |

## Tips

### リトライ処理

一部のリクエストが失敗した場合、失敗した query_id だけを抽出して再実行:

```bash
# 失敗した query_id を指定して入力ファイルを再作成
uv run python prepare_batch_input.py \
    --query-ids "5,12,45" \
    --output data/batch_input/relevance_evaluation_retry.jsonl
```

### コスト見積もり

- 入力トークン: $0.0375 / 1M tokens (Flash)
- 出力トークン: $0.15 / 1M tokens (Flash)
- ※ 標準価格の 50% OFF

### 注意事項

- Batch API では caching と RAG は使用不可
- 48 時間を超えるとジョブは期限切れになる
- 結果ファイルは一定期間後に削除されるため、早めにダウンロードすること

---

# 方法 2: Vertex AI Batch Prediction (gcloud / REST)

GCP サービスアカウントで認証。GCS/BigQuery との統合が必要な場合に最適。

## セットアップ

```bash
# gcloud CLI のインストール・認証
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

# Vertex AI SDK (Python の場合)
uv add google-cloud-aiplatform
```

## 入力ファイル形式

GCS に配置する JSONL ファイル。Gemini API と形式が少し異なる:

```jsonl
{"request": {"contents": [{"role": "user", "parts": [{"text": "質問1"}]}]}}
{"request": {"contents": [{"role": "user", "parts": [{"text": "質問2"}]}]}}
```

## gcloud CLI での実行

```bash
# 入力ファイルを GCS にアップロード
gsutil cp input.jsonl gs://your-bucket/batch-input/

# バッチジョブ作成
gcloud ai batch-predictions create \
    --region=us-central1 \
    --model=gemini-1.5-flash-002 \
    --input-uri=gs://your-bucket/batch-input/input.jsonl \
    --output-uri=gs://your-bucket/batch-output/ \
    --display-name="my-batch-job"

# ジョブ一覧
gcloud ai batch-predictions list --region=us-central1

# ジョブ状態確認
gcloud ai batch-predictions describe JOB_ID --region=us-central1

# 結果ダウンロード
gsutil -m cp -r gs://your-bucket/batch-output/ ./results/
```

## REST API (curl) での実行

```bash
# アクセストークン取得
ACCESS_TOKEN=$(gcloud auth print-access-token)
PROJECT_ID="your-project-id"
LOCATION="us-central1"

# バッチジョブ作成
curl -X POST \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  "https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/batchPredictionJobs" \
  -d '{
    "displayName": "my-batch-job",
    "model": "publishers/google/models/gemini-1.5-flash-002",
    "inputConfig": {
      "instancesFormat": "jsonl",
      "gcsSource": {
        "uris": ["gs://your-bucket/batch-input/input.jsonl"]
      }
    },
    "outputConfig": {
      "predictionsFormat": "jsonl",
      "gcsDestination": {
        "outputUriPrefix": "gs://your-bucket/batch-output/"
      }
    }
  }'

# ジョブ状態確認
curl -X GET \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  "https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/batchPredictionJobs/JOB_ID"
```

## Python SDK での実行

```python
from google.cloud import aiplatform

aiplatform.init(project="your-project-id", location="us-central1")

batch_prediction_job = aiplatform.BatchPredictionJob.create(
    job_display_name="my-batch-job",
    model_name="publishers/google/models/gemini-1.5-flash-002",
    instances_format="jsonl",
    gcs_source="gs://your-bucket/batch-input/input.jsonl",
    predictions_format="jsonl",
    gcs_destination_prefix="gs://your-bucket/batch-output/",
)

# 完了待機
batch_prediction_job.wait()

print(f"Job state: {batch_prediction_job.state}")
print(f"Output: {batch_prediction_job.output_info}")
```

---

# どちらを選ぶべきか

| ユースケース | 推奨 |
|-------------|------|
| ローカルでの実験・評価 | Gemini API (google-genai) |
| CI/CD パイプライン (API キー使用可) | Gemini API (google-genai) |
| GCS/BigQuery にデータがある | Vertex AI Batch Prediction |
| サービスアカウント認証が必須 | Vertex AI Batch Prediction |
| Vertex AI Pipelines と統合 | Vertex AI Batch Prediction |

---

## 参考リンク

### Gemini API Batch Mode
- [Batch API ドキュメント](https://ai.google.dev/gemini-api/docs/batch-mode)
- [google-genai SDK](https://github.com/googleapis/python-genai)

### Vertex AI Batch Prediction
- [Vertex AI Batch Prediction ドキュメント](https://cloud.google.com/vertex-ai/docs/generative-ai/batch-prediction-genai)
- [gcloud ai batch-predictions](https://cloud.google.com/sdk/gcloud/reference/ai/batch-predictions)
