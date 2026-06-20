# Tag-Manage v2 — Scope Recovery (Slice 1: Compliance + Report)

## Context

`tag-manage` v1 (PR #42, merged 2026-06-20) shipped as a narrow, safe audit-and-cleanup
engine: a deterministic rewrite core (`tags.js`) with a byte-exact survival guard, plus a CLI
(`cli.js`) exposing `audit` / `plan` / `apply`. It renames, merges, and removes existing tags
across all six on-disk representations, behind a preview-and-confirm gate.

A live UAT against a copy of the user's production vault surfaced that v1 is a **subset** of a
mature predecessor the user built in March 2026 (the `tag-management` skill, both a plugin
version and a migrated local version). The predecessor was a full tag-management analyst:
seven analysis modes, a severity-classified convention-compliance engine, ~50 BRAND and ~85
COMPOUND curated override dictionaries, folder-exclusive rules, hierarchy analysis, and an
11-section vault-written report with a health score.

**Root cause of the loss:** the planning record said `tag-manage` was `status: deferred` —
"never built." The v1 dispatch brief therefore scoped it as a greenfield stub and built fresh
rather than porting, dropping the predecessor's accumulated intelligence and hand-curated
dictionaries. The predecessor was real and intact on disk; the planning side simply did not
know it existed.

This spec recovers the lost intelligence **onto v1's safe deterministic engine** — keeping the
survival guarantee, adding back the analysis, dictionaries, and rich report.

## Decisions (brainstorming, 2026-06-20)

| # | Question | Decision |
|---|---|---|
| 1 | Slice-1 scope | **A + B** — compliance engine + dictionaries + rich vault report. C–G deferred to later slices. |
| 2 | Casing / convention default | **PascalCase enforced, default-on.** Casing fixes are primary recommendations, not opt-in cosmetic. The Step-0 case-insensitivity finding stays as the *reason it is safe and reversible*, not a reason to skip. The preview→confirm→execute gate remains before any write. |
| 3 | Override home | **Vault-local config file.** Generic defaults ship in the repo; personal/vault-specific overrides live in the vault, merged at runtime. |
| 4 | Report destination | **Config-determined**, default = the user's existing `Tag Management for Obsidian` folder, else vault root. No hardcoded path. |
| 5 | Architecture | **Modular pure-engine extension** — `tags.js` unchanged; new focused pure modules `convention.js` / `analysis.js` / `report.js` + `config.js` (I/O) + a shipped `tag-overrides.default.json`. |

## Goals (Slice 1)

1. A deterministic, severity-classified **convention-compliance engine** + a **canonical-form
   resolver** (brand → compound → PascalCase heuristic).
2. **Curated override dictionaries**: generic defaults shipped in the repo (MIT-safe), personal
   overrides in a vault-local config, merged at runtime.
3. A **rich tag-analysis report** written into the vault (scaled subset of the original's
   11 sections), with a prioritized recommendation list.
4. **Reuse v1's `applyOps` write path unchanged** — no change to the survival guard, mass-change
   guard, birthtime preservation, or idempotency.

## Non-Goals (deferred to later slices)

- **C** — hierarchy analysis (flat-vs-hierarchical, multi-parent, deep-nesting, orphan-parents)
- **D** — folder-exclusive tag *enforcement* (the config schema reserves the field; enforcement
  is a later slice)
- **E** — `suggest` mode (content-based near-duplicate detection: singular/plural, abbreviations,
  synonyms)
- **F** — `_Tag Index.md` generation
- **G** — Cookbook / Roadmap continuous-improvement update loop
- Recognizing Dataview `tags::` inline-fields as *real, manageable tags* (only the mis-parse
  hotfix is in scope — see Safety)

## Architecture

All under `skills/tag-manage/`. New modules are pure (no `fs`, no clock) except `config.js`
and `cli.js`.

| Module | Responsibility | I/O |
|---|---|---|
| `scripts/tags.js` | **Unchanged** — rewrite engine, survival guard, six representations, `applyOps`, audit grouping | none |
| `scripts/convention.js` | Compliance classification (severity) + canonical-form resolver (brand → compound → PascalCase), with `source` provenance | none |
| `scripts/analysis.js` | Frequency, coverage, top-N, hierarchy-depth distribution, singleton/low-usage classification | none |
| `scripts/report.js` | Markdown report builder (data → string), date injected | none |
| `scripts/config.js` | Load + merge dictionaries (defaults ⊕ vault-local), resolve report destination | read |
| `scripts/cli.js` | Orchestrator + report write + apply (extended) | read/write |
| `references/tag-overrides.default.json` | Generic shipped defaults (brands + compounds) | data |

### Data flow

```
walk(vault | scope)
  -> tags.js     : inventory (logical tags, variants, noteCount, files)
  -> analysis.js : frequency / coverage / top-N / depth / singletons
  -> convention.js: per tag -> { violations[], canonical, source }  (uses merged dictionaries)
  -> build recommendations (prioritized by notes affected)
  -> report.js   : markdown
  -> cli.js      : print report + write report note to config destination
  == Stage 1 review checkpoint: only the report note is written, no tag changes ==
  -> user selects recs ("apply all" / "#1,#3" / "skip #2" / "#1 bis #4")
  -> recs -> ops -> tags.js applyOps  (survival guard, per-op mass guard, birthtime)
  -> post-verify re-scan -> "after changes" report + Update Log
```

The new intelligence produces **only recommendations** (Stage 1, read-only on notes). The
**write path is unchanged `applyOps`** (Stage 2, behind the confirm gate).

## Convention rules (canonical)

First matching rule wins (mirrors the predecessor's Step 3.5). Exceptions checked first:
AI-/KI-prefix (`AI-ML` is correct), brand-hyphen (`Mercedes-Benz`), reserved (`VaultAutopilot`).

| Severity | Violation | Example | Canonical |
|---|---|---|---|
| HIGH | hashtag-prefix | `#research` | `Research` (strip `#`) |
| HIGH | yaml-artifact | `created:` | remove (not a tag) |
| HIGH | numeric-artifact | `2026`, `1` | remove (not a tag) |
| MEDIUM | lowercase-concept | `research` | `Research` |
| MEDIUM | camelCase | `fastAPI` | `FastAPI` (brand-check first) |
| MEDIUM | upper-kebab | `App-Development` | `AppDevelopment` (compound-check first) |
| MEDIUM | snake_case | `ai_agents` | `AI-Agents` |
| LOW | flat-where-hierarchical | `DevTools` while `Software/DevTools` exists | `Software/DevTools` |

### Canonical-form resolver

Deterministic, in order:

1. **BRAND** dictionary hit (logical-key match) → official casing (`github` → `GitHub`).
2. **COMPOUND** dictionary hit → merged PascalCase (`secondbrain` → `SecondBrain`,
   `low-code` → `LowCode`).
3. **PascalCase heuristic** fallback: AI-/KI-prefix keeps the hyphen and PascalCases parts;
   otherwise split on separators and PascalCase.

The resolver returns `{ canonical, source: 'brand' | 'compound' | 'heuristic' }`. The
heuristic guesses wrong on unknown compounds (`wealthbuilding` → `Wealthbuilding`). Therefore
**heuristic-sourced canonicals are flagged distinctly in the report** ("verify casing — not in
override dictionary") and are never silently applied without the user's confirmation. Confirmed
corrections feed the vault-local dictionary (the continuous-improvement loop; the automated
Cookbook update is a later slice).

## Dictionaries + config

### Shipped defaults — `references/tag-overrides.default.json`

Generic, MIT-safe entries only (no personal names). Schema:

```json
{
  "brands":    { "github": "GitHub", "chatgpt": "ChatGPT", "linkedin": "LinkedIn" },
  "compounds": { "opensource": "OpenSource", "lowcode": "LowCode" }
}
```

### Vault-local config

A Markdown note in the config directory (`Tag Manage Config.md`) carrying a fenced ` ```json `
block — readable and editable in Obsidian, zero-dependency parseable (extract the first json
fence, `JSON.parse`). Schema:

```json
{
  "brands":         { "busitec": "Busitec", "omnixis": "Omnixis" },
  "compounds":      { "schulamtstuttgart": "SchulamtStuttgart" },
  "folderExclusive": { "Inbox": "001_Inbox - ...", "Clippings": "001_Inbox - .../Clippings" },
  "reportDir":      "020_Processes - .../SecondBrain/Tag Management for Obsidian"
}
```

`folderExclusive` is **reserved but not enforced in Slice 1** (forward-compatible schema).

### Config discovery (no hardcoded path)

The skill resolves the vault-local config without any hardcoded path, in order:

1. An explicit `--config <path>` flag, if given.
2. Otherwise, a scoped search **inside `OBSIDIAN_VAULT_PATH`** for a note named
   `Tag Manage Config.md` (permitted — it is within the configured vault, not external
   filesystem discovery). First match wins.
3. If none is found: run with **defaults only** (no error), and on a Stage-1 run offer to create
   the config note in the resolved report directory (the `Tag Management for Obsidian` folder if
   present, else vault root) seeded with the rescued personal overrides.

`reportDir` is read from the config once located; until then the report-directory default
(Tag Management folder → vault root) applies. This resolves the bootstrap ordering.

### Merge semantics

Defaults ⊕ vault-local; **vault-local wins on key collision**. Missing vault-local config →
defaults only, no error. The merged dictionary is passed into `convention.js` (pure — no I/O
inside the engine).

### Asset rescue (one-time, part of the build)

The predecessor's ~135 overrides (from the original skill file's `BRAND_OVERRIDES` /
`COMPOUND_OVERRIDES`) **and** the in-vault `Obsidian Tag Management — Cookbook.md` are read and
split:

- **Generic** entries (GitHub, OpenSource, …) → `tag-overrides.default.json` (repo).
- **Personal / vault-specific** entries (SchulamtStuttgart, VfB-Stuttgart, Busitec, …) → the
  vault-local config.

Nothing is lost; nothing personal lands in the public repo.

## Report (Slice 1)

`report.js` builds a scaled subset of the predecessor's report:

1. Summary callout — scope, notes, unique tags, assignments, coverage %, issue count
2. Key Metrics — tagged/untagged, unique, avg tags/note, max hierarchy depth, singletons
3. Top 20 tags — usage count, % of tagged notes
4. Findings — duplicates (case/separator); **convention violations by severity** (current →
   canonical → notes affected); unused/low-usage (singletons + 2–3×, classified
   remove/merge/keep)
5. Recommendations — prioritized by notes affected, numbered for `apply #1,#3`
6. Health Score — conformity %, coverage %, singleton ratio
7. Update Log — plus a Changes section appended after Stage 2

**Deferred report sections:** hierarchy (C), folder-exclusive compliance (D), folder
scorecard / vault-wide master summary.

**Destination:** config `reportDir`, default = `Tag Management for Obsidian` if present, else
vault root. Naming: `YYYY-MM-DD Tag Analysis Report - [Scope].md`; post-apply
`YYYY-MM-DD Tag Analysis Report - [Scope] - after changes.md`. Writing a new report note is
additive (overwrites nothing); the skill announces the path.

## Recommendation → confirm → execute flow

- **Stage 1 (`audit`):** produces the report + recommendations; writes **only** the report note
  (additive). No tag changes. This is the review checkpoint.
- **User selection:** "apply all" / "apply #1, #3" / "skip #2" / "apply #1 bis #4".
- **Compile:** selected recommendations → `rename` / `merge` / `remove` ops → `tags.js applyOps`.
- **Gates (all reused from v1):** >10-note runs confirmed first; every merge flagged
  irreversible; per-op mass-change guard (default 50); survival guard.
- **Stage 2 (`apply`):** writes tag changes → post-verify re-scan → updates the report's Changes
  section + Update Log.

## Safety

- **Survival guard, mass-change guard, birthtime preservation, idempotency** — reused unchanged
  from v1; nothing in `tags.js`'s write path is touched.
- **Production Vault Safety Rules** apply: vault path is a gate (ask, never assume); no
  filesystem discovery; confirm before touching more than 10 files.
- **Dataview `tags::` mis-parse hotfix (UAT finding):** `FIELD_RE` becomes
  `^(\s*)(tags|tag)\s*:(?!:)\s*(.*)$` so a Dataview double-colon inline-field (`tags::`) is no
  longer mis-read as a `tags:` scalar with a garbage value. Cheap, honest, removes the audit
  noise. (Recognizing Dataview `tags::` as real, manageable tags is a larger feature — deferred.)
- **Bucket rename:** the audit's `numericArtifacts` bucket becomes `invalidTags`, split into
  `numeric` vs `other` (the UAT showed 50/52 were genuinely numeric, 2 were other-invalid).

## Testing (TDD)

- `convention.js` — each violation type; each canonical-resolver path (brand / compound /
  heuristic); AI-/KI-prefix and brand-hyphen exceptions; reserved-tag skip; an **anti-vacuous**
  pin (a known-wrong heuristic guess is asserted as flagged, not silently applied).
- `analysis.js` — frequency / coverage / top-N / depth distribution on a fixture.
- `report.js` — deterministic markdown snapshot from a known dataset (date injected).
- `config.js` — defaults-only; merge with vault-local; vault-local wins; missing-config graceful;
  json-fence extraction from the Markdown config note.
- Integration via `cli.js` on the existing chaos fixture + new compliance/dictionary fixtures.
- The **63 existing engine assertions stay green** (no regression).
- CI bridge `scripts/test-tag-manage.sh` extended to run the new suites.

## Open items / future slices

- **Slices C–G** (hierarchy, folder-exclusive enforcement, suggest, tag-index, cookbook loop)
  follow as separate spec → plan → implementation cycles.
- **Case-philosophy note:** Decision 2 enforces PascalCase by default because this vault's owner
  demonstrably values the display convention (~135 curated overrides). The Step-0 finding
  (Obsidian is case-insensitive) is preserved as the rationale for *why* case-normalization is
  safe and reversible — it is not a reason to omit the operation.
