# vertexai-gemini-batch

Vertex AI Batch Prediction で Gemini モデルをバッチ実行するための Claude Code プラグイン。

## Overview

google-genai SDK を使用して Vertex AI 経由で Gemini のバッチ処理を実行します。標準 API と比較して 50% のコスト削減が可能です。

## Features

- **型安全な入力ファイル生成**: google.genai.types を使った JSONL 作成
- **CLI スクリプト同梱**: バッチジョブの作成・待機・状態確認をコマンドラインで実行
- **Structured Output 対応**: JSON Schema による出力形式の制御
- **BigQuery 入出力対応**: GCS だけでなく BigQuery もソース/出力先として利用可能

## Prerequisites

- Google Cloud プロジェクト
- `gcloud auth application-default login` で認証済み
- Vertex AI API が有効 (`gcloud services enable aiplatform.googleapis.com`)
- GCS バケット (入出力用)

## Usage

```
Gemini のバッチ処理を実行したい
バッチ入力ファイルを作成して
Vertex AI Batch API を使いたい
```

## 入力ファイル形式

```jsonl
{"key": "req-1", "request": {"contents": [{"role": "user", "parts": [{"text": "質問1"}]}]}}
{"key": "req-2", "request": {"contents": [{"role": "user", "parts": [{"text": "質問2"}]}]}}
```

## CLI スクリプト

```bash
# バッチジョブ作成
uv run ./scripts/batch.py --project PROJECT_ID create \
    --input-uri gs://BUCKET/input.jsonl \
    --output-uri gs://BUCKET/output/

# 完了待機
uv run ./scripts/batch.py --project PROJECT_ID wait --job-name JOB_NAME
```

## Installation

```
/plugin install vertexai-gemini-batch@pokutuna-plugins
```
