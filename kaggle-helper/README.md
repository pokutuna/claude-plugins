# kaggle-helper

Kaggle のコンペティションリサーチを支援する Claude Code プラグイン。

## Skills

| Skill | Description |
|-------|-------------|
| `meta-kaggle` | kaggle/meta-kaggle データセットをダウンロードし、コンペ別にディスカッションを検索・分析 |
| `discussion-updates` | 開催中のコンペで最近投稿・コメントのあった discussion を一覧し、未取得・更新ありのものを選んで取り込む |

## Commands

| Command | Description |
|---------|-------------|
| `/kaggle-discussion` | Kaggle discussion を取得・分析し、レポートを出力 |
| `/kaggle-notebook` | Kaggle notebook とコメントを取得・分析し、レポートを出力 |

出力先は、コマンドを実行したリポジトリの `kaggle/` 以下。

```
kaggle/
  discussions/<ID>_<タイトル>.md   # discussion の分析レポート
  notebooks/<USER>__<FILENAME>/
    <FILENAME>.ipynb               # 取得した notebook
    comments.md                    # 取得したコメント
    analysis.md                    # 分析レポート
```

## Prerequisites

- kaggle CLI (`pip install kaggle`) - 認証済み
- playwright-cli - discussion の一覧とページ、notebook のコメントの取得に使用
- jq - playwright-cli の出力のデコードに使用
- uv - Python スクリプト実行 (meta-kaggle skill)

## Installation

```
/plugin install kaggle-helper@pokutuna-plugins
```
