# kaggle-helper

Kaggle のコンペティションリサーチを支援する Claude Code プラグイン。

## Skills

| Skill | Description |
|-------|-------------|
| `kaggle-fetch` | discussion と notebook を取得して保存する。分析はしない。Sonnet の subagent で動く |
| `kaggle-analyze` | 取得済みの discussion と notebook を分析し、`analysis.md` を書く。このセッションのモデルで動き、複数件は subagent で並列に分析する |
| `kaggle-updates` | 開催中のコンペで最近更新された discussion と notebook を一覧し、未取得・更新ありのものを件数の基準で選んで取得と分析を行う |
| `meta-kaggle` | kaggle/meta-kaggle データセットをダウンロードし、コンペ別にディスカッションを検索・分析 |

`kaggle-analyze` は、取得していないものを渡されると、先に `kaggle-fetch` で取得する。

`kaggle-updates` は、期間内に活動のあったもののうち未取得と更新ありのものから、次の基準で選ぶ。

1. 候補が 10 件以下なら、すべて
2. 11 件以上なら上位 10 件。discussion は votes 順、notebook は公開スコア上位と votes 上位を半分ずつ
3. そのコンペで votes が 20 位のものの votes 以上の候補は、10 件を超えても加える (上限 30 件)

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
    listing.json                   # kaggle-updates で取得したときの一覧のスコアなど
    outputs/                       # 最新の実行の出力 (指定したときと、分析に必要なときだけ。git 管理外)
    analysis.md                    # 分析
```

notebook の出力は、`kaggle-fetch` に `--outputs` を付けたときと、分析で出力を確かめる必要があったときだけ取得する。合計 100MB を超えるぶんは、ユーザーが求めたとき (`--outputs-all`) だけ取得する。`outputs/` は、中に置く `.gitignore` で git の管理外になる。

以前の形式の `discussions/<ID>_<タイトル>.md` は、その discussion を次に取得するときに `<ID>_<タイトル>/analysis.md` へ移す。

## Prerequisites

- kaggle CLI (`pip install kaggle`) - 認証済み
- playwright-cli - discussion と notebook の一覧、discussion のページ、notebook のコメントの取得に使用
- uv - Python スクリプト実行

## Installation

```
/plugin install kaggle-helper@pokutuna-plugins
```
