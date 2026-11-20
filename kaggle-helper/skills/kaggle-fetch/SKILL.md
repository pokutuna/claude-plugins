---
name: kaggle-fetch
description: Kaggle の discussion と公開 notebook を取得し、リポジトリの kaggle/ 以下に保存する。分析はしない。"discussion を取得", "notebook を取り込む", "kaggle-fetch" などで起動。
compatibility: uv、kaggle CLI (認証済み)、playwright-cli が必要
argument-hint: "<discussion URL | notebook URL | user/slug> ..."
context: fork
model: sonnet
allowed-tools:
  - "Bash(uv run *)"
  - "Bash(cat .gitignore)"
user-invocable: true
---

# kaggle-fetch Skill

引数の discussion と notebook を取得し、取得した内容をそのままファイルに保存する。内容の分析や要約はしない。分析は `kaggle-analyze` skill が行う。

引数: $ARGUMENTS

引数には、次の形式のものを 1 つ以上、空白で区切って渡す。

- discussion: `https://www.kaggle.com/competitions/<slug>/discussion/<id>`
- notebook: `https://www.kaggle.com/code/<user>/<slug>` (末尾の `/comments` などは無視される) か `<user>/<slug>`

引数が無いか、どの形式にも当てはまらないものがあれば、取得せずにその旨を返す。

## Instructions

### Step 1: 取得する

引数をすべて、1 回のコマンドで渡す。

```bash
uv run ${CLAUDE_PLUGIN_ROOT}/skills/kaggle-fetch/scripts/fetch.py <引数をすべて>
```

スクリプトは、playwright-cli のセッションを分けて最大 4 件を並列に取得する。保存先はリポジトリのルート (git の作業ツリーのルート) の `kaggle/` 以下である。

- discussion: `kaggle/discussions/<id>_<タイトル>/discussion.md`
  - 旧形式の `kaggle/discussions/<id>_<タイトル>.md` (分析だけのファイル) があれば、そのディレクトリの `analysis.md` に移す
- notebook: `kaggle/notebooks/<user>__<slug>/`
  - `kaggle kernels pull -m` で取得したコードのファイルと `kernel-metadata.json`
  - `comments.md`: コメントページの内容
  - `source.md`: 出力を除き、長い行とセルを切り詰めたコード。分析ではこれを読む
  - 同じ kernel id (`kernel-metadata.json` の `id_no`) のディレクトリがあれば、slug が変わっていてもそこに保存する

出力は 1 件ごとに 1 行の JSON である。

```json
{"type": "discussion", "id": 760095, "dir": "kaggle/discussions/760095_...", "movedLegacy": null, "comments": 1, "commentsTruncated": false}
{"type": "notebook", "ref": "user/slug", "id_no": 145952068, "dir": "kaggle/notebooks/user__slug", "slugChanged": false, "comments": 0, "commentsTruncated": false}
{"target": "https://example.com/x", "error": "..."}
```

- `commentsTruncated`: コメントが 300 件を超えたため読み込みを打ち切った。`comments` は読み込めた件数
- `error`: その 1 件は取得できていない。他の件は取得できている

取得したファイルは書き換えない。失敗した件を、別の方法 (snapshot や innerText) で取得して補ったり、代わりの内容をファイルに書いたりしない。

### Step 2: 結果を返す

次を返す。報告する内容はこれですべてである。

- 取得できた件ごとに、`dir` と、コメントの件数
- `movedLegacy`、`slugChanged`、`commentsTruncated` があった件
- 失敗した件と `error` の内容。原因の見当がつけば添える (Troubleshooting を参照)
- リポジトリの `.gitignore` に `.playwright-cli/` が無いとき (`.gitignore` が無いときも含む) は、追加の依頼。playwright-cli が作業ディレクトリに作るログで、成果物ではない。`.gitignore` は自分では作らず、書き換えない

## Examples

### discussion と notebook をまとめて取得する

```
ユーザ: /kaggle-fetch https://www.kaggle.com/competitions/santa-2026/discussion/760095 ozertuu/santa-2026-starter-notebook

手順:
1. 2 件を 1 回のコマンドで fetch.py に渡す
2. 保存先とコメントの件数を返す
```

## Troubleshooting

### `kaggle kernels pull failed: ... 404`

原因: notebook が削除されたか、slug が変わった。作者がタイトルを変えると slug も変わる。
対処: Code タブで現在の URL を確かめ、新しい slug で取得する。同じ kernel id の既存ディレクトリがあれば、そこに保存される。

### `extract failed: ... TimeoutError`

原因: ページの読み込みが遅いか、DOM が変わってスクリプトが要素を見つけられない。
対処: もう一度実行する。続けて失敗するなら、失敗したことをそのまま返す。

### 参加者だけが見られる discussion が取れない

原因: スクリプトは、ログインしていないブラウザで開く。
対処: 取得できなかったことを返し、ログインが必要な可能性を添える。
