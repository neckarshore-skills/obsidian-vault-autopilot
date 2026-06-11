# Product Philosophy

## Why This Exists

Every knowledge worker drowns in unstructured notes. They dump ideas, meeting notes, research, and half-finished thoughts into tools like Obsidian — and never come back to organize them. The gap between "captured" and "useful" grows every day.

AI can close that gap. Not by replacing the human's judgment, but by doing the grunt work: sorting, renaming, standardizing metadata, flagging stale content, surfacing connections. The human decides what matters. The AI makes it findable.

This plugin is that AI layer for Obsidian — built on Claude Code, open source, and designed to work with any vault.

## Core Principles

### 1. Skill Philosophy — Core + Nahbereich + Report

Every skill has three zones of responsibility:

- **Core task:** Execute the job. Rename files, sort inbox, standardize properties. This is what the skill was called to do.
- **Adjacent fixes (Nahbereich):** When evidence is clear, fix it. An empty file during a rename pass gets removed. A missing date field gets filled. The surgeon takes the appendix while they're in there — but only if it's obviously needed. Destructive Nahbereich actions use the plugin's trash convention (see `references/trash-concept.md`). Only confirmed-empty files (0 bytes) may be permanently deleted. All other removals go through soft-delete to `_trash/`.
- **Report everything else:** "Found 5 files with broken YAML frontmatter." Don't fix what's not your job. Report it so the right skill can handle it.
- **Write a report:** Every skill run produces output: what was done, what was found, what needs attention. This is how skills communicate — not through shared state, but through reports.

This principle exists because skills must be **maintainable at scale**. A skill that does everything is impossible to test, debug, or improve. A skill that only does one thing misses obvious opportunities. The "Core + Nahbereich + Report" model is the sweet spot.

### 2. Quality Over Tokens

A skill that processes 100 notes thoroughly is more valuable than one that processes 500 notes superficially. Token consumption is a cost. Wrong metadata is a debt. We optimize for correctness, not speed.

This does not mean "be wasteful." It means: when forced to choose between a cheaper run and a better result, choose the better result.

### 3. No Vendor Lock-In (Two Dimensions)

**Tool-agnostic:** Today the vault is Obsidian. Tomorrow it might be something else. Skills work on Markdown files and YAML frontmatter — not on Obsidian-specific APIs, plugins, or data formats. If a user moves their vault to another Markdown-based tool, these skills should still work.

**AI-agnostic:** Today the engine is Claude Code. Tomorrow a customer might want Copilot, Cursor, or something that doesn't exist yet. The skill logic (what to do, when to do it, what rules to follow) is documented in plain Markdown. The AI reads and executes. Switching the AI means switching the reader, not rewriting the book.

### 4. Opinionated Defaults, Configurable Everything

Every skill ships with strong defaults that work out of the box. A new user installs the plugin and immediately gets value — inbox gets sorted, files get renamed, properties get standardized.

But every default is overridable. Different vaults have different folder structures, different naming conventions, different property schemas. The configuration is where personal vaults become personal.

### 5. Open Source First

The plugin is free and open source. The code lives on GitHub. Anyone can install it, use it, modify it, contribute to it.

The open source plugin is the proof of competence. Contributions, issues, and discussions are welcome.

## Skill Design Rules

### Naming

Pattern: `[domain]-[action]` — noun first (the domain), then verb or descriptive noun (the action).

- Singular nouns, English compound-noun convention: `note-rename`, not `notes-rename`
- Domain groups skills in `ls`: all `note-*` together, all `social-*` together
- Standalone nouns OK when action IS the domain: `properties`, `tags`
- kebab-case always

See `CLAUDE.md` for the full naming reference with examples.

### Scope

Each skill answers one question: "What is your job?" If the answer has "and" in it, consider splitting.

Exceptions: Consolidation is allowed when the underlying domain is the same. Four separate "properties-description", "properties-status", "properties-type", "properties-context" skills all work on YAML frontmatter — one `properties` skill with configurable scope is cleaner.

The test: would a user ever want to run only part of this skill? If yes, split. If no, keep together.

### Reports

Every skill produces a summary:

```
## [Skill Name] Report — [Date]

### Done
- Renamed 12 files
- Deleted 3 empty files (Nahbereich)

### Findings
- 5 files with broken YAML frontmatter (→ properties skill)
- 2 files older than 1 year, no edits (→ quality-check skill)

### Unchanged
- 45 files already compliant
```

This format is non-negotiable. It is how the user (and future orchestrator) knows what happened.

## Architecture

### Plugin = obsidian-vault

All Obsidian skills live in one plugin. The plugin is installed once, and individual skills activate based on user requests or triggers.

### Config = Vault-Specific

Each vault has its own configuration. The configuration mechanism is an open design decision — it will likely involve an onboarding/analysis skill that examines the vault and proposes a config. Details TBD.

### Vault Path = Environment Variable

```bash
export OBSIDIAN_VAULT_PATH="/path/to/your/vault"
```

No hardcoded paths. No assumptions about vault location. One variable, one truth.

## Target Skills (7)

| # | Skill | Core Task | Nahbereich | Report |
|---|-------|-----------|------------|--------|
| 1 | inbox-sort | Move files from inbox to correct folders | Delete confirmed-empty files, fill missing `created` | List of moves + findings |
| 2 | note-quality-check | Score notes, walk user through decisions | Trash whitespace-only files (soft-delete) | Quality distribution + actions + parked items |
| 3 | note-rename | Rename poorly named files, fix backlinks | Trash accidental notes, minimal YAML syntax repairs | Renamed files + suspicious patterns |
| 4 | property-classify | Set `status` and `type` from rules | Normalize property-key casing | Classifications + conflicts + distribution |
| 5 | property-describe | Generate `description` from content | Write `description: TBD` for too-thin notes | Written vs. skipped vs. flagged |
| 6 | property-enrich | Fill missing `title`/`created`/`modified` | Create frontmatter if none exists | Fields added + source per note |
| 7 | tag-manage | Audit tags + suggest from content (v0.2.0, deferred) | Auto-fix obvious convention violations | Tag health + changes + suggestions |

Plus: a future **config/onboarding skill** that analyzes a vault and proposes configuration. Former target skills social-scraper, research-report, and social-post moved out of this plugin into the standalone scraper-skill family (D17).

