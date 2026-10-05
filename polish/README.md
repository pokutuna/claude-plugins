# polish

テキストや成果物を修正する skill をまとめた Claude Code プラグイン。
文章やコードを人に渡す前に、不要な記述を取り除き、読み手が理解しやすい形に書き直す。

## Skills

| Skill | Description |
|-------|-------------|
| [`remove-slop`](skills/remove-slop/SKILL.md) | ブランチで AI が追加した冗長なコメント、過剰な防御コード、any キャストを削除する |
| [`remove-artifact-noise`](skills/remove-artifact-noise/SKILL.md) | ドキュメントやコードコメントを、制作時の会話を知らない読者にも理解できるように書き直す |
| [`trim-skill`](skills/trim-skill/SKILL.md) | SKILL.md から判断や出力を変えない記述を削り、短く簡潔にする |
| [`plain-english`](skills/plain-english/SKILL.md) | 英文を ISO 24495-1 と W3C COGA に沿って、読み手が理解しやすい形に書き直す |

## Installation

```
/plugin install polish@pokutuna-plugins
```
