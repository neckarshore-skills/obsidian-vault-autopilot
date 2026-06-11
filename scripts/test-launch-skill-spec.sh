#!/usr/bin/env bash
# Spec-contradiction assertion harness for the launch-scope skills. Phase 4 of
# the 2026-06-11 skill-hardening plan
# (docs/plans/2026-06-11-skill-hardening-fable-pilot.md § 4).
#
# Unlike Phases 2/3 these are SMALL, ADDITIVE wording fixes — no new behavior.
# The three targets are stale/contradictory spec text that lets a model pick a
# repair path the canonical references already supersede:
#
#   G7  property-enrich + property-describe cooldown param row still says
#       "Use file creation date (birthtime)" while the step body already routes
#       cooldown through the Source Hierarchy + clone-cluster gate. Same
#       clone-poisoning bypass class the Phase-2 property-classify fix closed.
#       Regression pin mirrors scripts/test-property-classify.sh (c).
#
#   inbox-sort Quality Check claims "No files were renamed or modified" (the
#       skill DOES modify frontmatter: Step 5a recipe b+f, Step 12 skill-log)
#       and gates cooldown on "recently modified" (Step 5 reads YAML `created`,
#       never modification date).
#
#   note-rename legacy Nahbereich quick-fix list ("type:" -> type, remove
#       duplicate ---) predates and overlaps Step 4a's recipe (f) routing but
#       carries no precedence pointer, so the legacy bullet can bypass the
#       duplicate-key collision ABORT (divergent -> skip + Class-A).
#
# Doc-shape test (greps SKILL.md spec text), same family as the other
# scripts/test-*.sh drift-guards. Bash 3.2 + BSD grep/awk.

set -u
set -o pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENRICH="${REPO_ROOT}/skills/property-enrich/SKILL.md"
DESCRIBE="${REPO_ROOT}/skills/property-describe/SKILL.md"
INBOX="${REPO_ROOT}/skills/inbox-sort/SKILL.md"
RENAME="${REPO_ROOT}/skills/note-rename/SKILL.md"

PASS=0
FAIL=0

ok()   { echo "  PASS: $*"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL+1)); }

# Extract the single `cooldown_days` parameter-table row from a SKILL.md.
cooldown_row() { grep -F '| `cooldown_days` |' "$1"; }

# ─── Target 1 (G7): cooldown param vs Source-Hierarchy + clone gate ──────────
# Mirrors scripts/test-property-classify.sh block (c): the exact stale string is
# the regression pin — if it returns, the clone-poisoning bypass is back.
for skill in "$ENRICH" "$DESCRIBE"; do
  name="$(basename "$(dirname "$skill")")"
  row="$(cooldown_row "$skill")"

  echo "[$name] cooldown param row"
  printf '%s' "$row" | grep -qF "Use file creation date (birthtime)" \
    && fail "$name cooldown: stale raw-birthtime date source still present (clone-poisoning bypass)" \
    || ok "$name cooldown: stale raw-birthtime date source removed"
  printf '%s' "$row" | grep -q "Source Hierarchy" \
    && ok "$name cooldown: row references the Source Hierarchy" \
    || fail "$name cooldown: row does not reference the Source Hierarchy (param table contradicts the step)"
  printf '%s' "$row" | grep -qi "clone-cluster" \
    && ok "$name cooldown: row references the clone-cluster gate" \
    || fail "$name cooldown: row does not reference the clone-cluster gate"
done

# ─── Target 2: inbox-sort Quality Check honesty ──────────────────────────────
echo "[inbox-sort] Quality Check wording"
grep -qF "No files were renamed or modified" "$INBOX" \
  && fail "inbox-sort QC: 'No files were renamed or modified' contradicts Step 5a/12 (skill DOES edit frontmatter)" \
  || ok "inbox-sort QC: false 'renamed or modified' invariant removed"
grep -qF "no recently modified files moved" "$INBOX" \
  && fail "inbox-sort QC: cooldown gated on 'recently modified' — Step 5 reads YAML created, never modification date" \
  || ok "inbox-sort QC: cooldown no longer gated on modification date"
grep -qF "no recently created files moved" "$INBOX" \
  && ok "inbox-sort QC: cooldown correctly gated on creation date" \
  || fail "inbox-sort QC: cooldown not restated against creation date"

# ─── Target 3: note-rename legacy quick-fix list -> recipe (f) precedence ─────
# Region-scoped to the Core/Nahbereich/Report block so a file-level match on
# Step 4a's own recipe (f) reference cannot mask the missing pointer.
echo "[note-rename] Nahbereich legacy quick-fix precedence pointer"
nahbereich_block="$(awk '/\*\*Nahbereich:\*\*/{f=1} f{print} /\*\*Report:\*\*/{if(f){exit}}' "$RENAME")"
printf '%s' "$nahbereich_block" | grep -q "recipe (f)" \
  && ok "note-rename Nahbereich list: routes quoted-key/separator repairs through recipe (f)" \
  || fail "note-rename Nahbereich list: no recipe (f) pointer — legacy bullet bypasses the collision check"
printf '%s' "$nahbereich_block" | grep -qiE "ABORT|collision|Step 4a" \
  && ok "note-rename Nahbereich list: references the duplicate-key collision ABORT (Step 4a)" \
  || fail "note-rename Nahbereich list: no ABORT/Step-4a precedence — divergent-duplicate bypass open"

# ─── Summary ─────────────────────────────────────────────────────────────────
echo
echo "test-launch-skill-spec: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
