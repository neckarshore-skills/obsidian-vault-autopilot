---
name: note-quality-check
status: beta
description: Use when an Obsidian vault has accumulated old, low-value, or obsolete notes that need quality review. Trigger phrases - "check note quality", "find old notes", "cleanup notes", "prune notes", "stale notes", "quality audit", "review notes". Also trigger when the user mentions notes from an iOS migration, Apple Notes import, or too many unreviewed notes.
---

# Note Quality Check

Review vault notes by age, content quality, and relevance. Walk the user through decisions in small batches. Conservative — the skill never recommends trashing a note. Only the user decides what goes.

## Principle: Core + Nahbereich + Report

- **Core:** Score notes, present clusters, walk user through decisions
- **Nahbereich:** Detect 0-byte files (permanent-delete candidates) and whitespace-only files (soft-delete candidates, see `references/trash-concept.md`). Candidates only — **no destructive action happens before the preview** (see Destruction Gate below).
- **Report:** Quality distribution, actions taken, parked items, findings for other skills

## Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `cooldown_days` | 3 | Skip notes created within the last N days. Grace period so the user can review recent captures before automation touches them. **Date source:** YAML `created` field in frontmatter. If missing, evaluate via the Source Hierarchy (filename date > Git first-commit > filesystem birthtime, gated by the clone-cluster check) — read-only; this skill does not write `created` (property-enrich's job). Never use modification date. |
| `clone_cluster_skip` | true | When `true` (default), age/cooldown evaluation DEFERs for files whose only available date source is filesystem birthtime AND whose birthtime falls in a detected clone-cluster window (age undecidable — flag, do not score staleness). See `references/clone-cluster-detection.md`. Set to `false` to fall through to filesystem birthtime. |
| `scope` | inbox | Which folder to scan. `inbox` = inbox only. `vault` = entire vault. User confirms before execution. |
| `batch_size` | 5 | Number of notes to present per round. User decides before next round continues. |

## Protected Files and Folders

Never process or score these (see `references/vault-autopilot-note.md`):
- `_vault-autopilot.md` in vault root
- Any file starting with `_` in vault root (reserved for plugin management)
- Everything inside `_trash/` (see `references/trash-concept.md`)

## Destruction Gate

**No destructive action happens before the preview.** Phase 1 only *detects* Nahbereich candidates (0-byte, whitespace-only); the preview presents them as the first decision block of the walk-through, and only an explicit user confirmation executes them. This applies to every destructive path of this skill: permanent delete (0-byte), soft-delete to `_trash/`, and archive moves.

> **Behavior change (2026-06-11, deliberate):** earlier versions executed 0-byte deletes and whitespace-only trashes during the scan, before the user saw anything. That violated the "AI recommends, human decides" principle and the README approval promise. The order is now: detect → preview → confirm → execute.

## Four Actions

Every note gets exactly one action, chosen by the user:

| Action | What happens | When to suggest |
|--------|-------------|-----------------|
| **Keep** | Note stays. Optionally suggest a better target folder. | Note has clear purpose or reference value |
| **Archive** | Move to archive folder (e.g. `099_Archive/`) | Completed projects, past events, historical reference |
| **Park** | No action now. Tracked in report for later review. | User is unsure, needs more context, or wants to revisit |
| **Trash** | Soft-delete to `_trash/` with metadata | Only when user explicitly chooses this |

## The Golden Rule: Never Recommend Trash

The skill does not say "delete this" or "trash this". Instead:

- For notes the skill does not understand: "I cannot determine the purpose of this note. What is it for?"
- For notes with weak signals: suggest Keep or Archive, not Trash
- Only the user can say "Trash"

### Intentional Content Signals

A note is considered intentional (and never a Nahbereich candidate) if ANY of these are true:

1. Contains an embed (`![[...]]`)
2. Contains a wikilink (`[[...]]`)
3. Has YAML frontmatter with meaningful values (title, tags, description)
4. Has 3+ lines of non-whitespace content
5. Has a descriptive filename (not generic like "Untitled" or "New Note")

**Fail-safe default:** any uncertainty in the signal evaluation → KEEP/DEFER, never auto-trash. One ambiguous signal is enough to keep a note out of the Nahbereich set — deleting a valuable note is the worst failure class this skill has, strictly worse than leaving a worthless note in place. Only literally-empty content (0 bytes, pure whitespace) is ever a candidate.

## Quality Criteria

Evaluate each note against all five. These inform the suggested action (Keep vs. Archive), not a delete decision.

| # | Criterion | Signal |
|---|-----------|--------|
| 1 | Staleness | >12 months old, no edits in 6+ months |
| 2 | Obsolete | Past events, completed projects, expired offers |
| 3 | Low substance | 1-2 sentences, URL-only, undeveloped thought |
| 4 | Redundancy | Near-duplicate title and opening lines in same folder |
| 5 | No clear purpose | No action, no reference value, no idea worth keeping |

`TBD -` prefixed notes (from note-rename) count as one pre-existing signal.

## Age Detection

1. YAML frontmatter (`created`, `date`, `modified`) — authoritative
2. Source Hierarchy fallback (read-only): filename date > Git first-commit > filesystem birthtime — birthtime only via the clone-cluster gate per `references/clone-cluster-detection.md`. If the note's birthtime falls in a detected clone-cluster window and no alternate source exists, age is **undecidable**: DEFER staleness scoring for that note, flag "age uncertain (clone-cluster)" in the findings file, and never count uncertain age toward an Archive suggestion. (Clone-time birthtimes are empirically unreliable — the F3/GR-3 class: 36.8% of files in a robocopy clone clustered at clone time.)
3. **Bulk-import:** Many files sharing same creation timestamp — flag age as uncertain. Report, do not modify frontmatter (property-enrich's job).

## Pre-flight

Before **every** invocation of this skill — including resumed sessions and re-triggers within the same conversation:

1. **Always (every OS):** Run [`references/clone-preflight.md`](../../references/clone-preflight.md). It detects clone-induced birthtime clusters and emits a WARN before any date-derivation runs. Cross-platform — applies on macOS, Linux, and Windows. WARN-flow only; skill execution continues.
2. **On Windows additionally:** Follow [`references/windows-preflight.md`](../../references/windows-preflight.md) end-to-end (registry check, trailing-dot folder detection, Windows-aware file-enumeration pattern). The enumeration pattern in Step 6 of that preflight applies to every subsequent file-listing call this skill makes — the scan in Phase 1 included. On macOS or Linux, this preflight is a no-op.

Run the checks freshly each time. Do not assume a previous turn's pass result still holds.

## Workflow

### Phase 1: Discover and Scan (read-only)

1. Resolve `${OBSIDIAN_VAULT_PATH}`. Ask for target folder. Non-recursive default.
2. Confirm scope if 50+ notes.
3. **Sanity-check per note.** Call `references/yaml-sanity.md` before reading any frontmatter. Verdict-routing per § "Per-skill policy" — this skill never repairs YAML:
   - `BROKEN_KEYS_INSIDE_COLON`, `DUPLICATE_KEYS_DIVERGENT_VALUES`, `DUPLICATE_KEYS_IDENTICAL_VALUES`, `MULTIPLE_FRONTMATTER_BLOCKS`, `UNCLOSED_FRONTMATTER`: **exclude the note from scoring** + finding (Class-A for divergent/multi-block/unclosed, Class-C otherwise; route to property-enrich / note-rename). A corrupted file is a repair case, **not a low-quality note** — broken YAML must never feed the quality criteria or end up as a trash suggestion.
   - `OK` / `OK_QUOTED` / `OK_NO_FRONTMATTER`: proceed normally (regexes accept plain and standard-quoted forms).
4. Read all notes: title, frontmatter, first ~30 lines, file metadata. Apply cooldown + age detection per the Age Detection rules (clone-cluster DEFER included).
5. **Nahbereich detection (no execution):** collect 0-byte files as permanent-delete candidates and whitespace-only files as soft-delete candidates. Do NOT delete or move anything in this phase — see Destruction Gate.

### Phase 2: Cluster and Group

6. Detect clusters using (in order):
   - Filename prefix matching (e.g., `MB -`, `CREALOGIX`, `ITG -`)
   - Tag overlap (3+ shared tags between notes)
   - Semantic grouping for remaining unclustered notes
7. Assign unclustered notes to a "Mixed" group.
8. Order clusters: largest first, then alphabetical.

### Phase 3: Walk-Through

9. **Nahbereich candidates first.** Present the collected 0-byte and whitespace-only candidates as the opening decision block (same table format, suggested action prefilled). Wait for user confirmation; execute only what the user approves.
10. Present one cluster at a time. Use this exact format:

```
**Cluster X: "[Name]" (N Notes)**
Context: [1-line description of what connects these notes]

| # | Note | Type | Lines | Suggested Action |
|---|------|------|------:|-----------------|
| 1 | Example Note.md | Brief Draft | 68 | Archive (A) |
| 2 | Another Note.md | Project Doc | 115 | Keep (K) |

**Actions:**
- **Keep (K)** — stays where it is, optional folder suggestion
- **Archive (A)** — moves to `099_Archive/[Cluster]/`
- **Park (P)** — no action now, recorded in the report for later
- **Trash (T)** — soft-delete to `_trash/` (recoverable)

Examples: `1A 2K` or `all A` or `1-5 A, 6T`

→ Your decision?
```

11. Show max `batch_size` notes per table (default 5). If a cluster has more, continue with a second table after the user decides.
12. Wait for user decisions. Accept shorthand (e.g. `1A 2A 3K`) or cluster-wide (e.g. `alle A`).
13. Execute actions immediately after each round (move files, add trash metadata). Trash metadata fields MUST be written per `references/yaml-edits.md` recipes (b/c) — never `str.replace`, never multi-line regex; see `references/trash-concept.md` for the field set.
14. **Skill Log** — for each actioned file: add `VaultAutopilot` tag and append skill log callout row (see `references/skill-log.md`). YAML tag-list edits and skill-log callout edits MUST follow `references/yaml-edits.md` (recipes d + e).
15. Continue to next round or next cluster.

### Phase 4: Report

16. **Write findings file** — for any non-trivial Findings (Class A/B/C/D as defined in `references/findings-file.md`), append a section to `<VAULT>/_vault-autopilot/findings/<YYYY-MM-DD>-note-quality-check.md`. Create the folder chain if missing. Never edit prior findings — append-only ledger.
17. Write summary report. Append to `logs/run-history.md`.

## Report Format

```
## Note Quality Check Report — [Date]

### Done
- Analyzed: X | Kept: X | Archived: X | Trashed: X | Parked: X
- Nahbereich (user-approved): X files removed (0-byte: X, whitespace-only trashed: X)

### Skipped
- Cooldown: X | Age undecidable (clone-cluster): X | Broken YAML (excluded from scoring): X | Protected: X

### Parked (revisit later)
- [List of parked notes with 1-line context each]

### Clusters Reviewed
- [Cluster name]: X notes — [actions summary]

### Findings
- Uncertain age (import suspected): X notes
- [Observations for other skills]
```

## Quality Check

- [ ] Every action was chosen by the user (no auto-trash of content notes)
- [ ] No destructive action executed before the preview (Destruction Gate held — detect → preview → confirm → execute)
- [ ] Nahbereich limited to 0-byte and whitespace-only files; any intentional signal kept the note out (KEEP/DEFER on uncertainty)
- [ ] Sanity-check called before frontmatter reads; broken-YAML notes excluded from scoring with finding, never scored or trash-suggested
- [ ] Age/cooldown evaluated via Source Hierarchy with clone-cluster gate — uncertain age flagged, never counted toward Archive
- [ ] Trash metadata and skill-log edits used `references/yaml-edits.md` recipes (b/c fields, d/e tag + callout)
- [ ] Parked notes are listed in report
- [ ] Uncertain-age notes reported, not modified
- [ ] Findings file written per `references/findings-file.md` for any non-trivial findings
