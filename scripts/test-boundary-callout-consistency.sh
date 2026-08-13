#!/usr/bin/env bash
# scripts/test-boundary-callout-consistency.sh
#
# Regression test for the boundary-vs-callout contradiction (issue #41, found
# 2026-06-20 during a real property-enrich run on v0.1.5, fixed 2026-08-13).
#
# Empirical defect it guards against:
#   `references/skill-log.md` mandates that every note-modifying skill append a
#   `> [!info] Vault Autopilot` callout at the END OF THE NOTE BODY. Three skills
#   (property-enrich, property-classify, property-describe) simultaneously
#   declared a Boundary saying they do not modify/touch the note body — and
#   inbox-sort, which issue #41 proposed as the fix template, carried the same
#   defect in its own Boundaries block ("no editing content") while phrasing it
#   correctly only in its Quality Check list.
#
#   This is not a cosmetic doc inconsistency. An LLM executing the skill reads
#   the boundary and the callout step as equally authoritative and must silently
#   pick one:
#     (1) honor the boundary -> skip the callout -> break the per-note
#         audit-trail contract, which is the product's whole "do no harm" story;
#     (2) honor the callout  -> write the body   -> silently violate a stated
#         boundary the user relies on.
#   Either way the behaviour is nondeterministic across runs, in a product whose
#   job is tending other people's notes.
#
# What it asserts:
#   A. Every skills/*/SKILL.md that mandates the skill-log contract must not
#      contain a body-denial boundary line UNLESS that same line names the
#      callout exception (detected by the literal token `skill-log`).
#   B. references/skill-log.md must still carry the sentence declaring that the
#      callout is a body write. That sentence is the single home of the rule;
#      if it is deleted, the four boundary lines lose the thing they point at
#      and the class silently reopens.
#
# Exit 0 on PASS. Exit 1 on first defect, with file:line context.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Fail closed: a test that silently scans the wrong tree and prints PASS is the
# decorative-gate failure this whole class of guard exists to prevent.
cd "$REPO_ROOT" || { echo "FAIL: cannot cd to repo root ${REPO_ROOT}"; exit 1; }

FAIL=0

# --- Assertion B: the contract's home still declares the body write ----------

CONTRACT="references/skill-log.md"

if [ ! -f "$CONTRACT" ]; then
  echo "FAIL: $CONTRACT is missing — the skill-log contract has no home."
  exit 1
fi

if ! grep -qi "appended to the \*\*note body\*\*" "$CONTRACT"; then
  echo "FAIL: $CONTRACT no longer states that the callout is appended to the note body."
  echo "      That sentence is what the skills' Boundaries lines point at. Restore it"
  echo "      rather than relaxing this test — see issue #41."
  FAIL=1
fi

if ! grep -qi "appended exception" "$CONTRACT"; then
  echo "FAIL: $CONTRACT no longer prescribes the 'appended exception' phrasing for"
  echo "      Boundaries sections. Without it each skill re-invents the wording and"
  echo "      the contradiction returns one skill at a time."
  FAIL=1
fi

# --- Assertion A: no unqualified body denial in a callout-mandating skill ----

# Two defect shapes, both instances of the same thing: a Boundary that denies a write
# the workflow mandates.
#
#   (1) BODY denial   — "does not modify note body" vs. the appended callout.
#   (2) PROPERTY      — "ONLY writes description" / "no other property modified" vs. the
#       exclusivity      mandated VaultAutopilot tag, which is another property.
#
# Shape (2) was found by CodeRabbit on the PR that fixed shape (1) — the same
# contradiction one field over. Both live here so the next instance is caught by a
# mechanism rather than by a reviewer who happened to look.
#
# Kept deliberately broad WITHIN these shapes: a false positive costs one carve-out
# clause, a false negative costs the defect. It does NOT catch every possible phrasing —
# "frontmatter only" or "leaves the body untouched" would slip through.
DENIAL_RE='([Dd]oes not|[Nn]ever|[Nn]o) (modif|touch|edit|chang|alter|rewrit|writ)[a-z]*( to)?( the)?( note)? (body|content)'
EXCLUSIVITY_RE='(ONLY writes|no other property (modified|written)|[Aa]dditive only)'

scanned=0
for skill_md in skills/*/SKILL.md; do
  # Fail closed on an unmatched glob or an unreadable file rather than skipping quietly.
  if [ ! -r "$skill_md" ]; then
    echo "FAIL: ${skill_md} is not readable — refusing to report PASS on an unscanned tree."
    exit 1
  fi
  # Only skills bound by the skill-log contract can contradict it.
  if ! grep -q "skill-log" "$skill_md"; then
    continue
  fi
  scanned=$((scanned + 1))

  while IFS= read -r hit; do
    line_no="${hit%%:*}"
    line_text="${hit#*:}"

    # The carve-out must name BOTH the contract and that it is an exception. A bare
    # "see skill-log" does not tell the executing model which of the two instructions wins.
    case "$line_text" in
      *skill-log*exception*) continue ;;
    esac

    echo "FAIL: ${skill_md}:${line_no} denies a body write but mandates the skill-log callout."
    echo "      ${line_text}"
    echo "      Fix: say it does not *rewrite* body content and name the callout as the"
    echo "      one appended exception, pointing at references/skill-log.md."
    FAIL=1
  done < <(grep -nE "$DENIAL_RE" "$skill_md" || true)

  while IFS= read -r hit; do
    line_no="${hit%%:*}"
    line_text="${hit#*:}"

    # Same carve-out rule, one field over: the mandated VaultAutopilot tag IS another
    # property, so an unqualified exclusivity claim is false in exactly the same way.
    case "$line_text" in
      *skill-log*|*VaultAutopilot*) continue ;;
    esac

    echo "FAIL: ${skill_md}:${line_no} claims property exclusivity but mandates the"
    echo "      VaultAutopilot tag, which is another property."
    echo "      ${line_text}"
    echo "      Fix: name the mandated tag as the sanctioned exception, pointing at"
    echo "      references/skill-log.md."
    FAIL=1
  done < <(grep -nE "$EXCLUSIVITY_RE" "$skill_md" || true)
done

# The glob matched nothing, or no skill carries the contract: either way this run proved
# nothing and must not read as a pass.
if [ "$scanned" -eq 0 ]; then
  echo "FAIL: no contract-bound SKILL.md was scanned. Either the glob matched nothing or"
  echo "      every skill lost its skill-log reference. A guard that scans zero files"
  echo "      passes vacuously — that is the failure mode, not the happy path."
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "PASS — ${scanned} contract-bound skill(s); none denies a write it is required to make."
fi

exit "$FAIL"
