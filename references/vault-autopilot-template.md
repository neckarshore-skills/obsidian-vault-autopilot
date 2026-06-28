# Vault Autopilot

This vault is managed by [Obsidian Vault Autopilot](https://github.com/neckarshore-skills/obsidian-vault-autopilot) — an AI-powered plugin that sorts, renames, tags, and enriches your notes automatically.

## Available Skills

| # | Skill | What it does | Last run |
|---|-------|-------------|----------|
| 1 | inbox-sort | Moves notes from inbox root into subfolders | — |
| 2 | note-rename | Renames poorly named files with clear, descriptive names | — |
| 3 | property-enrich | Fills missing metadata fields (dates, tags, status) | — |
| 4 | property-describe | Generates missing note descriptions | — |

Three more skills (`note-quality-check`, `property-classify`, `tag-manage`) are on the roadmap — see the project README's "On the Roadmap" section for status.

## How It Works

Each skill follows the **Core + Nahbereich + Report** principle:
- **Core:** Execute the job (sort, rename, tag, etc.)
- **Nahbereich:** Fix adjacent issues when evidence is clear
- **Report:** Document what was done, what was found, what needs attention

## Reports

Skill reports are saved to the `logs/` directory after each run.

## Configuration

Skills use sensible defaults but respect your vault structure. No hardcoded folder names — skills discover your vault layout at runtime.

---

> **Note:** This file is protected. No skill will move, rename, or modify it.
