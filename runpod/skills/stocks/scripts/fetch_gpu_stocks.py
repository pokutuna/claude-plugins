#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["runpod"]
# ///
"""
RunPod GPU 在庫・データセンター情報を取得するスクリプト

環境変数:
  RUNPOD_API_KEY: RunPod API キー (または ~/.runpod/config.toml)

使用例:
  # データセンター × GPU の在庫状況を取得
  uv run --script fetch_gpu_stocks.py

  # 48GB 以上の GPU のみ
  uv run --script fetch_gpu_stocks.py --min-memory 48

  # 特定の GPU のみ (部分一致)
  uv run --script fetch_gpu_stocks.py --gpu h100 5090

  # Network Volume (S3) 対応のデータセンターのみ
  uv run --script fetch_gpu_stocks.py --storage

  # 在庫が High のもののみ
  uv run --script fetch_gpu_stocks.py --stock high

  # 世代でフィルタ (ada, hopper, ampere, blackwell)
  uv run --script fetch_gpu_stocks.py --gen hopper

  # 複合条件: 80GB以上 + Storage対応 + 在庫High
  uv run --script fetch_gpu_stocks.py --min-memory 80 --storage --stock high

  # JSON 出力
  uv run --script fetch_gpu_stocks.py --json
"""

import argparse
import json
import os
import sys
import tomllib
from pathlib import Path

import runpod


RUNPOD_CONFIG_PATH = Path.home() / ".runpod" / "config.toml"

# GPU 世代の分類
GPU_GENERATIONS = {
    "blackwell": ["B200", "B300", "RTX PRO 6000", "RTX 5090", "RTX 5080"],
    "hopper": ["H100", "H200"],
    "ada": [
        "RTX 4090",
        "RTX 4080",
        "RTX 4070",
        "L40S",
        "L40",
        "RTX 6000 Ada",
        "RTX 5000 Ada",
        "RTX 4000 Ada",
        "RTX 2000 Ada",
    ],
    "ampere": [
        "A100",
        "A40",
        "A30",
        "RTX 3090",
        "RTX 3080",
        "RTX 3070",
        "RTX A6000",
        "RTX A5000",
        "RTX A4500",
        "RTX A4000",
        "RTX A2000",
        "L4",
    ],
    "volta": ["V100"],
    "amd": ["MI300X"],
}


def get_api_key() -> str:
    """API キーを取得 (環境変数 > config.toml)"""
    api_key = os.environ.get("RUNPOD_API_KEY", "")
    if api_key:
        return api_key

    if RUNPOD_CONFIG_PATH.exists():
        try:
            with open(RUNPOD_CONFIG_PATH, "rb") as f:
                config = tomllib.load(f)
                return config.get("apikey", "")
        except Exception as e:
            print(f"Warning: Failed to read {RUNPOD_CONFIG_PATH}: {e}", file=sys.stderr)

    return ""


def fetch_datacenters() -> list[dict]:
    """データセンター情報を取得 (GPU 在庫含む)"""
    query = """
    query {
      dataCenters {
        id
        name
        location
        storageSupport
        gpuAvailability {
          gpuTypeId
          stockStatus
        }
      }
    }
    """
    result = runpod.api.graphql.run_graphql_query(query)
    return result.get("data", {}).get("dataCenters", [])


def fetch_gpu_types() -> dict[str, dict]:
    """GPU タイプ情報を取得 (価格など)"""
    gpus = runpod.get_gpus()
    gpu_details = {}
    for gpu in gpus:
        try:
            detail = runpod.get_gpu(gpu["id"])
            gpu_details[gpu["id"]] = detail
        except ValueError:
            pass
    return gpu_details


def get_gpu_generation(gpu_id: str) -> str | None:
    """GPU ID から世代を判定"""
    for gen, keywords in GPU_GENERATIONS.items():
        for keyword in keywords:
            if keyword.lower() in gpu_id.lower():
                return gen
    return None


def build_availability_table(
    datacenters: list[dict],
    gpu_details: dict[str, dict],
) -> list[dict]:
    """データセンター × GPU の在庫テーブルを構築"""
    rows = []
    for dc in datacenters:
        for avail in dc.get("gpuAvailability", []):
            gpu_id = avail.get("gpuTypeId", "")
            gpu_info = gpu_details.get(gpu_id, {})

            rows.append(
                {
                    "datacenter_id": dc["id"],
                    "datacenter_name": dc["name"],
                    "location": dc.get("location", ""),
                    "storage_support": dc.get("storageSupport", False),
                    "gpu_id": gpu_id,
                    "gpu_name": gpu_info.get("displayName", gpu_id),
                    "memory_gb": gpu_info.get("memoryInGb"),
                    "generation": get_gpu_generation(gpu_id),
                    "stock_status": avail.get("stockStatus"),
                    "secure_cloud": gpu_info.get("secureCloud", False),
                    "community_cloud": gpu_info.get("communityCloud", False),
                    "secure_price": gpu_info.get("securePrice"),
                    "community_price": gpu_info.get("communityPrice"),
                    "secure_spot_price": gpu_info.get("secureSpotPrice"),
                    "community_spot_price": gpu_info.get("communitySpotPrice"),
                }
            )
    return rows


def filter_rows(
    rows: list[dict],
    min_memory: int | None = None,
    gpu_keywords: list[str] | None = None,
    storage_only: bool = False,
    stock_status: str | None = None,
    generation: str | None = None,
    secure_cloud: bool = False,
    community_cloud: bool = False,
) -> list[dict]:
    """条件に基づいてフィルタ"""
    result = rows

    if min_memory is not None:
        result = [
            r for r in result if r.get("memory_gb") and r["memory_gb"] >= min_memory
        ]

    if gpu_keywords:
        keywords_lower = [k.lower() for k in gpu_keywords]
        result = [
            r
            for r in result
            if any(
                kw in r.get("gpu_id", "").lower() or kw in r.get("gpu_name", "").lower()
                for kw in keywords_lower
            )
        ]

    if storage_only:
        result = [r for r in result if r.get("storage_support")]

    if stock_status:
        status_lower = stock_status.lower()
        if status_lower == "high":
            result = [r for r in result if r.get("stock_status") == "High"]
        elif status_lower == "medium":
            result = [r for r in result if r.get("stock_status") in ["High", "Medium"]]
        elif status_lower == "low":
            result = [
                r for r in result if r.get("stock_status") in ["High", "Medium", "Low"]
            ]

    if generation:
        result = [r for r in result if r.get("generation") == generation.lower()]

    if secure_cloud:
        result = [r for r in result if r.get("secure_cloud")]

    if community_cloud:
        result = [r for r in result if r.get("community_cloud")]

    return result


def format_price(price: float | None) -> str:
    if price is None:
        return "N/A"
    return f"${price:.2f}"


def print_table(rows: list[dict]) -> None:
    """テーブル形式で出力"""
    if not rows:
        print("No results found.")
        return

    # ヘッダー
    print(
        f"{'Datacenter':<12} {'Location':<15} {'GPU':<25} {'Mem':>6} {'Gen':<9} {'Stock':>6} {'Storage':>7} {'Price':>8}"
    )
    print("-" * 105)

    # メモリ降順、データセンター名でソート
    sorted_rows = sorted(
        rows, key=lambda r: (-(r.get("memory_gb") or 0), r["datacenter_id"])
    )

    for r in sorted_rows:
        dc = r["datacenter_id"]
        loc = r.get("location", "")[:15]
        gpu = (r.get("gpu_name") or r.get("gpu_id", ""))[:25]
        mem = f"{r['memory_gb']}GB" if r.get("memory_gb") else "N/A"
        gen = (r.get("generation") or "-")[:9]
        stock = (r.get("stock_status") or "-")[:6]
        storage = "✓" if r.get("storage_support") else "-"
        price = format_price(r.get("community_price") or r.get("secure_price"))

        print(
            f"{dc:<12} {loc:<15} {gpu:<25} {mem:>6} {gen:<9} {stock:>6} {storage:>7} {price:>8}"
        )


def print_summary(rows: list[dict]) -> None:
    """サマリーを出力"""
    if not rows:
        return

    # ユニークなデータセンターと GPU をカウント
    datacenters = set(r["datacenter_id"] for r in rows)
    gpus = set(r["gpu_id"] for r in rows)

    print(
        f"\nFound {len(rows)} options across {len(datacenters)} datacenters, {len(gpus)} GPU types"
    )


def main():
    parser = argparse.ArgumentParser(
        description="RunPod GPU 在庫・データセンター情報を取得",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--min-memory", type=int, metavar="GB", help="最小 VRAM (GB)")
    parser.add_argument(
        "--gpu", nargs="+", metavar="KEYWORD", help="GPU 名でフィルタ (部分一致)"
    )
    parser.add_argument(
        "--storage", action="store_true", help="Network Volume 対応のみ"
    )
    parser.add_argument(
        "--stock",
        choices=["high", "medium", "low"],
        help="在庫レベル (high: Highのみ, medium: High+Medium, low: 全て)",
    )
    parser.add_argument("--gen", choices=list(GPU_GENERATIONS.keys()), help="GPU 世代")
    parser.add_argument(
        "--secure-cloud", action="store_true", help="Secure Cloud 対応のみ"
    )
    parser.add_argument(
        "--community-cloud", action="store_true", help="Community Cloud 対応のみ"
    )
    parser.add_argument("--json", action="store_true", help="JSON 形式で出力")
    args = parser.parse_args()

    api_key = get_api_key()
    if not api_key:
        print("Error: RUNPOD_API_KEY not found", file=sys.stderr)
        print(
            "Set RUNPOD_API_KEY environment variable or configure ~/.runpod/config.toml",
            file=sys.stderr,
        )
        sys.exit(1)

    runpod.api_key = api_key

    # データ取得
    print("Fetching data...", file=sys.stderr)
    datacenters = fetch_datacenters()
    gpu_details = fetch_gpu_types()

    # テーブル構築
    rows = build_availability_table(datacenters, gpu_details)

    # フィルタ
    filtered = filter_rows(
        rows,
        min_memory=args.min_memory,
        gpu_keywords=args.gpu,
        storage_only=args.storage,
        stock_status=args.stock,
        generation=args.gen,
        secure_cloud=args.secure_cloud,
        community_cloud=args.community_cloud,
    )

    if args.json:
        print(json.dumps(filtered, indent=2))
    else:
        print_table(filtered)
        print_summary(filtered)


if __name__ == "__main__":
    main()
