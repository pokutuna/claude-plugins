---
name: kaggle-analyze
description: kaggle-fetch で取得した Kaggle の discussion と notebook を分析し、insights.md を書く。取り直したものは、前回の分析からの差分だけを反映する。"discussion を分析", "notebook を分析", "取り込んだものを分析", "kaggle-analyze" などで起動。
argument-hint: "[discussion URL | notebook URL | user/slug | kaggle/ 以下のディレクトリ] ..."
allowed-tools:
  - "Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/kaggle-analyze/scripts/pending.py *)"
  - "Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/kaggle-analyze/scripts/pending.py)"
  - Read
  - Write
  - Edit
user-invocable: true
---

# kaggle-analyze Skill

`kaggle-fetch` skill が保存した discussion と notebook を読み、分析結果を `insights.md` に書く。分析はこのセッションのモデルで行う。

引数: $ARGUMENTS

`insights.md` の `取得:` 行は、どの取得まで分析したかの記録である。取得したファイル (discussion は `discussion.md`、notebook は `source.md`) の `取得:` 行と同じなら、分析は済んでいる。
取り直したものは、`kaggle-fetch` が前回分析した取得からの差分を `changes.diff` に残す。分析ではそれを読み、変わったところだけを `insights.md` に反映する。

## Instructions

### Step 1: 対象を決める

引数をすべて渡して、次を実行する。引数が無ければ、引数なしで実行する。

```bash
uv run ${CLAUDE_PLUGIN_ROOT}/skills/kaggle-analyze/scripts/pending.py [引数...]
```

引数が無いときは、`kaggle/` 以下の取得済みのもののうち、分析が済んでいないものだけが出る。出力は 1 件ごとに 1 行の JSON である。

```json
{"target": "...", "dir": "kaggle/notebooks/145952068_santa-2026-starter-notebook", "kind": "notebook", "mode": "diff", "changes": 42, "insightsBytes": 9120}
```

`mode` ごとに次のように扱う。

- `new`: `insights.md` が無い。分析する
- `diff`: `changes.diff` (`changes` 行) に前回の分析からの差分がある。分析する
- `full`: `insights.md` が古いが、差分の基準が分からない。分析する
- `unchanged`: 取り直したが、内容は変わっていなかった。スクリプトが `insights.md` の `取得:` 行 (notebook は `公開スコア:` 行も) を書き換え済み。分析しない
- `done`: 分析は済んでいる。分析しない
- `invalid`: `insights.md` が `URL:` で始まらない。分析せず、報告する
- `unfetched`: 取得したものが無い。先に `kaggle-fetch` skill で取得し、取得できたら同じ引数で Step 1 をやり直す

分析するものが無ければ、その旨と `unchanged` の件数を伝えて終える。

### Step 2: 分析する

分析の手順と、`insights.md` のテンプレートは、種類ごとに次のファイルにある。既存の `insights.md` の直し方もここにある。

- discussion: `${CLAUDE_PLUGIN_ROOT}/skills/kaggle-analyze/references/discussion.md`
- notebook: `${CLAUDE_PLUGIN_ROOT}/skills/kaggle-analyze/references/notebook.md`

対象が 1 件のときは、そのファイルを読み、自分で分析して `insights.md` を書く。

対象が 2 件以上のときは、1 件ごとに Agent ツールで subagent を起動し、並列に分析させる。subagent は自分で `insights.md` を書き、要点 1 行だけを返す。

- `subagent_type` は `general-purpose` にし、`model` は指定しない。このセッションのモデルが使われる
- 同時に起動するのは 5 件までにする。それより多ければ、終わった分から次を起動する
- 途中で、1 件ごとの報告やファイルの確認をしない。完了の通知を待つだけにし、ScheduleWakeup などで待ち合わせを仕掛けない
- プロンプトは次の文面をそのまま使い、`<種類>`、`<手順のファイル>`、`<ディレクトリ>` を埋める。空欄を残さない

```
Kaggle の <種類> を分析し、結果を insights.md に書く。手順とテンプレートは <手順のファイル> にある。最初にそのファイルを読み、それに従うこと。
対象のディレクトリ: <リポジトリのルートの絶対パス>/<ディレクトリ>
書き終えたら、要点 1 行だけを最終応答として返すこと。既存の insights.md を直したときは、今回の変化の要点を書く。変化が分析に影響せず、取得: の行だけを書き換えたときは、そう書く。書けなかったときは、その理由を返す。
```

### Step 3: 確かめて報告する

全件が終わったら、Step 2 で分析したディレクトリをすべて引数にして、`pending.py` を 1 回だけ実行する。`mode` が `done` でないものは、分析に失敗している。

次を 1 度だけ報告する。報告する内容はこれですべてである。

- 分析した件ごとに、`insights.md` のパスと要点 1 行
- `unchanged` だった件数
- 失敗した件とその理由 (Step 3 で `done` にならなかったもの、`invalid` だったもの)

## Examples

### 取得済みで分析がまだのものをまとめて分析する

```
ユーザ: 取り込んだものを分析して

手順:
1. 引数なしで pending.py を実行し、分析が済んでいないものを出す
2. new、diff、full のものを 1 件ずつ subagent で分析させる。diff のものは changes.diff から読ませる
3. 分析したディレクトリで pending.py を実行して確かめ、要点を報告する
```

### 1 件を取得から分析まで行う

```
ユーザ: /kaggle-analyze https://www.kaggle.com/code/ozertuu/santa-2026-starter-notebook

手順:
1. pending.py が unfetched を返すので、kaggle-fetch で取得し、pending.py をやり直す
2. new なので、references/notebook.md に従って自分で分析し、insights.md を書く
```
