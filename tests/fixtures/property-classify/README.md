# Fixture: property-classify

Behavioral truth matrix for the deterministic classification rules in
`skills/property-classify/SKILL.md`. Phase 2 of
`docs/plans/2026-06-11-skill-hardening-fable-pilot.md` — before this fixture
existed, property-classify (the only skill that writes frontmatter with no
defenses) had zero executable coverage.

## Layout

| Path | Purpose |
|------|---------|
| `_truth.json` | Cell → expected `{status, type, action}` (canonical matrix) |
| `vault/` | Mini vault tree — folder placement IS part of the test input |

The harness `scripts/test-property-classify.sh` carries a reference
implementation of the rules (status hierarchy, two-layer type, conflict
handling, casing Nahbereich, sanity skip-routing) and asserts every cell.

## Coverage

1. Status hierarchy precedence: protected (s01, s02), archived-by-path
   (s03), archived-over-reviewed priority (s09), reviewed (s04), reviewed
   blocked by open checkbox (s05), polished (s06), polished blocked by a
   placeholder field (s07), default draft (s08).
2. Type two-layer: content signals override path (t01 ISBN in a resource
   folder, t02 Agenda), path fallback per keyword table (t03-t05, t10),
   no-match TBD (t06).
3. Conflict handling: existing divergent type stays (t07); TBD (t08) and
   inbox (t09) are always settable.
4. Nahbereich: `Status:` key casing (s10).
5. yaml-sanity routing: shape-beta (x01) and divergent-duplicate (x02)
   files are skip-sanity — classify is additive-only and never repairs.
   The full verdict classifier is covered by
   `tests/fixtures/yaml-sanity-verdicts/`; these two cells only pin the
   per-skill SKIP policy.

## Authoring rules

Cell bodies must stay signal-clean: no `ISBN`, `Author:`, `Agenda:`,
checkbox syntax, or path-keyword words in cells that do not test them —
explanations live here and in `_truth.json` notes, never in fixture bodies.
Filenames also avoid path keywords; Layer-2 matching is folder-path-only
(excluding the filename), which cell t09 (`...-inbox-type.md` in
`projects/`) pins explicitly.
