---
name: tag-manage
status: beta
description: Use when an Obsidian vault needs tag auditing or cleanup of EXISTING tags - finding duplicates, case inconsistencies, orphan tags, separator variants, or convention violations, then renaming, merging, or removing tags behind a preview-and-confirm gate. Trigger phrases - "audit tags", "analyze tags", "fix tags", "tag cleanup", "find duplicate tags", "merge tags", "rename tag", "unused tags", "orphan tags", "tag consistency". Also trigger when the user mentions inconsistent tag casing, separator variants, or numeric tag artifacts. Does NOT invent new tags from note content (that is a later version).
---

# Tag Manage

Audit a vault's existing tags and apply guided cleanup: rename, merge, remove orphans, fix
convention violations. **Cleanup normalizes/consolidates tags that already exist — it never
invents new ones** (content-based auto-tagging is a later version, out of scope here).

The engine is a deterministic Node script (`scripts/tags.js` + `scripts/cli.js`). Determinism is
the safety guarantee — never hand-edit notes to "clean tags." The AI proposes consolidations and
runs the gate; the script does every byte-level rewrite.

> **Read first:** [`references/tag-semantics.md`](../../references/tag-semantics.md) (Step 0 finding —
> Obsidian matches tags case-insensitively, which is why case-fixes are cosmetic and a different op
> class than true merges) and [`references/tag-convention.md`](../../references/tag-convention.md)
> (the casing convention used as the target when the user opts into case-normalization).

## Principle: Core + Nahbereich + Report

- **Core:** Audit existing tags + apply user-approved rename / merge / remove ops across all six
  on-disk tag representations consistently.
- **Nahbereich:** None destructive beyond the approved ops. The survival guard aborts the whole run
  rather than risk corrupting a code span, URL, heading, or wikilink.
- **Report:** Tag inventory, cosmetic vs functional findings, orphans, numeric artifacts, untagged
  notes, and what each approved op would change — routed to other skills where relevant.

## Two stages (safe-half first)

| Stage | What | Writes? | Gate |
|-------|------|---------|------|
| 1 | `audit` + `plan` — inventory, proposed convention, exact "what I would change" diffs | no | review checkpoint (reviewable on its own) |
| 2 | `apply` — execute the approved ops | yes | confirm gate |

## How to run

**Stage 1 — audit (read-only):**
```
node "${CLAUDE_PLUGIN_ROOT}/skills/tag-manage/scripts/cli.js" audit <vault>
```
Show the user the inventory and the two finding classes:
- **Cosmetic (case variants).** Per Step 0, Obsidian already treats `#AI` and `#ai` as one tag, so
  fixing case is a *display* normalization, not a functional merge. Surface it, but recommend it is
  **opt-in** — do not bundle it into the default cleanup.
- **Functional duplicates** (separator variants like `ai-ml` / `ai_ml`, and — proposed by you, the
  AI, from the inventory — singular/plural, abbreviations, synonyms). These are real distinct tags.

From the audit + the user's choices, build an **ops list** (JSON):
```json
[
  { "type": "rename", "from": "javascript", "to": "JavaScript" },
  { "type": "merge",  "from": ["ai-ml", "ai_ml"], "to": "AI-ML" },
  { "type": "remove", "from": "tmp" }
]
```
`rename` (one→one), `merge` (N→one, **irreversible**), `remove` (orphan/unused, **frontmatter-only**).

**Stage 1 — plan (dry-run preview, still no writes):**
```
node ".../cli.js" plan <vault> --ops ops.json
```
Show the per-note diffs. **Human gate:** for any merge, state that it is irreversible (you cannot
tell afterwards which note had which source tag). For more than 10 affected notes, first state
"I will change tags in N notes in <vault>. Confirm?" and wait.

**Stage 2 — apply (only after explicit confirmation):**
```
node ".../cli.js" apply <vault> --ops ops.json --write
```
If the script exits non-zero with `ABORTED — Survival guard...` or `ABORTED — Mass-change guard...`,
**do not retry blindly.** A survival abort means a rewrite would have touched a non-tag byte
(code/URL/heading/wikilink); a mass-change abort means the op exceeds the safety threshold
(default 50 notes — raise with `--max N` only after a deliberate review). Nothing was written.

## What an operation hits (the logical tag)

A logical tag is rewritten consistently across all six representations: frontmatter block-list,
inline-array, single-scalar, legacy `tag:` key, inline body `#tag`, and nested `#parent/child`
(handled as a whole-path unit — renaming `ai` does NOT cascade into `ai/coding`). Matching is
case-insensitive (Step 0); the target casing you supply is written verbatim.

## Survival guarantees (non-negotiable — tested byte-exact)

A `#tag`-looking token is left **byte-for-byte untouched** when it sits inside: fenced or inline
code, a URL (`example.com/#frag`), an ATX heading marker (`# Heading` — space after `#`), or a
`[[wikilink]]`. The structural survival guard re-tokenizes before/after and aborts if any non-tag
byte changed. See `tests/tags.test.js` (survival + representation-matrix suites).

## Boundaries

- Operates on existing tags only. **Never invents tags from content** (auto-tagging is out of scope
  for v1).
- **Remove is frontmatter-only.** An inline body `#tag` is never stripped from prose (that would
  mutate the sentence) — if a removed tag still lives in the body, it is reported, not deleted.
- Reserved tags (`VaultAutopilot`) are never proposed for merge/rename/remove.
- Merges require explicit confirmation and count toward the mass-change threshold.
- In-place writes preserve filesystem birthtime (Node `fs.writeFileSync` reuses the inode).

## Known limitations (v1)

- **No per-note skill-log callout.** Unlike note-rename, this skill does not add a `VaultAutopilot`
  tag or `> [!info] Vault Autopilot` callout to every touched note. Rationale: a bulk tag op can
  touch hundreds of notes, and stamping each one is a large incidental change beyond the requested
  rewrite ("do no harm"). The tag rewrite is the only change, which keeps re-runs provably
  idempotent. Run-level traceability lives in the report and `logs/run-history.md`. Adding per-note
  skill-log (with the `#143` date-only-vs-`HH:MM` callout-dedup handling) is a tracked follow-up.
- **No content-based auto-tagging** (scope C — a later version).
- **Near-duplicate detection is deterministic for case + separator only.** Singular/plural,
  abbreviations, and synonyms are AI-proposed from the inventory and always confirmed by the user
  (a German vault breaks naive trailing-`s` stripping).

## Protected files

Files and folders starting with `_` or `.` are excluded (`_trash/`, `_secret/`, `.obsidian/`,
`_vault-autopilot.md`). Production-vault runs follow the repo's Production Vault Safety Rules (gate
before switching vaults; confirm before touching more than 10 files).

## Report format

```
## tag-manage Report — <date>

### Audit
- <N> notes, <M> logical tags
- Cosmetic (case variants): <count> groups
- Functional duplicates (separator): <count> groups
- Orphans: <count> | Numeric artifacts: <count> | Untagged notes: <count>

### Done (Stage 2 only)
- Renamed: <count> | Merged: <count> groups | Removed: <count>
- Notes changed: <N>

### Findings
- <inline-body residuals after a frontmatter-only remove>
- <observations routed to other skills>

### Unchanged
- <count> notes already consistent
```

## Quality check

- [ ] Step 1 audit shown before any write; case findings flagged cosmetic (opt-in)
- [ ] Every merge flagged irreversible; >10-note runs confirmed first
- [ ] `apply` only after explicit user confirmation
- [ ] Survival + representation-matrix + idempotency + mass-change suites green (`scripts/test-tag-manage.sh`)
- [ ] No invented tags; remove stayed frontmatter-only
