---
name: tag-manage
status: beta
description: Use when an Obsidian vault needs tag auditing, convention-compliance checking, or cleanup of EXISTING tags — finding duplicates, case inconsistencies, orphan tags, separator variants, or convention violations, then renaming, merging, or removing tags behind a preview-and-confirm gate. Trigger phrases - "audit tags", "analyze tags", "fix tags", "tag cleanup", "find duplicate tags", "merge tags", "rename tag", "unused tags", "orphan tags", "tag consistency", "check tag convention", "tag compliance". Also trigger when the user mentions inconsistent tag casing, separator variants, numeric tag artifacts, or wants a tag health report. Does NOT invent new tags from note content (that is a later version).
---

# Tag Manage

Audit a vault's existing tags, score them against the PascalCase convention, and apply guided cleanup: rename, merge, remove orphans, fix convention violations. **Cleanup normalizes and consolidates tags that already exist — it never invents new ones** (content-based auto-tagging is a later version, out of scope here).

The engine is a set of deterministic Node scripts (`scripts/tags.js`, `scripts/cli.js`, `scripts/convention.js`, `scripts/config.js`, `scripts/recommend.js`, `scripts/report.js`). Determinism is the safety guarantee — never hand-edit notes to "clean tags." The AI reviews the report and runs the confirm gate; the scripts do every byte-level rewrite.

> **Read first:** [`references/tag-semantics.md`](../../references/tag-semantics.md) (Step 0 finding —
> Obsidian matches tags case-insensitively, which is why case-fixes are cosmetic and a different op
> class than true merges) and [`references/tag-convention.md`](../../references/tag-convention.md)
> (the PascalCase convention used as the compliance target and the canonical casing source).

## Principle: Core + Nahbereich + Report

- **Core:** Audit existing tags + apply user-approved rename / merge / remove ops across all six on-disk tag representations consistently.
- **Nahbereich:** None destructive beyond the approved ops. The survival guard aborts the whole run rather than risk corrupting a code span, URL, heading, or wikilink.
- **Report:** A rich vault-written Markdown report (key metrics, top 20 tags, severity-classified recommendations table, health score) plus a machine-readable recommendations JSON file — written to the vault's configured report directory (see Configuration below), or printed to stdout when no directory is configured.

## Two stages (safe-half first)

| Stage | Subcommand | What | Writes to vault? | Gate |
|-------|-----------|------|-----------------|------|
| 1 | `audit` | Read-only inventory + convention-compliance analysis + recommendations | No (report only) | Review checkpoint; reviewable on its own |
| 2 | `apply` | Execute the approved ops, then re-audit for the after-changes report | Yes (note rewrites) | Explicit user confirm gate |

`plan` is a dry-run sub-stage of Stage 2: it shows the exact per-note diffs without writing anything.

## How to run

**Stage 1 — audit (read-only):**

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/tag-manage/scripts/cli.js" \
  audit <vault> [--report-dir DIR] [--config FILE] [--date YYYY-MM-DD]
```

The audit writes a full Markdown report and a `.tag-manage-recommendations.json` sidecar to the report directory (if configured). It then prints the report to stdout.

Show the user the audit output. It covers:

- **Cosmetic (case variants).** Per Step 0, Obsidian already treats `#AI` and `#ai` as one tag. Case normalization is a display convention, not a functional fix. Surface it, but treat it as **opt-in** — do not bundle it into the default cleanup unless the user asks.
- **Functional duplicates** (separator variants like `ai-ml` / `ai_ml`, which are real distinct tags).
- **Convention violations** classified by severity (see the Severity table below).
- **Recommendations table** with numbered IDs, severity, source (brand / compound / heuristic), and "verify casing" notice for heuristic entries.

**Stage 2 — dry-run preview (plan):**

```bash
node ".../cli.js" plan <vault> \
  (--ops ops.json | --from-recs .tag-manage-recommendations.json [--ids 1,3]) \
  [--max N]
```

Show the per-note diffs. **Human gate:** for any merge, state it is irreversible (you cannot tell afterwards which note had which source tag). For more than 10 affected notes, first state "I will change tags in N notes in `<vault>`. Confirm?" and wait.

**Stage 2 — apply (only after explicit confirmation):**

```bash
node ".../cli.js" apply <vault> \
  (--ops ops.json | --from-recs .tag-manage-recommendations.json [--ids 1,3]) \
  [--max N] --write
```

The `--from-recs` flag is the primary flow after an audit: it reads the `.tag-manage-recommendations.json` the audit wrote, optionally filtered by `--ids 1,3` (comma-separated recommendation IDs). The user can say "apply all", "apply #1, #3", or "skip #2" — map those to the `--from-recs` + `--ids` flags accordingly.

`--ops ops.json` is the manual escape hatch for hand-crafted operation files.

After a successful `--write`, if a report directory is configured the engine automatically runs a second audit and writes an after-changes report (filename suffix: ` - after changes`).

If the script exits non-zero with `ABORTED — Survival guard...` or `ABORTED — Mass-change guard...`, **do not retry blindly.** A survival abort means a rewrite would have touched a non-tag byte (code / URL / heading / wikilink); a mass-change abort means the op exceeds the safety threshold (default 50 notes — raise with `--max N` only after a deliberate review). Nothing was written.

## Convention compliance engine

The convention check runs on every tag in the vault inventory, applying the first matching rule:

| Severity | Violation class | Examples |
|----------|----------------|---------|
| HIGH | `hashtag-prefix` — `#` in frontmatter tag value | `#research`, `#AI-ML` |
| HIGH | `yaml-artifact` — a YAML field key used as a tag | `created:`, `status:` |
| HIGH | `numeric-artifact` — only numbers/slashes/dashes, no letter | `2024-01`, `42` |
| MEDIUM | `snake_case` — underscore in tag | `open_source`, `ai_ml` |
| MEDIUM | `camelCase` — lowercase-start with an uppercase inside | `openSource`, `devTools` |
| MEDIUM | `lowercase-concept` — all lowercase letters/digits | `research`, `productivity` |
| MEDIUM | `upper-kebab` — UpperCamelCase with hyphen (not a brand or AI/KI prefix) | `Open-Source` (correct form: `OpenSource`) |
| LOW | `flat-where-hierarchical` — flat spelling of a tag that elsewhere appears as a hierarchy leaf | `DevTools` when `Software/DevTools` exists |
| (none) | Compliant tag — no rule fires | `Research`, `GitHub`, `AI-ML` |

**Brand-set short-circuit:** if a tag's logical key (case-folded) is in the brands dictionary, it is always compliant regardless of its display casing. The recommendation engine will enforce the canonical brand spelling (see Canonical resolver below), but it is not a convention violation.

**First-match-wins:** rules are checked top to bottom; the first matching rule is the verdict.

## Canonical resolver (canonicalForm)

When the engine proposes a rename or merge, it resolves the target spelling in this order:

1. **Brand dictionary** — exact canonical spelling (e.g., `github` → `GitHub`). Source label: `brand`. Enforcement is unconditional: even a uniformly-lowercase brand with no mixed variant gets a rename recommendation (`github` → `GitHub`).
2. **Compounds dictionary** — known multi-word or hyphenated compounds (e.g., `ai-ml` → `AI-ML`, `opensource` → `OpenSource`). Source label: `compound`.
3. **PascalCase heuristic** — segments split on `-` or `_`, each capitalized (e.g., `ai-foo` → `AI-Foo`, `day-trading` → `DayTrading`). Source label: `heuristic` — flagged in the report as "verify casing (not in dictionary)".

Heuristic recommendations are proposals, not enforcements. The report flags them explicitly because the heuristic cannot know all compound terms or brand names. A heuristic recommendation is generated only when a real convention violation exists — a compliant tag is never renamed to a heuristic guess.

Dictionary-backed recommendations (brand or compound) are generated even when the current spelling is uniform (no mixed-case variants), because the dictionary is the authoritative source.

## Override dictionaries and configuration

### Shipped generic defaults

`skills/tag-manage/references/tag-overrides.default.json` ships with the plugin and contains curated brand and compound entries covering common tools and terms used across many vaults (GitHub, ChatGPT, YouTube, LinkedIn, n8n, SaaS, LLM, API, OpenSource, LowCode, GenerativeAI, AI-ML, AI-Agents, AI-Coding, and others). These are MIT-licensed generic defaults — vault-specific personal brands are not included.

### Vault-local config note

To customize the dictionaries for your vault, create a note called `Tag Manage Config.md` anywhere in the vault. The engine discovers it automatically by filename during the audit and apply walks.

The config note must contain a `json` fenced code block:

```json
{
  "brands": {
    "perplexity": "Perplexity",
    "kubernetes": "Kubernetes",
    "tesla": "Tesla"
  },
  "compounds": {
    "myvaultterm": "MyVaultTerm"
  },
  "reportDir": "Meta/Tag Management"
}
```

Fields:

- `brands` — vault-specific brand names and abbreviations. Keys are case-insensitive (matched via logical key). Values are the canonical spellings to enforce.
- `compounds` — vault-specific multi-word or hyphenated terms. Keys are the "stripped" or common variants; values are the canonical spellings.
- `reportDir` — path relative to the vault root where audit reports and the recommendations JSON are written. Without this field (or `--report-dir`), the audit writes no file and prints to stdout only.

Vault-local entries win over the shipped defaults on collision (vault-local `brands.github` overrides the default). The merge is additive: vault-local and shipped entries coexist.

**Config override flag:** `--config FILE` loads a specific file path instead of the auto-discovered `Tag Manage Config.md`. Useful for testing.

### First-run report-home gate (agent workflow)

On a report run where no `reportDir` is resolvable (no `Tag Manage Config.md`, or it has no
`reportDir`), seed the permanent report home before writing any report:

1. Run `node ".../cli.js" suggest-report-dir <vault>` — it returns ranked candidates as JSON
   (`recommended` plus `candidates[]` with `relpath`, `reason`, `exists`).
2. Present the recommended fresh location and the alternatives (including any `exists: true`
   continuity folder). State that the choice becomes the permanent home for all future reports.
3. **Gate:** ask the user to confirm or choose a different location. Wait for the answer.
4. Run `node ".../cli.js" set-report-dir <vault> "<chosen relpath>"` to write `reportDir`
   into `Tag Manage Config.md` (created if absent; existing brands/compounds preserved).
5. Proceed with the audit. The report (and every later run's before/after reports) now lands
   in that one home — the gate never repeats.

## Report destination

The audit writes a Markdown report file and a `.tag-manage-recommendations.json` sidecar when a report directory is resolvable. Priority:

1. `--report-dir DIR` CLI flag (absolute or resolved relative to cwd)
2. `reportDir` field in the vault-local config note (relative to vault root)
3. If neither is set: no file written; the report is printed to stdout only.

The recommended convention is to set `reportDir` to a dedicated folder such as `Meta/Tag Management` in the vault-local config note — this keeps reports alongside notes and makes them browsable in Obsidian.

The engine excludes the report directory from the audit scan, so previously written report notes do not inflate the tag counts on subsequent runs.

## What an operation hits (the logical tag)

A logical tag is rewritten consistently across all six representations:

1. Frontmatter block-list (`tags:\n  - value`)
2. Frontmatter inline-array (`tags: [a, b]`)
3. Frontmatter scalar (`tags: value`)
4. Legacy frontmatter `tag:` key
5. Inline body `#tag`
6. Hierarchical inline body `#parent/child` (handled as a whole-path unit — renaming `ai` does NOT cascade into `ai/coding`)

Matching is case-insensitive (Step 0); the target casing you supply is written verbatim.

## Survival guarantees (non-negotiable — tested byte-exact)

A `#tag`-looking token is left **byte-for-byte untouched** when it sits inside: fenced or inline code, a URL fragment (`example.com/#frag`), an ATX heading marker (`# Heading` — space after `#`), or a `[[wikilink]]`. The structural survival guard re-tokenizes the body before and after the rewrite and aborts if any non-tag text segment changed. See `tests/tags.test.js` (survival + representation-matrix suites).

## Known limitations

- **No per-note skill-log callout.** Unlike note-rename, this skill does not stamp a `VaultAutopilot` callout onto every touched note. Rationale: a bulk tag op can touch hundreds of notes; stamping each one is a large incidental change beyond the requested rewrite and breaks idempotency. Run-level traceability lives in the vault report and `logs/run-history.md`. Per-note skill-log is a tracked follow-up.
- **No content-based auto-tagging** (scope C — a later version).
- **Dataview `tags::` fields are not first-class.** The engine correctly ignores `tags::` lines in frontmatter (the negative lookahead `(?!:)` in the field regex excludes Dataview field syntax so they are never mis-parsed as tag fields). However, Dataview inline field tags are not read, not counted in the inventory, and not rewritten. A note that uses only `tags:: value` (no YAML frontmatter) will appear untagged in the audit.
- **`notesAffected` is a slight upper bound for merges.** The recommendations engine counts the logical tag's total note occurrences. For a merge where some notes already carry the canonical spelling, the actual changed-note count will be lower. The mass-change guard uses the real `applyOps` result (exact count), so safety is not affected — only the report number is an upper bound.
- **Near-duplicate detection is deterministic for case + separator only.** Singular/plural, abbreviations, and synonyms are not auto-detected. They can be added to the vault-local config as brand or compound entries, after which the engine will enforce them.

## Boundaries

- Operates on existing tags only. **Never invents tags from content** (auto-tagging is out of scope here).
- **Remove is frontmatter-only.** An inline body `#tag` is never stripped from prose (that would mutate the sentence). If a removed tag still lives in the body, it is reported as a body residual, not deleted.
- Reserved tags (`VaultAutopilot`) are never proposed for merge / rename / remove.
- Merges require explicit confirmation and count toward the mass-change threshold.
- In-place writes preserve filesystem birthtime (Node `fs.writeFileSync` reuses the inode, unlike the Edit/Write tools).

## Protected files

Files and folders starting with `_` or `.` are excluded from walks (`_trash/`, `_secret/`, `.obsidian/`, `_vault-autopilot.md`). `node_modules` is also excluded.

Production-vault runs follow the repo's **Production Vault Safety Rules** (gate before switching vaults; confirm before touching more than 10 files; read-only operations also require explicit approval for production vaults).

## Report format

The vault-written Markdown report contains:

- YAML frontmatter (`type: inbox`, `status: draft`, tagged `Meta/TagManagement`)
- Summary callout (scope, note count, unique tags, coverage %, recommendation count)
- Key Metrics table (totals, avg tags/note, max depth, singletons)
- Top 20 Tags table (tag, count, % of tagged notes)
- Recommendations table (id, action + severity, from, to, notes affected, source / "verify casing" notice)
- Next Steps callout (prompts: "apply all", "apply #1, #3", "skip #2")
- Health Score table (convention conformity %, tag coverage %, singleton ratio %)
- Update Log table

The after-changes report (written when `apply --write` succeeds and a report directory is configured) carries the same structure with a ` - after changes` filename suffix, giving a before/after audit trail.

## Quality check

- [ ] Stage 1 audit shown before any write; case findings flagged cosmetic (opt-in)
- [ ] Every merge flagged irreversible; more than 10-note runs confirmed first
- [ ] `apply --write` only after explicit user confirmation
- [ ] Heuristic recommendations called out ("verify casing — not in dictionary")
- [ ] Survival + representation-matrix + idempotency + mass-change suites green (`scripts/test-tag-manage.sh`)
- [ ] No invented tags; remove stayed frontmatter-only
- [ ] Report directory excluded from scan (no self-poisoning of subsequent audits)
