# Roadmap

## v0.2.0 — tag-manage v2 + first-run report home (current)

> v0.2.0 consolidates the tag-manage v2 milestone and adds the first-run report home. The version number had drifted: the v2 compliance work (Slice 1) and its production-copy UAT fixes both shipped under 0.1.7 without a bump, so existing installs received no update signal. v0.2.0 restores an honest version and bundles the new feature.
>
> - **tag-manage v2 (compliance engine).** Convention-compliance scoring, curated brand/compound override dictionaries, a rich vault-written report (before + after-changes), the acronym-preference resolver (`MCP`/`GEO`/`PRD` stay uppercase), report-only invalid tags (no silent destructive removal by default), and case-variant folding. Validated on a 1,290-note production copy.
> - **First-run report home.** On the first report run, tag-manage detects candidate locations, proposes a smart fresh folder based on your vault's structure, and persists the choice in `Tag Manage Config.md` — so every follow-up report lands in one place. Two coupled fixes ship with it: the report directory is auto-created (no abort on a fresh folder), and `apply` no longer rewrites tags inside report notes ("self-poisoning").
>
> Launch-scope feature set (inbox-sort, note-rename, property-enrich, property-describe) unchanged from v0.1.5.

## v0.1.5 — Cross-platform clone-cluster warning + macOS timezone fix (previous)

> v0.1.5 finishes the clone-cluster work that v0.1.4 started. Two changes:
>
> - **Cross-platform clone-cluster warning.** When you clone an Obsidian vault, every file gets a fresh filesystem creation date — the moment of the clone, not when the note was originally written. v0.1.4 detected this on Windows only. v0.1.5 extends the warning to macOS and Linux, because the same problem affects `cp -R` on macOS, `cp -a` on Linux, `git clone`, ZIP downloads, and `robocopy` on Windows. The four launch-scope skills now run the clone-cluster preflight on every operating system, with the Windows-specific checks layered on top.
> - **macOS timezone fix.** A bug in v0.1.4's clone-detection logic compared timestamps using a format that returned local time tagged with a UTC marker. On any macOS machine outside the UTC timezone, the comparison was off by the local-UTC offset and silently produced wrong skip verdicts, causing date-derivation skills to write the clone time as the note's creation date. v0.1.5 fixes this by switching to numeric epoch comparison on both platforms.
>
> **Note for v0.1.4 users on macOS in a non-UTC timezone:** if you ran `property-enrich` on a cloned vault between v0.1.4 (2026-05-07) and v0.1.5, some files may have the clone time saved as their `created` date. Just upgrading to v0.1.5 and re-running `property-enrich` is not enough — the skill is additive-only and won't overwrite an existing `created` value. Three-step remediation: (1) run `scripts/detect-clone-cluster.sh` against your vault to identify the cluster window; (2) for each file with a `created` value inside that window, blank the `created` field; (3) re-run `property-enrich`. Files with no other date source will surface as findings instead of being silently overwritten. Linux, Windows, and UTC-macOS hosts were not affected. See `logs/changelog.md` for full detail.
>
> Launch-scope feature set unchanged from v0.1.4.

## v0.1.4 — Pre-public-release fixes (previous)

> v0.1.4 closes four bugs that surfaced when testing on a Windows vault cloned with `robocopy`. All four blocked the path to public release:
>
> - **Windows trailing-dot folder enumeration.** Windows silently strips trailing dots and trailing spaces from folder names when enumerating files, so a folder named `030_Systems - reference material.` was invisible to PowerShell — 670 files inside it were missed by every skill that walked the vault. Fixed by using the Windows extended-path prefix (`\\?\`) which bypasses the normalization.
> - **Clone-cluster skip gate.** When cloning a vault, every file's creation time gets reset to the clone moment, so falling back to filesystem timestamps writes the clone date as the note's `created` field. v0.1.4 adds a runtime gate: when a file's creation time falls inside the clone-cluster window AND no alternative date source exists (YAML `created`, filename `YYYY-MM-DD` pattern, git first-commit), the skill skips writing `created` for that file instead of poisoning it. The user gets a clear list of skipped files in the report instead of silently corrupted data.
> - **Robocopy clone-integrity preflight.** Even with `robocopy /COPY:DAT`, post-clone Windows background services (Defender, Search Indexer, Obsidian's startup cache) can reset creation times back to the clone moment. v0.1.4 adds a non-blocking warning at the start of each skill run if the cluster pattern is detected, plus retractions to the documentation that previously claimed robocopy reliably preserves creation times.
> - **Duplicate-key resolution.** When YAML frontmatter contains the same key twice with different values (e.g. `status: draft` AND `status: ready-for-designer`), v0.1.3 silently picked one and discarded the other. v0.1.4 detects this case, aborts the repair, and surfaces a finding instead — the user resolves the ambiguity manually.
>
> Launch-scope feature set unchanged from v0.1.3.

## v0.1.3 — Apple Notes import repair + German date support (previous)

> v0.1.3 closes a frontmatter pattern from Apple Notes imports. When Apple Notes exports YAML, it sometimes produces keys with a stray colon inside the quotes (e.g. `"created:":` instead of `created:`). Strict YAML parsers cannot read these — the date is lost, and the skill falls back to filesystem birthtime (which on a cloned vault is the clone moment). v0.1.3 detects and repairs this pattern via a pre-write sanity check called by every property-writing skill at step zero. The check is idempotent — running it again is a no-op. German DACH date format (`DD.MM.YYYY[, HH:mm:ss]`) is now also recognized in `property-enrich`.

Launch-scope feature set unchanged from v0.1.2.

## v0.1.2 — YAML-edit hardening (previous)

> v0.1.2 closes two mid-run regex bugs surfaced during the 2026-04-27 launch shake-out: F8 (inbox-sort callout-append regex did not handle `> ` blockquote prefix on the table separator line) and F15 (property-enrich `tags:` regex was greedy across newlines under `(?s)`). Root cause was identical: each LLM run wrote its own ad-hoc multi-line regex. v0.1.2 codifies line-by-line YAML/Markdown editing as the only allowed approach (`references/yaml-edits.md`) and introduces a vault-side findings ledger (`references/findings-file.md`) so Obi can resume across sessions. See `logs/changelog.md`.

Launch-scope feature set unchanged from v0.1.1.

## v0.1.1 — Launch

> Launch-scope feature set is identical to v0.1.0. v0.1.1 hardens the Windows preflight gate (non-skippable wording, shorter recovery command) and bumps the version so the marketplace cache can deliver updates to existing installs. See `logs/changelog.md`.


Six skills that automate Obsidian vault management:

| # | Skill | What it does | Status |
|---|-------|-------------|--------|
| 1 | inbox-sort | Moves notes from inbox to correct subfolders based on content | stable |
| 2 | note-rename | Renames poorly named files, updates all backlinks | stable |
| 3 | note-quality-check | Scores notes by quality, recommends what to keep or delete | beta |
| 4 | property-describe | Generates concise description frontmatter from note content | beta |
| 5 | property-classify | Sets lifecycle status and type properties automatically | beta |
| 6 | property-enrich | Fills missing metadata: title, dates, aliases, source, priority | stable |

**Launch-scope (4 skills, v0.1.1):** note-rename + inbox-sort + property-enrich (stable) + property-describe (in development). The 4 skills together cover the typical first-pass: rename poorly named files → sort the inbox → fill missing metadata → describe what each note is about. All 4 ship with the Windows pre-flight gate.

Skills marked **beta** work but may change behavior based on community feedback.

## v0.1.x — Stability

Bug fixes, community feedback, cross-platform validation.

| # | Item | Description |
|---|------|-------------|
| 1 | Cross-platform testing | Validate on macOS, Linux, Windows (WSL) |
| 2 | Community feedback loop | Triage issues, adjust defaults based on real vault diversity |
| 3 | Skill file refactoring | Extract detailed rule sets into reference documents for maintainability |
| 4 | Getting started guide | Step-by-step onboarding for new users |

## v0.2.0 — Configurability

The **Settings Layer** — making skills adapt to your vault instead of the other way around.

Today, skills ship with opinionated defaults that work out of the box. v0.2.0 adds a configuration layer so every default becomes overridable.

We have identified **40 configurable attributes** across all skills, prioritized by user impact. See the full specification in [references/config-spec.md](references/config-spec.md).

### What Comes First (Tier 1)

These 11 attributes cause the most friction when they do not match your vault. They ship first:

| # | Attribute | Default | What it controls |
|---|-----------|---------|-----------------|
| 1 | `folders.inbox` | Auto-detect | Which folder skills scan by default |
| 2 | `folders.trash` | `_trash` | Where soft-deleted notes go |
| 3 | `folders.secret` | `_secret` | Where sensitive notes are moved |
| 4 | `folders.daily_notes` | Auto-detect | Your Daily Notes folder location |
| 5 | `cooldown_days` | `3` | Grace period before automation touches new notes |
| 6 | `scope` | `inbox` | Default scan scope (inbox, vault-wide, or specific folder) |
| 7 | `folders.excluded_prefixes` | `["_", "."]` | Folder prefixes to skip during scans |
| 8 | `skill_log.tag` | `true` | Toggle the VaultAutopilot tracking tag |
| 9 | `skill_log.callout` | `true` | Toggle the history callout at the end of notes |
| 10 | `uninformative_patterns` | 7 patterns (EN+DE) | Filename patterns that trigger rename — extensible for any language |
| 11 | `confirm` | `true` | Require confirmation before execution (disable for automation) |

7 of these 11 attributes are **global** — they affect all skills, not just note-rename. The configuration infrastructure benefits the entire plugin.

### Folder Names

Different vaults use different naming conventions. The inbox might be `Inbox`, `_Inbox`, `00-Inbox`, or `Eingang`. Same for trash, secret, and daily notes folders.

v0.2.0 introduces configurable folder mappings:

```yaml
folders:
  inbox: "00-Inbox"
  trash: "_trash"
  secret: "_secret"
  daily_notes: "Daily Notes"
```

Skills resolve these names from config instead of assuming defaults.

### Feature Toggles

Not every user wants every output. The skill-log (VaultAutopilot tag + callout history at the end of each note) is useful for tracking what happened — but some users prefer clean notes without automation traces.

```yaml
skill_log:
  tag: true          # Add VaultAutopilot tag to frontmatter
  callout: true      # Append history callout to note body
```

Both default to `true`. Set to `false` to disable.

### Output Shape

Control what skills write into your notes:

```yaml
output:
  date_format: "YYYY-MM-DD"    # Date format in skill-log entries
  add_tag: true                 # Whether to add the VaultAutopilot tag
  add_callout: true             # Whether to append the history callout
```

This is a **Settings Layer**, not a rule engine. It controls the shape of skill output — what gets written, where, and in what format. It does not change skill logic or classification rules.

### Vault Onboarding

A new skill that analyzes your vault structure and proposes a configuration:

- Detects existing folder conventions
- Identifies inbox, archive, and daily notes locations
- Suggests property schemas based on what your notes already use
- Generates a starter config file

Run it once when you install the plugin. Re-run it when your vault evolves.

## v0.3.0 — Tag Management and Orchestration

### tag-manage Skill

Audits tag quality, suggests tags from content, cleans duplicates, enforces naming conventions.

| # | Feature | Description |
|---|---------|-------------|
| 1 | Tag audit | Find unused, duplicate, and inconsistent tags |
| 2 | Auto-tagging | Suggest tags based on note content |
| 3 | Tag cleanup | Merge duplicates, fix casing, remove orphans |
| 4 | Naming conventions | Enforce kebab-case, singular nouns, or your own rules |

### Multi-Skill Orchestration

Run skills in sequence with a single command. Example workflow:

```
inbox-sort → note-rename → property-enrich → property-describe
```

The orchestrator handles ordering, passes findings between skills, and produces a combined report.

---

Have an idea? [Open an issue](https://github.com/neckarshore-skills/obsidian-vault-autopilot/issues) or check [CONTRIBUTING.md](CONTRIBUTING.md).
