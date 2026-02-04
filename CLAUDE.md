# Claude Marketplace

複数の Claude Code プラグインをホストする marketplace リポジトリ。

## 構造

各プラグインは独立したディレクトリに配置:

```
<plugin-name>/.claude-plugin/plugin.json  # マニフェスト
<plugin-name>/skills/<skill-name>/SKILL.md  # スキル定義
```

## プラグイン一覧

- `vertexai-gemini-batch` - Vertex AI Batch Prediction
- `actions-ubuntu-slim-migration` - GitHub Actions ubuntu-slim 移行
- `hydra-experiment` - Hydra による機械学習実験管理

## 開発

新規プラグイン作成: `docs/PLUGIN_GUIDE.md` を参照
