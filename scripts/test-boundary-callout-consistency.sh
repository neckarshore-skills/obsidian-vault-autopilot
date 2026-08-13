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
cd "$REPO_ROOT"

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

# Body-denial shapes observed in the wild, plus the obvious near-misses. Kept
# deliberately broad: a false positive costs one carve-out clause, a false
# negative costs the defect this file exists to prevent.
DENIAL_RE='([Dd]oes not|[Nn]ever|[Nn]o) (modif|touch|edit|chang|alter|rewrit|writ)[a-z]*( to)?( the)?( note)? (body|content)'

for skill_md in skills/*/SKILL.md; do
  # Only skills bound by the skill-log contract can contradict it.
  if ! grep -q "skill-log" "$skill_md"; then
    continue
  fi

  while IFS= read -r hit; do
    line_no="${hit%%:*}"
    line_text="${hit#*:}"

    # The carve-out: a denial line that names the skill-log exception is correct.
    case "$line_text" in
      *skill-log*) continue ;;
    esac

    echo "FAIL: ${skill_md}:${line_no} denies a body write but mandates the skill-log callout."
    echo "      ${line_text}"
    echo "      Fix: say it does not *rewrite* body content and name the callout as the"
    echo "      one appended exception, pointing at references/skill-log.md."
    FAIL=1
  done < <(grep -nE "$DENIAL_RE" "$skill_md" || true)
done

if [ "$FAIL" -eq 0 ]; then
  echo "PASS — no skill denies the body write it is contractually required to make."
fi

exit "$FAIL"
