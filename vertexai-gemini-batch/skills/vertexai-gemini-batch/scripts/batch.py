#!/usr/bin/env -S uv run --script
# /// script
# dependencies = [
#     "google-genai",
# ]
# ///
"""
Vertex AI Batch Prediction CLI (google-genai SDK)

Subcommands:
    create  バッチジョブを作成
    status  ジョブの状態を確認
    list    ジョブ一覧を取得
    wait    ジョブの完了を待機
    usage   詳細な使い方を表示

Global Options:
    --project   GCP プロジェクト ID (必須)
    --region    リージョン (default: global)

Examples:
    ./batch.py --project PROJECT_ID create \\
        --input-uri gs://BUCKET/input.jsonl \\
        --output-uri gs://BUCKET/output/ \\
        --model gemini-2.5-flash

    ./batch.py --project PROJECT_ID status --job-name JOB_NAME
    ./batch.py --project PROJECT_ID list
    ./batch.py --project PROJECT_ID wait --job-name JOB_NAME
"""

import argparse
import sys
import time

from google import genai
from google.genai import types

USAGE_DOC = """
Vertex AI Batch Prediction CLI
==============================

google-genai SDK を使用して Vertex AI 経由で Gemini のバッチ処理を実行する CLI ツール。

Prerequisites
-------------
- gcloud auth application-default login で認証済みであること
- Vertex AI API が有効化されていること
  gcloud services enable aiplatform.googleapis.com --project=PROJECT_ID

Subcommands
-----------

create: バッチジョブを作成
    --input-uri     入力 JSONL の GCS URI (必須)
    --output-uri    出力先の GCS URI プレフィックス (必須)
    --model         モデル名 (必須, 例: gemini-2.5-flash)
    --display-name  ジョブ表示名 (default: batch-job)

status: ジョブの状態を確認
    --job-name      ジョブ名 (必須)

list: ジョブ一覧を取得
    (オプションなし)

wait: ジョブの完了を待機
    --job-name      ジョブ名 (必須)
    --poll-interval ポーリング間隔 (秒, default: 30)

Input JSONL Format
------------------
各行が 1 リクエスト。key フィールドで入出力を対応付け可能:

{"key": "req-1", "request": {"contents": [{"role": "user", "parts": [{"text": "質問"}]}]}}

Output JSONL Format
-------------------
{
  "key": "req-1",
  "status": "",
  "processed_time": "2024-01-15T10:30:00Z",
  "request": {...},
  "response": {
    "candidates": [{"content": {"parts": [{"text": "回答"}]}}],
    "usageMetadata": {...}
  }
}

注意: 出力順序は入力順序と異なる場合がある。key フィールドで対応付けること。

Job States
----------
JOB_STATE_PENDING    ジョブ作成済み、処理待ち
JOB_STATE_QUEUED     キューに入った
JOB_STATE_RUNNING    処理中
JOB_STATE_SUCCEEDED  成功完了
JOB_STATE_FAILED     失敗
JOB_STATE_CANCELLED  ユーザーによるキャンセル
JOB_STATE_EXPIRED    48 時間超過で期限切れ

Examples
--------
# 入力ファイルを GCS にアップロード
gcloud storage cp input.jsonl gs://BUCKET/batch-input/

# バッチジョブ作成
./batch.py --project PROJECT_ID create \\
    --input-uri gs://BUCKET/batch-input/input.jsonl \\
    --output-uri gs://BUCKET/batch-output/ \\
    --model gemini-2.5-flash

# ジョブ状態確認
./batch.py --project PROJECT_ID status \\
    --job-name "projects/PROJECT_NUM/locations/global/batchPredictionJobs/JOB_ID"

# ジョブ一覧
./batch.py --project PROJECT_ID list

# ジョブ完了を待機
./batch.py --project PROJECT_ID wait \\
    --job-name "projects/PROJECT_NUM/locations/global/batchPredictionJobs/JOB_ID"

# 結果ダウンロード
gcloud storage cp -r gs://BUCKET/batch-output/ ./results/
"""


def create_client(project: str, region: str) -> genai.Client:
    """Vertex AI を使用する Client を作成"""
    return genai.Client(
        vertexai=True,
        project=project,
        location=region,
    )


def cmd_create(args):
    """バッチジョブを作成"""
    client = create_client(args.project, args.region)

    batch_job = client.batches.create(
        model=args.model,
        src=args.input_uri,
        config=types.CreateBatchJobConfig(
            display_name=args.display_name,
            dest=args.output_uri,
        ),
    )

    print(f"Created batch job: {batch_job.name}")
    print(f"State: {batch_job.state.name}")


def cmd_status(args):
    """ジョブの状態を確認"""
    client = create_client(args.project, args.region)
    job = client.batches.get(name=args.job_name)

    print(f"Name: {job.name}")
    print(f"State: {job.state.name}")
    print(f"Model: {job.model}")
    if job.dest:
        print(f"Output: {job.dest.gcs_uri}")
    if job.error:
        print(f"Error: {job.error}")


def cmd_list(args):
    """ジョブ一覧を取得"""
    client = create_client(args.project, args.region)

    for job in client.batches.list():
        print(f"{job.state.name:25} {job.name}")


def cmd_wait(args):
    """ジョブの完了を待機"""
    client = create_client(args.project, args.region)
    wait_for_completion(client, args.job_name, args.poll_interval)


def cmd_usage(args):
    """詳細な使い方を表示"""
    print(USAGE_DOC)


def wait_for_completion(client: genai.Client, job_name: str, poll_interval: int = 30):
    """ジョブの完了を待機"""
    completed_states = {
        "JOB_STATE_SUCCEEDED",
        "JOB_STATE_FAILED",
        "JOB_STATE_CANCELLED",
        "JOB_STATE_EXPIRED",
    }

    print(f"Waiting for job: {job_name}")
    batch_job = client.batches.get(name=job_name)

    while batch_job.state.name not in completed_states:
        print(f"  Current state: {batch_job.state.name}")
        time.sleep(poll_interval)
        batch_job = client.batches.get(name=job_name)

    print(f"Job finished with state: {batch_job.state.name}")

    if batch_job.state.name == "JOB_STATE_SUCCEEDED":
        print(f"Output: {batch_job.dest.gcs_uri}")
    elif batch_job.error:
        print(f"Error: {batch_job.error}")

    return batch_job


def main():
    parser = argparse.ArgumentParser(
        description="Vertex AI Batch Prediction CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Run './batch.py usage' for detailed documentation.",
    )
    parser.add_argument("--project", type=str, help="GCP プロジェクト ID")
    parser.add_argument(
        "--region", type=str, default="global", help="リージョン (default: global)"
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    # create
    p_create = subparsers.add_parser("create", help="バッチジョブを作成")
    p_create.add_argument(
        "--input-uri", type=str, required=True, help="入力 JSONL の GCS URI"
    )
    p_create.add_argument(
        "--output-uri", type=str, required=True, help="出力先の GCS URI プレフィックス"
    )
    p_create.add_argument("--model", type=str, required=True, help="モデル名")
    p_create.add_argument(
        "--display-name", type=str, default="batch-job", help="ジョブ表示名"
    )
    p_create.set_defaults(func=cmd_create)

    # status
    p_status = subparsers.add_parser("status", help="ジョブの状態を確認")
    p_status.add_argument("--job-name", type=str, required=True, help="ジョブ名")
    p_status.set_defaults(func=cmd_status)

    # list
    p_list = subparsers.add_parser("list", help="ジョブ一覧を取得")
    p_list.set_defaults(func=cmd_list)

    # wait
    p_wait = subparsers.add_parser("wait", help="ジョブの完了を待機")
    p_wait.add_argument("--job-name", type=str, required=True, help="ジョブ名")
    p_wait.add_argument(
        "--poll-interval", type=int, default=30, help="ポーリング間隔 (秒)"
    )
    p_wait.set_defaults(func=cmd_wait)

    # usage
    p_usage = subparsers.add_parser("usage", help="詳細な使い方を表示")
    p_usage.set_defaults(func=cmd_usage)

    args = parser.parse_args()

    # usage サブコマンドは --project 不要
    if args.command != "usage" and not args.project:
        parser.error("--project is required for this command")

    args.func(args)


if __name__ == "__main__":
    main()
