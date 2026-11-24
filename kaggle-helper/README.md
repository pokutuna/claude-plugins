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

`kaggle-fetch` と `kaggle-analyze` は単独でも使える。`kaggle-updates` は一覧と選択だけを行い、取得と分析はそれぞれを 1 件ずつ実行したときと同じになる。`kaggle-analyze` に未取得のものを渡すと、先に `kaggle-fetch` で取得する。引数なしで実行すると、分析が済んでいないものをすべて分析する。

## 取り直したものの扱い

同じ notebook や discussion を何度も取り直す使い方を前提にしている。

- 「更新あり」になるのは、notebook は版が変わったとき、discussion はコメントが増えたときだけである。votes だけの変化では取り直さない
- 取り直すと、前回分析した取得からの差分が `changes.diff` に残る。分析はこの差分から始め、変わったところだけを `insights.md` に反映する。前回までの記述は残す
- 内容が変わっていないものと、分析に影響しない変化だけのものは、`insights.md` の `取得:` 行だけを書き換える
- `insights.md` の `取得:` 行は、どの取得まで分析したかの記録である。取得したファイルの `取得:` 行と違うものが、分析の対象になる

## 使い方

```
/kaggle-updates                            # 直近 7 日の更新を選んで取り込む
/kaggle-updates 2026-11-18 notebook 取得だけ
/kaggle-updates 2026-11-24T09:00           # 指定した日時以降の更新を取り込む
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
    changes.diff           # 前回分析した取得からの差分
  notebooks/<KERNEL ID>_<SLUG>/
    <SLUG>.ipynb           # notebook
    kernel-metadata.json   # kernel id とデータソース
    source.md              # 出力を除き、長い行とセルを切り詰めたコード
    comments.md            # コメント
    listing.json           # kaggle-updates の一覧で読んだ版、スコア、実行日時
    outputs/               # 実行の出力とログ。--outputs を付けたときだけ (git 管理外)
    insights.md            # 分析
    changes.diff           # 前回分析した取得からの差分
```

notebook のディレクトリは kernel id で探すので、作者がタイトルを変えて slug が変わっても、同じディレクトリに保存する。名前の slug は最初に取得したときのままである。

notebook の出力は、`kaggle-fetch` に `--outputs` を付けたとき (`kaggle-updates` では `出力も`) だけ、`kaggle kernels output` で取得する。同じ名前のファイルは上書きし、前回の実行にだけあったファイルは残る。

ページは、ログインしていないヘッドレスのブラウザで読む。参加者だけが見られる discussion などを取るときは、`--extension` を付けると、Playwright の拡張機能を通してユーザーの Chrome で読む。

## Prerequisites

- kaggle CLI (`pip install kaggle`): 認証済みであること
- playwright-cli: 一覧、discussion のページ、notebook のコメントの取得に使う
- uv: Python スクリプトの実行に使う

## Installation

```
/plugin install kaggle-helper@pokutuna-plugins
```
