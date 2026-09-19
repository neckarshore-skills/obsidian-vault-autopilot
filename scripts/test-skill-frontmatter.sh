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

# A well-formed block is `---` on line 1 AND a later closing `---`. This is an
# EXPLICIT PRECONDITION, checked before the extractor runs, not an emergent
# property of it: an awk that stops at the closing delimiter simply prints to
# EOF when there is none, and every downstream assertion then goes green over a
# file Claude Code cannot parse. Measured 2026-09-19 on the first draft of this
# gate — stripping the closing `---` from tag-manage produced five PASSes and
# inflated the trigger count from 16 to 66, because `description_value` ran off
# into the markdown body. That is this repo's own gate falling into the class
# the gate was written to close.
# Single awk process ON PURPOSE. The first version was
# `tail -n +2 "$1" | grep -qx -- '---'`, which fails under `set -o pipefail` for
# a reason that has nothing to do with the file: `grep -q` exits at the first
# match, SIGPIPEs `tail`, and pipefail turns that into a non-zero status. It
# therefore went red on note-rename and tag-manage (larger files, tail still
# writing) and green on inbox-sort (smaller, tail already done) — a gate whose
# verdict tracked file size. Caught by re-running the gate after the fix.
well_formed_block() {
  awk 'NR==1 && $0!="---" { exit }
       NR==1 { next }
       $0=="---" { closed=1; exit }
       END { exit (closed ? 0 : 1) }' "$1"
}

# Lines between the first and second `---`. Only valid after well_formed_block.
frontmatter() {
  awk 'NR==1 { next }
       $0=="---" { exit }
       { print }' "$1"
}

# ─── The block must be VALID YAML, not merely delimited ─────────────────────
# Raised by CodeRabbit on PR #102 and correct: until this existed, the gate
# greped the block and reported "frontmatter block parses" without ever
# parsing it. `description: [` is a delimited block, matches `name:`, carries
# quoted phrases — and is unparseable YAML, so Claude Code does not load the
# skill AT ALL. For a skills product that is the worst failure mode there is:
# total, silent, and invisible in the file. The old wording was the same
# overclaim this gate was written to close, one layer further down.
#
# `name`, `description` and `status` are read as PARSED SCALARS from here on,
# never as grep hits, and the trigger count runs over the parsed string.
#
# Parser availability is FAIL-CLOSED AND LOUD (see require_yaml_parser): a gate
# that skips itself when its parser is missing is the decorative-green class
# wearing a dependency for a hat.
skill_report() {
  python3 - "$1" <<'PYEOF' 2>&1
import sys, yaml

path = sys.argv[1]
try:
    text = open(path, encoding="utf-8").read()
except Exception as exc:                       # unreadable / undecodable
    print("ERR=cannot read file: %s" % exc); sys.exit(0)

lines = text.split("\n")
if not lines or lines[0].strip() != "---":
    print("ERR=line 1 is not the `---` delimiter"); sys.exit(0)
try:
    end = lines.index("---", 1)
except ValueError:
    print("ERR=no closing `---` delimiter"); sys.exit(0)

block = "\n".join(lines[1:end])
try:
    data = yaml.safe_load(block)
except yaml.YAMLError as exc:
    print("ERR=frontmatter is not valid YAML: %s" % str(exc).replace("\n", " ")[:160])
    sys.exit(0)

if data is None:
    print("ERR=frontmatter block is delimited but empty"); sys.exit(0)
if not isinstance(data, dict):
    print("ERR=frontmatter is valid YAML but not a mapping (%s)" % type(data).__name__)
    sys.exit(0)

def scalar(key):
    if key not in data:
        return "absent", ""
    v = data[key]
    if v is None:
        return "null", ""
    if not isinstance(v, (str, int, float, bool)):
        return "nonscalar", type(v).__name__
    v = str(v).strip()
    return ("empty", "") if not v else ("value", v)

print("OK=1")
for key in ("name", "description", "status"):
    state, val = scalar(key)
    print("%s_STATE=%s" % (key.upper(), state))
    if key != "description":
        print("%s=%s" % (key.upper(), val))
state, desc = scalar("description")
print("TRIGGERS=%d" % (desc.count('"') // 2 if state == "value" else 0))
PYEOF
}

require_yaml_parser() {
  python3 -c 'import yaml' >/dev/null 2>&1 && return 0
  echo "FAIL: python3 with PyYAML is required — the frontmatter block cannot be"
  echo "      validated without a parser, and a gate that skips itself when its"
  echo "      parser is missing reports green over unchecked files."
  echo
  echo "test-skill-frontmatter: checked 0 skills, 0 passed, 1 failed"
  exit 1
}

require_yaml_parser

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
  if ! well_formed_block "$skill"; then
    fail "$name: no parseable YAML frontmatter block (needs \`---\` on line 1 and a closing \`---\`)"
    continue
  fi

  # (1) The block must be VALID YAML and a mapping. Everything below reads
  #     PARSED SCALARS from this report, never grep hits.
  report="$(skill_report "$skill")"
  case "$report" in
    ERR=*) fail "$name: ${report#ERR=}"; continue ;;
    OK=1*) ok "$name: frontmatter parses as a YAML mapping" ;;
    *)     fail "$name: frontmatter probe produced no verdict — ${report:-<empty>}"; continue ;;
  esac
  field() { printf '%s\n' "$report" | grep -m1 "^$1=" | cut -d= -f2-; }

  # (2) name: present, a scalar, and equal to the directory it lives in.
  case "$(field NAME_STATE)" in
    value)
      declared="$(field NAME)"
      if [ "$declared" != "$name" ]; then
        fail "$name: \`name: $declared\` does not match its directory \`skills/$name/\`"
      else
        ok "$name: \`name:\` matches its directory"
      fi ;;
    absent)    fail "$name: no \`name:\` in frontmatter" ;;
    null)      fail "$name: \`name:\` is present but null" ;;
    empty)     fail "$name: \`name:\` is present but empty" ;;
    nonscalar) fail "$name: \`name:\` is not a scalar" ;;
  esac

  # (3) description: present and non-empty — this is what Claude Code matches on.
  case "$(field DESCRIPTION_STATE)" in
    value)     ok "$name: \`description:\` present and non-empty" ;;
    absent)    fail "$name: no \`description:\` in frontmatter — this is what Claude Code matches on"; continue ;;
    null)      fail "$name: \`description:\` is present but null"; continue ;;
    empty)     fail "$name: \`description:\` is present but empty"; continue ;;
    nonscalar) fail "$name: \`description:\` is not a scalar"; continue ;;
  esac

  # (4) At least MIN_TRIGGERS quoted trigger phrases, counted over the PARSED
  #     description — not over the raw block, which would swallow the body.
  triggers="$(field TRIGGERS)"
  if [ "${triggers:-0}" -lt "$MIN_TRIGGERS" ]; then
    fail "$name: only ${triggers:-0} quoted trigger phrase(s) in \`description:\`, convention is ${MIN_TRIGGERS}+"
  else
    ok "$name: ${triggers} quoted trigger phrases (>= ${MIN_TRIGGERS})"
  fi

  # (5) status: OPTIONAL (nothing consumes it — see header). An ABSENT key and a
  #     PRESENT-but-empty/null one are different facts and are reported as such.
  case "$(field STATUS_STATE)" in
    absent)    : ;;
    value)
      status="$(field STATUS)"
      case "$status" in
        beta|stable) ok "$name: \`status: $status\`" ;;
        *)           fail "$name: \`status: $status\` is not one of beta|stable" ;;
      esac ;;
    null)      fail "$name: \`status:\` is present but null — omit the key or give it a value" ;;
    empty)     fail "$name: \`status:\` is present but empty — omit the key or give it a value" ;;
    nonscalar) fail "$name: \`status:\` is not a scalar" ;;
  esac
done <<EOF
$SKILL_FILES
EOF

echo
echo "test-skill-frontmatter: checked ${CHECKED} skills, ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
