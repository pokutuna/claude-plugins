# runpod

RunPod GPU cloud management plugin for Claude Code.

## Installation

```bash
claude plugins add /path/to/runpod
```

## Skills

### prepare-model-upload

Colab で HuggingFace モデルをダウンロードし、RunPod の Network Volume に S3 互換 API でアップロードする。

GPU インスタンス起動前にモデルを配置しておくことで課金時間を節約。

#### 前提条件

Colab Secrets に以下を設定:
- `HF_TOKEN`: HuggingFace アクセストークン
- `RUNPOD_STORAGE_ACCESS_KEY_ID`: RunPod Storage Access Key ID
- `RUNPOD_STORAGE_SECRET_ACCESS_KEY`: RunPod Storage Secret Access Key

#### 使用方法

1. notebook を生成
2. VSCode の Colab Kernel 拡張から実行
3. モデル名、RunPod Storage 情報を入力して実行
