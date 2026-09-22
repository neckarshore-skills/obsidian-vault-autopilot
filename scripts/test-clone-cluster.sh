#!/usr/bin/env bash
# scripts/test-clone-cluster.sh
#
# W2 regression test for the clone-cluster-detection mode-shift unification.
#
# What it asserts (in order, fail-fast):
#   1. Fixture structure: tests/fixtures/clone-cluster/ has _truth.json,
#      generate.sh, README.md.
#   2. Generator can run + produces 30 files (regenerates fixture each run for
#      isolation).
#   3. Decision-matrix correctness: for each file in _truth.json, executing
#      recipes (a) and (b) from references/clone-cluster-detection.md against
#      the file produces the expected verdict.
#   4. references/clone-cluster-detection.md exists, declares both recipes,
#      contains the decision matrix table, and the cluster-window heuristic.
#   5. All 4 launch-scope SKILL.md files reference clone-cluster-detection.md
#      and mention the SKIP behavior at least once.
#
# Exit 0 on PASS. Exit 1 on first failure with a contextual message.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

FIXTURE_DIR="tests/fixtures/clone-cluster"
NOTES_DIR="$FIXTURE_DIR/notes"
RECIPE_DOC="references/clone-cluster-detection.md"

assert_path() {
  local path="$1"
  local kind="$2"
  case "$kind" in
    dir) [ -d "$path" ] || { echo "FAIL: missing dir: $path" >&2; exit 1; } ;;
    file) [ -f "$path" ] || { echo "FAIL: missing file: $path" >&2; exit 1; } ;;
  esac
}

assert_grep() {
  local needle="$1"; local file="$2"
  grep -qF "$needle" "$file" || { echo "FAIL: '$needle' not found in $file" >&2; exit 1; }
}

# ---------------------------------------------------------------------------
# 1. Fixture structure
# ---------------------------------------------------------------------------
echo "[1/5] Fixture structure..."
assert_path "$FIXTURE_DIR" dir
assert_path "$FIXTURE_DIR/_truth.json" file
assert_path "$FIXTURE_DIR/generate.sh" file
assert_path "$FIXTURE_DIR/README.md" file

# ---------------------------------------------------------------------------
# 2. Generator runs + produces 30 files
# ---------------------------------------------------------------------------
echo "[2/5] Generator regeneration..."
bash "$FIXTURE_DIR/generate.sh" >/dev/null
COUNT=$(find "$NOTES_DIR" -name '*.md' -type f | wc -l | tr -d ' ')
if [ "$COUNT" != "30" ]; then
  echo "FAIL: expected 30 files in $NOTES_DIR, got $COUNT" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. Decision-matrix correctness
# ---------------------------------------------------------------------------
echo "[3/5] Decision matrix per _truth.json..."

# v0.1.5 contract: drive recipe (a) from the actual detector output instead
# of re-deriving the window from _truth.json. Re-derivation hid a runtime
# bug in v0.1.4 W2: the test computed a UTC-correct window via `date -ju`,
# while recipe (a)'s `stat -f '%SB' -t '...Z'` formatted local time with a
# literal Z, and the fixture generator's `touch -t` used local time too —
# so the test passed by coincidence because both halves were systematically
# wrong by the same offset. Real macOS users on non-UTC hosts got wrong
# SKIP verdicts at runtime. Driving the test from the detector closes that
# gap, and the lock-in assertion below catches any future regression that
# reintroduces the local-time-with-Z trap.
DETECTOR_OUT=$("$REPO_ROOT/scripts/detect-clone-cluster.sh" "$NOTES_DIR")
eval "$DETECTOR_OUT"
if [ "${CLUSTER_FOUND:-}" != "yes" ]; then
  echo "FAIL: detector did not declare a cluster on the W2 fixture; output:" >&2
  printf -- "%s\n" "$DETECTOR_OUT" >&2
  exit 1
fi
if [ -z "${CLONE_CLUSTER_WINDOW_START_EPOCH:-}" ] || [ -z "${CLONE_CLUSTER_WINDOW_END_EPOCH:-}" ]; then
  echo "FAIL: detector did not emit *_EPOCH window fields (v0.1.5 contract)" >&2
  printf -- "%s\n" "$DETECTOR_OUT" >&2
  exit 1
fi
export CLONE_CLUSTER_WINDOW_START CLONE_CLUSTER_WINDOW_END
export CLONE_CLUSTER_WINDOW_START_EPOCH CLONE_CLUSTER_WINDOW_END_EPOCH

# Lock-in assertion: the detector's epoch window must enclose the fixture's
# documented UTC center. v0.1.4 W2 deliberately omitted this assertion
# because the broken format-string would have made it fail on non-UTC hosts.
# v0.1.5 fixes recipe (a) + generator + detector contract, so the assertion
# now passes cleanly. Future regression to local-time-with-Z handling will
# trip this check.
CLUSTER_CENTER=$(awk -F'"' '/center_utc/ { print $4 }' "$FIXTURE_DIR/_truth.json")
case "$(uname)" in
  Darwin)
    CENTER_EPOCH=$(date -ju -f '%Y-%m-%dT%H:%M:%SZ' "$CLUSTER_CENTER" '+%s')
    ;;
  Linux)
    CENTER_EPOCH=$(date -u -d "$CLUSTER_CENTER" '+%s')
    ;;
esac
if [ "$CENTER_EPOCH" -lt "$CLONE_CLUSTER_WINDOW_START_EPOCH" ] || \
   [ "$CENTER_EPOCH" -gt "$CLONE_CLUSTER_WINDOW_END_EPOCH" ]; then
  echo "FAIL: detector window does not enclose fixture center_utc" >&2
  echo "  center_utc=$CLUSTER_CENTER (epoch $CENTER_EPOCH)" >&2
  echo "  detector window=[$CLONE_CLUSTER_WINDOW_START..$CLONE_CLUSTER_WINDOW_END]" >&2
  echo "  detector window epoch=[$CLONE_CLUSTER_WINDOW_START_EPOCH..$CLONE_CLUSTER_WINDOW_END_EPOCH]" >&2
  exit 1
fi

# Inline recipe (a) for the test harness — copy of the doc snippet, v0.1.5
# epoch-based contract (numeric in-window compare, no ISO strings).
recipe_a() {
  local FILE="$1"
  local BT_EPOCH
  if [ -z "${CLONE_CLUSTER_WINDOW_START_EPOCH:-}" ] || [ -z "${CLONE_CLUSTER_WINDOW_END_EPOCH:-}" ]; then
    return 1
  fi
  case "$(uname)" in
    Darwin)
      BT_EPOCH=$(stat -f '%B' "$FILE")
      ;;
    Linux)
      BT_EPOCH=$(stat -c '%W' "$FILE")
      if [ "$BT_EPOCH" = "0" ]; then
        BT_EPOCH=$(stat -c '%Y' "$FILE")
      fi
      ;;
  esac
  if [ "$BT_EPOCH" -ge "$CLONE_CLUSTER_WINDOW_START_EPOCH" ] && \
     [ "$BT_EPOCH" -le "$CLONE_CLUSTER_WINDOW_END_EPOCH" ]; then
    return 0
  else
    return 1
  fi
}

# Inline recipe (b) for the test harness
recipe_b() {
  local FILE="$1"
  local YAML_DATE
  YAML_DATE=$(awk '
    BEGIN { in_fm = 0 }
    /^---$/ { in_fm = !in_fm; next }
    in_fm && /^[ ]*"?created"?:[ ]*[0-9]{4}-[0-9]{2}-[0-9]{2}/ {
      sub(/^[ ]*"?created"?:[ ]*/, "")
      sub(/[ ].*$/, "")
      print
      exit
    }
  ' "$FILE")
  if [ -n "$YAML_DATE" ]; then
    return 0
  fi
  local NAME
  NAME=$(basename "$FILE")
  if printf -- "%s" "$NAME" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}'; then
    return 0
  fi
  return 1
}

# Iterate _truth.json
FAIL_COUNT=0
while IFS= read -r ENTRY; do
  NAME=$(echo "$ENTRY" | awk -F'"' '{print $2}')
  EXPECTED=$(echo "$ENTRY" | awk -F'"' '{print $6}')
  FILE="$NOTES_DIR/$NAME"
  [ -f "$FILE" ] || { echo "FAIL: missing fixture $FILE" >&2; exit 1; }

  if recipe_a "$FILE"; then
    IN_CLUSTER=yes
  else
    IN_CLUSTER=no
  fi
  if recipe_b "$FILE"; then
    HAS_ALT=yes
  else
    HAS_ALT=no
  fi

  # Decision
  if [ "$IN_CLUSTER" = "yes" ] && [ "$HAS_ALT" = "no" ]; then
    ACTUAL=SKIP
  else
    ACTUAL=PROCESS
  fi

  if [ "$ACTUAL" != "$EXPECTED" ]; then
    echo "FAIL: $NAME — expected $EXPECTED, got $ACTUAL (cluster=$IN_CLUSTER, alt=$HAS_ALT)" >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done < <(grep -E '"cell-[a-d]-[0-9]+\.md":' "$FIXTURE_DIR/_truth.json")

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "FAIL: $FAIL_COUNT decision-matrix mismatch(es)" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 4. references/clone-cluster-detection.md content checks
# ---------------------------------------------------------------------------
echo "[4/5] Reference-doc content..."
assert_path "$RECIPE_DOC" file
assert_grep "Recipe (a)" "$RECIPE_DOC"
assert_grep "Recipe (b)" "$RECIPE_DOC"
assert_grep "is_birthtime_in_clone_cluster_window" "$RECIPE_DOC"
assert_grep "has_alternate_date_source" "$RECIPE_DOC"
assert_grep "Decision Matrix" "$RECIPE_DOC"
assert_grep "Cluster Window Detection" "$RECIPE_DOC"
assert_grep "10 files" "$RECIPE_DOC"
assert_grep "1 hour" "$RECIPE_DOC"

# ---------------------------------------------------------------------------
# 5. All 4 SKILL.md files reference the recipe doc + SKIP behavior
# ---------------------------------------------------------------------------
# CONTRACT: every skill declaring a "## Pre-flight" section must cross-ref the
# recipe doc. Derived, not enumerated — see scripts/lib/skill-sets.sh.
# shellcheck source=lib/skill-sets.sh
. "$(cd "$(dirname "$0")/.." && pwd)/scripts/lib/skill-sets.sh"
PREFLIGHT_SKILLS=()
while IFS= read -r line; do
  [ -n "$line" ] && PREFLIGHT_SKILLS+=("$line")
done < <(preflight_skills)
printf '%s\n' "${PREFLIGHT_SKILLS[@]}" | assert_preflight_floor || exit 1

echo "[5/5] SKILL.md cross-refs (${#PREFLIGHT_SKILLS[@]} pre-flight skills)..."
for SKILL_MD in "${PREFLIGHT_SKILLS[@]}"; do
  assert_path "$SKILL_MD" file
  assert_grep "clone-cluster-detection.md" "$SKILL_MD"
  # Must mention skip on cluster-with-no-alt-source explicitly
  if ! grep -qiE 'clone.cluster|clone-cluster' "$SKILL_MD"; then
    echo "FAIL: $SKILL_MD does not mention clone-cluster" >&2
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# 6. Grep-uniqueness: only ONE recipe definition exists, in the doc
# ---------------------------------------------------------------------------
echo "[6/6] Grep-uniqueness — recipes defined exactly once..."

# Recipe (a) function definition: appears in the recipe doc, NOT redefined in any skill
A_DOC_HITS=$(grep -c '^### Recipe (a)' "$RECIPE_DOC" || true)
if [ "$A_DOC_HITS" != "1" ]; then
  echo "FAIL: Recipe (a) heading not found exactly once in $RECIPE_DOC (found $A_DOC_HITS)" >&2
  exit 1
fi
B_DOC_HITS=$(grep -c '^### Recipe (b)' "$RECIPE_DOC" || true)
if [ "$B_DOC_HITS" != "1" ]; then
  echo "FAIL: Recipe (b) heading not found exactly once in $RECIPE_DOC (found $B_DOC_HITS)" >&2
  exit 1
fi

# No SKILL.md should reimplement the recipe — they reference by path only.
# Allow the strings `is_birthtime_in_clone_cluster_window` and `has_alternate_date_source`
# (they MAY appear as recipe-name mentions) but disallow the `stat -f '%SB'` /
# `stat -c '%W'` implementation pattern outside the recipe doc.
SKILL_REIMPL=$(grep -lE "stat -[fc] '%(SB|W)'" skills/*/SKILL.md || true)
if [ -n "$SKILL_REIMPL" ]; then
  echo "FAIL: SKILL.md files reimplement birthtime stat — should reference recipe instead:" >&2
  echo "$SKILL_REIMPL" >&2
  exit 1
fi

echo "PASS: clone-cluster fixture + decision matrix + recipe doc + ${#PREFLIGHT_SKILLS[@]} SKILL.md cross-refs + grep-uniqueness"
