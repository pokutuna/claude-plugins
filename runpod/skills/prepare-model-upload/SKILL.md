---
name: prepare-model-upload
description: |
  Download HuggingFace models on Colab and upload to RunPod Network Volume via S3-compatible API.
  Pre-deploy models before GPU instance startup to save billing time.
  Use when user mentions "runpod model upload", "network volume model",
  "colab to runpod", "HuggingFace model to runpod", "S3 sync runpod".
metadata:
  author: pokutuna
  version: 0.2.0
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

## Notebook Structure

The notebook has separate cells:
1. **Environment Setup** - Loads secrets from Colab (run once)
2. **Settings** - Model names and storage settings (user configures this)
3. **Download and Upload** - Main execution
4. **Troubleshooting cells** - For retry scenarios

## Response Instructions

When user provides model names or aws cli command examples, output code snippets that can be directly copy-pasted into Colab cells.

### When user provides model name(s)

Output a ready-to-paste Settings cell:

```python
# Settings

# HuggingFace models (USER/REPOSITORY format, multiple allowed)
HF_MODELS = [
    "USER_PROVIDED_MODEL",  # parsed from user input
]

# RunPod Storage (copy from https://console.runpod.io/user/storage)
REGION = ""  # @param {type:"string"}
ENDPOINT_URL = ""  # @param {type:"string"}
BUCKET = ""  # @param {type:"string"}
```

### When user provides aws cli command example

Parse the command and output a ready-to-paste Settings cell with values filled:

Example input:
```
aws s3 ls --region us-east-1 --endpoint-url https://s3api-xxxxxx.runpod.io s3://abc123def456/
```

Output:
```python
# Settings

# HuggingFace models (USER/REPOSITORY format, multiple allowed)
HF_MODELS = [
    "",  # Add your model here, e.g., "Qwen/Qwen3-8B"
]

# RunPod Storage (parsed from aws cli command)
REGION = "us-east-1"  # @param {type:"string"}
ENDPOINT_URL = "https://s3api-xxxxxx.runpod.io"  # @param {type:"string"}
BUCKET = "abc123def456"  # @param {type:"string"}
```

### When user provides both model name(s) and aws cli command

Combine both into a complete Settings cell ready to run.

## Examples

User: "I want to put Qwen3-8B on my runpod network volume"

1. Provide Colab notebook URL
2. Guide Colab Secrets setup
3. Output Settings cell with model name filled:
   ```python
   HF_MODELS = [
       "Qwen/Qwen3-8B",
   ]
   ```

User: "aws s3 ls --region us-east-1 --endpoint-url https://s3api-xxx.runpod.io s3://my-bucket/"

Parse and output Settings cell with storage values filled.

## References

- [runpod/runpod-s3-examples](https://github.com/runpod/runpod-s3-examples)
- [RunPod S3 API Known Issues](https://docs.runpod.io/serverless/storage/s3-api#known-issues-and-limitations)
