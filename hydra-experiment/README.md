# hydra-experiment

Hydra を使った機械学習実験のパラメータ管理をガイドする Claude Code プラグイン。

## Overview

Hydra + OmegaConf によるパラメータ管理のベストプラクティスを提供します。実験パラメータと環境設定を分離し、yaml は差分だけで管理する構成パターンをガイドします。

## Features

- **dataclass 駆動の設定管理**: デフォルト値は dataclass が唯一の正
- **exp/env 分離**: 実験パラメータ (exp) と環境依存設定 (env) を分離
- **差分 yaml**: 変更するパラメータだけ記述、デフォルト値は dataclass から継承
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
ローカル環境用の env 設定を追加したい
```

## ディレクトリ構造

```
experiments/NNN-name/
  config.yaml              # エントリポイント (defaults 指定 + hydra 設定)
  train.py                 # dataclass 定義 + 学習ロジック
  exp/
    001.yaml               # 実験パラメータ (差分のみ)
    002.yaml
  env/                     # 環境を分ける場合のみ作成
    runpod.yaml
    local.yaml
```

## 実行方法

```bash
uv run python train.py                    # デフォルト設定
uv run python train.py --cfg job          # 設定確認
uv run python train.py exp=001            # exp/001.yaml を使用
uv run python train.py exp=001 env=local  # ローカル環境で実行
```

## Installation

```
/plugin install hydra-experiment@pokutuna-plugins
```

## 参考

- [unonao/kaggle-template](https://github.com/unonao/kaggle-template)
