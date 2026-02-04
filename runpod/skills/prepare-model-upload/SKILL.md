---
name: prepare-model-upload
description: |
  Colab で HuggingFace モデルをダウンロードし、RunPod の Network Volume に S3 互換 API でアップロードする notebook を作成する。
  GPU インスタンス起動前にモデルを配置しておくことで課金時間を節約する。
  Use when user mentions "runpod model upload", "network volume にモデル配置",
  "colab から runpod", "HuggingFace model to runpod", "S3 sync runpod".
metadata:
  author: pokutuna
  version: 0.1.0
compatibility: Google Colab, RunPod Network Volume with S3 API
---

# Colab → RunPod Network Volume モデルアップロード

GPU インスタンス起動中に巨大モデルをダウンロードするのは課金の無駄。
Colab で HuggingFace からダウンロードし、RunPod の S3 互換 API で Network Volume に配置する。

## 前提条件

### Colab Secrets に以下を設定

- `HF_TOKEN`: HuggingFace のアクセストークン
- `RUNPOD_STORAGE_ACCESS_KEY_ID`: RunPod Storage の Access Key ID
- `RUNPOD_STORAGE_SECRET_ACCESS_KEY`: RunPod Storage の Secret Access Key

### RunPod Storage 情報

RunPod Console > Storage > Network Volume から確認:
- Endpoint URL (例: `https://xxx.r2.cloudflarestorage.com`)
- Region (例: `auto` or specific region)
- Bucket name (Volume ID)

## 実行手順

1. 以下の URL で Colab notebook を開く:
   https://colab.research.google.com/github/pokutuna/claude-plugins/blob/main/runpod/skills/prepare-model-upload/sync.ipynb
2. Colab Secrets を設定 (左サイドバーの 🔑 アイコン)
3. モデル名、Volume 情報を入力して実行

## 注意事項

### sync の制限

Volume が大きくなると `aws s3 sync` が失敗することがある:
> fatal error: Error during pagination: The same next token was received twice: ...

この場合は `aws s3 cp --recursive` を使う (差分転送は不可)。

### アップロード失敗時

`upload failed` が出た場合は `--checksum-algorithm=CRC32C` を付けて再実行。

### ファイル構成

HuggingFace の cache 構造ではなく、モデル単位でアップロードする方が管理しやすい。

## Examples

### 基本的な使用

User: 「Qwen3-8B を runpod の network volume に置きたい」

1. Colab notebook の URL を提示
2. Colab Secrets の設定を案内
3. RunPod Storage 情報 (Endpoint, Region, Bucket) の入力を案内

## 参考

- [runpod/runpod-s3-examples](https://github.com/runpod/runpod-s3-examples) - リトライ付きアップロードスクリプト
- [RunPod S3 API Known Issues](https://docs.runpod.io/serverless/storage/s3-api#known-issues-and-limitations)
