---
name: property-enrich
status: stable
description: Use when Obsidian vault notes have incomplete or missing YAML frontmatter and need structural metadata filled in. Best for bulk enrichment of an entire vault. Trigger phrases - "add properties", "enrich metadata", "fill frontmatter", "prepare my vault", "backfill created", "enrich before sort", "missing metadata", "incomplete frontmatter".
---

# Property Enrich

Fill missing structural metadata: `title`, `created`, `modified`. Additive only — never overwrites (except `modified`).

## When to Run This

**Recommended for bulk enrichment.** property-enrich fills `created`, `title`, and `modified` across your entire vault in one pass — efficient for initial setup or after a clone. Note-rename and inbox-sort auto-enrich `created` per-note during their runs (Nahbereich), so property-enrich is no longer a strict prerequisite. It remains the best choice for bulk metadata coverage and for filling `title` and `modified`, which other skills do not auto-enrich.

## Principle: Core + Nahbereich + Report

- **Core:** Fill missing metadata from content, path, filesystem
- **Nahbereich:** Create frontmatter if none exists
- **Report:** Fields added per type, source per note

## Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `cooldown_days` | 3 | Skip notes created within the last N days. Grace period so the user can review recent captures before automation touches them. **Date source:** YAML `created` field in frontmatter. If missing, evaluate via the Source Hierarchy (filename date > Git first-commit > filesystem birthtime), gated by the clone-cluster check (Step 3a) so clone-time birthtime never counts as a real creation date. Never use modification date. |
| `scope` | inbox | Which folder to scan. `inbox` = inbox root only (default). `inbox-tree` = inbox folder including all subfolders (opt-in for bulk-mode, e.g. initial vault setup). `vault` = entire vault excluding root. `folder:<path>` = specific subfolder. User confirms before execution. |
| `clone_cluster_skip` | true | When `true` (default), skip `created` enrichment for files whose only available date source is filesystem birthtime AND whose birthtime falls in a detected clone-cluster window. See `references/clone-cluster-detection.md`. Set to `false` to disable the gate (e.g. on known-clean vaults where you want birthtime-fallback behavior). |

## Protected Files

Never process or modify these files (see `references/vault-autopilot-note.md`):
- `_vault-autopilot.md` in vault root
- Any file starting with `_` in vault root (reserved for plugin management)

## Properties (v0.1.0)

| Property | Source | Overwrite? |
|----------|--------|-----------|
| `title` | First H1 heading, fallback: filename without `.md` | Never |
| `created` | Source Hierarchy (see below) | Never |
| `modified` | Filesystem mtime | **Always** (refreshed on every write) |

### `created` Source Hierarchy

When `created` is missing from YAML, derive it from the highest-priority available source. Prio 1 includes a normalization preprocessing step for non-ISO formats (v0.1.3+):

| Prio | Source | How | When reliable |
|------|--------|-----|---------------|
| 1 | YAML `created` exists | If value parses as ISO 8601 → use directly. Else try German `DD.MM.YYYY[, HH:mm:ss]` normalization (per `references/german-date-normalization.md`). If normalized, use the ISO result. If unparseable, flag as Class-C "unparseable date format" finding and fall through to Prio 2. **Never overwrite the YAML value** — additive-only contract preserved (the normalized form is used internally for downstream skills like cooldown evaluation; the YAML field stays as-authored). | Always |
| 2 | Filename date pattern | Parse `YYYY-MM-DD` from filename, e.g. `2024-03-14 Meeting Notes.md` | When user names files with dates |
| 3 | Git first-commit timestamp | `git log --follow --diff-filter=A --format=%aI -- <file>` | When vault is under Git |
| 4 | Filesystem birthtime (last resort) | `stat -f %SB` (macOS) / `stat -c %W` (Linux) | Only on native (non-cloned) vaults |

**Rules:**
- Try 1 through 4 in order, use the first valid date
- Log which source was used per note in the Report (Source column)
- If no source yields a valid date, skip the note and report it as a Finding

### Clone Detection Warning

When Source 4 (filesystem birthtime) is used AND all birthtimes in the batch cluster within a 1-hour window: log a warning in the Report.

> **Warning:** All created dates derived from filesystem birthtime within a narrow window. This vault may be a clone. Consider verifying dates manually.

The warning does NOT block execution — it informs only.

### Relational Properties (v0.2.0)

> **Deferred to v0.2.0.** Properties like `aliases`, `parent`, `source`, and `priority` are not filled in the current release.

## Pre-flight

Before **every** invocation of this skill — including resumed sessions and re-triggers within the same conversation:

1. **Always (every OS):** Run [`references/clone-preflight.md`](../../references/clone-preflight.md). It detects clone-induced birthtime clusters and emits a WARN before any date-derivation runs. Cross-platform — applies on macOS, Linux, and Windows. WARN-flow only; skill execution continues.
2. **On Windows additionally:** Follow [`references/windows-preflight.md`](../../references/windows-preflight.md) end-to-end (registry check, trailing-dot folder detection, Windows-aware file-enumeration pattern). The enumeration pattern in Step 6 of that preflight applies to every subsequent file-listing call this skill makes — `Scan` (step 2 below) included. On macOS or Linux, this preflight is a no-op.

Run the checks freshly each time. Do not assume a previous turn's pass result still holds — registry state, folder topology, and birthtime clustering can change between invocations and previous results are not authoritative.

## Workflow

1. **Discover vault** — resolve `${OBSIDIAN_VAULT_PATH}`. Ask for scope. Confirm if 50+ notes.
2. **Scan** — read frontmatter, path, filesystem timestamps per note.
   - **2a. Repair corrupted quoted-key variants first (Nahbereich, sanity-check).** Call `references/yaml-sanity.md` for each scanned note. Verdict-routing per `references/yaml-sanity.md` § "Per-skill policy":
     - `BROKEN_KEYS_INSIDE_COLON` (shape β — F26 inside-colon): normalize via `references/yaml-edits.md` recipe (f) — handles ALL quoted-key patterns (broadened from v0.1.0/v0.1.2 hardcoded list of `"created:"`/`"modified:"`). After normalization, resolve duplicate-key collisions per recipe (f) Step 3 (identical-value collisions silent-dedup'd, divergent-value collisions ABORT — see next bullet). Re-call sanity-check (idempotent fixpoint) — verdict must now be `OK`, `OK_QUOTED`, or `OK_NO_FRONTMATTER`.
     - `DUPLICATE_KEYS_IDENTICAL_VALUES` (v0.1.4 W4 — pre-existing plain duplicates with identical values): repair via recipe (f) silent dedup, then re-run sanity-check.
     - `DUPLICATE_KEYS_DIVERGENT_VALUES` (v0.1.4 W4 — F7 family; recipe (f) refused to auto-resolve): **skip the file** + log Class-A finding "duplicate-key-divergent-values" (route to user / note-rename for manual resolution). Recipe (f) leaves the file unchanged on disk; user must merge values manually.
     - `MULTIPLE_FRONTMATTER_BLOCKS` or `UNCLOSED_FRONTMATTER`: skip the file and log Class-A finding (route to user / note-rename).
     - `OK_QUOTED` (shape α — standard quoted-key, valid YAML): proceed normally; skill regexes accept both plain and standard-quoted forms.
     - `OK` / `OK_NO_FRONTMATTER`: proceed normally.

     This step is mandatory BEFORE Step 3 (Compute / Source Hierarchy walk) — without it, the Hierarchy falls through to filesystem birthtime on files where YAML had a valid (but broken-keyed) date. Historical bugs: F19 LIVE-CONFIRMED in GR-2 Cell 1 (2026-04-28) — 60 of 1016 inbox-tree files affected (5.9% blast-radius). F26 cluster generalizes the inside-colon pattern across all quoted-keys. F7 (GR-3 Cell 1, 2026-05-01) generalizes duplicate-key resolution beyond first-wins-silent.
3. **Compute** — for each note missing `created`: walk the Source Hierarchy (Prio 1 through 3, with German-date normalization in Prio 1 per `references/german-date-normalization.md`, then Prio 4 gated by Step 3a). Compute `title` from H1 or filename. Read `modified` from filesystem.
   - **3a. Clone-cluster gate before Prio 4 (filesystem birthtime).** Before the first invocation of Prio 4, detect the vault-wide clone-cluster window per `references/clone-cluster-detection.md` § "Cluster Window Detection". If a cluster is declared, for every note where Prio 1-3 yielded no value: invoke recipe (a) `is_birthtime_in_clone_cluster_window`. If recipe (a) returns 0 (in cluster), invoke recipe (b) `has_alternate_date_source` — note that recipe (b) walks Prio 1-3 again as a defensive re-check. If recipe (b) returns 1 (no alt source), SKIP this note's `created` enrichment: do NOT write a `created` field, log the file in the per-skill findings file as Class-C "clone-cluster birthtime, no alt source" per `references/clone-cluster-detection.md` § "Findings format". The note still gets `title` and `modified` enriched normally — only `created` is gated. If recipe (a) returns 1 (not in cluster), proceed with Prio 4 (filesystem birthtime) as before. Behavior is gated by config field `clone_cluster_skip` (default `true`); when `false`, this step is a no-op. If no cluster is declared (fewer than 10 files in any 1 h bin), this step is a no-op for every note.
4. **Preview** — summary table with sample changes including Source column. Wait for confirmation.
5. **Write** — pre-write, call `references/yaml-sanity.md` again as defense-in-depth (sanity-check is idempotent — repeated calls are no-ops if Step 2a already normalized). Add fields using line-by-line YAML edits per `references/yaml-edits.md`. Never use `str.replace`. Never use multi-line regex with `(?s)` or `.+`/`.*` against newline-spanning input. New fields are inserted as new lines immediately before the closing `---` (recipe c). List-field appends (e.g. `tags:`) follow recipe d in `references/yaml-edits.md` § "Append to a list field". Preserve all existing field values.
6. **Skill Log** — for each enriched file: add `VaultAutopilot` tag and append skill log callout row (see `references/skill-log.md`). Action format: `Added [field list] (created source: [source])`. YAML tag-list edits and skill-log callout edits MUST follow `references/yaml-edits.md` (recipes d + e).
7. **Write findings file** — for any non-trivial Findings (Class A/B/C/D as defined in `references/findings-file.md`), append a section to `<VAULT>/_vault-autopilot/findings/<YYYY-MM-DD>-property-enrich.md`. Create the folder chain if missing. Never edit prior findings — append-only ledger.
8. **Report and log** — append to `logs/run-history.md`.

## Boundaries

- Additive only (except `modified`)
- Does not write `description` (property-describe), `status` or `type` (property-classify)
- Does not modify note body, delete, move, or rename files
- Does not fill `aliases`, `parent`, `source`, `priority` in v0.1.0

## Report Format

```
## Property Enrich Report — [Date]

### Done

| # | Note | title | created | Source | modified | Findings |
|---|------|-------|---------|--------|----------|----------|
| 1 | Budget Review.md | Budget Review | 2024-06-15 | filename | 2026-04-13 | — |
| 2 | Architecture.md | Architecture | 2025-11-20 | git | 2026-04-13 | — |

- Notes enriched: X | Already complete: X | Skipped (no valid date): X

### Clone Detection

[If triggered:] Warning — all birthtime-derived dates cluster within 1 hour. This vault may be a clone.
[If not triggered:] No clone indicators detected.

### Findings

- [Observations for other skills]
```

## Quality Check

- [ ] No existing property values were overwritten (except `modified`)
- [ ] `created` Source Hierarchy was followed (filename > git > birthtime)
- [ ] Source column in report shows derivation per note
- [ ] Preview shown and confirmed before writing
- [ ] No `aliases`, `parent`, `source`, or `priority` fields were written
- [ ] Tag-list edits used line-by-line procedure per `references/yaml-edits.md` (no multi-line regex, no `str.replace`)
- [ ] Sanity-check called pre-Compute (Step 2a) and pre-Write (Step 5) per `references/yaml-sanity.md`
- [ ] Quoted-key broken-key variants (shape β — inside-colon) normalized via recipe (f), not appended-below
- [ ] Duplicate-key divergent-value collisions (F7 family) ABORT recipe (f), file unchanged, Class-A finding logged — never silent-pick a winner (v0.1.4 W4)
- [ ] Duplicate-key collisions resolved (first-occurrence-wins, subsequent removed and logged as Class-D)
- [ ] German date format (`DD.MM.YYYY[, HH:mm:ss]`) recognized in Prio 1 per `references/german-date-normalization.md` — not silently dropped to Prio 2-4
- [ ] Findings file written per `references/findings-file.md` for any non-trivial findings
- [ ] Step 3a clone-cluster gate followed per `references/clone-cluster-detection.md` — files in cluster window with no alt source had `created` SKIPPED (not Prio-4-enriched), Class-C finding logged, `title`/`modified` still enriched
