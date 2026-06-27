# Changelog

All notable, user-facing changes to Obsidian Vault Autopilot are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(pre-1.0 — minor versions may include user-visible behavior changes).

For implementation detail and internal release notes, see [`logs/changelog.md`](logs/changelog.md).

## [0.3.0] — 2026-06-27

### Added

- **Canonical property order.** `property-enrich` now finalizes frontmatter into a consistent, human-readable order — `title` first, `description` second, then `type`/`status`/`created`/`modified`, your custom fields, and `tags` always last. The reorder moves each property as a whole unit (a key plus its list items or multi-line value), so list items are never orphaned. It is idempotent (a note already in order is left untouched) and configurable via `property_order`.
- **`modified` carries a time.** `property-enrich` now writes `modified` as `YYYY-MM-DD HH:MM` instead of date-only, so it stays greppable and renders as text in Obsidian rather than a date-picker widget.

### Fixed

- **Tag separator variants now fold together.** A brand or compound tag written without its separator now merges into the canonical form: `MercedesBenz` / `mercedes_benz` → `Mercedes-Benz`, `AIML` → `AI-ML`. Previously these survived tag cleanup because matching required the exact hyphenated spelling.
- **Tag-organize keeps brand names whole.** A family of LinkedIn tags is now proposed under the parent `LinkedIn` instead of the truncated `Linked` (the name builder split the brand at its internal capital letter). Applies to internal-capital brands generally (ChatGPT, FastAPI, …).

### Changed

- **The plugin now meets its own frontmatter standard.** Report notes the plugin writes into your vault carry `title` + `description` + `tags` in canonical order. The machine-read findings ledger (`_vault-autopilot/findings/`) keeps its minimal schema as a documented, intentional exception (it is data storage, not a human-facing note).
- **Tag organization matured.** The tag-organize workflow that developed across the 0.2.x line — the browsable proposal note, the Implement / Decide / Ignore confidence triage with per-family note counts, and declared-hierarchy nesting — is consolidated under this release.

## [0.1.5] — 2026-05-07

### Added

- Cross-platform clone-cluster warning. When you clone an Obsidian vault, every file's filesystem creation date gets reset to the clone moment. macOS and Linux users now also see a non-blocking warning at the start of each skill run if their vault shows a clone-cluster pattern — previously this was a Windows-only warning.

### Fixed

- **macOS timezone bug in clone-cluster detection.** A bug in v0.1.4's clone-detection logic compared timestamps using a format that returned local time tagged with a UTC marker. On any macOS machine outside the UTC timezone, the comparison was off by the local-UTC offset and silently produced wrong skip verdicts, causing date-derivation skills to write the clone time as the note's creation date.

### Notes

If you ran `property-enrich` on a cloned vault under v0.1.4 on a non-UTC macOS host between 2026-05-07 (v0.1.4 ship) and v0.1.5 upgrade, some files may have the clone time saved as their `created` date. Just upgrading to v0.1.5 and re-running `property-enrich` is **not enough** — the skill is additive-only and won't overwrite an existing `created` value. Three-step remediation:

1. Run `scripts/detect-clone-cluster.sh` against your vault to identify the cluster window.
2. For each file with a `created` value inside that window, blank the `created` field (delete the YAML line).
3. Re-run `property-enrich`. Files with no alternative date source (filename `YYYY-MM-DD` pattern, git first-commit) will surface as findings instead of being silently overwritten.

Linux, Windows, and UTC-macOS hosts were not affected.

## [0.1.4] — 2026-05-07

### Fixed

- **Windows trailing-dot folder enumeration.** Windows silently strips trailing dots and trailing spaces from folder names when enumerating files. A folder like `030_Systems - reference material.` was invisible to PowerShell — every skill walking the vault missed files inside. Fixed by using the Windows extended-path prefix (`\\?\`).
- **Clone-cluster skip gate.** When a vault clone collapses every file's creation time onto the clone moment, skills now skip writing `created` for affected files instead of poisoning them with the clone time. Recoverable absence is strictly better than poisoned presence. The user gets a clear list of skipped files in the report.
- **Robocopy clone integrity preflight.** Windows users now see a non-blocking warning at the start of each skill run if their vault shows a clone-time birthtime cluster — even when `robocopy /COPY:DAT` was used (post-clone Windows background services can reset creation times back to the clone moment).
- **Duplicate-key resolution.** When YAML frontmatter contains the same key twice with different values (e.g. `status: draft` AND `status: ready-for-designer`), skills now abort the repair and surface a finding instead of silently picking one value.

## [0.1.3] — 2026-04-29

### Added

- Pre-write YAML sanity check across all property-writing skills (defense-in-depth, idempotent).
- Recognition of German DACH date format (`DD.MM.YYYY[, HH:mm:ss]`) in `property-enrich`.

### Fixed

- **Apple Notes import frontmatter repair.** Skills now detect and repair the quoted-key pattern that Apple Notes occasionally leaves in exports (e.g. `"created:":` instead of `created:`). Strict YAML parsers cannot read these, so without the repair the date was lost and the skill fell back to filesystem birthtime.

## [0.1.2] — 2026-04-27

### Fixed

- **YAML and Markdown edit safety.** Skills no longer use multi-line regular expressions for YAML or callout edits — both caused subtle frontmatter corruption in earlier versions. Line-by-line edit recipes are now codified in a shared reference and called by every property-writing skill.

### Added

- Vault-side findings ledger (`_vault-autopilot/findings/<YYYY-MM-DD>-<skill>.md`) for cross-session continuity. Append-only — prior findings are never edited or renumbered.

## [0.1.1] — 2026-04-27

### Fixed

- Windows preflight gate now runs on every skill invocation, with no caching across conversation turns. A previous gate could be skipped via "Resume Session" if the registry value had changed mid-conversation.

### Changed

- Plugin marketplace cache: version bump enables existing installs to receive updates. The marketplace caches plugin content by version field, so every release that touches plugin content bumps the version.

## [0.1.0] — 2026-04-01

### Added

- Initial release with 4 launch-scope skills: `inbox-sort`, `note-rename`, `property-enrich`, `property-describe`.
- Three additional skills (`note-quality-check`, `property-classify`, `tag-manage`) shipped as in-development / planned (see README's "On the Roadmap" section).
- Shared run history (`logs/run-history.md`) and changelog (`logs/changelog.md`).
- Windows preflight gate for the four launch-scope skills.
- Soft-delete to `_trash/` with recovery metadata for all destructive operations.
- Skill log: `VaultAutopilot` tag and per-note callout history for every processed note.

<!-- Release-tag links will be added once GitHub releases are published. For per-component change detail, see logs/changelog.md. -->

