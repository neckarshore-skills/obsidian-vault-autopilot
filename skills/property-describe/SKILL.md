---
name: property-describe
status: beta
description: Use when Obsidian vault notes need AI-generated description properties in their YAML frontmatter. Trigger phrases - "add descriptions", "fill descriptions", "generate summaries", "description property", "empty description", "missing description". Also trigger when notes have placeholder descriptions (TBD, TODO) or when batch-filling descriptions across a folder. This is a token-intensive operation (reads full note content) — run it deliberately, not as part of every property pass.
---

# Property Describe

Generate a concise `description` property for vault notes by reading their content and distilling it to one sentence (max 250 characters). Like a meta description for a web page — scannable, specific, English.

## Principle: Core + Nahbereich + Report

- **Core:** Generate and write `description` values from note content
- **Nahbereich:** Write `description: TBD` for notes too thin to summarize (prevents re-scanning)
- **Report:** Descriptions written, skipped, too-thin notes flagged

## Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `cooldown_days` | 3 | Skip notes created within the last N days. Grace period so the user can review recent captures before automation touches them. **Date source:** YAML `created` field in frontmatter. If missing, evaluate via the Source Hierarchy (filename date > Git first-commit > filesystem birthtime), gated by the clone-cluster check (Step 2c) so clone-time birthtime never counts as a real creation date — read-only for cooldown purposes; describe does not write `created` (that is property-enrich's job). Never use modification date. |
| `scope` | inbox | Which folder to scan. `inbox` = inbox root only (default). `inbox-tree` = inbox folder including all subfolders (opt-in for bulk-mode, e.g. initial vault setup). `vault` = entire vault excluding root. `folder:<path>` = specific subfolder. User confirms before execution. |
| `clone_cluster_skip` | true | When `true` (default), Step 2c DEFERs description generation for files whose only available date source is filesystem birthtime AND whose birthtime falls in a detected clone-cluster window (cooldown undecidable). See `references/clone-cluster-detection.md`. Set to `false` to fall through to filesystem birthtime for cooldown evaluation. |

## Protected Files

Never process or modify these files (see `references/vault-autopilot-note.md`):
- `_vault-autopilot.md` in vault root
- Any file starting with `_` in vault root (reserved for plugin management)

## Token Cost Warning

This skill reads full note content and generates AI summaries. It is the most expensive property skill. Do not bundle it into routine property passes — trigger it deliberately when descriptions are the goal.

## Which Notes Get a Description

Process only if ALL true:
1. Has real content (2+ sentences beyond frontmatter/headings)
2. `description` is missing, empty, or placeholder (`TBD`, `TODO`, `...`, `PLACEHOLDER`, `FIXME`, any string < 10 chars)
3. Not protected (`status: permanent` or `status: evergreen`)

**Too-thin notes** (< 2 sentences): write `description: TBD` and move on. Skip if already `TBD`.

## How to Write a Good Description

- **Max 250 characters**, one sentence, always English
- Content-first: what the note contains, not what it is
- No fluff ("This note contains...", "Summary of...")
- Include specifics: names, dates, tools, numbers when they fit
- Proper nouns stay in original language ("Steuerbelege 2025")
- **Source-of-content policy:** Every claim in the description MUST be traceable to (a) note body text, (b) URL-encoded text in body links, OR (c) note title. NEVER fabricate or infer beyond these sources. Halluzinations-Audit-Pattern: every claim points at a source token in the note. URL-slugs that read as natural language (e.g. `linkedin.com/posts/charly-wargnier_n8n-automation`) count as URL-encoded text — but only the literal tokens visible in the slug, not inferred relationships.

## Pre-flight

Before **every** invocation of this skill — including resumed sessions and re-triggers within the same conversation:

1. **Always (every OS):** Run [`references/clone-preflight.md`](../../references/clone-preflight.md). It detects clone-induced birthtime clusters and emits a WARN before any date-derivation runs. Cross-platform — applies on macOS, Linux, and Windows. WARN-flow only; skill execution continues.
2. **On Windows additionally:** Follow [`references/windows-preflight.md`](../../references/windows-preflight.md) end-to-end (registry check, trailing-dot folder detection, Windows-aware file-enumeration pattern). The enumeration pattern in Step 6 of that preflight applies to every subsequent file-listing call this skill makes — the per-note iteration in `Filter` (step 2 below) and any vault-scope walks included. On macOS or Linux, this preflight is a no-op.

Run the checks freshly each time. Do not assume a previous turn's pass result still holds — registry state, folder topology, and birthtime clustering can change between invocations and previous results are not authoritative.

## Workflow

1. **Discover vault** — resolve `${OBSIDIAN_VAULT_PATH}`. Ask for target scope.
2. **Filter** — for each note in scope:
   - **2a. Pre-flight sanity-check.** Call `references/yaml-sanity.md`. Verdict-routing per `references/yaml-sanity.md` § "Per-skill policy":
     - `BROKEN_KEYS_INSIDE_COLON` (shape β — F26 inside-colon): SKIP + Class-C finding "broken-yaml: inside-colon shape detected — run property-enrich first" (NOT repair — boundaries: describe is additive-only).
     - `DUPLICATE_KEYS_DIVERGENT_VALUES` (v0.1.4 W4 — F7 family): skip + Class-A finding "duplicate-key-divergent-values" (route to user / property-enrich for resolution).
     - `DUPLICATE_KEYS_IDENTICAL_VALUES` (v0.1.4 W4): SKIP + Class-C finding "duplicate-keys-identical: run property-enrich first to dedup" (additive-only — defer to repair-capable skill).
     - `MULTIPLE_FRONTMATTER_BLOCKS` or `UNCLOSED_FRONTMATTER`: skip + Class-A finding (route to note-rename for handling).
     - `OK_QUOTED` (shape α): proceed normally; broadened filter regex catches both plain and standard-quoted forms.
     - `OK` / `OK_NO_FRONTMATTER`: proceed normally.
   - **2b. Eligibility check.** Identify notes needing descriptions using the **broadened DESC_KEY_PATTERN regex** — accepts plain identifier (`description:`) AND standard quoted-key (`"description":`, shape α). Per-line regex pattern:

     ```python
     DESC_KEY_PATTERN = re.compile(r'''
         ^
         (?:
             ([A-Za-z_][A-Za-z0-9_-]*)        # plain identifier
             |
             "([^":]+)"                        # standard quoted-key (no inside-colon!)
         )
         \s*:
     ''', re.VERBOSE)
     ```

     The inner `[^":]+` (NO inside-colon allowed) is what distinguishes shape α (matched here) from shape β (handled in 2a — SKIP). Apply "Which Notes Get a Description" rules (missing/placeholder/too-thin).
   - **2c. Clone-cluster gate for cooldown evaluation.** Before applying cooldown_days, for each candidate note where YAML `created` is absent: detect the vault-scope clone-cluster window per `references/clone-cluster-detection.md` § "Cluster Window Detection" once per invocation, then invoke recipe (a) `is_birthtime_in_clone_cluster_window`. If recipe (a) returns 0 (in cluster) AND recipe (b) `has_alternate_date_source` returns 1 (no alt source), DEFER cooldown evaluation: treat the file as `cooldown unknown`, SKIP description generation, and log Class-C "clone-cluster birthtime, no alt source — cooldown undecidable" in the findings file. The note is reported in the Skipped section (not silently dropped). Otherwise, evaluate cooldown_days against the available date source (YAML `created`, filename, git, or filesystem birthtime if not in cluster). Behavior gated by config `clone_cluster_skip` (default `true`); when `false`, cooldown falls through to filesystem birthtime as before.
3. **Generate** — read content, produce 250-char summary per note. For long notes (5000+ words): read title, first 50 lines, headings, last 10 lines.
4. **Preview** — show table (filename, generated description, char count). Wait for confirmation. User can approve all, review individually, or reject specific entries.
5. **Write** — pre-write, call `references/yaml-sanity.md` again as defense-in-depth (sanity-check is idempotent). Set `description` in YAML frontmatter. Line-by-line replacement only (never `str.replace`, never multi-line regex). See `references/yaml-edits.md` for the canonical recipes (recipe b — replace single field value). Preserve all other fields. Single-quote the value, escape apostrophes by doubling (`'`→`''`).
6. **Skill Log** — for each described file: add `VaultAutopilot` tag and append skill log callout row (see `references/skill-log.md`). YAML tag-list edits and skill-log callout edits MUST follow `references/yaml-edits.md` (recipes d + e).
7. **Write findings file** — for any non-trivial Findings (Class A/B/C/D as defined in `references/findings-file.md`), append a section to `<VAULT>/_vault-autopilot/findings/<YYYY-MM-DD>-property-describe.md`. Create the folder chain if missing. Never edit prior findings — append-only ledger.
8. **Report and log** — append to `logs/run-history.md`.

## Boundaries

- ONLY writes `description` — no other property modified
- Does not touch note body content
- Does not create, delete, move, or rename files

## Report Format

```
## Property Describe Report — [Date]

### Done
- Descriptions written: X | TBD written (too thin): X

### Skipped
- Already has description: X | Protected: X

### Findings
- [Observations for other skills]
```

## Quality Check

- [ ] No description exceeds 250 characters
- [ ] All descriptions are in English
- [ ] Preview was shown and confirmed before writing
- [ ] No properties other than `description` were modified
- [ ] Sanity-check called pre-Filter (Step 2a) and pre-Write (Step 5) per `references/yaml-sanity.md`
- [ ] Quoted-key broken-key files (shape β — F26 inside-colon) SKIPPED with Class-C finding (NOT repaired, NOT written — additive-only boundary)
- [ ] Duplicate-key divergent-value collisions (F7 family) skip + Class-A finding; describe is additive-only and never auto-resolves (v0.1.4 W4)
- [ ] Filter regex accepted both plain (`description:`) and standard quoted-key (`"description":`, shape α) forms
- [ ] Every description claim is traceable to body, URL-text, or title (no fabrication)
- [ ] Step 2c clone-cluster gate followed per `references/clone-cluster-detection.md` — files in cluster window with no alt source were SKIPPED (cooldown undecidable, Class-C finding logged), not silently described from clone-time birthtime
