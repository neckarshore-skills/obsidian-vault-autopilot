# tag-organize — AI Tag Restructure + Auto-Tag (Design)

- **Date:** 2026-06-23
- **Author:** Obi (Skill Master)
- **Status:** Design approved (user, 2026-06-23). Build decomposes into Slice 1 (induce-structure) then Slice 2 (auto-tag); writing-plans plans Slice 1 first.
- **Relates to:** `2026-06-22-tag-manage-hierarchy-design.md` (Phase 1 — the deterministic nest mechanics this skill builds on). This document is the "Phase 2" follow-up that the hierarchy spec named and deferred.
- **Open item:** OBI-2026-06-22-4.

## Context

`tag-manage` does tag **hygiene**: it audits, renames, merges, and removes existing tags against a convention, and (Phase 1) nests a flat tag under a declared parent (`#daytrading` -> `#Investing/DayTrading`). What it does **not** do is decide structure or fill gaps — it never proposes how a sprawl of flat tags should be grouped, and it never adds a tag a note is missing.

`tag-organize` is that next skill — the user's "Tag Optimierung". It is the home of the AI-driven work that `tag-manage` deliberately keeps out: reading note content to **propose a hierarchy** over the residual flat tags, and **auto-tagging** under-tagged notes against that hierarchy.

The split was decided in the Phase 1 spec (Decision 2026-06-22): the deterministic nest engine stays in `tag-manage` (shared code, no standalone user step); the AI layer becomes its own skill with its own trigger surface and its own content-read gate. This document designs that skill.

**Data that shaped the design** (from the 2026-06-22 `-c` live audit of a 1,638-note Nexus clone, post-cleanup): ~1,346 residual tags, ~61% singletons, with name-evident families (`Business*`, `Career*`, `AI-*`). Names carry a large, cheap structure signal — this is why the induction engine is name-first rather than pure-content (see Engines).

## Scope decisions (locked with the user, 2026-06-23)

Each was an explicit choice, recorded so the build does not re-litigate them.

1. **What it touches: restructure AND auto-tag.** The skill both reshapes existing tags into a hierarchy and assigns new tags to under-tagged notes. This knowingly overrides the Phase 1 spec line "no content-based auto-tagging — permanently out of scope"; the override is a deliberate user decision, not drift.
2. **Auto-tag vocabulary: closed + gated-new.** Auto-tag assigns primarily from the existing/approved tag set (the post-restructure tree). It may *propose* brand-new tags, but each proposed-new tag lands in a separate block and must be individually approved before it exists and is applied.
3. **Auto-tag read surface: untagged + sparsely-tagged notes only** (threshold configurable). A full re-tag pass over every note is a later opt-in flag, not the default — it keeps the content-read surface and the LLM cost bound to the actual gap, not the vault size.
4. **Induction engine: name-first hybrid, two-pass.** Pass A clusters residual tags by name patterns and reads content only to resolve ambiguous merges; Pass B reads under-tagged note content and classifies against the approved tree. Content cost tracks uncertainty, not vault size.

## Architecture

`tag-organize` is a separate skill that **shares the `tag-manage` engine** (`skills/tag-manage/scripts/`). It adds an agent layer (SKILL.md instructions) and a small amount of new engine code; it does not fork the existing tag machinery.

The cross-skill pipeline is deliberate and ordered:

```
tag-manage (hygiene)            tag-organize (structure + fill)
  audit -> rename/merge/remove     Pass A: induce hierarchy -> set-hierarchy -> nest
  (Phase 1: declared nest)         Pass B: auto-tag under-tagged notes
        |                                |
   clean tag set  ------------------>  residuals + tree
```

Hygiene runs first so structure is induced over a clean tag set, not a messy one. This is a usage convention, not a hard code dependency — `tag-organize` operates on whatever tag set it finds — but the SKILL.md states the recommended order.

The two capabilities inside `tag-organize` are themselves ordered by a **hard dependency**: auto-tag's closed vocabulary *is* the post-restructure tree, so induce-structure must run (and be approved) before auto-tag is meaningful. This is why the build slices in that order (see Build slicing).

## The two engines

### Pass A — induce structure (name-first hybrid)

- **Input:** residual tags (flat / singleton / ungrouped) + their frequencies + the current rules (`references/tag-convention.md` + config), all given explicitly to the model.
- **Stage 1 (cheap, name-based):** cluster residuals by name pattern — shared prefixes/affixes and obvious families (`Business*`, `Career*`, `AI-*`). Propose a candidate parent for each family. No content read.
- **Stage 2 (targeted, content-based):** read content **only** for the residuals whose placement is ambiguous after Stage 1 (homonyms, abbreviations, multi-sense tags — e.g. does `#python` go under `#Programming` or `#Animals`). Sample is bounded (see Content-read gate).
- **Output:** a set of `nest` recommendations (and sibling-merge recommendations where two residuals are the same concept), each annotated with its basis (`[name: family Business*]` vs `[content: 3 notes]`). These flow through the **existing** approval table -> `set-hierarchy` (config writer) -> the Phase 1 nest apply path. **No new write code** for restructure: a nest is a rename onto a slash path and rides `applyOps` (see Write path).

### Pass B — auto-tag (closed + gated-new)

- **Input:** the under-tagged notes (0 or `< threshold` tags) + the approved tree from Pass A + the rules.
- **Processing:** for each note, read a bounded content sample and classify it against the tree. Produce two recommendation classes:
  - `assign-existing` — the note should carry tag T, where T already exists in the tree.
  - `propose-new` — the note's topic has no matching tag; the model proposes a new tag. Proposed-new tags are collected separately and gated individually; only after a proposed-new tag is approved does it become assignable.
- **Output:** assignment recommendations grouped for review at scale (see Approval surface) -> approval -> the **new** `addTagsToNote` write (see Write path).

## Write path (code-grounded)

Verified against `skills/tag-manage/scripts/tags.js` on 2026-06-23 — not assumed.

The existing engine is purely a **transform-existing-tokens** machine:

- `compileOps` builds a map from `rename` / `merge` / `remove` ops only — every entry is keyed on `logicalKey(from)` of an **existing** tag.
- `rewriteBodyTags` / `rewriteFrontmatterTags` walk the note's **existing** tag tokens and rewrite them through that map. A token the map does not mention is left byte-identical.
- `assertSurvival` re-tokenizes before/after and throws if the **tag-token count changes** or any non-tag text segment differs.

Two consequences:

| Capability | Write path | Survival contract |
|---|---|---|
| Restructure / nest | **Existing** `applyOps` (nest = rename onto a slash path; token count unchanged) | Existing `assertSurvival` passes unchanged |
| Auto-tag `assign` | **New** `addTagsToNote` primitive | **New** contract (the existing one would *reject* an add) |

> **Important:** Adding a tag to a note that did not have it cannot reuse `applyOps`. Because `assertSurvival` asserts the tag-token count is unchanged, an add would (correctly) trip it with "tag-token count changed". This is the proof that the boundary is real — auto-tag needs its own write primitive and its own survival contract.

**`addTagsToNote(noteText, tagsToAdd, opts)` contract:**

1. Every existing text segment and every existing tag token is preserved byte-for-byte.
2. Exactly the approved `tagsToAdd` are added — nothing else.
3. **Idempotent:** a tag the note already carries (in any representation) is skipped, not duplicated.
4. **Representation-matching (do-no-harm):** the added tag matches the note's existing tag representation — append to frontmatter `tags:` if the note uses frontmatter tags; append inline if the note is inline-only; for a note with **no** tags at all (the primary target), create a frontmatter `tags:` block as the canonical home. Never silently restyle an inline-only note into frontmatter (the class of real-vault surprise the 2026-06-16 ZWJ bug taught).

## Approval surface at scale (the trust-critical part)

Restructure yields a few dozen cluster proposals — the existing recommendations table + `--ids` ("apply all" / "apply 1, 3" / "skip 2") handles it.

Auto-tag does not. ~300 under-tagged notes x 2-3 tags is ~700-900 assignments. A 900-row table is reviewed by hitting "apply all" — at which point the human gate **is** trust-the-model, and "AI recommends, human decides" is violated in practice while passing on paper. The discriminating requirement is therefore explicit: **the auto-tag approval surface must stay reviewable at ~900 assignments, not ~30.** Three mechanisms, built in from the start (not bolted on later):

1. **Group by proposed tag, not by note.** Present `#Investing -> these 41 notes`; one decision (approve / trim the set / skip) covers many assignments. This collapses ~900 rows into ~(number of distinct tags) decisions.
2. **Evidence + confidence-sort.** Each group shows the model's basis snippet and a confidence signal; uncertain assignments sort to the top, where review actually matters. High-confidence, name-obvious assignments sink.
3. **Per-run ceiling (default on).** Cap assignments per run (`maxAssignmentsPerRun`, configurable) so the first runs are humanly auditable end-to-end. The existing >10-note confirm and >50-note mass-change guards still fire, but they bound note-count, not table readability — the ceiling is what keeps the *review* tractable.

## Content-read gate

Reading note **bodies** is a new, larger production-vault data surface (the existing skill reads only tags + frontmatter). It is gated as its own capability:

- Read content only for the bounded set: Pass A's ambiguous residuals, Pass B's under-tagged notes. Never the whole vault by default.
- Default sample: top-N notes per residual tag (Pass A) and the under-tagged note itself (Pass B), with a global cap.
- An explicit user gate states the scope before any read: "read N notes to propose structure/tags — proceed?".
- Honors the Production Vault Safety Rules: production read is user-gated even though it is read-only; test vault first; no filesystem discovery outside the configured vault.

## Build slicing (hard dependency)

One spec, two build slices. The order is a dependency, not a preference: auto-tag's closed vocabulary is the post-restructure tree, so Slice 1 must exist and be validated before Slice 2 is meaningful.

| Slice | Scope | Write path | Risk | Gate before next |
|---|---|---|---|---|
| 1 — induce-structure | Pass A; nest/merge recommendations + approval | Reuses existing `applyOps` (no new write code) | Low | UAT-validated on a test vault before Slice 2 |
| 2 — auto-tag | Pass B; `addTagsToNote`; closed + gated-new; content-read of under-tagged notes; approval-at-scale | New `addTagsToNote` primitive | Higher | — |

`writing-plans` plans **Slice 1 first**. Slice 2 is a separate plan written after Slice 1 ships and is validated on real residual data.

## Testing strategy

TDD throughout (RED -> GREEN), consistent with the rest of the engine.

- **`addTagsToNote` survival suite:** add-exact (existing segments + tags byte-identical, only the approved tags added), idempotency (re-run adds nothing), representation-matching across the six tag representations (frontmatter block / array / scalar / inline / mixed / no-tags), and an anti-vacuous assertion that the note actually gained the tag.
- **Convergence:** a second run over an already-organized vault proposes nothing (no re-nest, no re-assign of an existing tag).
- **Approval-at-scale:** group-by-tag collapses N assignments into per-tag decisions; the per-run ceiling caps applied assignments; confidence-sort orders uncertain-first.
- **Induction (Pass A):** name-clustering proposes the evident families; ambiguous residuals are the only ones that trigger a content read.
- **Gated-new:** a proposed-new tag is not applied until individually approved; an unapproved proposed-new tag never reaches the write path.

## Rollout / downstream (ship-time, not part of the code build)

These travel with the feature and are part of "done" for the user, even though they are not code:

1. **Repository docs (Obi, in-lane):** update `README.md` and the user-facing docs (the tag-section and `docs/tag-hierarchy.md`) to describe what `tag-organize` adds — induced hierarchy + auto-tag. This is a build task in the implementation plan ("user-facing docs updated if behavior changed").
2. **Website (Linus, via MASCHIN — not Obi's lane):** the neckarshore-website skill description for Obsidian Vault Autopilot needs a note that the suite now does AI-driven tag structure + auto-tagging. Flag in the session report's FOR MASCHIN section.
3. **Marketing (Gary, via MASCHIN/Jack — not Obi's lane):** the skills are not yet promoted (promotion still gated on the marketing pipeline). When promotion happens, `tag-organize` is a strong story — candidate for a split into two LinkedIn posts (post 1: tag hygiene/cleanup that already shipped; post 2: the new AI structure + auto-tag). Flag in FOR MASCHIN.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Approval gate degrades to a rubber-stamp at ~900 assignments | Group-by-tag + confidence-sort + per-run ceiling; the gate must stay reviewable, not just exist |
| Model output reaching the write path unapproved | Write path consumes only user-approved recommendations; `set-hierarchy` is deterministic; proposed-new tags are gated individually |
| Auto-tag silently restyles a note (inline -> frontmatter) | `addTagsToNote` matches the note's existing representation; frontmatter only when the note has no tags |
| Invalid tag from a suggestion (spaces, etc.) | Config + op validation rejects non-tags before they are applicable (existing `isValidTag`) |
| New-tag proposals regrow the sprawl tag-organize is meant to fix | Closed vocabulary is the default; new tags are gated individually and rare by design |
| Bulk add changing hundreds of notes | Per-run ceiling + the existing >10 confirm and >50 mass-change guards |
| Content-read cost / privacy | Bounded sample (under-tagged + ambiguous only), global cap, explicit scope gate, production-read user-gated |
| Re-running re-proposes applied structure/tags | Convergence tests; induce proposes nest only for still-flat tags; auto-tag skips tags a note already carries |

## Deferred to implementation (measure on real data, do not guess now)

- One-pass vs explicit two-LLM-pass within Pass A (rule-application then residual-induction) — measure on the real residual set.
- Pass A ambiguity sample selection (most-recent? longest? highest-linked?) — start simple (most-recent N), revisit with data.
- The "sparse" threshold for Pass B (what tag-count counts as under-tagged) — start at a small default, expose as config.
- How an induced `nest` interacts with a sibling-merge proposed in the same round (ordering / conflict resolution).
- Naming: `tag-organize` vs `tag-structure` — `tag-organize` is the working name; confirm at Slice 1 ship.
