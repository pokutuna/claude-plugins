# Plugin Development Guide

Claude Code プラグインの作成ガイド。

## ディレクトリ構造

```
<plugin-name>/
├── .claude-plugin/
│   └── plugin.json            # プラグインマニフェスト
├── skills/
│   └── <skill-name>/
│       ├── SKILL.md           # スキル定義
│       ├── scripts/           # バンドルスクリプト
│       ├── references/        # 参照ドキュメント
│       └── examples/          # サンプルコード
├── commands/                  # スラッシュコマンド
├── agents/                    # エージェント定義
└── hooks/                     # フック定義
```

命名規則: kebab-case (例: `gemini-batch-request`)

## plugin.json

```json
{
  "name": "<plugin-name>",
  "version": "0.1.0",
  "description": "プラグインの説明",
  "author": "作者名",
  "keywords": ["keyword1", "keyword2"]
}
```

## SKILL.md フロントマター

```markdown
---
name: <skill-name>
description: This skill should be used when the user asks to "trigger phrase 1", "trigger phrase 2", or needs guidance on <topic>.
allowed-tools: Bash, Read, Edit, Write, Glob, Grep
user-invocable: true
---
```

| フィールド | 必須 | 説明 |
|-----------|------|------|
| `name` | Yes | スキル名 (kebab-case) |
| `description` | Yes | 三人称で記述。トリガーフレーズを含める |
| `allowed-tools` | No | スキルが使用できるツール |
| `user-invocable` | No | `/<skill-name>` で直接呼び出し可能か |


## スクリプト

### Python PEP 723 スクリプト

Python スクリプトを配置する際は PEP 723 形式で依存関係を記述し、`uv run --script` で実行:

```python
#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["requests"]
# ///
```

SKILL.md からの参照は相対パス: `./scripts/example.py`

## 参考

- [Claude Code Plugin Structure](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/plugin-dev/skills/plugin-structure)
- [Skill Development Guide](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/plugin-dev/skills/skill-development)
