# Configuration Specification

This document defines every configurable attribute in the Obsidian Vault Autopilot plugin. Each attribute has an opinionated default that works out of the box. Users override defaults via `_vault-autopilot-config.md` in their vault root.

## How Configuration Works

1. User creates `_vault-autopilot-config.md` in their vault root (optional — all defaults work without it)
2. The file contains YAML code blocks organized by section (Global, Folders, per-skill)
3. At the start of every run, each skill reads the config file and applies overrides
4. Missing keys use the defaults listed here
5. The config file is protected — no skill moves, renames, or modifies it

### List Behavior

For list-type attributes (patterns, platform maps), two modes exist:

- **`_extend`** (default): Adds entries to the built-in defaults. User entries come after built-in ones.
- **`_override`**: Replaces the entire list. Use only when you explicitly want to remove built-in patterns.

Example:
```yaml
# Extends the 7 built-in patterns with 2 more
uninformative_patterns_extend: ["名称未設定", "Sin título"]

# Replaces ALL built-in patterns with just these 2
uninformative_patterns_override: ["Untitled", "Draft"]
```

---

## Tier 1 — v0.2.0 (High Impact)

These cause immediate friction when they do not match a user's vault. Each is a simple value substitution.

| # | Key | Default | Type | rename | sort | quality | classify | describe | enrich | tags | Description |
|---|-----|---------|------|:------:|:----:|:-------:|:--------:|:--------:|:------:|:----:|-------------|
| 1 | `folders.inbox` | Auto-detect | Path | x | x | x | x | x | x | x | Name of the inbox folder. Skills scan this folder by default. |
| 2 | `folders.trash` | `_trash` | Path | x | x | x | | | | | Soft-delete destination. Must exist or will be created. |
| 3 | `folders.secret` | `_secret` | Path | x | | | | | | | Destination for notes with sensitive content. |
| 4 | `folders.daily_notes` | Auto-detect | Path | x | x | | | | | | Canonical Daily Notes folder location. |
| 5 | `cooldown_days` | `3` | Integer | x | x | x | x | x | x | x | Skip notes created within the last N days. Grace period before automation touches recent captures. |
| 6 | `scope` | `inbox` | Enum: `inbox`, `vault`, `folder:path` | x | x | x | x | x | x | x | Default scan scope. `inbox` = inbox root only. `vault` = entire vault excluding root. `folder:path` = specific subfolder. |
| 7 | `folders.excluded_prefixes` | `["_", "."]` | List | x | x | x | x | x | x | x | Folder prefixes to exclude from scanning. Folders starting with any of these prefixes are skipped. |
| 8 | `skill_log.tag` | `true` | Boolean | x | x | x | x | x | x | x | Whether to add the `VaultAutopilot` tag to processed notes. Set `false` to keep tag space clean. |
| 9 | `skill_log.callout` | `true` | Boolean | x | x | x | x | x | x | x | Whether to append the history callout to processed notes. Set `false` for minimal note footprint. |
| 10 | `uninformative_patterns` | `["Untitled", "Unbenannt", "New Note", "Draft", "Blank note", "Note from iPhone", "Quick Note"]` | List (extend) | x | | | | | | | Filename patterns that trigger rename. Extend with localized defaults (e.g., Japanese, Spanish, French). |
| 11 | `confirm` | `true` | Boolean | x | x | x | x | x | x | x | Whether to require user confirmation before execution. Set `false` for unattended/automated runs. |

### Config File Example (Tier 1)

````markdown
## Global

```yaml
cooldown_days: 0
scope: inbox
confirm: true
```

## Folders

```yaml
inbox: "Inbox"
trash: ".trash"
secret: "Private"
daily_notes: "Journal"
excluded_prefixes: ["_", "."]
```

## Skill Log

```yaml
tag: true
callout: false
```

## note-rename

```yaml
uninformative_patterns_extend: ["名称未設定", "Sin título", "Sans titre", "Naamloos"]
```
````

---

## Tier 2 — v0.3.0 (Moderate Impact)

Benefits many users but involves attribute interactions or less-frequently-encountered scenarios.

| # | Key | Default | Type | rename | sort | quality | classify | describe | enrich | tags | Description |
|---|-----|---------|------|:------:|:----:|:-------:|:--------:|:--------:|:------:|:----:|-------------|
| 12 | `separator` | ` - ` | String | x | | | | | | | Character(s) between name segments. Common alternatives: `_`, `.`, ` — `. |
| 13 | `date_format` | `YYYY-MM-DD` | String | x | x | | | | x | | Date format in filenames and skill-log entries. ISO 8601 recommended for sort order. |
| 14 | `date_position` | `first` | Enum: `first`, `last` | x | | | | | | | Whether date leads (`YYYY-MM-DD - Topic`) or trails (`Topic - YYYY-MM-DD`). Affects file explorer sort order. |
| 15 | `max_filename_length` | `70` | Integer | x | | | | | | | Maximum characters for renamed filenames. Lower for mobile (50), higher for detail (100+). |
| 16 | `web_capture_prefix` | `WebCapture` | String | x | x | | | | | | Prefix for web captures. Set empty string to disable prefix. |
| 17 | `social_prefix` | `Social` | String | x | x | | | | | | Prefix for social media captures. Set empty string to disable prefix. |
| 18 | `platform_map` | 8 built-in entries | Map (extend) | x | x | | | | | | URL pattern to context segment mapping. Extend with custom platforms (e.g., `news.ycombinator.com: HackerNews`). |
| 19 | `tag_casing` | `PascalCase` | Enum: `PascalCase`, `kebab-case`, `snake_case`, `lowercase` | x | | | | | x | x | Vault-wide tag naming convention. Applied when creating or fixing tags. |
| 20 | `cluster_threshold` | `3` | Integer | x | | | | | | | Minimum notes on the same topic before suggesting a common prefix. |
| 21 | `naming_structure` | `{date} - {context} - {detail}` | Template | x | | | | | | | Filename template. Supported variables: `{date}`, `{context}`, `{detail}`, `{title}`. |
| 22 | `multi_topic_join` | `&` | String | x | | | | | | | Character to join multiple topics in filenames. Alternatives: `,`, `+`, `and`. |
| 23 | `mixed_content_label` | `Mixed Content` | String | x | | | | | | | Label for notes with too many topics for a meaningful name. |
| 24 | `sensitive_patterns` | Built-in (recovery phrases, API keys, passwords, tokens) | List (extend) | x | | x | | | | | Patterns that trigger move to secret folder. Extend with domain-specific patterns (SSN, employee IDs). |
| 25 | `timestamp_source` | `birthtime` | Enum: `birthtime`, `mtime` | x | x | x | x | x | x | x | Which file timestamp to use for cooldown calculation. Use `mtime` on Linux where birthtime is unreliable. |

---

## Tier 3 — v0.4.0+ (Edge Cases, Power Users)

Niche needs or high complexity. Driven by community requests, not speculation.

| # | Key | Default | Type | rename | sort | quality | classify | describe | enrich | tags | Description |
|---|-----|---------|------|:------:|:----:|:-------:|:--------:|:--------:|:------:|:----:|-------------|
| 26 | `language` | Auto-detect | Enum: `en`, `de`, ... | x | x | x | x | x | | | Language for preview tables, column headers, and action labels. |
| 27 | `corrupted_label` | `Corrupted File` | String | x | | | | | | | Label for files with multiple YAML frontmatter blocks. |
| 28 | `callout_type` | `info` | String | x | x | x | x | x | x | x | Obsidian callout type for skill log. Alternatives: `note`, `abstract`, `tip`. |
| 29 | `skill_log_position` | `end` | Enum: `end`, `after-frontmatter` | x | x | x | x | x | x | x | Where to place the skill log callout in the note. |
| 30 | `action_labels` | English defaults | Map | x | x | x | x | x | x | x | Localized labels for skill log actions (Renamed, Reviewed, Trashed, etc.). |
| 31 | `tag_format` | `block` | Enum: `block`, `inline` | x | | | | | x | x | YAML tag format. `block`: `- Tag` per line. `inline`: `[Tag1, Tag2]`. |
| 32 | `trash_metadata_keys` | `{date: "trashed", source: "trash_source", origin: "trash_origin"}` | Map | x | x | x | | | | | Property names for trash metadata. Override for existing trash conventions. |
| 33 | `collision_format` | `timestamp` | Enum: `timestamp`, `numeric` | x | x | | | | | | How to resolve filename collisions. `timestamp`: `_2026-04-05T1423`. `numeric`: `(1)`, `(2)`. |
| 34 | `autopilot_tag_name` | `VaultAutopilot` | String | x | x | x | x | x | x | x | Name of the tracking tag added to processed notes. |
| 35 | `topic_thresholds` | `{join_max: 4, mixed_min: 5, override: 7}` | Map | x | | | | | | | Multi-topic rule thresholds. `join_max`: max topics joined with `&`. `mixed_min`: min topics for Mixed Content. `override`: always Mixed Content regardless of platform. |
| 36 | `vault_root_included` | `false` | Boolean | x | | x | x | x | x | x | Whether to include vault root files in scan scope. |
| 37 | `filler_words_allowed` | `false` | Boolean | x | | | | | | | Whether to allow filler words ("Note about", "Draft of") in filenames. |
| 38 | `social_platforms` | `["x.com", "twitter.com", "linkedin.com", "instagram.com", "threads.net", "mastodon.social"]` | List (extend) | x | x | | | | | | Social platform domains for context detection. Extend with new platforms. |
| 39 | `template_folder_pattern` | `00_Templates` | String | x | x | x | x | x | x | x | Pattern to detect template folders. Matched against folder names (case-insensitive contains). |
| 40 | `typo_threshold` | `95` | Integer (0-100) | x | | | | | | | Minimum confidence (%) to auto-fix obvious typos in filenames. Higher = more conservative. |

---

## Cross-Skill Summary

How many of the 40 attributes affect each skill:

| Skill | Tier 1 | Tier 2 | Tier 3 | Total |
|-------|:------:|:------:|:------:|:-----:|
| **note-rename** | 11 | 14 | 15 | **40** |
| **inbox-sort** | 9 | 5 | 8 | **22** |
| **note-quality-check** | 8 | 2 | 5 | **15** |
| **property-classify** | 7 | 1 | 4 | **12** |
| **property-describe** | 7 | 1 | 4 | **12** |
| **property-enrich** | 7 | 3 | 5 | **15** |
| **tag-manage** | 7 | 2 | 5 | **14** |

7 of 11 Tier 1 attributes and 5 Tier 2/3 attributes are **global** — they affect all 7 skills (4 launch-scope + 3 roadmap). The configuration infrastructure is a plugin-level feature, not a single-skill feature.

---

## skill-library-sync

These three keys are **not** part of the 40 tiered attributes above and are not counted in the summary table. They configure one skill only, and they are shaped differently from every other section in this file — read the shape note before writing them.

### The shape is keyed, not bare

Every section above puts **bare** keys inside its fence under an H2 heading (`## Folders` → `inbox: "Inbox"`). This section does not. The reader looks for the literal line `skill_library:` at column 0 inside a ```yaml fence, with its children indented below it. Written in the house style, the block is silently treated as absent.

| # | Key | Default | Type | Description |
|---|-----|---------|------|-------------|
| 1 | `library_path` | *(empty)* | Path, vault-relative | Folder holding the Skill Library notes. Not home-expanded — it is a path inside the vault, not on disk. Empty means unconfigured; see the warning below. |
| 2 | `retired_subfolder` | `Entfallen` | String | Subfolder under `library_path` that retired notes are moved into. Never deleted, only relocated and re-labelled. |
| 3 | `source_roots` | `[]` | List | Additional repository roots whose `skills/` subdirectory holds skills that are not installed as plugins. `~` is expanded. Additive by construction — see below. |

Two source classes are **always** read and cannot be configured away: `~/.claude/skills/` and every install path in `installed_plugins.json`. `source_roots` only adds to them, which is why the `_extend` / `_override` semantics documented at the top of this file do not apply here.

### Config File Example

The `## Global` fence below is present on purpose: it proves the two shapes coexist. The reader scans every yaml fence and takes the first one containing `skill_library:` at column 0.

````markdown
## Global

```yaml
cooldown_days: 0
```

## skill-library-sync

```yaml
skill_library:
  library_path: "020_Processes/Library Meta/Skill Library"
  retired_subfolder: "Entfallen"
  source_roots:
    - "~/Developer/projects/neckarshore-skills/photo-autopilot"
    - "~/Developer/projects/neckarshore-skills/social-scrapers"
```
````

### What silence means here

> **Warning:** Every malformed shape in this section is treated as **absent**, never as an error. A broken config file must not be able to stop a read-only scan — but that means a typo does not announce itself, it just changes what the skill believes about your vault. Each row below was measured against the reader, not read off the code.

| # | What you write | What the reader sees | Consequence |
|---|----------------|----------------------|-------------|
| 1 | No config file at all | `library_path: ''` | The whole vault becomes the candidate surface. This is [#93](https://github.com/neckarshore-skills/obsidian-vault-autopilot/issues/93). |
| 2 | List items at 2 spaces (`  - "~/a"`) | Empty `source_roots` | Valid YAML, silently dropped. This is the most likely hand-written form. Items need **exactly 4** spaces. |
| 3 | `source_roots_override:` | Empty `source_roots` | Not a recognized key. Every configured root is lost. |
| 4 | `source_roots_extend:` | Identical to `source_roots` | Accepted as a synonym, not as different semantics. |
| 5 | Scalars at 1 or 3 spaces | Key absent | Scalars need **exactly 2** spaces. |
| 6 | Tab indentation | Key absent | Tabs are not recognized at any depth. |
| 7 | Inline list (`source_roots: ["~/a"]`) | Empty `source_roots` | Flow-style lists are not recognized. |

An empty `source_roots` is the absence of evidence, not evidence of absence. The skill treats it that way: a library whose job is telling you what you have must not use its own silence to declare live skills gone.
