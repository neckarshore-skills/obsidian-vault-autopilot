# tag-organize Confidence Triage — scored Implement / Decide / Ignore proposal

Date: 2026-06-25
Status: design (approved for plan)
Skill: tag-organize / tag-manage (shared engine)
Predecessor: `2026-06-24-tag-organize-slice-1.5-design.md` (the human-readable proposal note)

## Context & Motivation

The 2026-06-25 live UAT (1,772-note vault copy `20260624 UTA nexus v1`, user-directed)
ran `induce` and produced a single flat 54-family proposal note. Two user-visible gaps:

1. **The flat table is not triage-able by impact.** A high-value family
   (`Baden ← Baden-Württemberg` (67 notes) + `BadenWürttemberg` (10)) looks identical
   in the table to a trivial coincidence (`Mc ← McFit, McKinsey` or `Front ← Front7, Front8`).
   The proposal note carries **no frequency and no recommendation**, so the human prunes
   54 rows blind. (This is the Finding D the 1.5 spec named and deferred:
   "No confidence/quality heuristic on families … a heuristic is Slice-2 territory.")
2. **Name-only clustering produces a large coincidence tail.** ~15-20 of the 54 families
   are name-coincidences (`Open ← OpenAI, OpenSource`; `Self ← SelfHosted, SelfImprovement`;
   `Low ← LowCode, LowLatency`). The note's prose warns about this generically, but the
   human still has to spot each one by eye.

This spec adds a **deterministic structural confidence score** and a three-way
**Implement / Decide / Ignore** triage so the proposal note ranks what should actually
be touched, and the flow can stage the clear wins as a batch.

## Guiding principles

1. **Honest about the limits of name-only signal.** Name structure cannot reliably tell
   `Open` (coincidence) from `Phase` (real enumerated family). The score is therefore
   labelled a **structural signal strength, not a probability**, and the threshold model
   is **conservative**: only strong structural signals reach `Implement`; the uncertain
   bulk lands in `Decide`, where the human decides. This is "AI empfiehlt, Mensch entscheidet"
   expressed as a default.
2. **`Implement` is never auto-apply.** Every nest still rides the existing
   `set-hierarchy → audit → plan → apply --write` path behind the confirm gate
   ("I will nest tags in N notes in `<vault>`. Confirm?"). `Implement` only means
   "recommended batch — review, then apply", it does not change the write surface.
3. **Engine stays pure.** The scorer is a total, deterministic, throw-free function over
   structural inputs (cluster shape + tag counts + the configured declared parents). No
   LLM, no content read, no clock. The agent layer (SKILL.md) reviews the `Decide` middle
   and may content-sample via the **already-existing** content-read gate.

## The scoring model (deterministic, pure)

`scoreCluster(cluster, { declaredParents })` returns `{ score, category, basis }`.
The score is an additive sum of structural signals, clamped to `0..100`. Every
contribution is traceable and surfaced in the `basis` string.

| Signal | Effect | Rationale |
|--------|--------|-----------|
| Base | `40` | Neutral starting point. |
| Family size | `+10` per child over 2, capped `+30` | More tags on one token = more evidence; capped so coincidence-size (`Open`, 6 children) cannot dominate. |
| Family note frequency (total) | `+0` (<5) / `+10` (5–60) / `+20` (>60) | Families actually used in the vault matter more. |
| Enumeration suffix (majority of children carry a numeric or version-like suffix, e.g. `Phase0-4`, `ISO27001`) | `+15` | Strong "real enumerated family" signal. |
| Declared-parent match (leading token equals an existing config-`hierarchy` parent, case-insensitive) | `+25` | The human already curated that parent; a new flat child plausibly belongs there. |
| Coincidence-prefix (leading token in the stoplist) | `−35` | Common words that unrelated tags share by accident. |

**Coincidence-prefix stoplist (`COINCIDENCE_PREFIXES`, frozen constant, A→Z):**
`auto, big, deep, early, free, front, full, go, high, large, local, long, low, make,
multi, new, online, open, power, real, self, share, smart, static, work`.
Curated from the live 54-family run; case-insensitive match on the leading token. The
list is a named constant so it is reviewable and extendable in one place.

**Thresholds:** `Implement ≥ 70` · `Decide 40–69` · `Ignore < 40`.

**`basis` string** lists the signals that fired, e.g. `size+enum`, `freq+declared`,
`coincidence-prefix`. It replaces the Slice-1 `"name: N tags share leading token …"`
basis (that fact is now implicit in the table's Children column).

**Worked examples against the live 54 (estimated; exact values calibrated post-build):**

| Family | Computation | Score | Category |
|--------|-------------|-------|----------|
| `Phase ← Phase0..4` | 40 +30(size) +15(enum) | ~85 | Implement |
| `Open ← OpenAI, OpenSource, …` | 40 +30(size) −35(coincidence) +~10(freq) | ~45 | Decide |
| `Mc ← McFit, McKinsey` | 40 +0(size) +20(freq) | ~60 | Decide |
| `Baden ← Baden-Württemberg, BadenWürttemberg` | 40 +0(size) +20(freq) | ~60 | Decide (a hygiene dup, not auto-nested — correct) |

The model is deliberately conservative: `Implement` is small and high-precision
(enumeration + declared-parent matches); most two/three-member name groups land in
`Decide`; coincidence-prefixes are pushed down toward `Ignore`.

**Calibration step (part of the build, not deferred):** after the engine is built and
green, run `induce` on the live `20260624 UTA nexus v1` copy, show the real
Implement/Decide/Ignore distribution over the 54 families, and tune the weights /
thresholds / stoplist against that real distribution before the spec is called done.

## Proposal note shape (`renderProposal`)

Three sections, one table each, every table sorted by `score` descending. Two new
columns — `Notes` (family total) and `Score`; per-child counts inline in `Children`.

```
> [!summary]
> Scope: Vault-wide · 54 families → Implement N · Decide M · Ignore K
> Score = structural signal strength (not a probability) — see Basis. Implement = a
> recommended batch, still applied behind the confirm gate; nothing is auto-applied.

## Implement (recommended — review, then apply as a batch)
| # | Parent | Children | Notes | Score | Basis |
| 1 | `Phase` | `Phase0` (12), `Phase1` (9), … | 41 | 85 | size+enum |

## Decide (your call — content-sample the unclear ones)
| # | Parent | Children | Notes | Score | Basis |

## Ignore (likely name-coincidence — skip)
| # | Parent | Children | Notes | Score | Basis |
```

Invariants preserved from Slice 1.5: `Meta/TagManagement` frontmatter marker (so future
scans exclude the note), every tag name backtick-wrapped, no bare `#token` in prose
(linter-promotion safe). An empty category still renders its heading with an
"(none)" line so the three-way structure is always visible.

## JSON shape (`.tag-organize-clusters.json`)

Enriched, still a flat array, downward-readable:

```json
{
  "parent": "Phase",
  "children": [{ "name": "Phase0", "count": 12 }, { "name": "Phase1", "count": 9 }],
  "notesTotal": 41,
  "score": 85,
  "category": "implement",
  "basis": "size+enum"
}
```

`category` is one of `implement | decide | ignore`. The agent reads this file to stage
the `Implement` batch.

## Flow change (`tag-organize/SKILL.md`)

The induce step is unchanged (read-only over notes). The presentation + apply steps change:

1. Present the three tables to the user (the proposal note IS the presentation).
2. **Implement** — propose the whole bucket as a default batch. The user skims the one
   table and deselects any they reject; the rest are persisted via `set-hierarchy`
   (one call per cluster) and applied via the existing `audit → plan --ids → apply --write`
   path **behind the confirm gate** (which states the note count). No auto-apply.
3. **Decide** — work through individually; for families whose names don't settle the call,
   use the existing content-read gate (state scope, sample bounded note bodies).
4. **Ignore** — skipped by default; the user may still promote one.

All Production Vault Safety Rules and the >10-note confirm gate are unchanged.

## Components touched

| File | Change |
|------|--------|
| `scripts/induce.js` | `clusterByName` enriches each child with its `count` (from the inventory) + sets `notesTotal`. NEW pure `scoreCluster(cluster, { declaredParents })` → `{ score, category, basis }`. NEW frozen `COINCIDENCE_PREFIXES` + pure helper `isEnumerationSuffix(suffix)`. Export the new symbols. |
| `scripts/report.js` | `renderProposal` splits into three score-sorted tables; new `Notes` + `Score` columns; inline per-child counts; three-way summary; honest score label; "(none)" for empty categories. |
| `scripts/cli.js` | `runInduce` passes `declaredParents` (parsed from the config `hierarchy` keys via the already-resolved config) into the scorer, and writes the enriched clusters + the categorized note. |
| `skills/tag-organize/SKILL.md` | Flow update — three-table triage, `Implement` as default batch behind the gate, `Decide` individually (content gate), `Ignore` skipped; score is a structural heuristic, not auto-apply. |
| `README.md`, `logs/changelog.md` | one row each. |

## Data flow

`readNotes → buildInventory (tag→count)` → `clusterByName (+ per-child counts, notesTotal)`
→ `scoreCluster (declaredParents from config)` → categorized + scored clusters →
`.tag-organize-clusters.json` + `renderProposal` (3 tables) → agent reads → `Implement`
batch staged → `set-hierarchy → audit → plan → apply --write` (confirm gate).

## Error handling

- `scoreCluster` is total and throw-free: a malformed/sparse family simply scores low.
- Config missing or no `hierarchy` block → `declaredParents = []` (no declared-match
  bonus; the stoplist and every other signal still apply).
- Empty vault → 0 families (unchanged Slice-1 behavior); `renderProposal` renders three
  empty "(none)" sections.
- Counts: a tag present in the inventory always has a count ≥ 1; a child missing from the
  inventory (should not happen — clusters are built from it) defaults to count 0 and is
  reported, not dropped.

## Testing (TDD, node:test, the Slice-1 rail)

1. **`scoreCluster` per-signal** — a fixture cluster gains exactly the expected delta when
   each signal is toggled: size step + cap, frequency tiers, enumeration suffix,
   declared-parent match, coincidence-prefix penalty. Non-vacuous: each asserts the
   numeric contribution, not just "score changed".
2. **`scoreCluster` thresholds + clamp** — boundary families land in the right category at
   69/70 and 39/40; a maximally-stacked family clamps at 100; a maximally-penalized one
   clamps at 0.
3. **`clusterByName` count enrichment** — children carry their inventory counts and
   `notesTotal` is the **sum of the per-child counts** (chosen for simplicity; a note
   tagged with two children of the same family is counted twice — acceptable for an
   ordinal triage signal. The de-duplicated note union is a possible refinement, deferred,
   only if the inventory cheaply exposes per-tag note sets). The test pins the sum.
4. **`isEnumerationSuffix`** — `0`, `1`, `27001`, `v2` → true; `AI`, `Source`, `Hosting`
   → false.
5. **`renderProposal` three-table split** — a mixed cluster set renders three sections, each
   sorted by score desc, with the `Notes`/`Score` columns; an absent category renders
   "(none)"; the load-bearing Slice-1.5 invariants still hold (only the marker in
   frontmatter, no bare `#token` in body, every tag backticked).
6. **`cli runInduce` integration** — given a config with a `hierarchy`, a family whose
   parent matches a declared parent gets the `+25` and lands in `Implement`; the written
   JSON carries `score`/`category`/`notesTotal`/per-child counts.

Then the **calibration run** on the live vault (see above) confirms the real distribution
is sensible before sign-off.

## Out of scope (YAGNI)

- **No duplicate-variant detector.** `Baden-Württemberg` vs `BadenWürttemberg` (Finding C)
  is a tag-manage hygiene concern; such families land in `Decide` (never auto-nested) and
  stay a tag-manage backlog item. The config `compounds`/`brands` matching should become
  separator-insensitive — separate work.
- **No content-based scoring.** The score is structural only; content reading stays a
  per-family agent decision behind the existing gate.
- **No new write surface.** Nesting still rides the Phase-1 `applyOps` rail.
- **No calibrated probability.** The 0–100 score is an ordinal triage aid, labelled as
  such; it is not a statistical confidence.

## Captured findings (for the report)

- **Finding C (cross-skill, tag-manage):** separator/camelCase variants of a hyphenated
  compound survive hygiene — `Baden-Württemberg`(67) + `BadenWürttemberg`(10),
  `Mercedes-Benz`(60) + `MercedesBenz`(6) — because `compounds` matching keys on the exact
  hyphenated lowercase form and misses the no-separator variant. tag-manage backlog: make
  compound/brand matching separator-insensitive. Confirmed live (broad grep, this session).
- **Finding D (resolved here):** the proposal note's missing frequency + recommendation is
  what this spec fixes.
