---
name: discussion-updates
description: 開催中のコンペで最近投稿・コメントのあった Kaggle discussion を一覧し、未取得のものと更新のあったものを選んで取り込む。"discussion の更新を確認", "最近の discussion を取り込む" などで起動。
compatibility: playwright-cli と jq が必要
argument-hint: "[competition-slug] [YYYY-MM-DD]"
allowed-tools:
  - "Bash(playwright-cli *)"
  - "Bash(jq *)"
  - "Bash(sed *)"
  - "Bash(ls *)"
  - "Bash(date *)"
  - Read
  - Write
  - Edit
user-invocable: true
---

# discussion-updates Skill

コンペの discussion 一覧から、指定日以降に投稿またはコメントのあったトピックを取得する。
`kaggle/discussions/` の取り込み済みファイルと比べ、未取得のものと更新のあったものを選んで取り込む。

終了済みのコンペで過去の discussion を検索するときは、`meta-kaggle` skill を使う。

引数: $ARGUMENTS

- コンペの slug: 引数に無ければ、リポジトリの CLAUDE.md、README、`kaggle/discussions/` の既存ファイルの `URL:` 行の順に `kaggle.com/competitions/<slug>` の形の URL を探し、最初に見つかったものを使う。見つからなければユーザーに尋ねる
- 日付 (`YYYY-MM-DD`): この日以降に活動のあったトピックを対象にする。引数に無ければ 7 日前とする。年の無い日付は、今日以前で最も近い日付と解釈する

日付はすべてローカル時刻で扱う。スクリプトは引数の日付をローカル時刻の 0 時と解釈する。
表やファイルに書く日付も、UTC の時刻をローカル時刻に直した日付にする。

## Instructions

### Step 1: 一覧を取得する

URL の `#since=` に日付を付けてページを開き、スクリプトを実行する。

```bash
playwright-cli open "https://www.kaggle.com/competitions/<slug>/discussion#since=<YYYY-MM-DD>"
playwright-cli run-code --filename=${CLAUDE_PLUGIN_ROOT}/skills/discussion-updates/scripts/list-discussions.mjs 2>&1 | sed -n '2p' | jq -r '.' | jq '.'
playwright-cli close
```

playwright-cli は作業ディレクトリに `.playwright-cli/` (ログ) を作る。成果物ではないので、削除せずに残し、コミットにも含めない。

スクリプトは最終活動の新しい順にページを送り、日付より古いトピックだけのページに達したら止まる。出力は次の JSON である。

```json
{
  "slug": "<slug>",
  "since": "2026-11-11T15:00:00.000Z",
  "truncated": false,
  "topics": [
    {
      "id": 756934,
      "title": "...",
      "url": "https://www.kaggle.com/competitions/<slug>/discussion/756934",
      "votes": 12,
      "comments": 8,
      "activity": "comment",
      "activityAt": "2026-11-15T14:24:28.000Z",
      "pinned": false
    }
  ]
}
```

- `activity`: 最終活動の種類。`posted` はコメントの無い新規投稿、`comment` は最後のコメント
- `since`: 引数の日付 (ローカル時刻の 0 時) を UTC で表した時刻
- `activityAt`: 最終活動の時刻 (UTC)
- `pinned`: ピン留めされたトピックかどうか。ピン留めのトピックも、他のトピックと同じ基準で選ぶ
- `truncated`: `true` のときは 10 ページ (200 件) で打ち切っている。日付を新しくして実行し直す

### Step 2: 取り込み済みのファイルと比べる

`kaggle/discussions/` には、トピックごとに `<id>_<タイトル>/` のディレクトリがあり、取得した内容が `discussion.md` に入っている。
取得した内容を残していなかった頃の、`<id>_<タイトル>.md` (分析だけのファイル) が残っていることもある。
一覧を取り、トピックの `id` で始まるディレクトリの `discussion.md`、それが無ければ `id` で始まる `.md` ファイルの更新時刻を、`activityAt` と比べる。
ディレクトリが無いと `ls` は失敗する。これは正常で、すべてのトピックが未取得である。

```bash
ls kaggle/discussions/
date -u -r kaggle/discussions/<id>_<タイトル>/discussion.md +%Y-%m-%dT%H:%M:%SZ
```

- **未取得**: ディレクトリもファイルも無い
- **更新あり**: 比べたファイルの更新時刻が `activityAt` より古い
- **取り込み済み**: 比べたファイルの更新時刻が `activityAt` 以降

状態はファイルの更新時刻だけで決める。ファイルの中身に書かれた日付は使わない。

### Step 3: 取り込むトピックを選ぶ

未取得と更新ありのトピックから、`votes` が 5 以上のものを選ぶ。

`votes` は、更新ありのトピックでも総数で比べる。基準に当てはまれば、内容が薄そうなトピックも取り込む。

タイトルから、コンペの主催者による告知、ルールやデータの変更、評価指標の不具合だと読み取れるトピックは、数に関係なく選ぶ。
ユーザーが基準や着目点を指定していれば、ここまでの基準の代わりに、その指定だけで選ぶ。

一覧のトピックをすべて、取り込み済みのものも含めて、最終活動の新しい順の表でユーザーに示す。
表を示したら、確認を待たずに Step 4 に進む。

```
| ID | 状態 | votes | comments | 最終活動 | タイトル | 取り込む |
|----|------|-------|----------|----------|----------|----------|
| 756934 | 未取得 | 12 | 8 | 2026-11-15 | ... | ○ |
| 751837 | 更新あり | 5 | 21 | 2026-11-14 | ... | ○ |
| 745660 | 取り込み済み | 40 | 33 | 2026-11-14 | ... | - |
| 756624 | 未取得 | 0 | 0 | 2026-11-13 | ... | - |
```

### Step 4: 取り込む

取り込みは、取得と分析の 2 段階で行う。

1. 選んだトピックの `url` をすべて引数にして、`kaggle-fetch` skill を 1 回だけ実行する。取得は Sonnet の subagent が行い、結果が返るまで待つ
2. 取得できたトピックのディレクトリ (`dir`) をすべて引数にして、`kaggle-analyze` skill を実行する。取得に失敗したトピックは分析しない

ユーザーが「取得だけ」と指定していれば、1 で止める。

最後に、次を 1 度だけ報告する。報告する内容はこれですべてである。

- 取り込んだトピックごとに、`analysis.md` のパスと要点 1 行。更新ありのトピックでは、今回追記した内容の要点を書く
- コメントの読み込みを打ち切ったトピック (`commentsTruncated`) と、読めた件数と一覧の `comments` の値
- 取得や分析に失敗したトピックと、その理由
- `kaggle-fetch` が `.gitignore` について依頼を返していれば、その依頼

## Examples

### 直近 1 週間の更新を取り込む

```
ユーザ: 最近の discussion を確認して取り込んで

手順:
1. slug をリポジトリから読み取り、7 日前の日付で一覧を取得する
2. kaggle/discussions/ のファイルと比べ、未取得・更新あり・取り込み済みに分ける
3. votes が 5 以上のものを選び、表で示す
4. 選んだトピックを kaggle-fetch でまとめて取得し、kaggle-analyze で分析して、要点を報告する
```

### 日付と基準を指定する

```
ユーザ: /discussion-updates 2026-11-01 votes 10 以上だけ

手順:
1. 2026-11-01 以降の一覧を取得する
2. 未取得と更新ありのうち、votes が 10 以上のものだけを選んで取り込む
```

## Troubleshooting

### Error: "not_competition_page"

原因: 開いているページがコンペのページではない。
対処: `https://www.kaggle.com/competitions/<slug>/discussion` を開いてから実行する。

### `topics` が空

原因: 日付以降に活動が無いか、一覧の DOM が変わってトピックを読み取れていない。
対処: 日付を古くして実行する。それでも空なら `playwright-cli snapshot` でページの構造を確かめる。

### 参加者だけが見られる discussion が出ない

原因: ログインしていないブラウザで開いている。
対処: `playwright-cli open` の代わりに `playwright-cli attach --extension` でログイン済みのブラウザに接続し、`playwright-cli goto <URL>` でページを開いてから実行する。
