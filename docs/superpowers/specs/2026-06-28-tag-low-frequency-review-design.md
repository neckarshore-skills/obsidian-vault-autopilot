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

## Provenance

Distilled from the 2026-06-28 Obi session on the Nexus production vault: singletons 824→772,
doubletons 226→208, all pure-numeric tags removed vault-wide (incl. the `_`-folder blindspot). The
manual scripts that produced the singleton/doubleton resolution reports are the prototype this spec
proposes to productize.
