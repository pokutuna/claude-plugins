# Claude Marketplace

A marketplace repository hosting multiple Claude Code plugins.

## Structure

Each plugin is placed in its own directory:

```
<plugin-name>/.claude-plugin/plugin.json  # Manifest
<plugin-name>/skills/<skill-name>/SKILL.md  # Skill definition
```

## Plugins

- `allow-until` - Time-limited Bash auto-approval
- `vertexai-gemini-batch` - Vertex AI Batch Prediction
- `actions-ubuntu-slim-migration` - GitHub Actions ubuntu-slim migration
- `cloud-logging` - Google Cloud Logging investigation
- `hydra-experiment` - Hydra ML experiment management

## Development

See `docs/PLUGIN_GUIDE.md` for creating new plugins.

## Commit Guidelines

When modifying a plugin, increment the `version` in `plugin.json`.
Local marketplaces are cached, so changes won't be reflected without a version bump.
