---
name: property-classify
status: beta
description: Use when Obsidian vault notes need their `status` and `type` frontmatter properties set or audited. Trigger phrases - "set note types", "check status", "classify notes", "status audit", "type audit", "lifecycle check", "draft notes", "assign types". Also trigger when notes have `type: TBD` or no status field, or when the user wants to know which notes need attention based on completeness.
---

# Property Classify

Assign `status` (lifecycle) and `type` (category) in one pass. Rule-based, no AI, cheap to run.

## Principle: Core + Nahbereich + Report

- **Core:** Set `status` and `type` from content, metadata, and path
- **Nahbereich:** Normalize casing (`Status` → `status`)
- **Report:** Classifications, conflicts, distribution

## Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `cooldown_days` | 3 | Skip notes created within the last N days. Grace period so the user can review recent captures before automation touches them. **Date source:** YAML `created` field in frontmatter. If missing, evaluate via the Source Hierarchy (filename date > Git first-commit > filesystem birthtime, gated by the clone-cluster check) — read-only for cooldown purposes; classify does not write `created` (that is property-enrich's job). Never use modification date. |
| `clone_cluster_skip` | true | When `true` (default), Step 2b DEFERs classification for files whose only available date source is filesystem birthtime AND whose birthtime falls in a detected clone-cluster window (cooldown undecidable). See `references/clone-cluster-detection.md`. Set to `false` to fall through to filesystem birthtime for cooldown evaluation. |
| `scope` | inbox | Which folder to scan. `inbox` = inbox only. `vault` = entire vault. User confirms before execution. |

## Protected Files

Never process or modify these files (see `references/vault-autopilot-note.md`):
- `_vault-autopilot.md` in vault root
- Any file starting with `_` in vault root (reserved for plugin management)

## Status Values (priority order, highest wins)

| Status | Rule |
|--------|------|
| `permanent` / `evergreen` | **Protected** — never changed, skip entirely |
| `archived` | Any folder-path segment contains `archive` (case-insensitive — e.g. `099_Archive/`, `Archive/`). Same matching semantics as the Layer-2 type rule below — the two rules must agree on the same folder. |
| `reviewed` | All checkboxes `[x]`, at least one exists |
| `polished` | Has real `description` (not TBD) + 3+ `aliases` + no placeholder fields |
| `draft` | Default — anything not matching above |

## Type Classification (two layers)

**Layer 1 — Content signals (checked first, more specific):**

| Signal | Type |
|--------|------|
| `ISBN` or `Author:` in frontmatter/body | `book` |
| `Agenda:` heading or field | `meeting` |

**Layer 2 — Path fallback (if no content signal):**

| Path contains | Type |
|---------------|------|
| `inbox` | `inbox` |
| `project` | `project` |
| `people` or `contact` | `person` |
| `meeting` | `meeting` |
| `resource` | `resource` |
| `archive` | `archive` |
| `template` | `template` |

**Path semantics:** "Path contains" means the **folder path relative to the vault root, excluding the filename**. A note named `Meeting with Bob.md` inside `notes/` must NOT become `type: meeting` via its own filename — only folder names carry Layer-2 intent.

**No match:** `type: TBD`. Content signals override path signals.

## Conflict Handling

Existing `type` (not `TBD`/`inbox`) + different proposed value = **conflict**, do not overwrite. Notes with `TBD`, `inbox`, or no `type` can always be set.

## Pre-flight

Before **every** invocation of this skill — including resumed sessions and re-triggers within the same conversation:

1. **Always (every OS):** Run [`references/clone-preflight.md`](../../references/clone-preflight.md). It detects clone-induced birthtime clusters and emits a WARN before any date-derivation runs. Cross-platform — applies on macOS, Linux, and Windows. WARN-flow only; skill execution continues.
2. **On Windows additionally:** Follow [`references/windows-preflight.md`](../../references/windows-preflight.md) end-to-end (registry check, trailing-dot folder detection, Windows-aware file-enumeration pattern). The enumeration pattern in Step 6 of that preflight applies to every subsequent file-listing call this skill makes — `Scan` (step 2 below) included. On macOS or Linux, this preflight is a no-op.

Run the checks freshly each time. Do not assume a previous turn's pass result still holds — registry state, folder topology, and birthtime clustering can change between invocations and previous results are not authoritative.

## Workflow

1. **Discover vault** — resolve `${OBSIDIAN_VAULT_PATH}`. Ask for scope. Confirm if 50+ notes.
2. **Scan** — for each note in scope:
   - **2a. Pre-flight sanity-check.** Call `references/yaml-sanity.md`. Verdict-routing per `references/yaml-sanity.md` § "Per-skill policy" — classify is **additive-only on YAML health**: it never repairs, it defers to the repair-capable skills:
     - `BROKEN_KEYS_INSIDE_COLON` (shape β — F26): SKIP + Class-C finding "broken-yaml: inside-colon shape detected — run property-enrich first" (NOT repair).
     - `DUPLICATE_KEYS_DIVERGENT_VALUES` (F7 family): skip + Class-A finding "duplicate-key-divergent-values" (route to user / note-rename for resolution).
     - `DUPLICATE_KEYS_IDENTICAL_VALUES`: SKIP + Class-C finding "duplicate-keys-identical: run property-enrich first to dedup".
     - `MULTIPLE_FRONTMATTER_BLOCKS` or `UNCLOSED_FRONTMATTER`: skip + Class-A finding (route to note-rename for handling).
     - `OK_QUOTED` (shape α): proceed normally; classification regexes accept both plain and standard-quoted forms.
     - `OK` / `OK_NO_FRONTMATTER`: proceed normally.
   - **2b. Clone-cluster gate for cooldown evaluation.** Before applying `cooldown_days`, for each candidate note where YAML `created` is absent: detect the scope-wide clone-cluster window per `references/clone-cluster-detection.md` § "Cluster Window Detection" once per invocation, then walk the Source Hierarchy Prio 1-3 read-only (filename date > Git first-commit). If Prio 1-3 yields no value, invoke recipe (a) `is_birthtime_in_clone_cluster_window`. If recipe (a) returns 0 (in cluster) AND recipe (b) `has_alternate_date_source` returns 1 (no alt source), DEFER: treat the file as `cooldown unknown`, SKIP classification for it, and log Class-C "clone-cluster birthtime, no alt source — cooldown undecidable" in the findings file. The note is reported in the Skipped section (not silently dropped). Otherwise, evaluate `cooldown_days` against the available date source. Behavior gated by config `clone_cluster_skip` (default `true`); when `false`, cooldown falls through to filesystem birthtime.
   - **2c. Read** frontmatter, path, checkboxes, and first ~500 chars.
3. **Classify** — apply status hierarchy + type layers. Detect conflicts.
4. **Preview** — group by action (no change, upgrades, downgrades, conflicts). Wait for confirmation.
5. **Write** — pre-write, call `references/yaml-sanity.md` again as defense-in-depth (idempotent). Set `status` and `type` via line-by-line YAML edits per `references/yaml-edits.md` only — recipe (b) to replace an existing field value, recipe (c) to add a missing field. Never `str.replace`, never multi-line regex. Preserve all other fields. Casing Nahbereich (`Status` → `status`) is a recipe-(b)-style single-line replacement of the key, value untouched.
6. **Skill Log** — for each classified file: add `VaultAutopilot` tag and append skill log callout row (see `references/skill-log.md`). YAML tag-list edits and skill-log callout edits MUST follow `references/yaml-edits.md` (recipes d + e).
7. **Write findings file** — for any non-trivial Findings (Class A/B/C/D as defined in `references/findings-file.md`), append a section to `<VAULT>/_vault-autopilot/findings/<YYYY-MM-DD>-property-classify.md`. Create the folder chain if missing. Never edit prior findings — append-only ledger.
8. **Report and log** — append to `logs/run-history.md`.

## Boundaries

- ONLY writes `status` and `type` (plus the casing Nahbereich on those two keys) — no other property modified
- Does not write `created` — cooldown derivation is read-only (property-enrich owns `created`)
- Does not repair broken YAML — defers to property-enrich / note-rename per Step 2a
- Does not touch note body content; does not create, delete, move, or rename files

## Report Format

```
## Property Classify Report — [Date]

### Done
- Classified: X notes | Status set: X | Type set: X
- Conflicts flagged: X (not overwritten)

### Skipped
- Cooldown: X | Cooldown undecidable (clone-cluster): X | Broken YAML (deferred): X | Protected: X

### Distribution
- Status: draft X | polished X | reviewed X | archived X | protected X
- Type: inbox X | project X | meeting X | book X | TBD X

### Findings
- [Status downgrades, type conflicts, observations for other skills]
```

## Quality Check

- [ ] Protected notes (`permanent`/`evergreen`) were not modified
- [ ] Conflicts were flagged, not overwritten
- [ ] Preview shown and confirmed before writing
- [ ] Sanity-check called pre-Scan (Step 2a) and pre-Write (Step 5) per `references/yaml-sanity.md`
- [ ] Broken-YAML files (shape β, duplicates, multi-block, unclosed) SKIPPED with finding — never repaired, never written through (additive-only)
- [ ] Cooldown evaluated via YAML `created` / Source Hierarchy with clone-cluster gate — never raw birthtime on a clustered vault (Step 2b)
- [ ] Status `archived` and type `archive` agreed on every archive-folder note (same path semantics)
- [ ] Layer-2 type matching used folder path only, excluding the filename
- [ ] All writes used `references/yaml-edits.md` recipes (b/c for fields, d/e for tag + skill log)
- [ ] Findings file written per `references/findings-file.md` for any non-trivial findings
