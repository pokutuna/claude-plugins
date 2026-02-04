# Plugin Development Checklist

Checklist for adding or updating plugins.

## New Plugin

- [ ] Create `<plugin-name>/.claude-plugin/plugin.json`
  - name, version, description, author, keywords
- [ ] Create `<plugin-name>/README.md`
- [ ] Add entry to `.claude-plugin/marketplace.json` `plugins` array
  - name, description, source, homepage
- [ ] Implement Skills/Commands/Agents/Hooks

## Skill

- [ ] Create `skills/<skill-name>/SKILL.md`
  - frontmatter: name, description, metadata (author, version, compatibility)
  - Include trigger words in description
- [ ] Reference scripts with `${CLAUDE_PLUGIN_ROOT}`
- [ ] Add usage examples (Examples section)

## Version Update

- [ ] Increment `version` in `plugin.json`
  - Marketplace is cached; changes won't reflect without version bump

## Before Commit

- [ ] Increment `version` in `plugin.json` if plugin files changed
- [ ] Verify entry added/updated in `marketplace.json`
- [ ] Verify homepage URL is correct (`claude-plugins` not `claude-marketplace`)
- [ ] Create or update `<plugin-name>/README.md`
- [ ] Add link to plugin directory (not README) in root `README.md` if new plugin added
- [ ] Verify `.gitignore` excludes unwanted files
