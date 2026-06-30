# Low-Frequency Tag Review — Design

> **Status:** Design proposal (2026-06-28). Not yet built. Captured from an ad-hoc session that
> resolved singletons + doubletons on a 1,250-note production vault by hand.

## Problem

A mature vault accumulates **low-frequency tags** — tags used in exactly one note (singletons) or
two (doubletons). On the production Nexus vault: **824 singletons (61% of all tags)** and **226
doubletons**. Most are legitimate precise labels, but a meaningful fraction are resolvable noise:

1. **Numeric / artifact junk** — `1`, `42`, `2prio`, `Y2025` used as tags (Apple-import numbering, backlog ids).
2. **German↔English duplicates** — `Versicherung`/`Insurance`, `Skalierung`/`Scaling`, `KünstlicheIntelligenz`/`AI`. A bilingual vault tags the same concept twice; each half is a singleton.
3. **Near-duplicates** — singular/plural (`Image`/`Images`), spelling (`BusinessModell`/`BusinessModel`), variants.

Today **no skill surfaces these or proposes resolution.** `tag-manage audit` reports a singleton
*count* (Key Metrics + Health Score) but offers no review path. The session that motivated this spec
did the entire analysis with throwaway Node scripts on top of `auditVault`'s inventory — not
repeatable, not shipped.

## Goal

Make the low-frequency review a **first-class, repeatable** part of the tag skills: surface
singletons/doubletons and propose resolutions, behind the same preview→confirm→apply gates as the
rest of tag-manage. The user runs it deliberately; the engine does the byte-level work.

## What is deterministic vs. what needs the model

The split decides which skill each piece belongs in.

| Capability | Deterministic? | Home |
|---|---|---|
| Count + list singletons/doubletons | Yes — `auditVault` already computes note-counts | `tag-manage` |
| Numeric-artifact resolution | Yes — `numericArtifacts` class exists | `tag-manage` |
| Near-duplicate (case / separator / singular-plural) | Mostly — case+separator groups exist; singular/plural needs a small rule | `tag-manage` |
| **German↔English merge detection** | **No — requires translation** | `tag-organize` (AI layer) |
| Cluster-into-a-parent (Funding, Security, …) | No — semantic grouping | `tag-organize` |

The German↔English step was the highest-value part of the manual session **and** the only part the
deterministic engine cannot do. Translation is model judgment, so it belongs in the AI-driven
`tag-organize`, not in the deterministic `tag-manage` core.

## Proposed shape

### Slice 1 — `tag-manage`: low-frequency surfacing (deterministic)

Extend the audit (or a new `review-low-frequency` subcommand) to emit a **Low-Frequency Review**
section / sidecar:

- A `Singletons` and `Doubletons` block with counts and the full list.
- Pre-classified resolution candidates the engine *can* judge:
  - **Numeric/junk** → `remove` proposals (reuse `numericArtifacts`, filtered to letter-free).
  - **Near-duplicates** → `merge` proposals (extend the existing case/separator grouping with a singular/plural rule).
- Everything flows through the existing `--from-recs` apply path. No new write code.
- Honest framing baked in: "a singleton is not a defect"; only flag the resolvable subset, never bulk-propose the whole tail.

### Slice 2 — `tag-organize`: bilingual + cluster proposals (AI)

- **German↔English merge detection:** the model scans low-frequency tags, identifies German↔English
  pairs where a translation merge eliminates a singleton, and proposes `from → canonical` (target
  validated against the live inventory; never invent a target). Confident vs. borderline split
  (a merge that *narrows* meaning is flagged, not auto-applied).
- **Cluster proposals:** related low-frequency families (e.g. `Fördermittel*` + `Funding`) become a
  nest-under-a-parent proposal, not a flat merge — reusing the existing hierarchy/`set-hierarchy` path.

### Cross-cutting hardening — the `_`-folder blindspot

This session surfaced a real coverage gap: `walkMarkdown` skips every `_`-prefixed folder (intended
for `_vault-autopilot`/`_trash`), but a user vault with real content in `_Work`, `_Personal`, etc.
gets **silently excluded** from every scan. After cleaning all numeric tags in scannable scope, an
independent full-walk still found **30 pure-numeric frontmatter tags, all inside `_`-folders** — the
engine reported `numericArtifacts: 0` and was right *for what it scanned*, which is the trap.

Options (separate from this feature, but it makes the gap user-visible):

1. Narrow the skip to a known meta-set (`_vault-autopilot`, `_trash`, `_templates`) instead of all `_*`.
2. Make the exclusion **configurable** (a `scan.exclude` / `scan.includeUnderscore` config field).
3. At minimum, **report** what was excluded ("skipped 383 notes in 8 `_`-folders") so a count of `0` is never read as "whole vault is clean."

Recommendation: (3) immediately (cheap, honest), (2) as the real fix.

## Open questions

1. **Subcommand vs. audit section?** A dedicated `review-low-frequency` keeps the default audit lean;
   an inline section makes it discoverable. Lean toward a section gated behind a flag
   (`audit --low-frequency`) so the default stays fast.
2. **Doubletons too, or singletons only?** The session did both; doubletons had a lower hit-rate
   (~14/226 resolvable vs ~40/824). Worth surfacing both; let the user pick the threshold (`--max-count N`).
3. **Dictionary vs. model for DE↔EN?** A shipped/vault German↔English dictionary makes Slice 2 partly
   deterministic (and reusable in `tag-manage`); a model pass is more flexible but non-deterministic.
   A seeded dictionary that the model extends is likely the right hybrid.

## Slice 2 v1 — build resolution (2026-06-30)

Slice 1 (deterministic surfacing + numeric removals) shipped (`tag-manage`, PRs #60/#61/#62).
This section resolves the open questions for the **Slice 2 v1 build** and pins its scope. It is a
delta on the design above, not a new feature.

### Resolved decisions

| # | Open question | Decision | Rationale |
|---|---|---|---|
| A | Dictionary vs. model for DE↔EN (open-q3) | **Skip the seeded dictionary in v1.** The model translates DE↔EN natively; the dictionary buys *reproducibility + `tag-manage` reuse*, not *capability*. The `both-exist` code-guard + the confirm gate make a model-only pass safe. | Reverses open-q3's "seeded dictionary the model extends." No concrete dictionary consumer exists today (YAGNI). Extension point preserved: the model writes its confirmed pairs to the merge sidecar, which *could* seed a future dictionary. |
| B | Canonical direction when both halves exist | **English-canonical, config-overridable.** The German half merges into the English half by default — direction is by *language*, not by frequency. | The motivating Nexus session went DE→EN (evidence the user wants language normalization); English is the skill-content convention. A German-primary vault overrides via config. |
| 2 | Doubletons too, or singletons only (open-q2) | **Both** (singletons + doubletons), via the existing `analysis.singletons` + `analysis.lowUsage`. `--max-count N` threshold deferred. | The lists already exist; no new surfacing primitive needed for v1. |

### The load-bearing new code — `validateRecs(recs, inventory)`

The `--from-recs` apply boundary (`selectOps` → `applyToVault`) currently validates **nothing**: a
model-authored sidecar with `{type:'rename', from:'X', to:'Y'}` applies even when `Y` is invented.
`applyOps` enforces survival, not inventory membership. Slice 2 closes this with a two-tier validator
wired into `cli.js` for both `plan` and `apply`:

1. **Universal (hardens every sidecar, model- or engine-authored):**
   - every `op.type` is in the known set (`rename`, `remove`);
   - every op's `from` resolves to a real logical tag in the live inventory (you cannot operate on a tag that is not there);
   - `isValidTag(to)` for renames (the target is a well-formed tag string).
   This is a strict improvement — it breaks no existing engine rec, because `buildRecommendations`,
   `buildNestRecommendations`, and `buildRemovalRecommendations` are all inventory-derived.

2. **Strict, cross-language only (`source: 'cross-language'`):** the rename `to` (the merge target)
   **must also exist in the live inventory** — the `both-exist` guard. This is what enforces "never
   invent a target" in code, not just instruction, and stops the model from translating the user's
   tag language wholesale.

**Merge-specific by design.** The strict `to`-in-inventory check fires **only** on `source:
'cross-language'` recs. It deliberately does **not** touch:
- **nest recs** — a nest's `to` is a slash path (`Parent/Leaf`) whose parent may legitimately be new (`set-hierarchy` creates it);
- **spelling folds** — a convention rename's `to` is the corrected canonical form, which may not yet exist as its own tag.

On any violation the validator **throws** — `ABORTED`, nothing written — the same fail-closed contract
as the survival and mass-change guards.

### The model pass (SKILL.md, `tag-organize`)

A new "Cross-language merge + cluster" flow, instruction-driven (no LLM in the engine):

1. Run `audit`/`induce` to read the low-frequency list (singletons + doubletons).
2. Identify DE↔EN pairs where **both** halves exist in the inventory; the German half merges into the English half (default direction by language; config-overridable).
3. Split **confident** (clear translation, same scope) from **borderline** (a merge that narrows or shifts meaning) — borderline is flagged, never auto-applied.
4. Write confirmed merges to `.tag-organize-merges.json` as recs with `kind: 'merge', source: 'cross-language'`.
5. Cross-language **clusters** (e.g. `Fördermittel*` + `Funding`) become a nest-under-a-parent proposal via the existing `set-hierarchy` path — **not** a flat merge.
6. Apply via the now-guarded `--from-recs` path. Confirm gate before any write touching >10 notes; content-read gate for borderline disambiguation.

### Explicitly out of v1 (YAGNI)

- The seeded DE↔EN dictionary (decision A).
- `--max-count N` threshold (open-q2 tail).
- A dedicated low-frequency listing sidecar — the audit report already lists singletons.

### Build discipline

- TDD, guard first (RED→GREEN): a cross-language rec with an invented target must abort; every existing engine rec (merge/rename/nest/removal) must still pass unchanged.
- Built and validated on a throwaway/fixture vault. The production Nexus vault is a separate, user-gated run — not part of the build session.

## Provenance

Distilled from the 2026-06-28 Obi session on the Nexus production vault: singletons 824→772,
doubletons 226→208, all pure-numeric tags removed vault-wide (incl. the `_`-folder blindspot). The
manual scripts that produced the singleton/doubleton resolution reports are the prototype this spec
proposes to productize.
