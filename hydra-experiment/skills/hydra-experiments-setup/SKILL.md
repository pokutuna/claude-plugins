---
name: experiment-setup
description: |
  Hydra による設定管理パターンをガイドする。
  Use when user mentions "hydra", "hydra.main", "ConfigStore", "OmegaConf",
  "config.yaml with defaults", "exp/*.yaml", "@_here_", or "--cfg job".
metadata:
  author: pokutuna
  version: 0.2.0
compatibility: requires hydra-core, omegaconf
---

# Hydra 実験管理ガイド

Hydra によるパラメータ管理と実験実行のパターン。
実験パラメータと環境設定を分離し、yaml は差分だけで管理する。

## 実験ディレクトリ構造

`experiments/` 配下に実験ごとのディレクトリ `NNN-name/` を作成する。
アプローチが異なる実験は別ディレクトリ、同じアプローチのパラメータ違いは `exp/` 内の yaml で管理する。

```
experiments/NNN-name/
  config.yaml              # エントリポイント (defaults 指定 + hydra 設定)
  train.py                 # dataclass 定義 + 学習ロジック
  exp/
    001.yaml               # パラメータ違い (差分のみ)
    002.yaml
  env/                     # 環境を分ける場合のみ作成
    runpod.yaml
    local.yaml
```

## 設計原則

### 1. dataclass がデフォルト値の唯一の正

```python
from dataclasses import dataclass, field
from hydra.core.config_store import ConfigStore

@dataclass
class ExpConfig:
    name: str = "default"
    seed: int = 42
    learning_rate: float = 2e-5
    batch_size: int = 16
    # ハイパーパラメータはフラットに配置 (ネストしない)

@dataclass
class EnvConfig:
    base_model: str = "/workspace/models/Model"
    output_dir: str = "output/NNN-name"
    model_output_dir: str = "/workspace/output/NNN-name"

@dataclass
class Config:
    exp: ExpConfig = field(default_factory=ExpConfig)
    env: EnvConfig = field(default_factory=EnvConfig)

cs = ConfigStore.instance()
cs.store(name="default", group="exp", node=ExpConfig)
cs.store(name="default", group="env", node=EnvConfig)
```

`exp/default.yaml` や `env/default.yaml` は作らない (ConfigStore の `name="default"` と衝突するため)。

### 2. config.yaml は defaults と hydra 設定だけ書く

```yaml
# 設定確認: python train.py --cfg job
# 実験指定: python train.py exp=001

defaults:
- _self_
- exp: default                       # ConfigStore のデフォルト
- env: default                       # ConfigStore のデフォルト (yaml なし)
# - env: runpod                      # yaml がある場合はこちら
- override hydra/job_logging: none   # hydra ログファイル生成を無効化

hydra:
  output_subdir: null   # .hydra/ ディレクトリを作らない
  job:
    chdir: false        # 作業ディレクトリを変更しない
  run:
    dir: .              # 出力ディレクトリをカレントに
```

config.yaml には `exp:` や `env:` ブロックで値を直接書かない。値は dataclass のデフォルトで管理し、変更は exp/*.yaml で行う。

### 3. 実験 yaml は差分だけ

```yaml
# exp/001.yaml
defaults:
  - default@_here_    # ConfigStore の "default" スキーマを継承

name: "001-lr-sweep"
learning_rate: 5.0e-5
```

- `defaults: [default@_here_]` で dataclass のデフォルト値を継承
- 変更するパラメータだけ書く
- `@_here_` は「このファイル自身の位置に展開する」という意味

### 4. env は同じ実験を別マシンで動かすためのもの

`EnvConfig` のデフォルト値がメインの実行環境に合っていれば yaml は不要。
別環境で動かす必要が出たら `env/` に yaml を追加する:

```yaml
# env/local.yaml
defaults:
  - default@_here_

base_model: "Qwen/Qwen3-4B-Instruct-2507"   # HuggingFace から取得
model_output_dir: "output/NNN-name"           # ローカルパス
```

```bash
python train.py exp=001 env=local
```

## exp と env の分け方

| 置き場 | 内容 | 判断基準 |
|--------|------|----------|
| `exp`  | 学習パラメータ、データセット、seed | 実験ごとに変える値 |
| `env`  | モデルパス、出力パス | 同じ実験を別マシンで動かすときに変える値 |

## エントリーポイント

```python
@hydra.main(version_base=None, config_path=".", config_name="config")
def main(cfg: Config) -> None:
    # 実験実行...

if __name__ == "__main__":
    main()
```

## 設定確認

Hydra 組み込みの `--cfg` オプションを使う。`show_config` フラグは不要。

```bash
python train.py --cfg job              # 自分の設定だけ表示
python train.py --cfg job exp=001      # 実験指定して確認
python train.py --cfg hydra            # Hydra 自体の設定
python train.py --cfg all              # 全部
```

## 実行方法

```bash
uv run python train.py                    # デフォルト設定で実行
uv run python train.py exp=001            # exp/001.yaml を使用
uv run python train.py exp=001 env=local  # exp/001.yaml, env/local.yaml を使用
uv run python train.py exp=001 exp.debug=true        # オーバーライド
uv run python train.py exp=001 exp.batch_size=8      # 値を直接変更
```

## WandB 連携パターン

```python
# fold: [0, 1, 2, 3, 4]
for fold in cfg.exp.fold:
    with wandb.init(
        project=os.environ.get("WANDB_PROJECT", "my-project"),
        group=cfg.exp.name,
        name=f"{cfg.exp.name}/fold{fold}",
        config=OmegaConf.to_container(cfg.exp, resolve=True),  # type: ignore
        mode="disabled" if cfg.exp.debug else "online",
    ):
        train_fold(cfg, fold)
        ...
```

## Jupyter から呼ぶ

```python
from hydra import compose, initialize

with initialize(version_base=None, config_path="./experiments/001-baseline"):
    cfg = compose(
        config_name="config.yaml",  # .yaml をつける
        overrides=["exp.name=foo"],
    )
```

## Examples

### 新規実験ディレクトリの作成

User: 「新しい実験 002-larger-model を始めたい」

1. ディレクトリ作成: `mkdir -p experiments/002-larger-model/exp`
2. 前の実験から `config.yaml` と `train.py` をコピー
3. train.py の dataclass を調整
4. `exp/001.yaml` を作成してパラメータ設定
5. `uv run python train.py --cfg job exp=001` で設定確認
6. `uv run python train.py exp=001` で実行

### 既存実験に新しいパラメータセットを追加

User: 「learning rate を変えて試したい」

1. `exp/002.yaml` を作成:
   ```yaml
   defaults:
   - default@_here_

   name: "002-smaller-lr"
   learning_rate: 1e-5
   ```
2. `uv run python train.py exp=002` で実行

### 別環境で同じ実験を実行

User: 「ローカルで同じ実験を動かしたい」

1. `env/local.yaml` を作成:
   ```yaml
   defaults:
   - default@_here_

   base_model: "Qwen/Qwen3-4B-Instruct-2507"
   model_output_dir: "output/002-larger-model"
   ```
2. config.yaml の defaults で `env: local` に変更、または:
   ```bash
   uv run python train.py exp=001 env=local
   ```

## Troubleshooting

- **Could not load exp/001** → ファイルパス確認、`config_path` 確認
- **MissingMandatoryValue** → dataclass にデフォルト値を設定
- **値が上書きされない** → `defaults` の `_self_` の位置を確認
- **リスト値エラー** → `"exp.fold=[0,1,2]"` と引用符で囲む
- **Jupyter で二重初期化** → `GlobalHydra.instance().clear()` してから `initialize`

## Tips

### @_here_ の意味

```yaml
defaults:
- default@_here_   # default の内容をこの階層にマージ
```

### Hydra config dataclass の制限

- OmegaConf が DictConfig に変換するためメソッドは失われる
- Union 型 (`str | list[str]`) は OmegaConf がサポートしない
