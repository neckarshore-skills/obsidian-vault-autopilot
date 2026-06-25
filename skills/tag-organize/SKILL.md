---
name: tag-organize
description: Use when an Obsidian vault's flat tags should be organized into a nested hierarchy by proposing parent/child families over EXISTING tags. Trigger phrases - "organize tags", "tag hierarchy", "group my tags", "tag structure", "nest my flat tags", "tag optimization", "restructure tags", "structure my tags". Runs AFTER tag-manage cleanup (hygiene first). Slice 1 proposes structure over existing tags only; it does NOT invent tags from note content (that is the later auto-tag slice, not yet built).
---

# Tag Organize

Propose a nested tag hierarchy for a vault's flat, sprawling tags. The model
groups existing flat tags into candidate parent/child families; you review,
disambiguate, and approve; the deterministic engine applies the nests.

This is the AI-driven companion to `tag-manage`. `tag-manage` does hygiene
(rename/merge/remove, and *declared* nesting from config). `tag-organize`
*proposes* the structure. The two share one engine (`skills/tag-manage/scripts/`);
this skill adds the proposal + orchestration layer.

## What this does / does not do (Slice 1)

- **Does:** scan the existing flat tags, propose parent/child families by shared
  name (e.g. `Business-Strategy` + `BusinessModel` + `business-dev` -> parent
  `Business`), and turn the families you approve into nests via the existing
  declared-hierarchy path.
- **Reads content only to disambiguate:** for a family the names alone do not
  settle (homonyms, mixed-sense stems), read a small bounded sample of note
  bodies — behind the content-read gate below.
- **Does NOT auto-assign tags to notes.** Filling under-tagged notes with new
  tags from their content is the later auto-tag slice (`addTagsToNote`), not yet
  built. This skill only reshapes tags that already exist.

## Principle: Core + Nahbereich + Report

- **Core:** propose families, apply the approved nests.
- **Nahbereich:** none that writes. Surface adjacent observations (e.g. a tag
  that looks mis-cased, a near-duplicate) for `tag-manage`; do not fix them here.
- **Report:** every run ends with what was proposed, approved, applied, and
  deferred. The report is how the user knows what happened.

## Prerequisite: run hygiene first

Recommend running `tag-manage` (audit + cleanup) **before** organizing, so the
structure is induced over a clean tag set rather than a messy one (mixed casing,
duplicates, separator variants). If the user has not cleaned up recently, say so
and offer to run `tag-manage` first.

## Production Vault Safety Rules

Production-vault runs follow the repo's Production Vault Safety Rules:

- **Test vault first.** Validate on a throwaway copy before any production run.
- **Gate, not step.** Switching from a test vault to a production vault requires
  an explicit user confirmation, even for read-only scans.
- **No filesystem discovery.** Operate only on the vault path the user provides;
  never scan outside `${OBSIDIAN_VAULT_PATH}`.
- **Confirm before bulk.** Before applying nests that touch more than 10 notes,
  state "I will nest tags in N notes in `<vault>`. Confirm?" and wait.

## Flow

Set `OBSIDIAN_VAULT_PATH` (or pass the vault path explicitly). The engine is the
shared `tag-manage` CLI.

**1. Induce candidate families (read-only):**

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/tag-manage/scripts/cli.js" induce "${OBSIDIAN_VAULT_PATH}"
```

This writes `.tag-organize-clusters.json` (a dot-prefixed sidecar, never scanned) and,
when a report home is configured, a browsable `<date> Tag Organize Proposal - Vault-wide.md`
note — the human-readable view of the same families. Read either.

**2. Present the proposal (three tables).** `induce` scores each family by structural
signal (family size, note frequency, enumeration suffix, match against a declared config
parent, minus a coincidence-prefix penalty) and splits them into three sections in the
proposal note:

- **Implement** — high structural confidence (e.g. enumerated families like `Phase0-4`, or
  a parent that matches a declared config parent). Propose the whole bucket as a default
  batch: show the one table, let the user deselect any they reject, then persist + apply
  the rest.
- **Decide** — the uncertain middle. Work through individually; for families whose names do
  not settle the call, use the content-read gate below.
- **Ignore** — likely name-coincidence (a common-word prefix, e.g. `Open` over `OpenAI` +
  `OpenSource`). Skipped by default; the user may still promote one.

Each row carries `Notes` (how many notes the family touches) and `Score` (0–100). The score
is a structural signal strength, **not** a probability — use it with `Notes` to triage.
`Implement` is a recommendation, never auto-apply: every nest still goes through the confirm
gate in step 5.

**3. Disambiguate the uncertain ones (content-read gate).** For families whose
placement the names do not settle, read a bounded sample of note bodies to decide.
State the scope first: "I will read up to N notes across M families to confirm
their grouping — proceed?" Wait for approval. Sample only the notes carrying the
ambiguous tags (top few per tag), never the whole vault.

**4. Persist each approved cluster** (deterministic, no LLM):

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/tag-manage/scripts/cli.js" set-hierarchy "${OBSIDIAN_VAULT_PATH}" \
  --parent Business --children Business-Strategy,BusinessModel,business-dev
```

`set-hierarchy` refuses to persist an invalid taxonomy (it throws). Re-run it once
per approved cluster. The user may rename a proposed parent before you persist it
(the proposal's casing is a starting point, not a mandate).

**5. Apply the nests via the existing guarded path.** Re-audit to surface the
nest recommendations the declared hierarchy now implies, then plan and apply:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/tag-manage/scripts/cli.js" audit "${OBSIDIAN_VAULT_PATH}" --report-dir <dir>
node "${CLAUDE_PLUGIN_ROOT}/skills/tag-manage/scripts/cli.js" plan  "${OBSIDIAN_VAULT_PATH}" --from-recs <dir>/.tag-manage-nest.json --ids 1,2
# Human gate: "I will nest tags in N notes in <vault>. Confirm?" — wait for yes.
node "${CLAUDE_PLUGIN_ROOT}/skills/tag-manage/scripts/cli.js" apply "${OBSIDIAN_VAULT_PATH}" --from-recs <dir>/.tag-manage-nest.json --ids 1,2 --write
```

A nest is a rename onto a slash path, so it rides the same `applyOps` + survival +
mass-change guards + confirm gate as every other op, and it **converges** (an
already-nested tag yields no further nest).

## Report format

End every run with:

```
## Tag Organize Report - <date>

### Done
- Proposed N candidate families
- Approved + persisted M clusters (set-hierarchy)
- Applied K nests (<note counts>)

### Findings (reported, not fixed)
- <adjacent tag-hygiene observations -> tag-manage>

### Deferred
- <families left for content review, or skipped>
```

## Known limitations (Slice 1)

- The parent name is the most-frequent leading display segment among members;
  confirm acronym/casing and homonym placement at review (you have the content),
  do not assume the proposal is final.
- No content-based auto-tagging. Under-tagged notes are not filled — that is the
  later auto-tag slice (`addTagsToNote`), a separate build with its own gate.
- A configured `reportDir` (via `Tag Manage Config.md`) makes `audit` and `induce`
  WRITE their report artifacts even without `--report-dir`. A "read-only audit" is not
  strictly read-only when a report home is set; the dated `HHMM` filename keeps same-day
  re-runs from overwriting each other.

## Quality check

- [ ] Hygiene (`tag-manage`) recommended before organizing
- [ ] Content-read gated, scope stated, sample bounded
- [ ] Every nest applied only after the confirm gate; more than 10-note runs confirmed first
- [ ] Report produced
