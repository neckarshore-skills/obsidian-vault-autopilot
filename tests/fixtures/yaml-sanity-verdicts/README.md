# Fixture: yaml-sanity-verdicts

Behavioral truth matrix for the verdict classifier defined in
`references/yaml-sanity.md`. Before this fixture existed, the classifier —
the most load-bearing shared logic in the plugin, called by all four
launch-scope skills — had no executable coverage (Phase-0 finding of
`docs/plans/2026-06-11-skill-hardening-fable-pilot.md`).

## Layout

| Path | Purpose |
|------|---------|
| `_truth.json` | Cell name → expected verdict (canonical matrix) |
| `notes/cell-*.md` | One file shape per cell, 18 cells |

The harness `scripts/test-yaml-sanity-verdicts.sh` carries a faithful
reference implementation of the spec's detection patterns (Patterns 1, 1b,
2, 3, 5 + verdict-priority ladder) and asserts every cell — plus the five
historical repro files in `test-data/` — classifies to its truth verdict.

## Coverage

1. All verdicts except `INVALID_YAML` (residual parser-fail class, no
   canonical byte-shape — documented limitation in `_truth.json`).
2. Priority-ladder interactions: beta+divergent (cell-14), beta+identical
   (cell-15), mixed alpha+beta (cell-05).
3. False-positive guards: body horizontal rules (cell-11, the empirical
   72-FP class), fenced YAML (cell-12).
4. Encoding edges: UTF-8 BOM (cell-17), CRLF (cell-18).
5. Conservative-by-design pin: prose colon lines between body rules
   (cell-16) — see `_truth.json` notes.

## Regenerating

Cells are static — no generator. `cell-17` must keep its UTF-8 BOM and
`cell-18` its CRLF endings; verify with `file notes/cell-1[78]*` after any
edit (expect "with BOM" / "with CRLF line terminators").
