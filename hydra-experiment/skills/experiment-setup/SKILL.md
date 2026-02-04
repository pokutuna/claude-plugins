---
name: experiment-setup
description: |
  Hydra を使った機械学習実験のパラメータ管理と実行方法をガイドする。
  Use when user mentions "hydra", "実験管理", "config.yaml", "exp/*.yaml",
  or asks about ML experiment configuration management.
metadata:
  author: pokutuna
  version: 0.1.0
compatibility: requires hydra-core, omegaconf
---

# Hydra 実験管理ガイド

Hydra によるパラメータ管理と実験実行のパターン。

## ディレクトリ構造

```
(repository root)
├── experiments/
│   ├── 001-baseline/       # 実験ディレクトリ
│   │   ├── config.yaml
│   │   ├── exp/
│   │   │   ├── 001.yaml    # パラメータオーバーライド
│   │   │   └── 002.yaml
│   │   └── train.py
│   ├── 002-larger-model/   # 別のアプローチ
│   │   ├── config.yaml
│   │   ├── exp/
│   │   └── train.py        # 訓練コードも変わりうる
│   └── ...
├── input/                  # 入力データ
└── output/                 # 実験出力
```

実験ごとに train.py を分離できるため、モデル構造やアプローチが異なる実験を並行して管理できる。

## 設定の階層構造

```
Config
└── exp: ExpConfig          # 実験固有
    ├── name, seed, ...
    └── train: TrainConfig  # ハイパーパラメータ
```

## 1. プロジェクトルートの解決

環境変数 `PROJECT_ROOT` で解決。未設定時はスクリプト位置から自動判定:

```python
import os
from pathlib import Path

PROJECT_ROOT = Path(os.environ.get(
    "PROJECT_ROOT",
    Path(__file__).parent.parent  # experiments/001-xxx/train.py → project root
))

input_dir = PROJECT_ROOT / "input"
output_dir = PROJECT_ROOT / "output"
```

リモート環境 (Runpod 等) では起動時に設定:
```bash
export PROJECT_ROOT=/workspace/project
```

## 2. 実験設定クラス

`train.py` 内:

```python
from dataclasses import dataclass, field
from hydra.core.config_store import ConfigStore

@dataclass
class TrainConfig:
    base_model: str = "model-name"
    epoch: int = 3
    batch_size: int = 32
    learning_rate: float = 5e-5

@dataclass
class ExpConfig:
    name: str = "default"
    fold: list[int] = field(default_factory=lambda: [0, 1, 2, 3, 4])
    seed: int = 42
    debug: bool = False
    mode: str = "cv"  # cv or sub
    train: TrainConfig = field(default_factory=TrainConfig)

@dataclass
class Config:
    exp: ExpConfig
    show_config: bool = False

cs = ConfigStore.instance()
cs.store(name="default", group="exp", node=ExpConfig)
```

## 3. config.yaml (ベース設定)

`experiments/001-baseline/config.yaml`:

```yaml
defaults:
- _self_
- exp: default

exp:
  name: baseline
  fold: [0]  # 試行錯誤時は 1 fold
  seed: 1209
  debug: false
  mode: cv

show_config: false

hydra:
  output_subdir: null  # .hydra/ を作らない
  job:
    chdir: false       # cwd を変えない
  run:
    dir: .
```

## 4. 実験オーバーライド

`experiments/001-baseline/exp/001.yaml`:

```yaml
defaults:
- default@_here_

name: "001-larger-lr"

train:
  epoch: 5
  learning_rate: 1e-4
  batch_size: 16
```

変更したいパラメータのみ記述。他はデフォルトを継承。

## 5. エントリーポイント

```python
@hydra.main(version_base=None, config_path=".", config_name="config")
def main(cfg: Config) -> None:
    if cfg.show_config:
        print(OmegaConf.to_yaml(cfg))
        return
    # 実験実行...

if __name__ == "__main__":
    main()
```

## 実行方法

```bash
uv run python train.py                    # ベース設定で実行
uv run python train.py show_config=true   # 設定確認のみ
uv run python train.py exp=001            # exp/001.yaml を使用
uv run python train.py exp=001 exp.fold=[0,1,2,3,4]  # オーバーライド
uv run python train.py exp=001 exp.debug=true        # デバッグモード
```

## WandB 連携パターン

```python
with wandb.init(
    project=os.environ.get("WANDB_PROJECT", "my-project"),
    group=exp_name,
    name=f"{exp_name}/fold{fold}",
    config=OmegaConf.to_container(cfg.exp, resolve=True),
    mode="disabled" if cfg.exp.debug else "online",
):
    # 訓練...
```

## Jupyter から呼ぶ

```python
from hydra import compose, initialize

with initialize(version_base=None, config_path="./experiments/001-baseline"):
    cfg = compose(
        config_name="config.yaml",  # .yaml をつける
        overrides=["exp.name=foo", "exp.fold=[0]"],
    )
```

## Examples

### 新規実験ディレクトリの作成

User: 「新しい実験 002-larger-model を始めたい」

1. ディレクトリ作成: `mkdir -p experiments/002-larger-model/exp`
2. `config.yaml` を 001 からコピーして `exp.name` を変更
3. `exp/001.yaml` を作成してパラメータ設定
4. `uv run python train.py exp=001` で実行

### 既存実験に新しいパラメータセットを追加

User: 「learning rate を変えて試したい」

1. `exp/002.yaml` を作成:
   ```yaml
   defaults:
   - default@_here_

   name: "002-smaller-lr"

   train:
     learning_rate: 1e-5
   ```
2. `uv run python train.py exp=002` で実行

### 本番モードで全データ訓練

User: 「CV 終わったので全データで訓練したい」

```bash
uv run python train.py exp=001 exp.mode=sub
```

## Troubleshooting

- **Could not load exp/001** → ファイルパス確認、`config_path` 確認
- **MissingMandatoryValue** → dataclass にデフォルト値を設定
- **値が上書きされない** → `defaults` の `_self_` の位置を確認
- **リスト値エラー** → `"exp.fold=[0,1,2]"` と引用符で囲む
- **Jupyter で二重初期化** → `GlobalHydra.instance().clear()` してから `initialize`

## Tips

### defaults の書き方

```yaml
defaults:
- _self_           # このファイルの値を最後に適用
- exp: default     # exp/default.yaml または ConfigStore
```

### @_here_ の意味

```yaml
defaults:
- default@_here_   # default の内容をこの階層にマージ
```

### dataclass の制限

- メソッドを生やせない (設定値から Path を返す等は不可)
- Union 型 (`str | list[str]`) は使えない
