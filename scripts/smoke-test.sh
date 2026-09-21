#!/usr/bin/env bash
# scripts/smoke-test.sh
#
# Manual harness for v0.1.x test fixtures. For each launch-scope skill, sets up
# an isolated temp subdir with ONLY that skill's relevant fixtures, asks the
# developer to run the skill, then diffs the result against the golden expected
# files in test-data/expected/<skill>/.
#
# Per-skill isolation (NOT cumulative). Each skill's diff reflects post-this-skill
# state only. This avoids state-pollution from prior skills (e.g. enrich's tag +
# callout would otherwise corrupt a "describe should be byte-identical" fixture).
#
# This is a CONTRACT validator, not an LLM executor. The runner does NOT invoke
# Claude Code automatically — the developer runs each skill manually against
# $TEMP_VAULT/<skill>/ and presses Enter when done. The runner then diffs.
#
# Exit 0 on full PASS. Exit 1 on first diff. Exit 2 on missing fixture/expected.
#
# Limitations (acceptable for v0.1.3 — see PR description):
# - Skill-log callout `> [!info] Vault Autopilot` blocks are STRIPPED before
#   diff (action-strings are LLM-variable, not deterministic). The diff
#   validates frontmatter + body, NOT the callout wording. Callout PRESENCE is
#   a separate manual visual check the developer makes during the run.
# - Date/timestamp values normalized via sed to {{TIMESTAMP}} / {{ISO_DATE}}.
# - Filesystem birthtime preservation tests are NOT performed here — separate
#   stat-based check needed (out of scope for v0.1.3).
# - First real run will surface drift between expected files and actual LLM
#   output. Treat first-run drift as fixture-author-bug, not skill-bug.
# - Bash-only, macOS-tested (Linux should work; Windows untested in v0.1.3).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMP_VAULT_BASE="$(mktemp -d /tmp/vault-autopilot-smoke.XXXXXX)"
trap 'rm -rf "$TEMP_VAULT_BASE"' EXIT

echo "=== smoke-test ==="
echo "Repo root:        $REPO_ROOT"
echo "Temp vault base:  $TEMP_VAULT_BASE"
echo
echo "Per-skill isolation: each skill gets its own subdir with its own fixtures."
echo

# Normalize a file for diff.
# 1. Replace ISO date-time strings with {{TIMESTAMP}}.
# 2. Replace `modified: <date>` line with `modified: {{ISO_DATE}}`.
# 3. Strip the entire skill-log callout block (action-strings are LLM-variable).
#    Definition of strip: from a line equal to `> [!info] Vault Autopilot` until
#    the first subsequent line that does NOT start with `>` after lstrip (or EOF).
normalize_for_diff() {
  local FILE="$1"
  awk '
    BEGIN { in_callout = 0 }
    {
      line = $0
      # Detect callout open
      if (line ~ /^> \[!info\] Vault Autopilot$/) {
        in_callout = 1
        next
      }
      if (in_callout) {
        # Strip whitespace from front to detect blockquote vs not
        stripped = line
        sub(/^[ \t]+/, "", stripped)
        if (stripped !~ /^>/) {
          in_callout = 0
          # Fall through and emit this line
        } else {
          next
        }
      }
      print line
    }
  ' "$FILE" \
    | sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}/{{TIMESTAMP}}/g' \
    | sed -E 's/^modified: [0-9]{4}-[0-9]{2}-[0-9]{2}.*$/modified: {{ISO_DATE}}/'
}

# Collect skill → fixture mapping by reading expected/ directories.
# Each skill's relevant fixtures = the fixtures that have an expected/ golden file.
# CONTRACT: the subject set is whatever has golden fixtures. Deriving it from
# test-data/expected/ means a new fixture set is exercised the day it lands,
# instead of on the day someone remembers to extend a list here.
SKILLS=()
for _d in "$REPO_ROOT"/test-data/expected/*/; do
  [ -d "$_d" ] && SKILLS+=("$(basename "$_d")")
done
if [ ${#SKILLS[@]} -eq 0 ]; then
  echo "FAIL: no fixture sets under test-data/expected/ — refusing to report a" >&2
  echo "      green smoke test over an empty subject set." >&2
  exit 1
fi
EXIT_CODE=0

for SKILL in "${SKILLS[@]}"; do
  echo "--- Step: $SKILL ---"
  EXPECTED_DIR="$REPO_ROOT/test-data/expected/$SKILL"
  if [[ ! -d "$EXPECTED_DIR" ]]; then
    echo "  No expected/ directory for $SKILL — skipping (no fixtures defined)"
    echo
    continue
  fi

  shopt -s nullglob
  EXPECTED_FILES=("$EXPECTED_DIR"/*.md)
  shopt -u nullglob

  if [[ ${#EXPECTED_FILES[@]} -eq 0 ]]; then
    echo "  No expected fixtures for $SKILL — skipping"
    echo
    continue
  fi

  # Set up isolated temp vault for this skill
  SKILL_VAULT="$TEMP_VAULT_BASE/$SKILL"
  mkdir -p "$SKILL_VAULT/Inbox"
  RELEVANT_COUNT=0
  for EXPECTED in "${EXPECTED_FILES[@]}"; do
    FIXTURE_NAME="$(basename "$EXPECTED")"
    SOURCE_FIXTURE="$REPO_ROOT/test-data/$FIXTURE_NAME"
    if [[ ! -f "$SOURCE_FIXTURE" ]]; then
      echo "  ERROR: expected/$SKILL/$FIXTURE_NAME has no matching test-data/$FIXTURE_NAME source"
      exit 2
    fi
    cp "$SOURCE_FIXTURE" "$SKILL_VAULT/Inbox/"
    RELEVANT_COUNT=$((RELEVANT_COUNT + 1))
  done
  echo "  Copied $RELEVANT_COUNT fixture(s) to $SKILL_VAULT/Inbox/"
  echo
  echo "  Run \`$SKILL\` against:"
  echo "    OBSIDIAN_VAULT_PATH=\"$SKILL_VAULT\""
  echo "    scope=inbox-tree, cooldown_days=0"
  echo
  echo "  Press Enter when the skill run completes (or Ctrl-C to abort)..."
  read -r _

  # Diff each expected file
  SKILL_FAILED=0
  for EXPECTED in "${EXPECTED_FILES[@]}"; do
    FIXTURE="$(basename "$EXPECTED")"
    ACTUAL="$(find "$SKILL_VAULT" -name "$FIXTURE" -type f -print -quit 2>/dev/null || true)"
    if [[ -z "$ACTUAL" || ! -f "$ACTUAL" ]]; then
      echo "  FAIL: $FIXTURE not found in temp vault after $SKILL"
      SKILL_FAILED=1
      EXIT_CODE=2
      continue
    fi

    NORMALIZED_EXPECTED="$(mktemp)"
    NORMALIZED_ACTUAL="$(mktemp)"
    normalize_for_diff "$EXPECTED" > "$NORMALIZED_EXPECTED"
    normalize_for_diff "$ACTUAL" > "$NORMALIZED_ACTUAL"

    if ! diff -u "$NORMALIZED_EXPECTED" "$NORMALIZED_ACTUAL" > /tmp/smoke-diff.txt; then
      echo "  FAIL: $FIXTURE differs from expected (post-normalize)"
      echo
      echo "  --- diff (expected vs actual, callout-stripped + dates-normalized) ---"
      cat /tmp/smoke-diff.txt
      echo "  --- end diff ---"
      SKILL_FAILED=1
      EXIT_CODE=1
    else
      echo "  PASS: $FIXTURE matches expected"
    fi
    rm -f "$NORMALIZED_EXPECTED" "$NORMALIZED_ACTUAL"
  done

  if [[ $SKILL_FAILED -eq 0 ]]; then
    echo "  $SKILL: all fixtures PASS"
  else
    echo "  $SKILL: one or more fixtures FAILED — see diffs above"
  fi
  echo
done

if [[ $EXIT_CODE -eq 0 ]]; then
  echo "=== smoke-test PASS ==="
else
  echo "=== smoke-test FAIL (exit $EXIT_CODE) ==="
fi
exit $EXIT_CODE
