# Claude Marketplace

A marketplace repository hosting multiple Claude Code plugins.

## Development

- Plugin guide: `docs/PLUGIN_GUIDE.md`
- Skills guide: `docs/The-Complete-Guide-to-Building-Skills-for-Claude.md`
  - If this file is missing, convert https://resources.anthropic.com/hubfs/The-Complete-Guide-to-Building-Skill-for-Claude.pdf to Markdown faithfully and place it there

## Commit Guidelines

When modifying a plugin, increment the `version` in `plugin.json`.
Local marketplaces are cached, so changes won't be reflected without a version bump.
