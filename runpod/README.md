# runpod

RunPod GPU cloud management plugin for Claude Code.

## Installation

```bash
claude plugins add /path/to/runpod
```

## Skills

### prepare-model-upload

Download HuggingFace models on Colab and upload to RunPod Network Volume via S3-compatible API.

Pre-deploy models before GPU instance startup to save billing time.

#### Prerequisites

Set these in Colab Secrets:
- `HF_TOKEN`: HuggingFace access token
- `RUNPOD_STORAGE_ACCESS_KEY_ID`: RunPod Storage Access Key ID
- `RUNPOD_STORAGE_SECRET_ACCESS_KEY`: RunPod Storage Secret Access Key

#### Usage

1. Open the Colab notebook
2. Configure Colab Secrets
3. Enter model names and RunPod Storage settings, then run

### stocks

Check RunPod GPU availability and suggest GPUs/datacenters matching requirements.

#### Prerequisites

- `~/.runpod/config.toml` with API key, or `RUNPOD_API_KEY` environment variable

#### Filter Options

- `--min-memory`: Minimum VRAM (GB)
- `--gpu`: Filter by GPU name
- `--storage`: Network Volume supported only
- `--stock`: Stock level (high/medium/low)
- `--gen`: GPU generation (blackwell/hopper/ada/ampere/volta/amd)
