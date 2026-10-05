# polish

AI が書いたテキストやコードを仕上げる skill をまとめた Claude Code プラグイン。
成果物を出す前に、AI が書きがちな冗長な記述や、制作時の会話にしか通じない記述を取り除く。

## Skills

| Skill | Description |
|-------|-------------|
| [`remove-slop`](skills/remove-slop/SKILL.md) | ブランチで AI が追加した冗長なコメント、過剰な防御コード、any キャストを削除する |
| [`remove-artifact-noise`](skills/remove-artifact-noise/SKILL.md) | ドキュメントやコードコメントを、制作時の会話を知らない読者にも理解できるように書き直す |
| [`trim-skill`](skills/trim-skill/SKILL.md) | SKILL.md から判断や出力を変えない記述を削り、短く簡潔にする |

## Installation

```
/plugin install polish@pokutuna-plugins
```
