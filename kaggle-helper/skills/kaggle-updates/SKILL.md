---
name: kaggle-updates
description: 開催中の Kaggle コンペで最近更新された discussion と公開 notebook を一覧し、未取得のものと更新のあったものを votes と公開スコアの順位で選んで、取得と分析を行う。"discussion の更新を確認", "最近の notebook を取り込む", "コンペの更新を取り込む", "kaggle-updates" などで起動。
compatibility: uv、kaggle CLI (認証済み)、playwright-cli が必要
argument-hint: "[competition-slug] [YYYY-MM-DD[THH:MM]] [discussion|notebook] [取得だけ|分析だけ] [出力も] [--extension] [選び方の指定]"
allowed-tools:
  - "Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/kaggle-updates/scripts/list.py *)"
  - "Bash(playwright-cli *)"
  - "Bash(rg *)"
  - Read
  - Skill
user-invocable: true
---

# kaggle-updates Skill

コンペの discussion と公開 notebook のうち、指定した日時以降に活動のあったものを一覧する。
`kaggle/` の取り込み済みのものと比べ、未取得のものと更新のあったものから選んで、`kaggle-fetch` skill で取得し、`kaggle-analyze` skill で分析する。
この skill が行うのは一覧と選択だけで、取得と分析は、それぞれの skill を 1 件ずつ実行したときと同じになる。

終了済みのコンペで過去の discussion を検索するときは、`meta-kaggle` skill を使う。

引数: $ARGUMENTS

- コンペの slug: 引数に無ければ、リポジトリの CLAUDE.md、README、`kaggle/discussions/` の既存ファイルの `URL:` 行の順に `kaggle.com/competitions/<slug>` の形の URL を探し、最初に見つかったものを使う。見つからなければユーザーに尋ねる
- 日時 (`YYYY-MM-DD` か `YYYY-MM-DDTHH:MM`): この日時以降に活動のあったものを対象にする。引数に無ければ 7 日前とする。ローカル時刻と解釈され、日付だけなら 0 時になる。年の無い日付は、今日以前で最も近い日付と解釈する
- 種類: `discussion` か `notebook` の一方だけを対象にする。無ければ両方
- `取得だけ`: 取得して止める。分析しない
- `出力も`: notebook の最新の実行の出力ファイルと実行ログも取得する
- `分析だけ`: 一覧を取らず、取得済みで分析が済んでいないものを分析する。`kaggle-analyze` skill を引数なしで実行して終わる
- `--extension`: 一覧と取得のページを、ユーザーの Chrome で読む。ログインが要るページを取るときに使う
- 選び方の指定 (「votes 10 以上」「スコア上位 5 件」「GPU を使うもの」など): Step 2 の推奨の代わりに、その指定だけで選ぶ

## Instructions

### Step 1: 一覧を取得する

一覧は playwright-cli のブラウザで読む。`--extension` が無ければ `kaggle-list` という名前のセッションでブラウザを開き、あればユーザーの Chrome につなぐ。Chrome に Playwright の拡張機能が入っていて、ユーザーがつなぐことを許可する必要がある。

```bash
playwright-cli -s=kaggle-list open
# --extension があるとき
playwright-cli attach --extension --session=kaggle-list
```

開いたセッションの名前を渡して、スクリプトを実行する。

```bash
uv run ${CLAUDE_PLUGIN_ROOT}/skills/kaggle-updates/scripts/list.py --session kaggle-list [--kind discussion|notebook] [--since <YYYY-MM-DD[THH:MM]>] <slug>
```

スクリプトは discussion の一覧と Code タブを読み、`kaggle/` のファイルと比べて、取り込むものの推奨を付ける。1 分ほどかかる。

スクリプトが失敗しても、終わったらセッションを閉じる。開いたものは `playwright-cli -s=kaggle-list close`、つないだものは `playwright-cli -s=kaggle-list detach` で閉じる。ユーザーの Chrome は閉じない。
playwright-cli は作業ディレクトリに `.playwright-cli/` (ログ) を作る。成果物ではないので、削除せずに残し、コミットにも含めない。

出力は次の JSON である。時刻はローカル時刻。

```json
{
  "slug": "<slug>",
  "since": "2026-11-13T00:00+09:00",
  "discussions": {
    "truncated": false,
    "hotVotes": 4,
    "items": [
      {"id": 756934, "title": "...", "url": "https://www.kaggle.com/competitions/<slug>/discussion/756934",
       "votes": 12, "comments": 8, "activity": "comment", "activityAt": "2026-11-15T23:24:28+09:00", "pinned": false, "byAdmin": false,
       "state": "updated", "localDir": "kaggle/discussions/756934_...", "recommended": true, "reason": "votes 上位"}
    ]
  },
  "notebooks": {
    "truncated": false,
    "hotVotes": 8,
    "scoreOrder": "ascending",
    "items": [
      {"id": 145952068, "version": 373338303, "ref": "user/slug", "title": "...", "url": "https://www.kaggle.com/code/user/slug",
       "votes": 27, "comments": 0, "score": 136185, "runAt": "2026-11-20T09:46:00+09:00",
       "state": "new", "localDir": null, "prevScore": null, "recommended": true, "reason": "スコア上位"}
    ]
  },
  "listingFile": "/var/folders/.../kaggle-listing-xxxx.json"
}
```

- `state`: `new` (未取得)、`updated` (更新あり)、`fetched` (取り込み済み)。前回取得したときの記録と比べて決まる
  - discussion: コメントが `discussion.md` の `## Comments (N)` より増えていれば `updated`
  - notebook: 版 (`version`) が前回取得したときの `listing.json` と違えば `updated`。`version` を持たない古い `listing.json` では、実行日時で比べる。`source.md` が無い古い形式で取得したものは、いつの版か分からないので `updated`
  - votes だけの変化では `updated` にならない。notebook は kernel id (`id`) で照合するので、slug が変わっても同じ notebook として扱う
- `recommended` と `reason`: 次の基準による推奨。候補は `new` と `updated`
  1. 候補が 10 件以下なら、すべて
  2. 11 件以上なら上位 10 件。discussion は votes 順。notebook はスコア上位と votes 上位を交互に取る。スコアが前回の取得から変わっていない `updated` の notebook は、残りの枠に回す
  3. votes が `hotVotes` (そのコンペで votes が 20 位のものの votes) 以上の候補は、10 件を超えても加える。上限は 30 件。discussion または notebook が全部で 20 件に満たないコンペでは、その種類の `hotVotes` は `null` で、この基準は使わない
- `score`: 公開スコア。提出していない notebook は `null`。`scoreOrder` は良いスコアの向きで、`ascending` は小さいほうが良い
- `prevScore`: 前回取得したときのスコア
- `byAdmin`: コンペの主催者が立てたトピックなら `true`
- `truncated`: `true` のときは一覧のページを送りきれずに打ち切っている。日付を新しくして実行し直す

### Step 2: 取り込むものを決める

`recommended` が `true` のものを取り込む。推奨を自分で入れ替えたり、件数を減らしたりしない。

推奨に加えて、`byAdmin` が `true` の discussion と、タイトルからルールやデータの変更、評価指標の不具合だと読み取れる discussion は、`state` が `fetched` 以外なら選ぶ。
ユーザーが選び方を指定していれば、推奨と上の追加の代わりに、その指定だけで選ぶ。

種類ごとに、表でユーザーに示す。並びはスクリプトの出力の順 (最終活動か実行の新しい順) のままにする。
一覧が 30 件を超える種類は、取り込むものだけを表にし、残りは状態ごとの件数を 1 行で示す。

```
discussion (2026-11-13 以降、11 件)
| ID | 状態 | votes | comments | 最終活動 | タイトル | 取り込む |
|----|------|-------|----------|----------|----------|----------|
| 756934 | 未取得 | 12 | 8 | 2026-11-15 | ... | ○ votes 上位 |
| 745660 | 取り込み済み | 40 | 33 | 2026-11-14 | ... | - |

notebook (2026-11-13 以降、81 件。スコアは小さいほど良い)
| notebook | 状態 | votes | スコア (前回) | 実行 | 取り込む |
|----------|------|-------|---------------|------|----------|
| user/slug | 更新あり | 27 | 136185 (136190) | 2026-11-20 | ○ スコア上位 |
他 64 件: 未取得 45、更新あり 10、取り込み済み 9
```

表を示したら、確認を待たずに Step 3 に進む。取り込むものが 1 件も無ければ、その旨を伝えて終わる。

### Step 3: 取り込む

1. `kaggle-fetch` skill を 1 回だけ実行し、取り込む discussion と notebook の `url` をすべて引数に渡す。notebook を含むときは、先頭に `--listing <listingFile>` を付ける。`出力も` の指定があれば `--outputs` を、`--extension` があれば `--extension` を付ける。取得は Sonnet の subagent が行うので、結果が返るまで待つ。ScheduleWakeup などで待ち合わせを仕掛けない
2. 取得できたものの `dir` をすべて引数にして、`kaggle-analyze` skill を実行する。取得に失敗したものは分析しない。取り直したもののうち、内容が変わっていないものや、分析に影響しない変化だけのものは、`kaggle-analyze` が `insights.md` の `取得:` の行だけを書き換えて済ませる

`取得だけ` の指定があれば、1 で止める。

最後に、次を 1 度だけ報告する。報告する内容はこれですべてである。

- 分析したものごとに、`insights.md` のパスと要点 1 行。更新ありのものでは、今回の変化の要点を書く
- 内容が変わっていなかったものと、分析に影響しない変化だけだったものの件数
- コメントの読み込みを打ち切ったもの (`commentsTruncated`) と、読めた件数と一覧の `comments` の値
- 取得や分析に失敗したものと、その理由
- `truncated` が `true` だった種類があれば、そのこと
- `kaggle-fetch` が `.gitignore` について依頼を返していれば、その依頼

## Examples

### 直近 1 週間の更新を取り込む

```
ユーザ: コンペの更新を取り込んで

手順:
1. slug をリポジトリから読み取り、--since を付けずに list.py を実行する (7 日前から)
2. 推奨されたものと主催者の告知を選び、discussion と notebook の表を示す
3. kaggle-fetch で 1 回にまとめて取得し、kaggle-analyze で分析して、要点を報告する
```

### notebook だけを、指定した基準で取得する

```
ユーザ: /kaggle-updates 2026-11-18 notebook スコア上位 5 件 取得だけ

手順:
1. --kind notebook --since 2026-11-18 で list.py を実行する
2. 未取得と更新ありのうち、スコアの良い順に 5 件を選んで表を示す
3. --listing を付けて kaggle-fetch で取得し、分析せずに報告する
```

## Troubleshooting

### `list-discussions.mjs: {"error": "not_competition_page", ...}`

原因: slug が違い、コンペのページが開けていない。
対処: `https://www.kaggle.com/competitions/<slug>` が開けるか確かめ、slug を直して実行する。

### `items` が空

原因: 日付以降に活動が無いか、一覧の DOM が変わって読み取れていない。
対処: 日付を古くして実行する。それでも空なら、`playwright-cli -s=kaggle-list open <一覧の URL>` と `playwright-cli -s=kaggle-list snapshot` でページの構造を確かめ、ユーザーに伝える。

### `goto failed (is the session open?)`

原因: ブラウザを開いていないか、セッション名が違う。
対処: `playwright-cli list` で開いているセッションを確かめ、Step 1 のブラウザを開くところからやり直す。

### `scoreOrder` が `null`

原因: Code タブの並べ替えで "Public Score" を選べなかった。スコアの無いコンペか、DOM が変わった。
対処: notebook の推奨は votes 上位だけで決まっている。そのまま進め、報告でそのことを伝える。
