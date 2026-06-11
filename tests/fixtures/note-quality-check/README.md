# Fixture: note-quality-check

Behavioral truth matrix for the deterministic core of
`skills/note-quality-check/SKILL.md`. Phase 3 of
`docs/plans/2026-06-11-skill-hardening-fable-pilot.md` — this skill owns
destructive paths (permanent delete, soft-delete to `_trash/`, archive
moves) and its only guard between a note and `_trash/` — the five
intentional-content signals — had zero executable coverage.

## Layout

| Path | Purpose |
|------|---------|
| `_truth.json` | Cell → expected `{disposition, signal}` (canonical matrix) |
| `vault/` | Mini vault — filenames ARE test input (generic vs descriptive) |

The harness `scripts/test-note-quality-check.sh` carries a reference
implementation of the candidacy rules and asserts every cell.

## Coverage

1. **Survival cells (the eval must bite):** five notes that look trashy to
   a naive substance heuristic but each carry exactly one intentional
   signal — single wikilink (`Untitled.md`), single embed (`New Note.md`),
   meaningful frontmatter only (`Quick Note.md`), 3+ plain lines
   (`Draft.md`), descriptive filename (`2024 Tax Strategy Notes.md`).
   All MUST classify `review`, never a Nahbereich candidate.
2. **Fail-safe default:** `Untitled 5.md` has content but NO signal —
   still `review` (golden rule: only the user can say Trash).
3. **Nahbereich candidates:** pure whitespace (`Untitled 2.md`) and
   0 bytes (`Untitled 3.md`) — candidates only; execution is gated behind
   the preview (the Phase-3 flagged behavior change).
4. **Sanity routing:** shape-beta (`Unbenannt.md`) and divergent-duplicate
   (`Untitled 4.md`) files are excluded from scoring — a corrupted file is
   a repair case, not a low-quality note.
5. **Protected:** `_vault-autopilot.md` and `_trash/` contents are never
   processed.

## Authoring rules

Fixture bodies stay signal-clean: a cell carries exactly the signal it
tests and nothing else. `Untitled 3.md` must remain 0 bytes and
`Untitled 2.md` whitespace-only — verify with `wc -c` after any edit.
Generic filenames (Untitled/Unbenannt/New Note/Draft/Quick Note, optional
trailing number) are part of the matrix; do not rename cells.
