---
name: stocks
description: |
  RunPod の GPU 在庫状況を取得し、条件に合う GPU とデータセンターを提案する。
  メモリ、世代、Network Volume 対応、在庫レベルでフィルタ可能。
  Use when user mentions "runpod gpu", "gpu availability", "gpu 在庫",
  "runpod datacenter", "network volume 対応 gpu", "どの GPU が使える".
metadata:
  author: pokutuna
  version: 0.1.0
  compatibility: RunPod API (requires ~/.runpod/config.toml or RUNPOD_API_KEY)
allowed-tools: "Bash(uv run --script fetch_gpu_stocks.py:*)"
---

# RunPod GPU 在庫確認

RunPod の GPU 在庫状況をデータセンター単位で確認し、条件に合う GPU を提案する。

## 前提条件

以下のいずれかで RunPod API キーを設定:
- 環境変数 `RUNPOD_API_KEY`
- `~/.runpod/config.toml` (runpod CLI で設定)

## スクリプト

`${CLAUDE_PLUGIN_ROOT}/skills/stocks/fetch_gpu_stocks.py`

## 使用方法

```bash
# 全データセンター × GPU の在庫状況
uv run --script fetch_gpu_stocks.py

# メモリでフィルタ (80GB 以上)
uv run --script fetch_gpu_stocks.py --min-memory 80

# GPU 名でフィルタ (部分一致、複数指定可)
uv run --script fetch_gpu_stocks.py --gpu h100 5090

# Network Volume (S3) 対応のデータセンターのみ
uv run --script fetch_gpu_stocks.py --storage

# 在庫レベルでフィルタ
uv run --script fetch_gpu_stocks.py --stock high    # High のみ
uv run --script fetch_gpu_stocks.py --stock medium  # High + Medium

# GPU 世代でフィルタ
uv run --script fetch_gpu_stocks.py --gen hopper    # H100, H200
uv run --script fetch_gpu_stocks.py --gen blackwell # B200, RTX 5090 など
uv run --script fetch_gpu_stocks.py --gen ada       # RTX 4090, L40 など
uv run --script fetch_gpu_stocks.py --gen ampere    # A100, RTX 3090 など

# 複合条件
uv run --script fetch_gpu_stocks.py --min-memory 80 --storage --stock high

# JSON 出力
uv run --script fetch_gpu_stocks.py --json
```

## 出力例

```
Datacenter   Location        GPU                          Mem Gen        Stock Storage    Price
---------------------------------------------------------------------------------------------------------
EU-CZ-1      Europe          RTX 5090                    32GB blackwell   High       ✓    $0.69
EU-RO-1      Europe          RTX 5090                    32GB blackwell   High       ✓    $0.69
US-CA-2      United States   RTX 5090                    32GB blackwell   High       ✓    $0.69
US-NC-1      United States   RTX 5090                    32GB blackwell   High       ✓    $0.69

Found 4 options across 4 datacenters, 1 GPU types
```

## フィルタオプション

| オプション | 説明 |
|------------|------|
| `--min-memory GB` | 最小 VRAM (GB) |
| `--gpu KEYWORD...` | GPU 名でフィルタ (部分一致、複数可) |
| `--storage` | Network Volume 対応のみ |
| `--stock {high,medium,low}` | 在庫レベル |
| `--gen {blackwell,hopper,ada,ampere,volta,amd}` | GPU 世代 |
| `--secure-cloud` | Secure Cloud 対応のみ |
| `--community-cloud` | Community Cloud 対応のみ |
| `--json` | JSON 形式で出力 |

## GPU 世代の分類

| 世代 | 主な GPU |
|------|----------|
| blackwell | B200, B300, RTX PRO 6000, RTX 5090, RTX 5080 |
| hopper | H100, H200 |
| ada | RTX 4090, RTX 4080, L40, L40S, RTX 6000 Ada など |
| ampere | A100, A40, RTX 3090, RTX A6000, L4 |
| volta | V100 |
| amd | MI300X |

## Examples

### ユーザーの質問に応じた使い方

User: 「RTX 5090 で Network Volume 使えるところは?」
```bash
uv run --script fetch_gpu_stocks.py --gpu 5090 --storage
```

User: 「80GB 以上の GPU で在庫あるのは?」
```bash
uv run --script fetch_gpu_stocks.py --min-memory 80 --stock high
```

User: 「Hopper 世代で Storage 対応のところ」
```bash
uv run --script fetch_gpu_stocks.py --gen hopper --storage
```

User: 「H100 と A100 の在庫比較」
```bash
uv run --script fetch_gpu_stocks.py --gpu h100 a100 --storage
```

## 注意事項

- **`stockStatus` は信頼性が低い**: API は常に High を返すことが多く、実際の在庫状況と異なる場合がある
- 実際の空き状況は [RunPod Web UI](https://www.runpod.io/console/gpu-cloud) で確認すること
- 価格は Community Cloud の価格を優先表示 (ない場合は Secure Cloud)

**ユーザーへの説明**: 結果を返す際、stockStatus は API の値であり実際の在庫と異なる場合があること、実際の空きは Web UI で確認するようユーザーに伝えること。
