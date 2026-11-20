# kaggle-helper

Kaggle のコンペの discussion と公開 notebook を取り込み、分析を `insights.md` に残す Claude Code プラグイン。

## Skills

| Skill | やること | 書くもの |
|-------|----------|----------|
| `kaggle-fetch` | 指定した discussion と notebook を取得して保存する。分析はしない。Sonnet の subagent で動く | `kaggle/` 以下の取得したファイル |
| `kaggle-analyze` | 取得したファイルを読んで分析する。このセッションのモデルで動き、2 件以上なら 1 件ずつ subagent で並列に分析する | `insights.md` |
| `kaggle-updates` | 開催中のコンペで最近更新されたものを一覧し、未取得と更新ありのものを選んで、`kaggle-fetch` と `kaggle-analyze` を順に呼ぶ | (呼んだ skill が書く) |
| `meta-kaggle` | 終了済みのコンペの discussion とチームの情報を、Meta Kaggle のデータセットから検索する | `~/.meta-kaggle/` のデータ |

```
kaggle-updates ── 一覧して選ぶ
   │
   ├─> kaggle-fetch ──── 取得する ──> discussion.md, source.md など
   │
   └─> kaggle-analyze ── 分析する ──> insights.md
```

`kaggle-fetch` と `kaggle-analyze` は単独でも使える。`kaggle-analyze` に未取得のものを渡すと、先に `kaggle-fetch` で取得する。引数なしで実行すると、`insights.md` が無いもの、または取得し直した後に分析していないものをすべて分析する。

## 使い方

```
/kaggle-updates                            # 直近 7 日の更新を選んで取り込む
/kaggle-updates 2026-11-18 notebook 取得だけ
/kaggle-fetch https://www.kaggle.com/code/<user>/<slug>
/kaggle-analyze                            # 未分析のものをまとめて分析する
/meta-kaggle                               # 終了済みのコンペの上位解法を調べる
```

`kaggle-updates` は、候補が 10 件を超えると上位 10 件を選ぶ。discussion は votes 順に選び、notebook は公開スコア上位と votes 上位から交互に選ぶ。votes がそのコンペの 20 位以上のものは、10 件を超えても加える (上限 30 件)。

## 保存先

実行したリポジトリの `kaggle/` 以下に保存する。

```
kaggle/
  discussions/<ID>_<タイトル>/
    discussion.md          # 本文とコメント
    insights.md            # 分析
  notebooks/<USER>__<SLUG>/
    <SLUG>.ipynb           # notebook
    kernel-metadata.json   # kernel id とデータソース
    source.md              # 出力を除き、長い行とセルを切り詰めたコード
    comments.md            # コメント
    listing.json           # kaggle-updates の一覧で読んだスコアと実行日時
    outputs/               # 最新の実行の出力 (git 管理外)
    insights.md            # 分析
```

notebook の出力は、`--outputs` を付けたときと、分析で出力を確かめる必要があったときだけ取得する。合計 100MB を超えるぶんは、`--outputs-all` を付けたときだけ取得する。

旧形式の分析ファイル `discussions/<ID>_<タイトル>.md` は、その discussion を次に取得するときに `<ID>_<タイトル>/insights.md` へ移す。

## Prerequisites

- kaggle CLI (`pip install kaggle`): 認証済みであること
- playwright-cli: 一覧、discussion のページ、notebook のコメントの取得に使う
- uv: Python スクリプトの実行に使う

## Installation

```
/plugin install kaggle-helper@pokutuna-plugins
```
