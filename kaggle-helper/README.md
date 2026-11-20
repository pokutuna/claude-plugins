# kaggle-helper

Kaggle のコンペティションリサーチを支援する Claude Code プラグイン。

## Skills

| Skill | Description |
|-------|-------------|
| `kaggle-fetch` | discussion と notebook を取得して保存する。分析はしない。Sonnet の subagent で動く |
| `kaggle-analyze` | 取得済みの discussion と notebook を分析し、`analysis.md` を書く。このセッションのモデルで動き、複数件は subagent で並列に分析する |
| `discussion-updates` | 開催中のコンペで最近投稿・コメントのあった discussion を一覧し、未取得・更新ありのものを選んで取得と分析を行う |
| `meta-kaggle` | kaggle/meta-kaggle データセットをダウンロードし、コンペ別にディスカッションを検索・分析 |

`kaggle-analyze` は、取得していないものを渡されると、先に `kaggle-fetch` で取得する。

出力先は、実行したリポジトリの `kaggle/` 以下。

```
kaggle/
  discussions/<ID>_<タイトル>/
    discussion.md                  # 取得した本文とコメント
    analysis.md                    # 分析
  notebooks/<USER>__<SLUG>/
    <SLUG>.ipynb                   # 取得した notebook
    kernel-metadata.json           # kernel id とデータソース
    source.md                      # 出力を除き、長い行とセルを切り詰めたコード
    comments.md                    # 取得したコメント
    analysis.md                    # 分析
```

以前の形式の `discussions/<ID>_<タイトル>.md` は、その discussion を次に取得するときに `<ID>_<タイトル>/analysis.md` へ移す。

## Prerequisites

- kaggle CLI (`pip install kaggle`) - 認証済み
- playwright-cli - discussion の一覧とページ、notebook のコメントの取得に使用
- jq - playwright-cli の出力のデコードに使用 (discussion-updates)
- uv - Python スクリプト実行

## Installation

```
/plugin install kaggle-helper@pokutuna-plugins
```
