# Obsidian Vault Autopilot

AI-powered vault automation for Obsidian × Claude Code. Sorts your inbox,
renames your notes, enriches your frontmatter — so you can focus on finding,
collecting, and thinking instead of filing.

Build your Second Brain rapidly. Let the Autopilot handle the tedious stuff.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Data Handling

**At a glance:** the plugin code itself makes no network calls
(verifiable with `grep`). Skill execution happens inside Claude
Code, which sends note content to Anthropic's API to generate skill
output — subject to [Anthropic's Privacy Policy](https://www.anthropic.com/privacy).
For privacy-sensitive vaults, read [SECURITY.md § Data Handling](SECURITY.md#data-handling)
in full before processing sensitive content.

## What This Does

**Nine skills** manage your vault automatically — four launch-scope skills validated to Gold-Run coverage, plus five more shipped in beta and usable today.

> **New in v0.3.0:** full tag management has landed. `tag-manage` (audit + convention cleanup) and `tag-organize` (nested tag hierarchy) are shipped and usable today — see the beta skills below.

### Launch-scope skills (Gold-Run validated)

| # | Skill | What it does | Status |
|---|-------|-------------|--------|
| 1 | **inbox-sort** | Moves notes from inbox root into existing subfolders based on content | ✅ stable |
| 2 | **note-rename** | Renames poorly named files and updates all backlinks | ✅ stable |
| 3 | **property-enrich** | Fills missing metadata (title, dates, aliases, source, priority) and finalizes frontmatter into a canonical, readable order (`title` first … `tags` last); `modified` carries a `HH:MM` timestamp | ✅ stable |
| 4 | **property-describe** | Generates concise `description` frontmatter from note content | 🧪 beta |

The **🧪 beta** skill is usable today with caveats — behavior may still change before v1.0. All four launch-scope skills have been validated across multiple vault topologies (macOS native, Windows clone, PowerShell clone, robocopy clone).

### Also available — beta (shipped & usable today)

Five more skills ship in the codebase and run today. They have not yet been validated at the same Gold-Run coverage as the launch-scope skills, so behavior may still change before v1.0 — but they are real, installed, and usable now.

| # | Skill | What it does | Status |
|---|-------|-------------|--------|
| 1 | **tag-manage** | Audits existing tags; scores against PascalCase convention (severity-classified); renames, merges, and removes duplicates / case variants / convention violations behind a preview-and-confirm gate with a rich vault-written report | 🧪 beta (shipped v0.2.1) |
| 2 | **tag-organize** | Organizes flat tags into a nested hierarchy — AI-proposed parent/child families over existing tags, scored and split into Implement / Decide / Ignore (with per-family note-counts) in a browsable proposal note so you triage by confidence and impact, applied behind a confirm gate (Slice 1: structure only, no auto-tagging yet) | 🧪 beta (shipped v0.3.0) |
| 3 | ai-paste-cleanup | Cleans AI-generated / pasted Markdown — strips citation markers, zero-width and non-breaking characters, bold/italic-wrapped headings, and blank-line runs; dry-run diff + a survival guard that protects links, checkboxes, and emoji | 🧪 beta |
| 4 | note-quality-check | Scores notes by quality, recommends what to keep or delete | 🧪 beta |
| 5 | property-classify | Sets lifecycle `status` and `type` properties automatically | 🧪 beta |

> **Tag hierarchy:** `tag-manage` can also nest flat tags under a parent you declare (`#daytrading` → `#Investing/DayTrading`). See the [Tag Hierarchy guide](docs/tag-hierarchy.md).

Each skill follows the **Core + Nahbereich (adjacent fixes) + Report** principle: do the job,
fix adjacent issues, and report everything else.

## What This Does NOT Do

This is not a syntax reference. It does not teach agents what Obsidian Markdown looks like.
This is not a diagram generator. It does not create Excalidraw or Mermaid visualizations.

It automates your vault. Nobody else does that.

## On the Roadmap

One capability is designed but not yet active:

| # | Skill | What it will do | Target |
|---|-------|----------------|--------|
| 1 | tag-organize (auto-tag) | Fills under-tagged notes with tags from their content, behind a closed + gated-new vocabulary and a per-tag approval surface (tag-organize Slice 2) | v0.4.x (planned) |

Want to help shape it? **[Open an issue](https://github.com/neckarshore-ai/obsidian-vault-autopilot/issues)** with your use case.

## Safety

> **This plugin performs destructive file operations on your Obsidian vault.** It moves files, renames files, changes frontmatter, and soft-deletes files to `_trash/`. There is no undo button at the plugin level. Read this section before your first run.

### No Backup, No Mercy

Before you run any skill, you need a backup you can restore from. Not "I have Obsidian Sync" (Sync is not a backup). Not "I have iCloud" (iCloud is not a backup for this purpose). A real, restorable backup: Time Machine, rsync snapshot, Git commit, or a vault copy on another disk. See [Backup and Recovery](docs/backup-and-recovery.md).

### Before Your First Run

1. **[Back up your vault](docs/backup-and-recovery.md)** — a real, restorable backup, not a sync service.
2. **[Clone your vault](docs/cloning-guide.md)** and run skills on the clone first. The clone method matters — `cp -R` resets birthtimes; Finder and `ditto -V` preserve them on APFS. **On Windows**, File Explorer copy silently drops files at long paths — use `robocopy` instead. See the [Cloning Guide](docs/cloning-guide.md) and [Windows Considerations](docs/windows-considerations.md) for details.
3. **[Check your metadata](docs/metadata-requirements.md)** — skills depend on YAML `created` fields. Low coverage? Run `property-enrich` first.
4. **[Read the Birthday Bug](docs/incident-birthday-bug.md)** — we damaged our own vault early in development. If the plugin ever damages yours, we want you to see how we learned.
5. **Start small** — pick a single folder, not your whole vault. Run `--preview` before any real execution.

New to this plugin? Follow the **[Getting Started](docs/getting-started.md)** guide for a step-by-step first run.

### How Your Data Stays Safe

| # | Feature | What it does |
|---|---------|-------------|
| 1 | **Soft-delete** | Removed files go to `_trash/` with recovery metadata (`trash_source`, `trash_origin`). Nothing is permanently deleted by a skill. |
| 2 | **Preview + Confirm** | Every destructive action shows what will change and waits for your approval. `--preview` is also available as a standalone mode. |
| 3 | **Cooldown** | Files newer than 3 days (configurable) are protected from automation. Gives you time to notice new notes before automation touches them. |
| 4 | **Skill Log** | Every action is logged with timestamp, skill name, and what changed — in the note frontmatter and in `logs/run-history.md`. |
| 5 | **Secret Detection** | Files containing API keys, recovery phrases, or financial data are detected. `inbox-sort` flags them in the report for your review; `note-rename` moves them to `_secret/` automatically. In either case, they are never silently sorted into normal categories. |

### Known Limitations

- **Fresh clones confuse cooldown.** A vault cloned with `cp -R`, Windows Explorer, `git clone`, or a GitHub ZIP download has fresh birthtimes on every file. Without YAML `created` coverage, cooldown will protect everything and skills will no-op. Run `property-enrich` first. Finder and `ditto -V` on macOS preserve birthtimes. See [Cloning Guide](docs/cloning-guide.md).
- **Obsidian Sync + clone-in-neighbor-folder is dangerous.** If Sync is active and you clone into a folder Sync can see, operations on the clone may propagate back. Always disable Sync on the clone first.
- **Windows long path limit (MAX_PATH 260) silently hides files.** On Windows without long path support enabled, files at paths exceeding 260 characters are invisible to PowerShell enumeration and to Vault Autopilot skills. Deep PARA folder structures cross 260 characters routinely. Enable long path support in the registry before running any skill. File Explorer / `Copy-Item` cloning also drops these files silently — use `robocopy` instead. The launch-scope skills (`note-rename`, `inbox-sort`, `property-enrich`, `property-describe`) detect this at startup and refuse to run if Long Path support is missing — they will not silently process a partial vault. Full procedure in [Windows Considerations](docs/windows-considerations.md).

### Disclaimer

This software performs destructive file operations on your Obsidian vault. There is no warranty, express or implied.

By running any skill, you confirm that:

1. You are responsible for maintaining backups of your vault.
2. You have read the [Cloning Guide](docs/cloning-guide.md) and will test on a clone first.
3. You accept that destructive automation on your own files is your decision and your responsibility.

See the [MIT License](LICENSE) for full warranty and liability terms.

For security issues, see [SECURITY.md](SECURITY.md). For contribution guidelines,
see [CONTRIBUTING.md](CONTRIBUTING.md). For community guidelines, see
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Installation

### Claude Code (recommended)

Add the marketplace:

```bash
/plugin marketplace add neckarshore-ai/obsidian-vault-autopilot
```

Then install the plugin:

```bash
/plugin install obsidian-vault-autopilot@neckarshore-ai
```

> **Note:** Run each command as a separate Claude Code input. Pasting both lines as one input causes Claude Code to treat the entire string as the marketplace source and the clone falls back to SSH.

### Manual

Clone the repo and register it as a local marketplace:

```bash
git clone https://github.com/neckarshore-ai/obsidian-vault-autopilot.git \
  ~/.claude/plugins/obsidian-vault-autopilot
```

Then in Claude Code, add the marketplace:

```bash
/plugin marketplace add ~/.claude/plugins/obsidian-vault-autopilot
```

And install the plugin:

```bash
/plugin install obsidian-vault-autopilot@neckarshore-ai
```

### Prerequisites

- [Claude Code](https://claude.ai/code) with plugin support
- An Obsidian vault (any structure, any size)
- Set your vault path:
  ```bash
  export OBSIDIAN_VAULT_PATH="/path/to/your/vault"
  ```

## Design Philosophy

Every skill ships with **opinionated defaults** that work out of the box.
New user? Install, set your vault path, go. Your inbox gets sorted, files get renamed,
properties get standardized.

Every default is **configurable**. Different vaults have different conventions.
See each skill's Parameters section for available options.

Skills work on **Markdown and YAML frontmatter** — not on Obsidian APIs.
Move your vault to another Markdown tool tomorrow. These skills still work.

## Contributing

Found a bug? Have a skill idea? **[Open an issue](https://github.com/neckarshore-ai/obsidian-vault-autopilot/issues)** — that's how we track and prioritize all work. New skill proposals start as issues, not pull requests.

See [CONTRIBUTING.md](CONTRIBUTING.md) for full guidelines.

## License

MIT — see [LICENSE](LICENSE) for details.

---

Built by [Neckarshore AI](https://neckarshore.ai)
