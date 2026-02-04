# hydra-experiment

Hydra を使った機械学習実験のパラメータ管理をガイドする Claude Code プラグイン。

## Overview

Hydra + OmegaConf によるパラメータ管理のベストプラクティスを提供します。実験ごとに設定ファイルとコードを分離し、再現可能な実験管理を実現します。

## Features

- **階層的な設定管理**: ベース設定 + 実験オーバーライドの構造
- **実験ディレクトリパターン**: 実験ごとに config.yaml と train.py を分離
- **WandB 連携**: 実験追跡との統合パターン
- **Jupyter 対応**: ノートブックからの設定読み込み方法

## Prerequisites

- hydra-core
- omegaconf

## Usage

```
Hydra で実験管理をセットアップしたい
新しい実験ディレクトリを作成して
learning rate を変えて実験を追加したい
```

## ディレクトリ構造

```
experiments/
├── 001-baseline/
│   ├── config.yaml     # ベース設定
│   ├── exp/
│   │   ├── 001.yaml    # パラメータオーバーライド
│   │   └── 002.yaml
│   └── train.py
└── 002-larger-model/
    ├── config.yaml
    ├── exp/
    └── train.py        # 別アプローチ用のコード
```

## 実行方法

```bash
uv run python train.py                    # ベース設定
uv run python train.py exp=001            # exp/001.yaml を使用
uv run python train.py exp=001 exp.debug=true  # オーバーライド
```

## Installation

```
/plugin install hydra-experiment@pokutuna-plugins
```
