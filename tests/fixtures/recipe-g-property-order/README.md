# Fixtures — recipe (g) canonical property order

Golden input/output pairs for the block-aware frontmatter reorder (recipe-g).
Each `cases/<name>/` holds `in.md` (input) and `expected.md` (canonical-ordered
output). `scripts/validate-recipe-g.py` asserts `reorder(in.md) == expected.md`
AND `reorder(expected.md) == expected.md` (idempotency).

Block reorder is the F8/F15/F26 data-loss class. These goldens — not the spec's
prose — are the proof that the algorithm moves each property as an atomic unit.

| # | Case | Pins |
|---|------|------|
| 01 | title-last-goes-first | an appended `title` ends up FIRST; `tags` block last, intact |
| 02 | description-second | `description` -> position 2; inline `tags: [..]` -> last |
| 03 | custom-preserved-order | custom keys (`version`, `related`, `up`) keep relative order, between lead block and `tags` |
| 04 | aliases-block-no-orphan | list items stay under their key (the orphan-bug regression lock) |
| 05 | already-canonical-idempotent | already-ordered input is a zero-diff no-op |
| 06 | blank-lines-removed | blank lines between top-level keys are non-semantic -> dropped |
| 07 | comment-preserved | a `#` comment is preserved and moves WITH its following block |
| 08 | folded-scalar-intact | a `|` literal scalar body (incl. an internal blank line) stays intact under its key |

CRLF, BOM, no-frontmatter, unclosed-frontmatter, and trailing-newline invariants
are covered by the validator's in-memory `--selftest` (not fixture files).
