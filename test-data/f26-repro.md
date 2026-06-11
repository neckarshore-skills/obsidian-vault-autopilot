---
"created:": 2024-03-14
created: 2025-01-01
"modified:": 2024-06-15
"description:": Apple Notes export
"tags:": []
---

# F26 Cross-Skill Cluster Repro (shape β only)

This file reproduces F26 (LIVE-REPRODUCED in GR-2 Cell 4, 60 of 1016 inbox-tree
files = 5.9% blast-radius cross-skill).

**Shape β — inside-colon quoted-keys** (Apple-Notes-Vintage import artifact).
Invalid-as-author-intended. Recipe (f) normalize would be required — but see
below: the divergent duplicate-collision dominates (W4) and ABORTs the repair.

This file has multiple inside-colon quoted-keys AND a duplicate-collision (both
`"created:"` and `created` exist).

All four quoted lines have inside-colon shape (`":` before closing quote AND `:`
after). Recipe (f) `F26_INSIDE_COLON_PATTERN` matches all four.

Expected behavior on property-enrich Step 2a (v0.1.4 W4 semantics):

1. Sanity-check verdict: `DUPLICATE_KEYS_DIVERGENT_VALUES` — the
   post-normalize view holds TWO `created` lines with divergent values
   (`2024-03-14` from the quoted form vs `2025-01-01` plain). Per the
   verdict-priority ladder in `references/yaml-sanity.md`, the divergent
   ambiguity dominates the (also present) `BROKEN_KEYS_INSIDE_COLON` shape.
2. Recipe (f) Step 3 sub-case (d): divergent collision → ABORT recipe (f)
   for this file. The file is left unchanged on disk — recipe (f) refuses
   to silently pick a winner between `2024-03-14` and `2025-01-01`.
3. Skill SKIPs the file + logs Class-A finding "duplicate-key-divergent-values"
   (route to user / note-rename for manual resolution).

Expected post-enrich state: BYTE-IDENTICAL to input (skip, no write). The
user must merge the divergent `created` values manually; only then does a
re-run normalize the remaining inside-colon keys and proceed.

History note: pre-W4 (v0.1.3), recipe (f) resolved this collision
first-wins-silent — exactly the value-loss class that F7 (GR-3 Cell 1,
2026-05-01) exposed and v0.1.4 W4 retracted.
