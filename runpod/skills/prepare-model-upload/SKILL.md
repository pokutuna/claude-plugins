---
name: prepare-model-upload
description: |
  Download HuggingFace models on Colab and upload to RunPod Network Volume via S3-compatible API.
  Pre-deploy models before GPU instance startup to save billing time.
  Use when user mentions "runpod model upload", "network volume model",
  "colab to runpod", "HuggingFace model to runpod", "S3 sync runpod".
metadata:
  author: pokutuna
  version: 0.1.0
  compatibility: Google Colab, RunPod Network Volume with S3 API
---

# Colab → RunPod Network Volume Model Upload

Downloading large models during GPU instance runtime wastes billing time.
Use Colab to download from HuggingFace and upload to RunPod Network Volume via S3-compatible API.

## Prerequisites

### Colab Secrets

- `HF_TOKEN`: HuggingFace access token
- `RUNPOD_STORAGE_ACCESS_KEY_ID`: RunPod Storage Access Key ID
- `RUNPOD_STORAGE_SECRET_ACCESS_KEY`: RunPod Storage Secret Access Key

### RunPod Storage Settings

Get from https://console.runpod.io/user/storage "S3 Compatible API Commands" Example:
```
aws s3 ls --region xxx --endpoint-url https://s3api-xxx.runpod.io s3://your-volume-id/
```

## Steps

1. Open Colab notebook:
   https://colab.research.google.com/github/pokutuna/claude-plugins/blob/main/runpod/skills/prepare-model-upload/hf-to-runpod-storage.ipynb
2. Configure Colab Secrets (🔑 icon in left sidebar)
3. Enter model names and volume settings, then run

## Notes

### Sync Limitations

`aws s3 sync` may fail on large volumes:
> fatal error: Error during pagination: The same next token was received twice: ...

Use `aws s3 cp --recursive` instead (no delta transfer).

### Upload Failures

If `upload failed` occurs, retry with `--checksum-algorithm=CRC32C`.

## Examples

User: "I want to put Qwen3-8B on my runpod network volume"

1. Provide Colab notebook URL
2. Guide Colab Secrets setup
3. Guide RunPod Storage settings (Endpoint, Region, Bucket)

## References

- [runpod/runpod-s3-examples](https://github.com/runpod/runpod-s3-examples)
- [RunPod S3 API Known Issues](https://docs.runpod.io/serverless/storage/s3-api#known-issues-and-limitations)
