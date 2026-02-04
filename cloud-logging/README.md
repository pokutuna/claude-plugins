# cloud-logging

Google Cloud Logging を効率的に調査するための Claude Code プラグイン。

## Overview

gcloud logging read でログを取得し、jq/duckdb で分析するワークフローを提供します。大量のログをコンテキストに読み込まずに、ファイルベースで効率的に調査できます。

## Features

- **段階的な調査ワークフロー**: ログの存在確認 → 構造発見 → ファイル書き出し → 分析
- **インデックスフィールド優先**: resource.type, logName, timestamp, severity で高速フィルタ
- **プリセット jq フィルタ**: エラー分析、レイテンシ分析、トレース調査など用途別フィルタ
- **duckdb による集計**: SQL でログの統計分析・クロス集計が可能

## Prerequisites

- gcloud CLI インストール済み、`gcloud auth login` で認証済み
- jq (または gojq)
- duckdb

## Usage

```
Cloud Logging を調査して
本番で 500 エラーが発生しているので調べて
API のレイテンシが遅い原因を調査して
```

## jq フィルタ一覧

| フィルタ | 用途 |
|---------|------|
| minimal.jq | 概要把握 |
| http-request.jq | HTTP リクエスト詳細 |
| latency.jq | レイテンシ分析 |
| error-analysis.jq | エラー調査 |
| trace.jq | トレース調査 |
| audit.jq | 監査ログ |
| k8s-pod.jq | GKE Pod メタデータ |

## Installation

```
/plugin install cloud-logging@pokutuna-plugins
```
