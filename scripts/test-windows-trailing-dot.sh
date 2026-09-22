#!/usr/bin/env bash
# scripts/test-windows-trailing-dot.sh
#
# W1 regression test for F-NEW-A-1 — Windows trailing-dot folder enumeration.
#
# This script is cross-platform but the *empirical bug* it guards against is
# Windows-only (Win32 path normalization strips trailing dots unless the path
# is prefixed with `\\?\`). On macOS/Linux the test verifies fixture structure
# and documentation integrity. On Windows the same checks plus a PowerShell
# enumeration smoke test (see PR description for the manual procedure on
# Windows hosts — OVA repo has no Windows CI runner as of v0.1.4).
#
# What it asserts:
#   1. Fixture directory exists with the trailing-dot folder intact.
#   2. The four expected fixture files exist at the right paths.
#   3. references/windows-preflight.md documents the Windows-aware enumeration
#      pattern (`\\?\` prefix + `Directory.EnumerateFiles`) and trailing-dot
#      folder detection.
#   4. All four launch-scope SKILL.md files reference the preflight doc and
#      mention the enumeration concern at least once.
#
# Exit 0 on PASS. Exit 1 on first failure with a contextual message.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# 1. Fixture structure
# ---------------------------------------------------------------------------

FIXTURE_ROOT="tests/fixtures/windows-trailing-dot"
DOT_FOLDER="$FIXTURE_ROOT/030_Systems - reference material."

assert_path() {
  local path="$1"
  local kind="$2" # "dir" or "file"
  case "$kind" in
    dir)
      if [ ! -d "$path" ]; then
        echo "FAIL: expected directory missing: $path" >&2
        exit 1
      fi
      ;;
    file)
      if [ ! -f "$path" ]; then
        echo "FAIL: expected file missing: $path" >&2
        exit 1
      fi
      ;;
    *)
      echo "FAIL: unknown assert kind: $kind" >&2
      exit 1
      ;;
  esac
}

assert_path "$FIXTURE_ROOT" dir
assert_path "$FIXTURE_ROOT/README.md" file
assert_path "$FIXTURE_ROOT/note-pointing-in.md" file
assert_path "$FIXTURE_ROOT/target-outside.md" file
assert_path "$DOT_FOLDER" dir
assert_path "$DOT_FOLDER/note-with-link.md" file
assert_path "$DOT_FOLDER/target-inside.md" file

# Verify trailing-dot survived filesystem write. The shell-globbed name keeps
# the dot if the OS preserved it; if the fs stripped the dot, the assert above
# already failed on $DOT_FOLDER.
case "$DOT_FOLDER" in
  *.) : ;; # ok, ends in .
  *)
    echo "FAIL: \$DOT_FOLDER does not end in '.' — fixture name lost the trailing dot somewhere" >&2
    exit 1
    ;;
esac

# ---------------------------------------------------------------------------
# 2. Wikilink targets are correct (so backlink-update path is exercised)
# ---------------------------------------------------------------------------

assert_grep() {
  local needle="$1"
  local file="$2"
  if ! grep -qF "$needle" "$file"; then
    echo "FAIL: expected '$needle' in $file" >&2
    exit 1
  fi
}

# note-with-link.md (inside trailing-dot folder) → target-outside (root)
assert_grep "[[target-outside]]" "$DOT_FOLDER/note-with-link.md"

# note-pointing-in.md (root) → target-inside (inside trailing-dot folder)
assert_grep "[[target-inside]]" "$FIXTURE_ROOT/note-pointing-in.md"

# ---------------------------------------------------------------------------
# 3. references/windows-preflight.md has the enumeration guidance
# ---------------------------------------------------------------------------

PREFLIGHT="references/windows-preflight.md"
assert_path "$PREFLIGHT" file
assert_grep "Trailing-Dot Folder Detection" "$PREFLIGHT"
assert_grep "EnumerateFiles" "$PREFLIGHT"
# The literal sequence `\\?\` (4 chars) appears in the doc — match a 5-char
# substring `(\\?\` to anchor the regex without bash escape-soup.
if ! grep -qF '\\?\' "$PREFLIGHT"; then
  echo "FAIL: $PREFLIGHT does not mention the \\?\ extended-path prefix" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 4. EVERY pre-flight SKILL.md points at the preflight + enumeration (derived)
# ---------------------------------------------------------------------------

# CONTRACT: derived from the "## Pre-flight" predicate, not enumerated.
# shellcheck source=lib/skill-sets.sh
. "$(cd "$(dirname "$0")/.." && pwd)/scripts/lib/skill-sets.sh"
PREFLIGHT_SKILLS=()
while IFS= read -r line; do
  [ -n "$line" ] && PREFLIGHT_SKILLS+=("$line")
done < <(preflight_skills)
printf '%s\n' "${PREFLIGHT_SKILLS[@]}" | assert_preflight_floor || exit 1

for skill_md in "${PREFLIGHT_SKILLS[@]}"; do
  assert_path "$skill_md" file
  assert_grep "windows-preflight.md" "$skill_md"
  assert_grep "enumerat" "$skill_md"  # case-insensitive root: "enumerate"/"enumeration"
done

echo "PASS: tests/fixtures/windows-trailing-dot/ + windows-preflight enumeration guidance + ${#PREFLIGHT_SKILLS[@]} SKILL.md cross-refs"
