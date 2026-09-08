# デザインシステム

`assets/design-system/` の CSS と JS、`scripts/` のツールを変更する人が読む資料。
スキルの実行時には読まれない。書き手 (エージェント) への指示は `../SKILL.md` が持ち、
`component-samples.html` は markup の実例を持つ。CSS と JS にはコメントを書かず、仕組みや理由はここに書く。
エージェントは CSS と JS を `<link>` / `<script>` で参照するだけで開かないので、そこに書いた説明は読まれない。

## ファイル

`assets/` は書き手が成果物へコピーするもの、`references/` は読むだけのもの、`scripts/` は実行するもの。

| ファイル | 役割 |
| --- | --- |
| `assets/design-system/document.css` | トークンと全部品のスタイル。単独で完結する |
| `assets/design-system/theme.js` | `data-theme` の確定と切り替えボタン。CSS の直後に同期で読み、ちらつきを防ぐ |
| `assets/design-system/copy.js` | `pre:not(.dg-mermaid)` を `div.dg-code` で包み copy ボタンを付ける。math.js / mermaid.js もこのヘルパーを使う |
| `assets/design-system/anchor.js` | `main` 内の h2 / h3 に `#` アンカーと、無ければ文面由来の `id` を付ける |
| `assets/design-system/math.js` | MathJax の設定 (SVG 出力) と数式の copy ボタン。MathJax より前に読む。コピーはデリミタ込み (`$...$` / `$$...$$`) で、貼り付け先でそのまま数式になる |
| `assets/design-system/mermaid.js` | `pre.dg-mermaid` を描画して `div.dg-mermaid` に置き換える。原文を保持し、テーマ切替時に描き直す。mermaid より後に読む |
| `assets/template.html` | 骨格と `<head>` の読み込み順。書き手はこれをコピーして始める |
| `references/component-samples.html` | 全部品の markup の実例と描画テストページ。使い分けは SKILL.md にあり、ここには書かない。`<head>` は `../assets/` を参照する |
| `references/component-samples.{light,dark}.png` | 見本ページの描画結果。現在の見た目の記録 |

## 全体の方針

- 見た目の判断は CSS に寄せ、書き手はクラスを当てるだけにする。用語集 `aside` の有無で
  `.dg-wrap:has(> aside)` が 1 / 2 カラムを切り替えるのはこの方針の例で、指定用クラスは持たない
- 成果物は既定で単一ファイル。ただし書いている間は分離した HTML と CSS として扱い、最後に bundle する
- CDN 参照のままを既定にして成果物を軽く保つ。ライブラリはリポジトリにコピーせず、
  `--offline` のときだけ bundle 時に取得して埋め込む

## 色

有彩色の実体は `--dg-accent1` (teal) と `--dg-accent2` (amber) の 2 つだけ。用途に名前が要るときは
色を複製せず別名にする (`--dg-link`)。差分の緑赤は `pre.dg-diff` 専用の機能色、系列色 `--dg-c1`〜`c5` は
`figure svg` と `.dg-chip` の中でだけ効くので、本文に現れる有彩色は 2 色に保たれる。

色を変えるときに関わる制約。

- teal `#008080` は暗背景で 3.79:1 しかなく AA を満たさない。ダークは明るい変種 (`#2DD4BF`) が必須
- accent2 に orange `#C2410C` を選ぶと、色相 17° が diff の削除色 (17°) と完全に衝突する。
  amber 系 (26°) なら衝突しない
- ダークの背景と面のコントラストは 1.15:1 では足りず、ブロックが背景に沈む。
  背景 `#1A1D22`、面 `#232830`、枠 `#4A5262` で段差をつけてある
- 系列色は Okabe-Ito 系で揃え、ダークは明るい変種にする
- accent1 (teal) は divider・ラベル・番号・コードのキーワード、accent2 (amber) は強調 (`em`) とコードの文字列・数値。
  `hr` は h1 の下線と役割が同じなので accent1。Highlight.js の配色も link / accent の 2 色に閉じる

色のトークンは `light-dark(ライト, ダーク)` で 1 箇所に書く。どちらの値を使うかは `color-scheme`
が決め、`data-theme` が無ければ `light dark` (OS 設定に従う)、あれば `light` / `dark` に固定する。
`color-scheme` を一緒に切り替えるので、OS がダークのままボタンでライトにしてもスクロールバーや
フォーム部品がダークに残らない。

## 部品と実装の判断

- 数式は MathJax の SVG 出力 (`tex-svg-full.js`)。CHTML はフォントと拡張を実行時に CDN から取るため、
  インライン化するとオフラインで壊れる。SVG 出力は全部入りで追加ロードがない
- 用語集は表ではなく `dl`。狭い列で語中折り返しが起きる問題が構造ごと消える。
  用語集なしのときは `main` ではなく `.dg-page` 全体を狭める。h1 だけ幅いっぱいになるちぐはぐを避ける
- アンカーリンクは JS で付ける。CSS の `::before` で `#` を出す方法では href を持てない
- copy ボタンは包む div に絶対配置する。`pre` 自体が横スクロールするため
- `.dg-wide` は本文ではなく画面を基準に中央寄せし、幅は `min(100vw - 64px, 1600px)`。
  main を中心に対称にはみ出す設計では、main が左寄りなので左端に阻まれ 1280px で片側 120px しか
  広がらない。margin-left は main の左端の画面座標から逆算する。`figure` 等の margin に負けないよう
  `.dg-page .dg-wide` で特異性を上げている。1000px 以下では無効
- `pre.dg-diff code` は `white-space: normal`。span を改行で区切って書いても空行が入らないようにする。
  行の中身は span 側の `pre-wrap` で保ち、行頭の `+` / `-` は CSS の `::before` が付ける
- `.dg-wide` の上下の余白は margin ではなく透明な border。背景は境界ボックスまでしか塗られないので、
  margin だと隣り合う `.dg-wide` の隙間から用語集が覗く。border は margin と違い相殺されない
- `.dg-steps` の番号の円は本文 1 行 (16px × 1.85 = 29.6px) の中央に合わせる。(29.6 − 24) / 2 = 2.8px から、
  視覚的な中心が下寄りに見える分を 1px 引いている
- `.dg-sub` と `nav.dg-toc` は同じ見た目で、目次は見出しだけ固定文字 (`::before` の「目次」)
- `table` は `table-layout: fixed` で列幅を確定させ、狭い領域でも溢れさせない
- ヘッダーは固定のテーマボタンと重ならないよう `padding-right: 40px`
- mermaid.js は `document.fonts.ready` を待ってから描画する。Web フォント確定前に測ると文字が箱から溢れる
- theme.js は保存値がなければ OS 設定に従う。CSS の直後に同期で読み、描画前に `data-theme` を確定させる
- `figure > :not(figcaption)` が表示面。図の中身が SVG でも画像でも Mermaid でも同じ枠と余白になり、
  部品ごとの指定が要らない。SVG の線と文字は `currentColor` に追随するので、書き手が色を指定しなければ
  テーマに応じた本文色で描かれる。系列色のクラスは `figure svg` と `.dg-chip` の中だけで効く
- `.dg-note[data-label]` は `::before` の `content: attr(data-label)` で見出しを出し、属性が無ければ
  見出しごと現れない。`.dg-sub` も同じ仕組みで、`nav.dg-toc` だけは固定文字の「目次」を出す
- `.dg-math-inline` の copy ボタンは `position: absolute` で流し込みから外し、数式の右に重ねる。
  行の中に置くと本文の行送りが乱れる
- 用語集 `aside` があれば 2 カラム、無ければ 1 カラム。1000px 以下と印刷では常に 1 カラムになり、
  用語集は本文の後ろに続く。`.dg-wide` もそこでは無効になる

## ツール

- bundle は標準ライブラリだけの自前スクリプトで行う。vite + vite-plugin-singlefile は使えない。
  素の `<script src>` を vite が黙って落とし、`type="module"` にするとモジュールの遅延実行で
  数式スクリプトが MathJax 起動後に走り、テーマのちらつきも再発する
- bundle の処理順は stylesheet → 画像 → script で固定する。画像を script より後に処理すると、
  インライン化された mermaid の圧縮 JS 内の `<image href="${e}">` を画像参照と誤検出する。
  同じ理由で `${` を含む参照はスキップするガードが要る
- `screenshot.sh` は Chrome が終了しないことがあるので、PNG が出たら kill する。ダークは
  一時コピーに `data-theme="dark"` を打って撮る (OS 設定に依存しない)

## 運用

- CSS、JS、見本ページを変更したら、次を実行して PNG を更新し、画像を開いて目視する。
  DOM 検査は「クラスが存在するか」には答えるが「そのクラスが仕事をしているか」には答えない。
  更新した PNG はコミットに含め、見た目の変化が差分に残るようにする

  ```sh
  scripts/screenshot.sh references/component-samples.html --height 5200 -o references/component-samples.light.png
  scripts/screenshot.sh references/component-samples.html --dark --height 5200 -o references/component-samples.dark.png
  ```

  文書を書くたびには行わない。デザインシステム側の不具合は直せば以降の文書に再発しないため、
  描画確認は `html` の手順に含めない
- 部品を追加したら見本ページにも実例を置く。見本にない部品は動作が確認されないまま壊れる
  (`.dg-table-scroll` がこれに当たる)
- 見本ページは markup だけにする。部品をいつ使うかは SKILL.md に書き、見本には書かない。
  仕組みや理由はここに書く。骨格は template.html に任せて
  再掲せず、JS が自動で付ける要素 (テーマボタン、copy ボタン、アンカー、`--offline` の Embedded 行) も
  載せない。`<symbol>` と `<use>` で図をまとめない。`figure svg .muted` などの規則は参照元の位置で評価され
  `<use>` で描いた図形に効かず、書き手が真似する markup でもない
- 部品を足したら SKILL.md の「部品」の一覧にも 1 行足す。エージェントは SKILL.md と template.html を
  必ず読み、見本は必要なときにしか読まない
- 見本の `.dg-table-scroll` には `.dg-wide` を付けない。幅が足りるとスクロールが起きず、
  横スクロールする表という部品の役割を示せなくなる。部品としては組み合わせられる
- 見本が 400 行を超えるようなら、h2 の `id` で節を切り出す script を検討する。
  全部品の h2 は `id` を持っているので、その時点で切り出しに使える
