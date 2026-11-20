---
name: kaggle-analyze
description: kaggle-fetch で取得した Kaggle の discussion と notebook を分析し、insights.md を書く。"discussion を分析", "notebook を分析", "取り込んだものを分析", "kaggle-analyze" などで起動。
argument-hint: "[discussion URL | notebook URL | user/slug | kaggle/ 以下のディレクトリ] ..."
allowed-tools:
  - "Bash(ls *)"
  - "Bash(rg *)"
  - Read
  - Write
  - Edit
user-invocable: true
---

# kaggle-analyze Skill

`kaggle-fetch` skill が保存した discussion と notebook を読み、分析結果を `insights.md` に書く。分析はこのセッションのモデルで行う。

引数: $ARGUMENTS

## Instructions

### Step 1: 対象を決める

引数があれば、それぞれをリポジトリの `kaggle/` 以下のディレクトリに対応させる。

- discussion の URL: `kaggle/discussions/<id>_*/` (ID で始まるディレクトリ)
- notebook の URL か `<user>/<slug>`: `kaggle/notebooks/*/kernel-metadata.json` の `"id"` が `<user>/<slug>` のディレクトリ。無ければ `kaggle/notebooks/<user>__<slug>/`
- ディレクトリ: そのまま使う

取得した内容 (discussion は `discussion.md`、notebook は `source.md`) が無いものは、先に `kaggle-fetch` skill で取得する。取得してから分析する。

引数が無ければ、取得した内容 (`discussion.md` か `source.md`) があり、`insights.md` が無いディレクトリをすべて対象にする。リポジトリのルートで次を実行し、出力をディレクトリごとにまとめて判断する。対象が無ければ、その旨を伝えて終える。

```bash
rg --files --sort path --no-ignore -g discussion.md -g source.md -g insights.md kaggle
```

分析の後に取得し直したものは、`insights.md` があるので対象にならない。それを分析するときは、ディレクトリを引数に渡す。

### Step 2: 分析する

分析の手順と、`insights.md` のテンプレートは、種類ごとに次のファイルにある。

- discussion: `${CLAUDE_PLUGIN_ROOT}/skills/kaggle-analyze/references/discussion.md`
- notebook: `${CLAUDE_PLUGIN_ROOT}/skills/kaggle-analyze/references/notebook.md`

対象が 1 件のときは、そのファイルを読み、自分で分析して `insights.md` を書く。

対象が 2 件以上のときは、1 件ごとに Agent ツールで subagent を起動し、並列に分析させる。subagent は自分で `insights.md` を書き、パスと要点 1 行だけを返す。

- `subagent_type` は `general-purpose` にし、`model` は指定しない。このセッションのモデルが使われる
- 同時に起動するのは 5 件までにする。それより多ければ、終わった分から次を起動する
- プロンプトは次の文面をそのまま使い、`<種類>`、`<手順のファイル>`、`<ディレクトリ>` を埋める。空欄を残さない

```
Kaggle の <種類> を分析し、結果を insights.md に書く。手順とテンプレートは <手順のファイル> にある。最初にそのファイルを読み、それに従うこと。
対象のディレクトリ: <リポジトリのルートの絶対パス>/<ディレクトリ>
書き終えたら、insights.md のパスと要点 1 行だけを最終応答として返すこと。既存の insights.md を更新したときは、今回追記した内容の要点を書く。書けなかったときは、その理由を返す。
```

subagent が返したら、`<ディレクトリ>/insights.md` の 1 行目を Read で確かめる。ファイルが無いか、1 行目が `URL:` で始まらないときは、分析に失敗している。失敗として報告する。

### Step 3: 報告する

分析した件ごとに、`insights.md` のパスと要点 1 行を報告する。既存の分析を更新した件では、今回追記した内容の要点を書く。失敗した件があれば、その理由も書く。

## Examples

### 取得済みで分析がまだのものをまとめて分析する

```
ユーザ: 取り込んだものを分析して

手順:
1. rg で kaggle/ 以下の取得したファイルと insights.md を一覧し、insights.md が無いディレクトリを選ぶ
2. 1 件ずつ subagent を起動し、insights.md を書かせる
3. パスと要点を報告する
```

### 1 件を取得から分析まで行う

```
ユーザ: /kaggle-analyze https://www.kaggle.com/code/ozertuu/santa-2026-starter-notebook

手順:
1. kaggle/notebooks/ozertuu__santa-2026-starter-notebook/source.md が無いので、kaggle-fetch で取得する
2. references/notebook.md に従って自分で分析し、insights.md を書く
```
