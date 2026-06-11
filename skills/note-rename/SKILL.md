---
name: note-rename
status: stable
description: Use when Obsidian vault notes have poor, generic, or uninformative filenames and need clear, descriptive names. Trigger phrases - "rename notes", "fix note names", "clean up filenames", "give notes better names". Also trigger for single notes - "rename this note", "give this a better name". Trigger when the user mentions "Untitled notes", "unnamed notes", or notes that are hard to find by name.
---

# Note Rename

Give poorly named vault notes clear, descriptive filenames. Rename and fix backlinks. No sorting, no restructuring.

## Principle: Core + Nahbereich + Report

- **Core:** Rename uninformative filenames, update backlinks across vault
- **Nahbereich:** Trash accidental notes via soft-delete (see rule below and `references/trash-concept.md`). Minimal YAML syntax repairs when already editing frontmatter. Syntactic fixes only — never add or change field values (that is property-enrich's job). Allowed repairs:
  - `*` → `-` in tag lists
  - Remove duplicate `---` separators
  - Convert inline tags `[X]` to block format
  - Remove junk text before opening `---` (e.g. dictation artifacts like `Thx ---` → `---`)
  - Fix quoted keys with embedded colon: `"type:"` → `type` (the colon belongs to YAML syntax, not the key name)
  - Fill missing YAML `created` from the Source Hierarchy (filename date > Git first-commit > filesystem birthtime) before evaluating cooldown. See `docs/metadata-requirements.md`. This prevents birthtime corruption on subsequent skill runs.
  - **Execution precedence:** the quoted-key and duplicate-`---` repairs above are governed by Step 4a's sanity-check routing — apply them via `references/yaml-edits.md` recipe (f), which resolves duplicate-key collisions (identical → silent dedup; divergent → ABORT: skip + Class-A finding, no rename). Never hand-apply a key fix in a way that bypasses the recipe (f) Step 3 collision check.
- **Report:** Renames, backlink updates, findings for other skills

## Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `cooldown_days` | 3 | Skip notes created within the last N days. Grace period so the user can review recent captures before automation touches them. **Date source:** YAML `created` field in frontmatter. If missing, the skill auto-enriches `created` from the Source Hierarchy (filename date > Git first-commit > filesystem birthtime) before evaluating cooldown — see Nahbereich. Never use modification date. |
| `clone_cluster_skip` | true | When `true` (default), Step 4b SKIPs `created` enrichment for files whose only available date source is filesystem birthtime AND whose birthtime falls in a detected clone-cluster window. See `references/clone-cluster-detection.md`. The rename flow still runs (filename change applied), but the YAML `created` field is left absent (recoverable, not poisoned). Set to `false` to disable. |
| `scope` | inbox | Which folder to scan. `inbox` = inbox root only (default). `inbox-tree` = inbox folder including all subfolders (opt-in for bulk-mode, e.g. initial vault setup). `vault` = entire vault excluding root. `folder:<path>` = specific subfolder. User confirms before execution. |

## Scope Rules

- **Vault root is always excluded** unless the user explicitly asks to process root-level files. Root files are typically structural (OPS docs, config notes, plugin files) and rarely rename candidates.
- Folders starting with `_` are excluded from scanning (`_trash/`, `_secret/`, `_test-backup/`).
- Folders starting with `.` are excluded (`.trash/`, `.obsidian/`).
- Template folders (e.g. `00_Templates`) are excluded.

## Protected Files

Never rename or process these files (see `references/vault-autopilot-note.md`):
- `_vault-autopilot.md` in vault root
- Any file starting with `_` in vault root (reserved for plugin management)

## Rename Candidates

Rename notes with **uninformative** filenames: `Untitled`, `Unbenannt`, `New Note`, `Draft`, `Blank note`, `Note from iPhone`, `Quick Note`, URL-only names, hash-only names, obvious typos (95%+ clear intent).

**Never rename:** Already descriptive names.

**Daily Notes (`YYYY-MM-DD.md`):** Not automatically kept. Classify by content:
- **Empty or boilerplate-only** → Trash candidate (accidental note detection)
- **Has content (links, text, ideas)** → Rename candidate. Keep date prefix: `YYYY-MM-DD - Context - Detail`
- **Multi-topic (links from different platforms, mixed themes)** → TBD suffix. Flag for manual review.

**Web captures:** Apply prefix per `references/web-capture-detection.md`. Skip existing categorical prefixes.

**Unclear cases:** `[Original Name] - TBD`. When the original name contains a date, keep the date first: `YYYY-MM-DD - TBD`. The date must always lead for chronological sorting.

## Accidental Note Detection (Nahbereich)

Soft-delete to `_trash/` if ALL true: (1) generic filename, (2) no content beyond template boilerplate, (3) frontmatter has only generic tags and no real title. Add trash metadata per `references/trash-concept.md`. When in doubt → TBD prefix instead.

## Daily Note Detection (Nahbereich)

Notes matching the Daily Note pattern (`YYYY-MM-DD.md`) get special handling. They are NOT auto-kept — classify by content (see Rename Candidates above). Location handling:

**Detection rules:**
1. **Misplaced daily notes** — `YYYY-MM-DD.md` outside the vault's canonical Daily Notes folder → move there first, then classify for rename like any other note. Add skill-log with Daily action for the move.
2. **Hybrid names** (`YYYY-MM-DD Some Description.md`) — this is NOT a daily note. It is a regular note with a date prefix. Process as a rename candidate — the date prefix is informative context, not a daily note pattern.
3. **Future dates** — if the note has a `created` date in frontmatter, use it as the correct date and rename accordingly. If a note with the corrected date already exists, resolve via naming (e.g. add a suffix). If no `created` date is available, flag for manual review. Always log the date correction in the skill-log action: `Renamed from [original] (date corrected)`.
4. **Already in correct Daily Notes folder** — no move needed. Still classify for rename based on content.
5. **Nested Daily Notes folders** (e.g. `inbox/Daily Notes/YYYY-MM-DD.md`) — these are misplaced. The vault has ONE canonical Daily Notes folder. Move there, avoid duplicates.

## Corrupted File Detection (Nahbereich)

Detect files with multiple YAML frontmatter blocks (two or more `---`/`---` pairs). This happens when two notes get accidentally merged — typically an append error during sync or import. These files cannot be reliably processed.

**Action:** Rename with a descriptive corruption label (e.g. `YYYY-MM-DD - Korrupte Datei - Zwei Notizen verschmolzen`). Write skill-log. Do not attempt to split the file — that requires manual review by the user.

**Detection:** Count `---` pairs that enclose YAML-key-like content (at least one `key: value` line between the pair). Body-level `---` horizontal-rule separators without YAML content do NOT count. Precise heuristic: see `references/yaml-sanity.md` Pattern 2. Two genuine frontmatter blocks = corrupted.

## Sensitive Content Detection (Nahbereich)

Move to `_secret/` if the note contains sensitive data: recovery phrases, API keys, passwords, tokens, or other credentials stored as plaintext. These notes are a security risk and must not remain in the vault unprotected. Add trash metadata with `trash_source: note-rename` and the original path. The `_secret/` folder signals to the user that these files need manual review and secure handling — not just deletion.

## Naming Rules

1. Capture **core topic** — scannable at a glance
2. **Dash separator:** `Topic - Detail` for two-level names
3. No filler words ("Note about", "Draft of")
4. Match content language
5. Max ~70 characters

**Clusters:** If 3+ notes share a topic, suggest a common prefix before renaming.

## Context Segment

When renaming notes that have a date prefix, use a three-part name: `YYYY-MM-DD - Context - Detail`.

The **Context** segment answers: "What gives the reader the fastest orientation?" It can be:
- A **platform** (Instagram, YouTube, ChatGPT, Perplexity, Grok, GitHub, Reddit, LinkedIn)
- A **project** (the project or product name the note relates to)
- A **life area** (Family, Finance, Career, Health)
- An **activity** (Research, Interview, Meeting, Review)

**Platform detection** (when primary content is a link or capture):

| URL Pattern | Context Segment |
|---|---|
| `instagram.com` | Instagram |
| `youtube.com`, `youtu.be` | YouTube |
| `perplexity.ai` | Perplexity |
| `chatgpt.com` | ChatGPT |
| `grok.com` | Grok |
| `linkedin.com` | LinkedIn |
| `github.com` | GitHub |
| `reddit.com` | Reddit |
| Other recognizable domain | Domain name (capitalized) |

See also `references/web-capture-detection.md` for social platform detection rules.

**Multiple links, same platform:** One context segment. E.g. 3 Instagram links → still just "Instagram".
**Multiple links, different platforms:** Use the dominant platform as context, or `Research` if no platform dominates.
**No links (pure text):** Use project, life area, or activity as context.

## Multi-Topic Rules

When a note covers multiple unrelated topics, join them with `&` in the Detail segment:

| # | Topic Count | Platforms | Rule |
|---|-------------|-----------|------|
| 1 | 1-2 | any | All topics in the name with `&` |
| 2 | 3-4 | any | All topics in the name with `&` if it stays readable and under ~70 characters. Skill decides. |
| 3 | 5-6 | one dominant | All topics as keywords with `&`. One keyword per topic — enough to find the note later. |
| 4 | 5+ | multiple | `YYYY-MM-DD - Mixed Content - Mixed Topics.md`. Too chaotic for a meaningful name. |
| 5 | 7+ | any | `YYYY-MM-DD - Mixed Content - Mixed Topics.md`. Topic Override — content this fragmented cannot produce a meaningful name regardless of platform dominance. |

Examples:
- 2 topics: `2025-12-03 - Instagram - HR Interview Tipps & SaaS.md`
- 3 topics: `2025-12-04 - Instagram - SaaS & Dev Tools & Karpathy LLM.md`
- 5-6 topics, one platform: `2025-12-11 - Instagram - Product & Interview & Claude & AI Cases & Cursor.md`
- 5+ topics, multiple platforms: `2025-12-08 - Mixed Content - Mixed Topics.md`
- 7+ topics, one platform: `2026-01-08 - Mixed Content - Mixed Topics.md` (Topic Override — 7 topics, 93% Instagram, still too fragmented)

## Pre-flight

Before **every** invocation of this skill — including resumed sessions and re-triggers within the same conversation:

1. **Always (every OS):** Run [`references/clone-preflight.md`](../../references/clone-preflight.md). It detects clone-induced birthtime clusters and emits a WARN before any date-derivation runs. Cross-platform — applies on macOS, Linux, and Windows. WARN-flow only; skill execution continues.
2. **On Windows additionally:** Follow [`references/windows-preflight.md`](../../references/windows-preflight.md) end-to-end (registry check, trailing-dot folder detection, Windows-aware file-enumeration pattern). The enumeration pattern in Step 6 of that preflight applies to every subsequent file-listing call this skill makes — `Scan` (step 2 below) and `Check backlinks` (step 6 below) included. On macOS or Linux, this preflight is a no-op.

Run the checks freshly each time. Do not assume a previous turn's pass result still holds — registry state, folder topology, and birthtime clustering can change between invocations and previous results are not authoritative.

## Workflow

1. **Discover vault** — resolve `${OBSIDIAN_VAULT_PATH}`. Default scope: inbox root. Confirm with user.
2. **Scan** — list `.md` files.
3. **Nahbereich** — detect and trash accidental notes (soft-delete to `_trash/`). Move misplaced Daily Notes to the Daily Notes folder. Log each.
4. **Classify** — read title, tags, first ~30 lines (skip template boilerplate). For each note:
   - **4a. Repair corrupted quoted-key variants first (Nahbereich, sanity-check).** Call `references/yaml-sanity.md`. Verdict-routing per `references/yaml-sanity.md` § "Per-skill policy":
     - `BROKEN_KEYS_INSIDE_COLON` (shape β — F26 inside-colon): normalize via `references/yaml-edits.md` recipe (f) — handles ALL quoted-key patterns, not just `"created:"`/`"modified:"` (broadened from v0.1.0/v0.1.2 hardcoded list). After normalization, resolve duplicate-key collisions per recipe (f) Step 3 (identical → silent dedup; divergent → ABORT, see next bullet). Re-call sanity-check (idempotent fixpoint) — verdict must now be `OK`, `OK_QUOTED`, or `OK_NO_FRONTMATTER`.
     - `DUPLICATE_KEYS_IDENTICAL_VALUES` (v0.1.4 W4): repair via recipe (f) silent dedup, then re-run sanity-check.
     - `DUPLICATE_KEYS_DIVERGENT_VALUES` (v0.1.4 W4 — F7 family): **skip the file** + log Class-A finding "duplicate-key-divergent-values". Do NOT rename — user may legitimately need to merge values first; rename would obscure the underlying ambiguity. Route to user.
     - `MULTIPLE_FRONTMATTER_BLOCKS`: use existing Corrupted File Detection (rename file with corruption-label).
     - `OK_QUOTED`: proceed normally.
     - `OK` / `OK_NO_FRONTMATTER`: proceed normally.

     YAML edits MUST follow `references/yaml-edits.md` (recipes b + f). Without this normalization a strict YAML parser cannot read the author-intended date, falls back to the Source Hierarchy → filesystem birthtime (often fresh on cloned vaults), and the cooldown evaluation in 4c silently skips legitimate candidates. Classification regex accepts both plain and standard-quoted forms. Historical bugs: repo issue #4 (2026-04-27) for `created`/`modified`; F26 cross-skill cluster (2026-04-28) generalized the inside-colon pattern; F7 (GR-3 Cell 1, 2026-05-01) generalized duplicate-key resolution beyond first-wins-silent (v0.1.4 W4).
   - **4b. After 4a, if YAML `created` is still missing:** derive the value via Source Hierarchy Prio 1-3 first (filename > git, with German-date normalization in Prio 1 per `references/german-date-normalization.md`). If Prio 1-3 yields a value, write it to frontmatter (Nahbereich) and record the source. If Prio 1-3 yields no value, apply the **clone-cluster gate** per `references/clone-cluster-detection.md`: detect the vault-wide cluster window once per skill invocation, then invoke recipe (a) `is_birthtime_in_clone_cluster_window`. If recipe (a) returns 0 (in cluster) AND recipe (b) `has_alternate_date_source` returns 1 (no alt source), SKIP `created` enrichment for this note — do not write the field, log the file as Class-C "clone-cluster birthtime, no alt source" in the per-skill findings file, and store the current filesystem birthtime only for later restoration (rename-flow proceeds, but `created` stays absent). Otherwise (no cluster declared, or recipe (a) returns 1 = not in cluster), fall through to Prio 4 (filesystem birthtime) — write `created` from `stat -f %SB` / `stat -c %W`. Behavior gated by config `clone_cluster_skip` (default `true`); when `false`, the gate is a no-op and Prio 4 fires unconditionally.
   - **4c. Apply cooldown** (per `cooldown_days` parameter) using the now-trustworthy `created` value. Cooldown-skipped notes are reported in the Skipped section of the report (not silently dropped) — see `references/report-format-note-rename.md`.
   - **4d. Mark** as: rename, keep, or TBD.
5. **Detect clusters** — 3+ candidates on same topic → prepare prefix suggestion.
6. **Check backlinks** — find all `[[Old Name]]` references across vault.
7. **Preview and confirm** — show the preview table (see `references/report-format-note-rename.md` for format and bilingual templates). Match the language the user is speaking. Include a rationale section below the table explaining non-trivial decisions. **Do not execute until the user explicitly confirms.**
8. **Execute** — rename files, update all `[[Old Name]]` and `[[Old Name|` references.
9. **Skill Log** — for every processed note (renamed, reviewed, or trashed), write the skill log. See `references/skill-log.md` for the full spec. YAML tag-list edits and skill-log callout edits MUST follow `references/yaml-edits.md` (recipes d + e). **After writing tag/callout, restore filesystem birthtime** from the YAML `created` value read during classification. Use `touch -t` (see `references/skill-log.md` § Birthtime Preservation). After auto-enrich in step 4, YAML `created` is almost always available. Restore birthtime from it. In the rare case that auto-enrich found no source (no filename date, no Git, no readable birthtime), restore from the pre-write filesystem birthtime captured in step 4.

   **Tag (idempotent):**
   - Check if `VaultAutopilot` already exists in the `tags` list in YAML frontmatter.
   - If missing: add it. If present: do nothing. Never duplicate.
   - If no `tags` field exists: create one with `VaultAutopilot` as the first entry.

   **Callout (append-only):**
   - Check if `> [!info] Vault Autopilot` exists at the end of the note.
   - If missing: create the full callout block:
     ```
     > [!info] Vault Autopilot
     >
     > | Date | Skill | Action |
     > |------|-------|--------|
     > | YYYY-MM-DD | note-rename | [action] |
     ```
   - If present: append only a new `> | YYYY-MM-DD | note-rename | [action] |` row to the existing table. Never create a second callout.
   - Ensure one blank line separates the callout from the preceding content.

   **Action types:**
   - Renamed: `Renamed from [old filename without .md]`
   - Reviewed (name was already good): `Reviewed — name already descriptive`
   - Trashed (Nahbereich): `Trashed — accidental note (soft-delete to _trash/)`
   - Secret (Nahbereich): `Secret — sensitive content (moved to _secret/)`
   - Daily (Nahbereich): `Daily — moved to Daily Notes folder`

10. **Write findings file** — for any non-trivial Findings (Class A/B/C/D as defined in `references/findings-file.md`), append a section to `<VAULT>/_vault-autopilot/findings/<YYYY-MM-DD>-note-rename.md`. Create the folder chain if missing. Never edit prior findings — append-only ledger.
11. **Report and log** — write summary, append to `logs/run-history.md`.

## Report Format

See `references/report-format-note-rename.md` for the full preview table format (bilingual), report template, and action types for skill log.

## Quality Check

- [ ] Renamed files exist at new paths
- [ ] All backlinks updated (no broken `[[]]`)
- [ ] No Daily Notes renamed
- [ ] User confirmed before execution
- [ ] Every processed file has `VaultAutopilot` tag in frontmatter (exactly once)
- [ ] Every processed file has skill log callout at the end
- [ ] Reviewed notes have "Reviewed" action, not "Renamed"
- [ ] Re-renamed notes have multiple callout rows, not multiple callouts
- [ ] Sanity-check called Step 4a per `references/yaml-sanity.md` (broadened from hardcoded `"created:"`/`"modified:"` to all quoted-keys)
- [ ] Quoted-key broken-key variants (shape β — inside-colon) normalized via recipe (f); standard quoted-keys (shape α) pass through as `OK_QUOTED`
- [ ] Duplicate-key divergent-value collisions (F7 family) skip + Class-A finding; file is NOT renamed — user merges manually first (v0.1.4 W4)
