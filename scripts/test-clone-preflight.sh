#!/usr/bin/env bash
# scripts/test-clone-preflight.sh
#
# Regression test for the clone-cluster preflight.
#
# v0.1.4 W3 (F3 — robocopy preflight) introduced the preflight as a Windows-only
# Step 7 inside windows-preflight.md.
# v0.1.5 extracts it to its own cross-platform reference (clone-preflight.md)
# so macOS and Linux users also get the WARN. Detector script unchanged
# (already cross-platform); SKILL.md preflight blocks invoke clone-preflight
# unconditionally; windows-preflight.md keeps Steps 1-6 (registry +
# trailing-dot + enumeration) without the clone-cluster step.
#
# What it asserts (in order, fail-fast):
#   1. scripts/detect-clone-cluster.sh exists and is executable.
#   2. Detector against W2 fixture (tests/fixtures/clone-cluster/notes/) emits
#      CLUSTER_FOUND=yes with a window enclosing the fixture's center_utc and
#      a CLUSTER_FILE_COUNT >= 10 (the configured cluster floor).
#   3. Detector against a synthetic no-cluster directory (5 files, all touched
#      now — under the 10-file floor) emits CLUSTER_FOUND=no.
#   4. Detector against an empty directory emits CLUSTER_FOUND=no.
#   5. references/clone-preflight.md exists, emits WARN (not STOP), references
#      the detector script, references clone-cluster-detection.md for the
#      runtime SKIP-gate, and explicitly states cross-platform applicability.
#   6. references/clone-cluster-detection.md cross-references the detector
#      script AND cross-references clone-preflight.md as the user-facing WARN
#      (v0.1.5 cross-platform extraction contract).
#   7. docs/windows-considerations.md + docs/cloning-guide.md no longer claim
#      robocopy /COPY:DAT preserves CreationTime unconditionally — they must
#      reflect empirical reality (clone-cluster observed 2026-05-01).
#   8. logs/changelog.md has a v0.1.4 W3 entry (historical) AND a v0.1.5 entry
#      for the cross-platform extraction.
#   9. references/windows-preflight.md no longer contains a "Step 7" heading
#      (the clone-cluster step was extracted) — Step 6 is the last step.
#  10. EVERY SKILL.md that declares a "## Pre-flight" section invokes
#      clone-preflight.md
#      UNCONDITIONALLY (i.e., the cross-platform invocation is not gated by
#      "if running on Windows"). This is the v0.1.5 behavior contract: macOS
#      and Linux users must see the WARN.
#
# Exit 0 on PASS. Exit 1 on first failure with a contextual message.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

DETECTOR="scripts/detect-clone-cluster.sh"
W2_FIXTURE="tests/fixtures/clone-cluster"
WINDOWS_PREFLIGHT="references/windows-preflight.md"
CLONE_PREFLIGHT="references/clone-preflight.md"
RECIPE_DOC="references/clone-cluster-detection.md"
WINDOWS_CONSIDERATIONS="docs/windows-considerations.md"
CLONING_GUIDE="docs/cloning-guide.md"
CHANGELOG="logs/changelog.md"

# shellcheck source=lib/skill-sets.sh
. "$REPO_ROOT/scripts/lib/skill-sets.sh"

# CONTRACT, not a pin: the subject set is every skill that declares a
# Pre-flight section, derived at run time. Until 2026-09-21 this was a
# hardcoded list of four while six skills carried the section — the two
# uncovered ones (note-quality-check, property-classify) happened to satisfy
# the contract, so the blindness cost nothing. It was still blindness.
PREFLIGHT_SKILLS=()
while IFS= read -r line; do
  [ -n "$line" ] && PREFLIGHT_SKILLS+=("$line")
done < <(preflight_skills)

printf '%s\n' "${PREFLIGHT_SKILLS[@]}" | assert_preflight_floor || exit 1

assert_path() {
  local path="$1"; local kind="$2"
  case "$kind" in
    file) [ -f "$path" ] || { echo "FAIL: missing file: $path" >&2; exit 1; } ;;
    exec) [ -x "$path" ] || { echo "FAIL: not executable: $path" >&2; exit 1; } ;;
  esac
}

assert_grep() {
  local needle="$1"; local file="$2"
  grep -qF "$needle" "$file" || { echo "FAIL: '$needle' not found in $file" >&2; exit 1; }
}

assert_grep_re() {
  local re="$1"; local file="$2"
  grep -qE "$re" "$file" || { echo "FAIL: pattern '$re' not found in $file" >&2; exit 1; }
}

refute_grep() {
  local needle="$1"; local file="$2"
  if grep -qF "$needle" "$file"; then
    echo "FAIL: '$needle' should NOT appear in $file" >&2
    exit 1
  fi
}

refute_grep_re() {
  local re="$1"; local file="$2"
  if grep -qE "$re" "$file"; then
    echo "FAIL: pattern '$re' should NOT appear in $file" >&2
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# 1. Detector exists + executable
# ---------------------------------------------------------------------------
echo "[1/10] Detector script presence + perms..."
assert_path "$DETECTOR" file
assert_path "$DETECTOR" exec

# ---------------------------------------------------------------------------
# 2. Detector against W2 cluster fixture → CLUSTER_FOUND=yes
# ---------------------------------------------------------------------------
echo "[2/10] Detector against W2 cluster fixture..."

# Regenerate the W2 fixture so birthtimes are deterministic
bash "$W2_FIXTURE/generate.sh" >/dev/null

# Capture detector output, eval into env
OUT=$("$DETECTOR" "$W2_FIXTURE/notes")
eval "$OUT"

if [ "${CLUSTER_FOUND:-}" != "yes" ]; then
  echo "FAIL: expected CLUSTER_FOUND=yes against W2 fixture, got '${CLUSTER_FOUND:-<unset>}'" >&2
  echo "  Detector output: $OUT" >&2
  exit 1
fi

if [ -z "${CLONE_CLUSTER_WINDOW_START:-}" ] || [ -z "${CLONE_CLUSTER_WINDOW_END:-}" ]; then
  echo "FAIL: detector did not emit window bounds" >&2
  echo "  Detector output: $OUT" >&2
  exit 1
fi

# CLUSTER_FILE_COUNT must be >= 10 (the configured floor)
if [ "${CLUSTER_FILE_COUNT:-0}" -lt 10 ]; then
  echo "FAIL: CLUSTER_FILE_COUNT=$CLUSTER_FILE_COUNT below floor (10) on W2 fixture" >&2
  exit 1
fi

# Window must be sane ISO 8601 ending in Z
if ! printf -- "%s" "$CLONE_CLUSTER_WINDOW_START" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'; then
  echo "FAIL: window start is not ISO 8601 UTC: $CLONE_CLUSTER_WINDOW_START" >&2
  exit 1
fi
if ! printf -- "%s" "$CLONE_CLUSTER_WINDOW_END" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'; then
  echo "FAIL: window end is not ISO 8601 UTC: $CLONE_CLUSTER_WINDOW_END" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. Detector against synthetic no-cluster dir → CLUSTER_FOUND=no
# ---------------------------------------------------------------------------
echo "[3/10] Detector against synthetic no-cluster dir..."

NO_CLUSTER_DIR=$(mktemp -d -t ova-w3-XXXXXX)
trap 'rm -rf "$NO_CLUSTER_DIR"' EXIT

# Create 5 .md files (under the 10-file cluster floor — even if all share
# birthtime, the floor blocks the cluster verdict).
for i in 1 2 3 4 5; do
  printf -- "# note %d\n" "$i" > "$NO_CLUSTER_DIR/note-$i.md"
done

OUT=$("$DETECTOR" "$NO_CLUSTER_DIR")
# Reset captured vars from previous block
unset CLUSTER_FOUND CLONE_CLUSTER_WINDOW_START CLONE_CLUSTER_WINDOW_END CLUSTER_FILE_COUNT
eval "$OUT"
if [ "${CLUSTER_FOUND:-}" != "no" ]; then
  echo "FAIL: expected CLUSTER_FOUND=no for 5-file dir (under floor), got '${CLUSTER_FOUND:-<unset>}'" >&2
  echo "  Detector output: $OUT" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 4. Detector against empty dir → CLUSTER_FOUND=no
# ---------------------------------------------------------------------------
echo "[4/10] Detector against empty dir..."

EMPTY_DIR=$(mktemp -d -t ova-w3-empty-XXXXXX)
OUT=$("$DETECTOR" "$EMPTY_DIR")
unset CLUSTER_FOUND CLONE_CLUSTER_WINDOW_START CLONE_CLUSTER_WINDOW_END CLUSTER_FILE_COUNT
eval "$OUT"
if [ "${CLUSTER_FOUND:-}" != "no" ]; then
  echo "FAIL: expected CLUSTER_FOUND=no for empty dir, got '${CLUSTER_FOUND:-<unset>}'" >&2
  exit 1
fi
rm -rf "$EMPTY_DIR"

# ---------------------------------------------------------------------------
# 5. clone-preflight.md is the WARN-flow doc (extracted from windows-preflight.md
#    in v0.1.5)
# ---------------------------------------------------------------------------
echo "[5/10] clone-preflight.md WARN-flow content..."
assert_path "$CLONE_PREFLIGHT" file
assert_grep "detect-clone-cluster.sh" "$CLONE_PREFLIGHT"
assert_grep_re "WARN" "$CLONE_PREFLIGHT"
assert_grep "clone-cluster-detection.md" "$CLONE_PREFLIGHT"
assert_grep_re "(proceed|continue)" "$CLONE_PREFLIGHT"
# Cross-platform applicability MUST be explicit — that is the whole point of v0.1.5
assert_grep_re "(cross-platform|every OS|macOS|Linux)" "$CLONE_PREFLIGHT"
# Must NOT be gated by IS_WINDOWS / Windows-only
refute_grep_re "Windows[- ]only" "$CLONE_PREFLIGHT"

# ---------------------------------------------------------------------------
# 6. clone-cluster-detection.md cross-refs detector AND clone-preflight.md
# ---------------------------------------------------------------------------
echo "[6/10] clone-cluster-detection.md cross-refs..."
assert_grep "scripts/detect-clone-cluster.sh" "$RECIPE_DOC"
# v0.1.5 contract: WARN reference now points to clone-preflight.md, not windows-preflight.md
assert_grep "clone-preflight.md" "$RECIPE_DOC"

# ---------------------------------------------------------------------------
# 7. False robocopy-preserves-CreationTime claims removed
# ---------------------------------------------------------------------------
echo "[7/10] Cross-doc false-claim retraction..."
refute_grep "Yes — preserved from source" "$WINDOWS_CONSIDERATIONS"
refute_grep "Yes — preserved from source" "$CLONING_GUIDE"
assert_grep "clone-cluster-detection.md" "$WINDOWS_CONSIDERATIONS"
assert_grep "clone-cluster-detection.md" "$CLONING_GUIDE"

# ---------------------------------------------------------------------------
# 8. Changelog has v0.1.4 W3 (historical) and v0.1.5 (cross-platform) entries
# ---------------------------------------------------------------------------
echo "[8/10] Changelog v0.1.4 W3 + v0.1.5 entries..."
assert_grep_re "v0\.1\.4 W3" "$CHANGELOG"
assert_grep_re "v0\.1\.5" "$CHANGELOG"

# ---------------------------------------------------------------------------
# 9. windows-preflight.md no longer has Step 7 (extracted to clone-preflight.md)
# ---------------------------------------------------------------------------
echo "[9/10] windows-preflight.md is Steps 1-6 only (no Step 7)..."
assert_path "$WINDOWS_PREFLIGHT" file
# Step 6 must still be there
assert_grep_re "^## Step 6" "$WINDOWS_PREFLIGHT"
# Step 7 must NOT be there as a heading
refute_grep_re "^## Step 7" "$WINDOWS_PREFLIGHT"
# But the file must point readers at clone-preflight.md so they don't think
# the cross-platform check is missing — explicit cross-link required
assert_grep "clone-preflight.md" "$WINDOWS_PREFLIGHT"

# ---------------------------------------------------------------------------
# 10. EVERY pre-flight skill invokes clone-preflight UNCONDITIONALLY (not
#     gated by Windows). This is the v0.1.5 behavior contract: macOS and
#     Linux users must see the WARN. Subject set derived, floor-checked.
# ---------------------------------------------------------------------------
echo "[10/10] ${#PREFLIGHT_SKILLS[@]} SKILL.md preflight blocks invoke clone-preflight unconditionally..."
for skill in "${PREFLIGHT_SKILLS[@]}"; do
  assert_path "$skill" file
  # Must reference clone-preflight.md
  assert_grep "clone-preflight.md" "$skill"
  # Must reference windows-preflight.md too (Steps 1-6 still apply on Windows)
  assert_grep "windows-preflight.md" "$skill"
  # Must NOT contain a stale "Step 7" reference (extraction is complete)
  refute_grep_re "Step 7" "$skill"
  # Cross-platform language: "every OS" or "Always" outside an "if Windows" gate
  # Heuristic: the unconditional invocation must use either "Always" or
  # "every OS" near the clone-preflight reference. The previous wording ("if
  # running on Windows, ... clone-cluster preflight WARN at Step 7") would
  # not satisfy this — that pattern gated everything on Windows.
  if ! awk '
    /clone-preflight\.md/ {
      # Look at the surrounding 3 lines for an unconditional marker
      ctx = prev2 prev1 $0 next1 next2
      if (ctx ~ /(Always|every OS|every operating system|Cross-platform|cross-platform|macOS, Linux, and Windows|on macOS, Linux, and Windows)/) {
        found = 1
      }
    }
    { prev2 = prev1; prev1 = $0 }
    END { exit found ? 0 : 1 }
  ' "$skill"; then
    # Re-read the full pre-flight section to give a useful failure message
    echo "FAIL: $skill — clone-preflight.md is referenced, but the surrounding text" >&2
    echo "      does not declare it as cross-platform / unconditional. The v0.1.5" >&2
    echo "      contract requires the invocation to apply on macOS, Linux, AND Windows." >&2
    exit 1
  fi
done

echo
echo "PASS: detector + clone-preflight.md WARN-flow + cross-platform SKILL.md invocation + cross-doc retractions + changelog"
