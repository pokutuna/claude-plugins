---
name: kaggle-analyze
description: kaggle-fetch で取得した Kaggle の discussion と notebook を分析し、analysis.md を書く。"discussion を分析", "notebook を分析", "取り込んだものを分析", "kaggle-analyze" などで起動。
argument-hint: "[discussion URL | notebook URL | user/slug | kaggle/ 以下のディレクトリ] ..."
allowed-tools:
  - "Bash(uv run *)"
  - "Bash(ls *)"
  - "Bash(rg *)"
  - Read
  - Write
  - Edit
user-invocable: true
---

# kaggle-analyze Skill

`kaggle-fetch` skill が保存した discussion と notebook を読み、分析結果を `analysis.md` に書く。分析はこのセッションのモデルで行う。

引数: $ARGUMENTS

## Instructions

### Step 1: 対象を決める

引数があれば、それぞれをリポジトリの `kaggle/` 以下のディレクトリに対応させる。

- discussion の URL: `kaggle/discussions/<id>_*/` (ID で始まるディレクトリ)
- notebook の URL か `<user>/<slug>`: `kaggle/notebooks/*/kernel-metadata.json` の `"id"` が `<user>/<slug>` のディレクトリ。無ければ `kaggle/notebooks/<user>__<slug>/`
- ディレクトリ: そのまま使う

取得した内容 (discussion は `discussion.md`、notebook は `source.md`) が無いものは、先に `kaggle-fetch` skill で取得する。取得してから分析する。

引数が無ければ、分析が無いか、取得より古いものをすべて対象にする。

```bash
uv run ${CLAUDE_PLUGIN_ROOT}/skills/kaggle-analyze/scripts/pending.py
```

出力は 1 件ごとに 1 行の JSON (`{"type": "notebook", "dir": "...", "analysis": "missing"}`) である。対象が無ければ、その旨を伝えて終える。

### Step 2: 分析する

分析の手順と、`analysis.md` のテンプレートは、種類ごとに次のファイルにある。

- discussion: `${CLAUDE_PLUGIN_ROOT}/skills/kaggle-analyze/references/discussion.md`
- notebook: `${CLAUDE_PLUGIN_ROOT}/skills/kaggle-analyze/references/notebook.md`

**対象が 1 件**のときは、そのファイルを読み、自分で分析して `analysis.md` を書く。

**対象が 2 件以上**のときは、1 件ごとに Agent ツールで subagent を起動し、並列に分析させる。

- `subagent_type` は `general-purpose` にし、`model` は指定しない。このセッションのモデルが使われる
- 同時に起動するのは 5 件までにする。それより多ければ、終わった分から次を起動する
- プロンプトは次の文面をそのまま使い、`<種類>`、`<手順のファイル>`、`<ディレクトリ>` だけを埋める。空欄を残さない

```
Kaggle の <種類> を分析する。手順とテンプレートは <手順のファイル> にある。最初にそのファイルを読み、それに従うこと。
対象のディレクトリ: <リポジトリのルートの絶対パス>/<ディレクトリ>
ファイルは書かない。analysis.md に書く内容の全文を、最終応答として返すこと。応答には全文だけを書き、前置きや後書きを付けない。
```

subagent はファイルを書けない (harness が `.md` の Write を拒否することがある)。返ってきた全文を、このセッションが `<ディレクトリ>/analysis.md` に書く。

- 全文は書き換えずにそのまま書く
- 既存の `analysis.md` があれば、Write の前に Read する。全文には既存の内容を引き継いだものが入っている
- 全文が `URL:` で始まらないときは、分析に失敗している。書かずに、失敗として報告する

### Step 3: 報告する

分析した件ごとに、`analysis.md` のパスと要点 1 行を報告する。既存の分析を更新した件では、今回追記した内容の要点を書く。失敗した件があれば、その理由も書く。

## Examples

### 取得済みで分析がまだのものをまとめて分析する

```
ユーザ: 取り込んだものを分析して

手順:
1. pending.py で、分析が無いか古いディレクトリを列挙する
2. 1 件ずつ subagent を起動し、返ってきた全文を analysis.md に書く
3. パスと要点を報告する
```

### 1 件を取得から分析まで行う

```
ユーザ: /kaggle-analyze https://www.kaggle.com/code/ozertuu/santa-2026-starter-notebook

手順:
1. kaggle/notebooks/ozertuu__santa-2026-starter-notebook/source.md が無いので、kaggle-fetch で取得する
2. references/notebook.md に従って自分で分析し、analysis.md を書く
```
