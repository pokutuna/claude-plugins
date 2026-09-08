---
name: html
description: HTML ドキュメントの作成・編集。HTML 形式の説明、調査結果、レポートを求められたときに使う。
compatibility: Requires python3 for bundle.py
---

# HTML ドキュメント

同梱のテンプレートとデザインシステムで HTML ドキュメントを作る。見た目はデザインシステムが決めるので、
書き手は骨格に本文を入れ、部品のクラスを当てる。

## 手順

1. `${CLAUDE_PLUGIN_ROOT}/skills/html/assets/` の `design-system/` と `template.html` を作業ディレクトリへコピーし、
   HTML を `{yyyymmdd}-{内容のケバブケース}.html` に改名する。`design-system/` が既にあればそれを使う。
   既存文書はファイル名と資産を変えずに編集する
2. テンプレートの骨格と `<head>` を保って本文を書く。用語集が要らなければ `aside` ごと消す。
   部品は下の一覧から選び、ページ固有の `<style>` は図の配置調整など最小限にする
3. 分離した構成を求められた場合を除き、単一ファイルに bundle して渡す。ユーザーがオフラインで開ける形を
   求めたときだけ `--offline` (Web フォントを省くなら `--offline --no-webfonts`) を付ける
   ```sh
   "${CLAUDE_PLUGIN_ROOT}/skills/html/scripts/bundle.py" <input.html> -o <output.html>
   ```

## 部品

書き手が付けるクラスは次のものだけで、他は素の要素にそのまま効く。実際の markup は
`references/component-samples.html` にあり、迷ったときに該当節を読む。

- `div.dg-note`: 読み飛ばしてほしくない注意、制限、前提。`data-label="注意"` を付けると枠にまたがる見出しになる
- `div.dg-sub`: 読まなくても本文が成立する補足や参考情報。`data-label` は `.dg-note` と同じで、どちらも省いてよい
- `div.dg-grid > div.dg-card > (h4, p)`: 独立した情報のまとまりを並べる。1 つなら `div.dg-card` だけ
- `span.dg-chip`: 並列の固有名やファイル名の列挙。図の系列と対応させるときだけ `c1`〜`c5` を順に付ける
- `ol.dg-steps`: 順番に意味のある手順。一方向の単純な手順は図にせずこれにする
- `blockquote > (p, p.dg-translation, cite)`: 引用。訳文は `p.dg-translation`、出所は `cite` に書き、ウェブ上にあればリンクにする
- `table > (caption, thead > tr > th, tbody > tr > (th, td))`: 説明は `caption`、行見出しは `tbody` の `th`
- `div.dg-table-scroll > table`: 列が多くて折り返すと読めない表だけ包む
- `pre > code.language-*`: コード。色付けしないなら `language-plaintext`
- `pre.dg-diff > code.nohighlight > (span.add | span.del | span.ctx)`: 差分。行ごとに span で包み、行頭の記号は書かない
- `figure > ((svg | img | pre.dg-mermaid), figcaption)`: 図。`figcaption` に番号と説明
- `.dg-wide`: `figure` `.dg-grid` `.dg-table-scroll` `table` `pre` に付けると画面幅いっぱい (上限 1600px) に広がる。
  横長の 1 枚図は `figure.dg-wide`、複数並べるなら `.dg-grid.dg-wide` の中に `figure`
- `em` は節ごとに 1 箇所、`hr` は見出しを立てるほどではない話の切れ目にだけ使う。`abbr` には `title` を付ける

## 図と色

- 自作図はインライン SVG。線と文字は色を指定せず、塗りが要る部分だけ `class="fill"`。
  色を変えるときは `accent1` (teal) `accent2` (amber) `muted` (注記) のクラス、系列の区別は `c1`〜`c5` を順に付ける
- ページ固有の `<style>` で色が要るときはカラーコードを書かず `--dg-accent1` `--dg-accent2` `--dg-muted`
  `--dg-c1`〜`--dg-c5` `--dg-surface` (面) `--dg-rule` (補助線) を参照する。本文や枠線の色は CSS が当てる
- Mermaid はフローチャート、シーケンス図、状態遷移図に使う。ノードが 4 つ以上かラベルが長ければ
  `flowchart TD` にして矢印の交差を避ける。ノード内に `<br/>` を書かず、` / ` で区切るか短くする
- アスキーアート、絵文字、矢印文字を図記号に使わない
- 数式はインライン `$...$`、ディスプレイ `$$...$$`。ベクトルと行列は `\boldsymbol`、スカラーは装飾しない
