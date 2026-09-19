#!/usr/bin/env bash
# scripts/test-skill-frontmatter.sh
#
# The SKILL.md frontmatter contract gate, over EVERY skill in the repo.
#
# Why this file exists (2026-09-19):
#   The repo had no frontmatter gate at all. `scripts/test-launch-skill-spec.sh`
#   is often read as one, but it is a REGRESSION PIN over four named skills —
#   see the pin-vs-contract note in that file. So the contract every SKILL.md
#   must satisfy was, until now, enforced by nothing.
#
# The class this guards against:
#   A NAMED POSITIVE LIST IN A GATE IS A GATE WITH AN EXPIRY DATE. It ages
#   exactly when new work arrives — a skill added tomorrow would be outside a
#   hand-maintained list and nobody would notice, because the gate stays
#   honestly green over the skills it does know. This gate therefore DERIVES
#   its subject set from the filesystem (`skills/*/SKILL.md`). A new skill is
#   in scope from the moment its directory exists.
#
# Fail-closed decisions (both deliberate):
#   1. ZERO SKILLS IS RED. A run over an empty set that reports green is the
#      same "honestly green over the wrong artifact" defect one level down.
#   2. AN UNREADABLE OR UNPARSEABLE SKILL.md IS RED, checked before any
#      content assertion. A negative assertion (`grep -q ... || ok`) over a
#      missing or empty file returns PASS — the assertion is then decorative.
#
# What is asserted, and why only these:
#   Only invariants MEASURED to hold for all 11 skills today AND backed by a
#   written convention (agent skill conventions: own subdirectory, SKILL.md
#   with YAML frontmatter, name, description, 3+ triggers). Anything else is a
#   preference, and a gate that enforces a preference flips from "checks too
#   little" to "demands nonsense".
#
#   `status:` is deliberately NOT required. Measured 2026-09-19: no consumer
#   reads the SKILL.md `status:` field (the `status: aktiv|entfallen` in
#   skill-library-sync belongs to the VAULT LIBRARY NOTE, a different
#   document). 10 of 11 skills carry it, tag-organize does not. Until a
#   consumer exists, that absence is a REPORTED FINDING, not a gate failure —
#   so this gate only checks the value when the key is present.
#
# Test-only knob: SKILLS_DIR overrides the scanned directory. It exists so the
# zero-denominator path can be demonstrated without deleting the repo's skills.
#
# Bash 3.2 + BSD grep/awk. Exit 0 on PASS, 1 on any failure.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT" || { echo "FAIL: cannot cd to repo root ${REPO_ROOT}"; exit 1; }

SKILLS_DIR="${SKILLS_DIR:-${REPO_ROOT}/skills}"
MIN_TRIGGERS=3

PASS=0
FAIL=0
CHECKED=0

ok()   { echo "  PASS: $*"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL+1)); }

# Lines between the first and second `---`, empty if the block is malformed.
frontmatter() {
  awk 'NR==1 && $0!="---" { exit }
       NR==1 { inblock=1; next }
       inblock && $0=="---" { exit }
       inblock { print }' "$1"
}

# `description:` value, including any continuation lines up to the block end.
description_value() {
  printf '%s\n' "$1" | awk '/^description:/ { f=1; sub(/^description:[[:space:]]*/, ""); print; next }
                            f && /^[a-z_][a-z0-9_-]*:/ { exit }
                            f { print }'
}

# ─── Derive the subject set from the filesystem, never from a name list ──────
SKILL_FILES=""
for d in "${SKILLS_DIR}"/*/; do
  [ -d "$d" ] || continue
  SKILL_FILES="${SKILL_FILES}${d}SKILL.md
"
done
SKILL_FILES="$(printf '%s' "$SKILL_FILES" | grep -v '^$' || true)"

if [ -z "$SKILL_FILES" ]; then
  echo "FAIL: no skills found under ${SKILLS_DIR} — a gate that checks zero files"
  echo "      and reports green is the defect this gate exists to prevent."
  echo
  echo "test-skill-frontmatter: checked 0 skills, 0 passed, 1 failed"
  exit 1
fi

# ─── Per-skill contract ──────────────────────────────────────────────────────
while IFS= read -r skill; do
  CHECKED=$((CHECKED+1))
  name="$(basename "$(dirname "$skill")")"
  echo "[$name] frontmatter contract"

  # (0) Fail-closed: readable, non-empty, parseable block — BEFORE any content
  #     assertion, because a negative assertion over an absent file passes.
  if [ ! -r "$skill" ]; then
    fail "$name: skills/$name/SKILL.md is missing or unreadable"
    continue
  fi
  if [ ! -s "$skill" ]; then
    fail "$name: skills/$name/SKILL.md is empty"
    continue
  fi
  fm="$(frontmatter "$skill")"
  if [ -z "$fm" ]; then
    fail "$name: no parseable YAML frontmatter block (needs \`---\` on line 1 and a closing \`---\`)"
    continue
  fi
  ok "$name: frontmatter block parses"

  # (1) name: present and equal to the directory it lives in.
  declared="$(printf '%s\n' "$fm" | grep -m1 '^name:' | sed 's/^name:[[:space:]]*//' | sed 's/[[:space:]]*$//')"
  if [ -z "$declared" ]; then
    fail "$name: no \`name:\` in frontmatter"
  elif [ "$declared" != "$name" ]; then
    fail "$name: \`name: $declared\` does not match its directory \`skills/$name/\`"
  else
    ok "$name: \`name:\` matches its directory"
  fi

  # (2) description: present and non-empty.
  desc="$(description_value "$fm")"
  desc_stripped="$(printf '%s' "$desc" | tr -d '[:space:]')"
  if [ -z "$desc_stripped" ]; then
    fail "$name: \`description:\` missing or empty — this is what Claude Code matches on"
    continue
  fi
  ok "$name: \`description:\` present and non-empty"

  # (3) At least MIN_TRIGGERS quoted trigger phrases in the description.
  triggers="$(printf '%s' "$desc" | grep -o '"[^"]*"' | wc -l | tr -d ' ')"
  if [ "$triggers" -lt "$MIN_TRIGGERS" ]; then
    fail "$name: only ${triggers} quoted trigger phrase(s) in \`description:\`, convention is ${MIN_TRIGGERS}+"
  else
    ok "$name: ${triggers} quoted trigger phrases (>= ${MIN_TRIGGERS})"
  fi

  # (4) status: optional, but constrained when present. See header note.
  status="$(printf '%s\n' "$fm" | grep -m1 '^status:' | sed 's/^status:[[:space:]]*//' | sed 's/[[:space:]]*$//')"
  if [ -n "$status" ]; then
    case "$status" in
      beta|stable) ok "$name: \`status: $status\`" ;;
      *) fail "$name: \`status: $status\` is not one of beta|stable" ;;
    esac
  fi
done <<EOF
$SKILL_FILES
EOF

echo
echo "test-skill-frontmatter: checked ${CHECKED} skills, ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
