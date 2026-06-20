# Obsidian Tag Semantics — Step 0 Finding (drives the merge/fix-case design)

> **Authority for tag-manage's merge / fix-case / normalize logic.** This file is the
> documented outcome of the mandatory Step 0 from the tag-manage v1 dispatch brief:
> *empirically determine how Obsidian matches tag case before defining "merge" / "fix-case."*
> Do not design a tag operation that contradicts this file.

## The finding: Obsidian matches tags case-insensitively

Primary source — official Obsidian Help (`help.obsidian.md/tags`), verbatim:

> "Tags are case-insensitive. For example, #tag and #TAG will be treated as identical."

Corroboration:

1. **Tag Wrangler** (the de-facto standard tag-rename plugin) "uses the same case-insensitive
   comparison as Obsidian when matching tags to change, and checking for clashes."
2. **Tag pane display** uses the **first-occurrence** casing: if `#Meeting` was written before
   `#meeting`, both render as `#Meeting` in the Tags view. Renaming one case variant can therefore
   change the *displayed* name of the "other" tag, even though no file changed.

**Confidence: HIGH** (primary source + 2 corroborations). The only gap to live empiricism is a
60-second test in a real Obsidian instance (`#AI` + `#ai` → one entry in the Tag pane) — slotted
into UAT, not a blocker for the design.

## Why this splits the flagship example into two operation classes

The brief's flagship `#AI` / `#ai` / `#a-i` → `#ai` is **not one operation**. It is two:

| Difference | Obsidian's view | What a "fix" actually does | Class |
|---|---|---|---|
| `#AI` vs `#ai` (case only) | **Already the same tag** — same search, graph, Tag-pane group | **Functional no-op.** Rewrites N files for zero navigational gain. Only the on-disk bytes and the Tag-pane *display* casing change. | **cosmetic** |
| `#ai` vs `#a-i` vs `#ML` (distinct spelling) | **Different tags** | **True merge.** Combines functionally separate tags. **Irreversible** — afterwards you cannot tell which note had which source tag. | **functional, destructive** |

Two consequences that drive the whole design:

1. **"Case-merge = harmless" is a trap.** It is a real multi-file write. It runs through the
   *same* `preview → confirm → mass-change-throw` gate as a true merge — never as an auto/silent fix.
2. **The audit reports case variants separately from functional duplicates.** Lumping `#AI`/`#ai`
   into the "duplicates" bucket implies a fix that does nothing functionally. Two report categories:
   *cosmetic case-inconsistency* vs *functional duplicates* (distinct spelling, singular/plural, abbreviation).

## Logical tag (operate across all six representations)

A tag is a **logical** entity. Its identity = case-folded full string (with `/` preserved).
A logical operation (rename `ai → ml`) must hit every on-disk representation consistently:

| # | Representation | Form | `#` prefix? |
|---|---|---|---|
| 1 | Frontmatter block-list | `tags:\n  - ai` | no |
| 2 | Frontmatter inline-array | `tags: [ai, ml]` | no |
| 3 | Frontmatter single-scalar | `tags: ai` | no |
| 4 | Frontmatter legacy singular key | `tag: ai` | no |
| 5 | Inline body | `#ai` | yes |
| 6 | Nested inline | `#parent/child` | yes (whole path is one unit) |

## Validity rules (from the same primary source — do not propose an invalid tag)

- Allowed characters: letters, numbers, `_`, `-`, `/` (nested), commonly-accepted Unicode.
- A tag must contain **at least one non-numerical character**: `#1984` is invalid, `#y1984` is valid.
- A bare number in a `tags:` list (often a Markdown-table artifact) is **not a valid tag** → audit
  flags it as a numeric artifact, never proposes it as a merge target.

## Case-folding rule (German vault — pin it, do not use naive ASCII tolower)

- Logical identity uses Unicode-aware case folding (`String.prototype.toLowerCase()` on the full
  tag string), applied **only for comparison/grouping** — never to mutate on-disk casing implicitly.
- `ß` has no 1:1 uppercase and `#Künstliche-Intelligenz` must fold correctly; ASCII `tolower`
  would mis-group. A Unicode fixture pins this.

## Locked design decisions (advisor-reviewed, 2026-06-20)

1. **Case-normalize is opt-in, default OFF.** Audit surfaces case inconsistency as a *cosmetic*
   finding category. Normalizing is an explicit opt-in op behind the gate; the default cleanup pass
   touches only functional tags. Rationale: "do no harm" — no multi-file write for zero functional
   gain without an explicit yes.
2. **When case-normalize IS chosen, target casing comes from `tag-convention.md` (PascalCase),** not
   a hardcoded lowercase. Brand/abbreviation exceptions in that file still win.
3. **Removal is frontmatter-only.** Removing an inline body `#tag` from prose mutates the sentence
   (content change, against do-no-harm) — the audit *reports* inline orphans, never auto-strips them.
4. **Deterministic near-duplicate detection = case + separator only.** Separator grouping is
   `-` ↔ `_` ONLY; `/` is **excluded** (a nested tag `ai/ml` is semantically distinct from `ai-ml`).
   Plural/singular, abbreviation, and synonym consolidation are **AI-proposed** in the preview, never
   auto-detected (a deutscher Vault breaks naive trailing-`s` stripping: `Haus` → `Häuser`).
5. **Nested tags rename as a whole-path unit — no cascade.** Renaming `ai → ml` does NOT touch
   `ai/coding`; each full path is its own logical tag. The audit *reports* related nested tags so the
   user can choose a subtree rename explicitly. (Mirrors the brief's "handled as a unit.")
6. **Reserved tags are excluded from all suggestions.** `VaultAutopilot` (the skill-log automation
   marker) and any future plugin-reserved tag are never proposed for merge/rename/remove — they are
   plumbing, not content.
7. **merge is irreversible → it always counts toward the mass-change threshold and requires the
   confirm gate.** Tag Wrangler's "no undo" warning is the precedent.
