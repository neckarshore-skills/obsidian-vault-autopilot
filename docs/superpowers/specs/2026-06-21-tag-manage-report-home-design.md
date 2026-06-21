# tag-manage: First-Run Report Home — Design

**Date:** 2026-06-21
**Status:** Approved (design) — pending spec review
**Skill:** tag-manage
**Author:** Obi (Skill Master)

## Context

A live UAT of tag-manage v2 on a fresh production-vault copy surfaced three coupled
defects around where the audit/apply reports are written:

1. **No report home, no guidance.** With no `reportDir` configured and no
   `Tag Manage Config.md`, the audit silently prints to stdout and writes nothing.
   A first-time user gets no report file and no prompt for where one should live.
2. **Folder sprawl from a manual workaround.** During the UAT the operator wrote the
   before-report and after-report into two separate folders (`Meta/Tag Management v2 live`,
   `Meta/Tag Management v2 after`) to avoid a filename collision. The user's reaction —
   "then I end up with as many folders as files" — is the design smell this spec removes.
3. **Report self-poisoning.** Running `apply` without `--report-dir` rewrote tag-shaped
   tokens inside a report note (its own "apply #1, #3 / skip #2" text became frontmatter
   tags `1`, `2`, `3`). Root cause confirmed in code: `runAudit` excludes report artifacts
   from its scan (gated on `reportDirAbs`), but `applyToVault` excludes nothing.

The user directive: on the **first** report run, the skill should **ask where the report
should go**, **propose a sensible location based on the vault's structure**, and make that
choice a **permanent home** so all follow-up reports land there automatically.

## Goals

1. First report run with no configured home triggers an agent-driven location gate:
   detect candidates, propose the best one, ask the user, persist the choice.
2. The chosen location becomes the permanent home via `Tag Manage Config.md` (`reportDir`).
   Subsequent runs never ask again — reports auto-land there (before + after in one folder).
3. Proposal is **smart placement of a fresh folder** (user's choice): informed by the
   vault's structure, not a fixed default and not the user's existing predecessor folder.
4. Fix the two coupled defects that make a permanent home actually safe: auto-create the
   report folder; exclude report artifacts from the `apply` scan.

## Non-Goals

- Content-based auto-tagging (separate, later scope).
- An interactive TTY prompt inside the CLI (wrong layer — the CLI is non-interactive;
  the human gate belongs to the agent).
- Migrating or deleting the user's existing predecessor reports.
- Automating the continuous-improvement dictionary loop (separate slice).

## Approach

**Hybrid — deterministic CLI helpers + agent-orchestrated gate.** Detection and persistence
are deterministic, unit-tested CLI functions (no hallucinated paths, no hand-corrupted
config in a user's vault); the human "where?" gate stays with the agent. This matches the
skill's core principle — *determinism is the safety guarantee* — and the existing
"deterministic engine + agent gate" architecture.

Rejected alternatives:
- **Agent-only** (agent scans + hand-writes config): non-deterministic, untestable, risks
  path hallucination and a malformed JSON fence in the user's vault.
- **Fully-CLI interactive**: breaks the non-interactive/scriptable design; wrong layer.

## Design

### New module: `scripts/report-home.js`

Single purpose: detect candidate report homes and persist the chosen one. Exposes two pure-ish
functions (fs effects isolated and testable):

#### `suggestReportDir(vault) -> { recommended, candidates }`

Deterministic ranking over the vault's top-level directories (excluding `.`/`_`-prefixed
and `node_modules`):

1. If a top-level dir named `Meta` (case-insensitive) exists →
   `{ relpath: "<MetaDir>/Tag Management", reason: "existing Meta folder", exists: false }`.
2. Else if a top-level dir whose name matches an admin/meta/system intent
   (`/(^|[^a-z])(meta|system|admin)([^a-z]|$)/i`) exists → a fresh `Tag Management`
   subfolder inside the first such dir (A→Z), reason `"admin-like area"`.
3. Always present: `{ relpath: "Tag Management", reason: "vault root (fallback)", exists: false }`.
4. **Continuity alternative** (ranked below the fresh default): any folder whose name
   contains both "tag" and "manage"/"management" →
   `{ relpath: "<that folder>", reason: "existing tag-management folder (continuity)", exists: true }`.

`recommended` = the first (highest-ranked fresh) candidate's `relpath`. `candidates` is the
full ranked list (fresh default first, fallback, then continuity alternative). Output is JSON
on stdout when run as a subcommand.

#### `setReportDir(vault, relpath) -> { configPath, created }`

- **Validate** `relpath`: must be vault-relative — reject if absolute, starts with `/`,
  or contains a `..` segment. (Do-no-harm: never persist a home pointing outside the vault.)
- Locate an existing `Tag Manage Config.md` (vault walk).
  - **Exists:** parse its `json` fence, set `reportDir = relpath`, **preserve** all other keys
    (`brands`, `compounds`, `folderExclusive`), rewrite the fence in place (surrounding
    markdown untouched). Idempotent.
  - **Absent:** create `Tag Manage Config.md` at the vault root with a short explanatory
    header and a `json` fence `{ "reportDir": "<relpath>" }`.

### CLI changes: `scripts/cli.js`

1. **New subcommand** `suggest-report-dir <vault>` → prints `suggestReportDir` JSON.
2. **New subcommand** `set-report-dir <vault> <relpath>` → calls `setReportDir`, prints the
   config path written.
3. **Fix (mkdir):** in `runAudit`, `fs.mkdirSync(reportDirAbs, { recursive: true })` before
   writing the report + sidecar. Removes the ENOENT abort on a not-yet-existing home.
4. **Fix (apply exclusion):** thread `reportDirAbs` (already resolved via
   `resolveReportContext` for the after-report) into `applyToVault`, and filter scanned notes
   with the same `isInside(reportDirAbs, p) && isReportArtifact(p)` guard `runAudit` uses.
   With the permanent-home feature, `reportDirAbs` is always resolvable on a configured vault,
   so a report note can never again be rewritten by an apply.

### SKILL.md: first-run agent workflow

Strengthen the existing "First-run config seeding" section into an explicit gate:

> On a report run where `Tag Manage Config.md` has no `reportDir` (or none exists):
> 1. Run `suggest-report-dir <vault>`.
> 2. Present the recommended fresh location plus alternatives (including the continuity
>    option). State it becomes the permanent home.
> 3. **Gate:** ask the user to confirm or choose. Wait.
> 4. Run `set-report-dir <vault> "<chosen>"`.
> 5. Proceed with the audit — the report now lands in the permanent home, and every
>    follow-up run reuses it without asking.

## Data Flow

```
first audit run
  -> resolveReportContext finds no reportDir, no config note
  -> agent: suggest-report-dir  ->  ranked candidates (JSON)
  -> agent presents #1 + alternatives  ->  USER GATE ("where?")
  -> agent: set-report-dir <chosen>  ->  writes Tag Manage Config.md (reportDir)
  -> agent: audit  ->  report + sidecar land in the permanent home (folder auto-created)
later runs
  -> resolveReportContext reads reportDir from config  ->  reports land there, no prompt
```

## Error Handling / Edge Cases

| Case | Behaviour |
|------|-----------|
| Headless run, no config, no `--report-dir` | Audit prints to stdout only, writes nothing. Nothing is guessed-and-written. (Do-no-harm.) |
| `set-report-dir` with absolute / `..` path | Reject with a non-zero exit and a clear message; write nothing. |
| `set-report-dir` on a vault with an existing config note | Update `reportDir`, preserve `brands`/`compounds`/`folderExclusive`. Idempotent. |
| Report home does not exist yet at audit time | `mkdir -p` creates it before writing. |
| `apply` run after the home is set | Report artifacts inside the home are excluded from the scan — no self-poisoning. |

## Components / Files

| File | Change |
|------|--------|
| `scripts/report-home.js` | **New.** `suggestReportDir`, `setReportDir`. |
| `scripts/cli.js` | Two subcommands; `mkdir -p` in `runAudit`; thread `reportDirAbs` into `applyToVault` + artifact filter. |
| `skills/tag-manage/SKILL.md` | First-run report-home gate workflow. |
| `tests/report-home.test.js` | **New.** Detection ranking + persistence + path-safety. |
| `tests/cli-apply-exclusion.test.js` (or extend an existing suite) | apply excludes report artifacts. |
| `logs/changelog.md` | Feature + two fix entries. |

## Testing Strategy (TDD — RED first)

1. **Detection ranking** — vault with a `Meta/` dir → recommends `Meta/Tag Management`;
   vault with only an `admin`-like dir → recommends `<dir>/Tag Management`; bare vault →
   `Tag Management` (root); vault with an existing "Tag Management" folder → it appears as a
   continuity alternative, not the recommendation.
2. **Persistence** — `setReportDir` creates a config note when absent; updates `reportDir`
   while preserving `brands`/`compounds` when present; is idempotent on re-run.
3. **Path safety** — absolute path and `..`-escape are rejected, nothing written.
4. **mkdir** — audit into a not-yet-existing report dir writes the report (no abort).
5. **apply exclusion** — apply with a report note inside the configured home leaves that
   note byte-identical.

All five RED before any implementation; GREEN gates the build. Existing 113-test suite must
stay green (no regression to the survival / representation / idempotency / mass-change suites).

## Open Questions

None — design approved 2026-06-21.
