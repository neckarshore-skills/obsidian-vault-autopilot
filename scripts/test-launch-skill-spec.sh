#!/usr/bin/env bash
# Spec-contradiction assertion harness. Phase 4 of the 2026-06-11 skill-
# hardening plan (docs/plans/2026-06-11-skill-hardening-fable-pilot.md § 4),
# extended 2026-09-19 — see "Derived vs pinned" below.
#
# These are SMALL, ADDITIVE wording guards — no new behavior. The targets are
# stale/contradictory spec text that lets a model pick a repair path the
# canonical references already supersede:
#
#   G7  property-enrich + property-describe cooldown param row once said
#       "Use file creation date (birthtime)" while the step body already routed
#       cooldown through the Source Hierarchy + clone-cluster gate. Same
#       clone-poisoning bypass class the Phase-2 property-classify fix closed.
#       Regression pin mirrors scripts/test-property-classify.sh (c).
#
#   inbox-sort Quality Check claimed "No files were renamed or modified" (the
#       skill DOES modify frontmatter: Step 5a recipe b+f, Step 12 skill-log)
#       and gated cooldown on "recently modified" (Step 5 reads YAML `created`,
#       never modification date).
#
#   note-rename legacy Nahbereich quick-fix list ("type:" -> type, remove
#       duplicate ---) predates and overlaps Step 4a's recipe (f) routing but
#       carried no precedence pointer, so the legacy bullet could bypass the
#       duplicate-key collision ABORT (divergent -> skip + Class-A).
#
# ─── Derived vs pinned — read this before adding an assertion ───────────────
#
# A NAMED POSITIVE LIST IN A GATE IS A GATE WITH AN EXPIRY DATE: it ages exactly
# when new work arrives, because a skill added tomorrow sits outside the list
# and the gate stays honestly green over the ones it does know. Until
# 2026-09-19 this file named four skills in four variables and checked nothing
# else — measured that day: 11 skills in the repo, and SIX of them carry a
# `cooldown_days` row while only two were pinned.
#
# The repair is not "run every assertion over every skill" — that flips the gate
# from checking too little to demanding nonsense (measured: note-rename and
# inbox-sort route cooldown through Nahbereich and legitimately do NOT name the
# clone-cluster gate). The distinction that does the work:
#
#   CONTRACT assertions state what must hold for anything of a kind. Their
#   subject set is DERIVED — here, by the predicate "this SKILL.md has a
#   `cooldown_days` param row". A new skill with such a row is in scope from
#   the moment it is written.
#
#   REGRESSION PINS record one past defect in one named file. A fixed subject
#   is correct for them — the defect happened there. What a pin still owes is a
#   FAIL-CLOSED existence check: a negative assertion (`grep -qF ... || ok`)
#   over a renamed or deleted file returns PASS, so the pin would go on
#   reporting green over a file that is no longer there.
#
# The repo-wide SKILL.md frontmatter contract lives in its own derived gate,
# scripts/test-skill-frontmatter.sh. This file is not that gate.
#
# Doc-shape test (greps SKILL.md spec text), same family as the other
# scripts/test-*.sh drift-guards. Bash 3.2 + BSD grep/awk.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT" || { echo "FAIL: cannot cd to repo root ${REPO_ROOT}"; exit 1; }

SKILLS_DIR="${SKILLS_DIR:-${REPO_ROOT}/skills}"

ENRICH="${SKILLS_DIR}/property-enrich/SKILL.md"
DESCRIBE="${SKILLS_DIR}/property-describe/SKILL.md"
INBOX="${SKILLS_DIR}/inbox-sort/SKILL.md"
RENAME="${SKILLS_DIR}/note-rename/SKILL.md"

PASS=0
FAIL=0

ok()   { echo "  PASS: $*"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL+1)); }

# Fail-closed guard for a PINNED target: a pin over a file that is missing,
# empty or unreadable must go red, never green-by-absence.
require_spec() {
  if [ ! -r "$1" ] || [ ! -s "$1" ]; then
    fail "$2: ${1#$REPO_ROOT/} is missing, empty or unreadable — the pin has lost its subject"
    return 1
  fi
  return 0
}

# Extract the single `cooldown_days` parameter-table row from a SKILL.md.
cooldown_row() { grep -F '| `cooldown_days` |' "$1"; }

# ─── CONTRACT (derived): every cooldown_days row, whichever skill carries it ──
# Asserted only for what is portable across ALL such rows. The clone-cluster
# requirement is NOT portable and stays a pin below.
echo "== cooldown_days contract (subject set derived from ${SKILLS_DIR#$REPO_ROOT/}/*/SKILL.md) =="
COOLDOWN_SKILLS=0
for skill in "${SKILLS_DIR}"/*/SKILL.md; do
  [ -r "$skill" ] && [ -s "$skill" ] || continue
  row="$(cooldown_row "$skill")"
  [ -n "$row" ] || continue
  COOLDOWN_SKILLS=$((COOLDOWN_SKILLS+1))
  name="$(basename "$(dirname "$skill")")"

  echo "[$name] cooldown param row"
  printf '%s' "$row" | grep -qF "Use file creation date (birthtime)" \
    && fail "$name cooldown: stale raw-birthtime date source present (clone-poisoning bypass)" \
    || ok "$name cooldown: no stale raw-birthtime date source"
  printf '%s' "$row" | grep -q "Source Hierarchy" \
    && ok "$name cooldown: row references the Source Hierarchy" \
    || fail "$name cooldown: row does not reference the Source Hierarchy (param table contradicts the step)"
  printf '%s' "$row" | grep -qF "Never use modification date" \
    && ok "$name cooldown: row forbids the modification date" \
    || fail "$name cooldown: row does not forbid the modification date"
done

if [ "$COOLDOWN_SKILLS" -eq 0 ]; then
  fail "cooldown contract: no SKILL.md with a \`cooldown_days\` row found under ${SKILLS_DIR#$REPO_ROOT/} — a contract checked over zero subjects is not a contract"
fi

# ─── PIN (G7): clone-cluster routing, property-enrich + property-describe ────
# Named on purpose: this records one 2026-06-11 defect in two named files, and
# is NOT portable — note-rename and inbox-sort route cooldown through their
# Nahbereich instead and correctly do not name the gate.
echo
echo "== regression pins (named subjects, fail-closed) =="
for skill in "$ENRICH" "$DESCRIBE"; do
  name="$(basename "$(dirname "$skill")")"
  echo "[$name] clone-cluster routing pin"
  require_spec "$skill" "$name" || continue
  printf '%s' "$(cooldown_row "$skill")" | grep -qi "clone-cluster" \
    && ok "$name cooldown: row references the clone-cluster gate" \
    || fail "$name cooldown: row does not reference the clone-cluster gate"
done

# ─── PIN: inbox-sort Quality Check honesty ───────────────────────────────────
echo "[inbox-sort] Quality Check wording"
if require_spec "$INBOX" "inbox-sort"; then
  grep -qF "No files were renamed or modified" "$INBOX" \
    && fail "inbox-sort QC: 'No files were renamed or modified' contradicts Step 5a/12 (skill DOES edit frontmatter)" \
    || ok "inbox-sort QC: false 'renamed or modified' invariant removed"
  grep -qF "no recently modified files moved" "$INBOX" \
    && fail "inbox-sort QC: cooldown gated on 'recently modified' — Step 5 reads YAML created, never modification date" \
    || ok "inbox-sort QC: cooldown no longer gated on modification date"
  grep -qF "no recently created files moved" "$INBOX" \
    && ok "inbox-sort QC: cooldown correctly gated on creation date" \
    || fail "inbox-sort QC: cooldown not restated against creation date"
fi

# ─── PIN: note-rename legacy quick-fix list -> recipe (f) precedence ─────────
# Region-scoped to the Core/Nahbereich/Report block so a file-level match on
# Step 4a's own recipe (f) reference cannot mask the missing pointer.
echo "[note-rename] Nahbereich legacy quick-fix precedence pointer"
if require_spec "$RENAME" "note-rename"; then
  nahbereich_block="$(awk '/\*\*Nahbereich:\*\*/{f=1} f{print} /\*\*Report:\*\*/{if(f){exit}}' "$RENAME")"
  if [ -z "$nahbereich_block" ]; then
    fail "note-rename: no Nahbereich block found — the region this pin scopes to is gone"
  else
    printf '%s' "$nahbereich_block" | grep -q "recipe (f)" \
      && ok "note-rename Nahbereich list: routes quoted-key/separator repairs through recipe (f)" \
      || fail "note-rename Nahbereich list: no recipe (f) pointer — legacy bullet bypasses the collision check"
    printf '%s' "$nahbereich_block" | grep -qiE "ABORT|collision|Step 4a" \
      && ok "note-rename Nahbereich list: references the duplicate-key collision ABORT (Step 4a)" \
      || fail "note-rename Nahbereich list: no ABORT/Step-4a precedence — divergent-duplicate bypass open"
  fi
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
echo
echo "test-launch-skill-spec: cooldown contract over ${COOLDOWN_SKILLS} skill(s) + 4 pinned skills, ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
