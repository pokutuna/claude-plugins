---
name: stocks
description: |
  Query RunPod GPU availability and suggest GPUs/datacenters matching requirements.
  Filter by memory, generation, Network Volume support, and stock level.
  Use when user mentions "runpod gpu", "gpu availability", "gpu stock",
  "runpod datacenter", "network volume gpu", "which gpu available".
metadata:
  author: pokutuna
  version: 0.1.0
  compatibility: RunPod API (requires ~/.runpod/config.toml or RUNPOD_API_KEY)
allowed-tools: "Bash(uv run --script fetch_gpu_stocks.py:*)"
---

# RunPod GPU Stock Check

Check RunPod GPU availability by datacenter and suggest GPUs matching requirements.

## Prerequisites

Set RunPod API key via either:
- Environment variable `RUNPOD_API_KEY`
- `~/.runpod/config.toml` (set via runpod CLI)

## Script

`${CLAUDE_PLUGIN_ROOT}/skills/stocks/fetch_gpu_stocks.py`

## Usage

```bash
# All datacenter × GPU availability
uv run --script fetch_gpu_stocks.py

# Filter by memory (80GB+)
uv run --script fetch_gpu_stocks.py --min-memory 80

# Filter by GPU name (partial match, multiple allowed)
uv run --script fetch_gpu_stocks.py --gpu h100 5090

# Network Volume (S3) supported datacenters only
uv run --script fetch_gpu_stocks.py --storage

# Filter by stock level
uv run --script fetch_gpu_stocks.py --stock high    # High only
uv run --script fetch_gpu_stocks.py --stock medium  # High + Medium

# Filter by GPU generation
uv run --script fetch_gpu_stocks.py --gen hopper    # H100, H200
uv run --script fetch_gpu_stocks.py --gen blackwell # B200, RTX 5090, etc.
uv run --script fetch_gpu_stocks.py --gen ada       # RTX 4090, L40, etc.
uv run --script fetch_gpu_stocks.py --gen ampere    # A100, RTX 3090, etc.

# Combined filters
uv run --script fetch_gpu_stocks.py --min-memory 80 --storage --stock high

# JSON output
uv run --script fetch_gpu_stocks.py --json
```

## Output Example

```
Datacenter   Location        GPU                          Mem Gen        Stock Storage    Price
---------------------------------------------------------------------------------------------------------
EU-CZ-1      Europe          RTX 5090                    32GB blackwell   High       ✓    $0.69
EU-RO-1      Europe          RTX 5090                    32GB blackwell   High       ✓    $0.69
US-CA-2      United States   RTX 5090                    32GB blackwell   High       ✓    $0.69
US-NC-1      United States   RTX 5090                    32GB blackwell   High       ✓    $0.69

Found 4 options across 4 datacenters, 1 GPU types
```

## Filter Options

| Option | Description |
|--------|-------------|
| `--min-memory GB` | Minimum VRAM (GB) |
| `--gpu KEYWORD...` | Filter by GPU name (partial match, multiple) |
| `--storage` | Network Volume supported only |
| `--stock {high,medium,low}` | Stock level |
| `--gen {blackwell,hopper,ada,ampere,volta,amd}` | GPU generation |
| `--secure-cloud` | Secure Cloud only |
| `--community-cloud` | Community Cloud only |
| `--json` | JSON output |

## GPU Generation Classification

| Generation | GPUs |
|------------|------|
| blackwell | B200, B300, RTX PRO 6000, RTX 5090, RTX 5080 |
| hopper | H100, H200 |
| ada | RTX 4090, RTX 4080, L40, L40S, RTX 6000 Ada, etc. |
| ampere | A100, A40, RTX 3090, RTX A6000, L4 |
| volta | V100 |
| amd | MI300X |

## Examples

User: "Where can I use RTX 5090 with Network Volume?"
```bash
uv run --script fetch_gpu_stocks.py --gpu 5090 --storage
```

User: "Which 80GB+ GPUs are in stock?"
```bash
uv run --script fetch_gpu_stocks.py --min-memory 80 --stock high
```

User: "Hopper generation with Storage support"
```bash
uv run --script fetch_gpu_stocks.py --gen hopper --storage
```

User: "Compare H100 and A100 availability"
```bash
uv run --script fetch_gpu_stocks.py --gpu h100 a100 --storage
```

## Important Notes

- **`stockStatus` is unreliable**: API often returns "High" regardless of actual availability
- Always verify actual availability on [RunPod Web UI](https://www.runpod.io/console/gpu-cloud)
- Prices shown are Community Cloud (falls back to Secure Cloud if unavailable)

**User communication**: When returning results, inform users that stockStatus is from the API and may not reflect actual availability. Recommend checking the Web UI for real-time status.
