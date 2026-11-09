# polish

文章やコードを仕上げる skill を集めた Claude Code プラグイン。
成果物を人に渡す前に、不要な記述を取り除き、読み手が理解しやすい形に書き直す。

## Skills

| Skill | Description |
|-------|-------------|
| [`remove-slop`](skills/remove-slop/SKILL.md) | 現在のブランチで AI が追加した冗長なコメント、過剰な防御コード、`any` キャストを削除する |
| [`remove-artifact-noise`](skills/remove-artifact-noise/SKILL.md) | ドキュメントやコードコメントから制作時の文脈に依存する記述を除き、やり取りを知らない読者にも分かるように書き直す |
| [`trim-skill`](skills/trim-skill/SKILL.md) | SKILL.md から Claude の判断や出力を変えない記述を削り、短く簡潔にする |
| [`plain-english`](skills/plain-english/SKILL.md) | 英文を ISO 24495-1 と W3C COGA に沿って、読み手が理解しやすい形に書き直す |
| [`gemini-rewrite`](skills/gemini-rewrite/SKILL.md) | pi 経由で Gemini を呼び出し、指定したファイルまたはディレクトリ以下の文書を直接書き直させる |

## Installation

```
/plugin install polish@pokutuna-plugins
```

## gemini-rewrite

### 準備

- [pi](https://pi.dev) と srt (`npm install -g @anthropic-ai/sandbox-runtime`) をインストールする。Linux では bubblewrap と socat も要る
- 次のいずれかで認証する
  - Vertex AI (API キー): `GOOGLE_CLOUD_API_KEY`、または pi で `/login`
  - Vertex AI (ADC): `gcloud auth application-default login` と `GOOGLE_CLOUD_PROJECT`、`GOOGLE_CLOUD_LOCATION`
  - Gemini API: `GEMINI_API_KEY`

### 設定

- `--style`: 書き直し方針。`clarify` (既定) か `concise`。`skills/gemini-rewrite/assets/styles/` にファイルを足せば増やせる
- `--provider`: 認証が複数あるときに使う provider
- `GEMINI_REWRITE_MODEL`: モデル (既定 `gemini-4-argon`)。Claude Code では `settings.json` の `env` に書く

### 動作

- 対象を直接書き換える。バックアップは取らないので、事前にコミットか stash しておく
- 書き換えられるのは対象だけで、コマンドはネットワークなしの srt で動く
- pi に入れた拡張や MCP サーバーは読み込まない
- セッションを再開して手直しさせられる
