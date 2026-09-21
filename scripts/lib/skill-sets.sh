#!/usr/bin/env bash
# scripts/lib/skill-sets.sh
#
# Derived subject sets for the assertion suites.
#
# THE PIN-VS-CONTRACT CUT (established in PR #102, applied across the class
# 2026-09-21): a CONTRACT assertion derives its subject set from a predicate,
# so a skill that joins the population is covered on the day it ships. A
# REGRESSION PIN keeps named subjects and owes a fail-closed existence check.
# Deriving a pin is not an improvement — it makes the gate red on skills that
# are behaviourally correct but documented differently. Measured example, left
# pinned on purpose: scripts/test-recipe-f-duplicate-keys.sh.
#
# Sourced, never executed. Not matched by the CI glob (scripts/test-*.sh).

# The pre-flight population: every skill that declares a Pre-flight section.
#
# Why THIS anchor and not "references clone-preflight.md": the defect this
# guards against is a skill that stops invoking the preflight. Deriving from
# the reference itself would make that removal invisible — the skill would
# simply drop out of the set and the gate would stay green. Deriving from the
# section heading keeps it IN the set, so the missing reference fails.
#
# Measured 2026-09-21: 6 skills (inbox-sort, note-quality-check, note-rename,
# property-classify, property-describe, property-enrich). The three suites
# that consume this set asserted against a hardcoded 4 until today.
preflight_skills() {
  grep -l '^## Pre-flight' skills/*/SKILL.md 2>/dev/null | sort
}

# Fail-closed floor for the derived set. A derivation that silently returns
# nothing — a renamed heading, a moved skills/ directory, a grep that finds no
# match — must fail loudly rather than pass an empty loop. The four
# launch-scope skills are the historical floor: they have carried the
# pre-flight contract since v0.1.5 and none of them may leave the set
# unnoticed.
#
# Callers pass the derived list on stdin.
assert_preflight_floor() {
  local derived; derived="$(cat)"
  local count; count=$(printf '%s\n' "$derived" | grep -c . || true)

  if [ "$count" -lt 4 ]; then
    echo "FAIL: preflight_skills() derived $count skills — the floor is 4." >&2
    echo "      Either the '## Pre-flight' heading changed shape or skills/ moved." >&2
    echo "      Derived: ${derived:-<empty>}" >&2
    return 1
  fi

  local floor_skill
  for floor_skill in inbox-sort note-rename property-enrich property-describe; do
    if ! printf '%s\n' "$derived" | grep -qx "skills/${floor_skill}/SKILL.md"; then
      echo "FAIL: launch-scope skill '${floor_skill}' dropped out of the derived" >&2
      echo "      pre-flight set. It has carried this contract since v0.1.5." >&2
      echo "      Derived: $derived" >&2
      return 1
    fi
  done
  return 0
}
