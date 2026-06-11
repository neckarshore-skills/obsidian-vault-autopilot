# Skill-Cluster Hardening Plan — Fable Pilot (2026-06-11)

**Status:** Phase 1 in progress — "go" received 2026-06-11 with two adjustments: (1) the property-classify cooldown/birthtime contradiction is a safety-gate bypass and is handled in Phase 2 (not Phase 4), (2) the Phase-1 stop must name the 2 beta skills and their disposition. Cosmetic items #1/#2 resolved en passant, #3 deferred (user decision).
**Scope:** The 7 skills under `skills/` only. No new skills, no behavior regressions (AP-1: changes additive or explicitly flagged).
**Method:** Eval/test-first per phase — failing assertion committed RED first, then the fix turns it GREEN. Hard stop after every phase.

---

## 1. Harness State (Phase-0 Finding)

What exists today — all verified green by running them (2026-06-11):

| # | Asset | Kind | Covers | Result |
|---|-------|------|--------|--------|
| 1 | `scripts/detect-clone-cluster.sh` | executable detector | clone-cluster window detection | green (via 3) |
| 2 | `scripts/smoke-test.sh` | interactive UAT scaffold | 4 launch skills, manual | manual-only |
| 3 | `scripts/test-clone-cluster.sh` | assertion script | fixture truth-matrix + 4 SKILL.md cross-refs | PASS |
| 4 | `scripts/test-clone-preflight.sh` | assertion script | preflight WARN-flow + doc retractions | PASS |
| 5 | `scripts/test-readme-install-blocks.sh` | assertion script | README fence shape | PASS |
| 6 | `scripts/test-recipe-f-duplicate-keys.sh` | assertion script | recipe-f 5-cell matrix, 31 asserts | PASS (31/0) |
| 7 | `scripts/test-windows-trailing-dot.sh` | assertion script | trailing-dot fixture + cross-refs | PASS |

**Gaps (these ARE Phase-0 findings):**

1. **No CI.** `.github/workflows/` does not exist. The 5 green assertion scripts run only when someone remembers to run them. (Known P2 backlog item since the 2026-05-14 pre-fire session; still open.)
2. **No eval coverage for the most load-bearing logic in the plugin:** the `references/yaml-sanity.md` verdict classifier (7 verdicts: `OK`, `OK_QUOTED`, `OK_NO_FRONTMATTER`, `BROKEN_KEYS_INSIDE_COLON`, `DUPLICATE_KEYS_IDENTICAL_VALUES`, `DUPLICATE_KEYS_DIVERGENT_VALUES`, `MULTIPLE_FRONTMATTER_BLOCKS`/`UNCLOSED_FRONTMATTER`). All 4 launch skills route every file through it; no fixture suite maps file-shapes to expected verdicts. The recipe-f matrix covers only the duplicate-key subset.
3. **Orphaned assets:** `test-data/f*-repro.md` (5 historical repro files) and `scripts/validate-recipe-f.py` are wired into no test script — repro knowledge exists but regresses silently.
4. **No eval for the `created` Source Hierarchy** (Prio 1-4 walk + German-date normalization per `references/german-date-normalization.md`) — the second-most load-bearing shared logic, also untested.
5. **Existing assertion scripts are doc-shape tests** (grep SKILL.md for required cross-refs/clauses). Valuable as drift-guards, but they verify the *spec text*, not *behavior on fixtures*. Behavioral validation so far = manual gold-runs (Cycle-4). The repo has no repeatable behavioral eval a fresh contributor can run.

## 2. Per-Skill Audit

Hardening stack = the v0.1.3/v0.1.4 defenses: yaml-sanity verdict routing, clone-cluster gate, clone/windows preflight, yaml-edits recipe discipline, findings-file step, preview/user-gate.

| # | Skill | Status | Hardening stack | Eval coverage | Key robustness gaps |
|---|-------|--------|-----------------|---------------|---------------------|
| 1 | inbox-sort | stable | full | partial (doc-shape) | G7 spec contradictions (see below) |
| 2 | note-quality-check | beta | **absent** | **none** | G2: destructive Nahbereich (0-byte delete, whitespace trash) in Phase 1 *before* any preview/user gate; cooldown + age detection use raw birthtime (clone-poisoning class — exactly what F3/GR-3 proved unreliable); no yaml-sanity call before reading frontmatter; trash metadata + skill-log edits not bound to yaml-edits recipes; no findings-file step; intentional-content-signal logic (the only guard between a note and `_trash/`) has zero fixtures |
| 3 | note-rename | stable | full | partial (doc-shape) | G5: Nahbereich quick-fix list (`"type:" → type`, "remove duplicate `---`") predates and overlaps recipe-(f)/yaml-sanity routing — a model applying the legacy bullet fix bypasses duplicate-collision ABORT handling; two repair paths for one defect class |
| 4 | property-classify | beta | **absent** | **none** | G1: writes `status`/`type` into frontmatter with no yaml-sanity preflight (on an F26-shaped file a naive edit corrupts further); cooldown uses raw birthtime, no clone gate; Step 5 "Write" not bound to `references/yaml-edits.md` recipes (the exact F19/F25/F26 historical bug surface); no findings-file step; no windows/clone preflight; fully deterministic rule tables (status hierarchy, 2-layer type, conflict handling) — ideal eval target, zero fixtures |
| 5 | property-describe | beta | full | partial (doc-shape) | G7: param table says cooldown "Use file creation date (birthtime)" — contradicts Step 2c (YAML-created-first + clone gate). A model following the param table bypasses the gate |
| 6 | property-enrich | stable | full | partial (doc-shape) | G7: same stale cooldown param text as #5 |
| 7 | tag-manage | deferred | absent | none | Excluded from this plan: v0.2.0 specs + 3 plans live on branch `obi/v0.2.0-tag-skills-design` awaiting MASCHIN review — hardening now would fork the pending design |

**Cross-cutting design note (flag, no action):** `property-classify` `polished` requires 3+ `aliases`, but no skill fills `aliases` (deferred to v0.2.0) — the status is effectively unreachable today.

## 3. Prioritized Targets (value x hardness)

| Rank | Target | Value | Why |
|------|--------|-------|-----|
| 1 | yaml-sanity verdict eval suite + CI | Cross-skill foundation | Every other phase's RED/GREEN evals need a behavioral fixture harness; classifier is load-bearing for all 4 launch skills and for hardening #2/#4; wires the orphaned `test-data/` repros; CI makes all greens permanent |
| 2 | property-classify hardening | Corruption-prevention | Only skill that writes frontmatter with zero defenses; deterministic rules make eval-first cheap and exact |
| 3 | note-quality-check hardening | False-positive-prevention | Destructive paths (trash/delete/archive) with no gates; a false positive here is the worst failure class (persona principle: deleting a valuable note > all other failures) |

The 4 launch skills are Cycle-4 gold-run validated; their remaining defects are spec contradictions (G5/G7) — real but small, bundled as Phase 4.

## 4. Phase-Gated Plan (stop after every phase)

### Phase 1 — Eval foundation: yaml-sanity fixture suite + CI

1a. **RED:** New fixture set `tests/fixtures/yaml-sanity-verdicts/` — one cell per verdict x shape (incl. the unwired `test-data/f*-repro.md` shapes, UNCLOSED_FRONTMATTER, body-level `---` horizontal-rule false-positive, no-frontmatter, BOM/CRLF variants). `_truth.json` maps each cell to its expected verdict. New `scripts/test-yaml-sanity-verdicts.sh` asserts the truth matrix against `references/yaml-sanity.md` pattern definitions — committed failing where coverage holes exist.
1b. **GREEN:** Close the holes (fixture-side or, if a genuine classifier-spec gap surfaces, additive clarification in `references/yaml-sanity.md` — flagged explicitly if behavior-relevant).
1c. **CI:** `.github/workflows/test.yml` running all `scripts/test-*.sh` on push/PR. Additive, no behavior change.
1d. **STOP** — present: gap, new eval, fix, all existing tests re-run green (self-verified).

### Phase 2 — property-classify hardening (eval-first)

2a. **RED:** Fixture vault `tests/fixtures/property-classify/` covering: status hierarchy precedence (protected > archived > reviewed > polished > draft), 2-layer type rules + content-over-path override, conflict (existing type vs proposed), F26-shaped file (must SKIP, not write), clone-cluster birthtime cooldown case, casing Nahbereich (`Status` → `status`). Assertion script committed RED.
2b. **GREEN:** SKILL.md hardening — additive: pre-flight block (clone + windows preflight refs), Step "sanity-check + verdict routing" (mirroring property-describe's additive-only policy: SKIP + finding, never repair), cooldown date source switched to the Source-Hierarchy wording used by the launch skills — **this closes the cooldown/birthtime param-table contradiction, classified as a safety-gate bypass and pulled into Phase 2 per user adjustment 2026-06-11** — Write step bound to `references/yaml-edits.md` recipes, findings-file step added, Quality Check items extended.
2c. **STOP** — same presentation contract.

### Phase 3 — note-quality-check hardening (eval-first)

3a. **RED:** Fixture vault `tests/fixtures/note-quality-check/`: intentional-content signals (each of the 5 signals individually must prevent Nahbereich), whitespace-only vs 0-byte vs near-empty-with-wikilink, bulk-import age cluster, F26-shaped file. Assertion script committed RED.
3b. **GREEN:** SKILL.md hardening — additive: Nahbereich deletes moved behind an explicit preview/confirm gate (behavior change, **flagged**: aligns with the E2 trust-gap finding from 2026-05-14 and README "waits for your approval" promise — this is regression-removal, not regression), yaml-sanity call before frontmatter reads, clone-cluster gate for age/cooldown, yaml-edits binding for trash metadata + skill log, findings-file step.
3c. **STOP.**

### Phase 4 — launch-skill spec-contradiction fixes (small, additive)

4a. **RED:** Extend an assertion script with greps that fail on: stale cooldown param text (enrich + describe), inbox-sort QC "No files were renamed or modified" / "recently modified" wording, note-rename legacy quick-fix list lacking a recipe-(f) precedence pointer.
4b. **GREEN:** Minimal wording fixes routing all repair paths through the canonical references.
4c. **STOP.**

## 5. Cosmetic Flag List (explicitly NOT in scope — zero Fable tokens)

| # | Item | Note |
|---|------|------|
| 1 | `AGENTS.md` (untracked, root) | **Resolved 2026-06-11 (user decision): deleted.** Was an auto-generated Codex variant of CLAUDE.md with mangled content (`.Codex-plugin/`, "Pre-launch" though repo is public) |
| 2 | `docs/philosophy.md` Target-Skills table | **Resolved 2026-06-11: fixed en passant** (8 stale skills → actual 7, scraper family pointer added) |
| 3 | `property-classify` `polished`/`aliases` unreachability | **Deferred (user decision 2026-06-11)** — design question for v0.2.0 |
| 4 | Description/trigger-phrase polish across skills | Per pilot brief: flag only |
| 5 | `session-report-20260505-0830.html`, `.DS_Store` in root | Resolved 2026-06-11: removed locally (both gitignored, never tracked) |

## 6. Non-Goals

- tag-manage changes (owned by pending v0.2.0 specs on `obi/v0.2.0-tag-skills-design`)
- Any production-vault run (test fixtures only; production = gate per CLAUDE.md safety rules)
- New skills, new features, scope beyond the 7 listed skills
