#!/usr/bin/env bash
# v0.1.4 W4 assertion harness for recipe-(f) duplicate-key resolution policy.
# Mirrors scripts/test-clone-cluster.sh structure (W2). 6 sections.

set -u
set -o pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE_ROOT="${REPO_ROOT}/tests/fixtures/recipe-f-duplicate-keys"
NOTES="${FIXTURE_ROOT}/notes"
TRUTH="${FIXTURE_ROOT}/_truth.json"

PASS=0
FAIL=0

ok()   { echo "  PASS: $*"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL+1)); }

# ─── Section [1/6] Fixture structure ─────────────────────────────────────────
echo "[1/6] Fixture structure"

[ -d "$NOTES" ] && ok "notes/ exists" || fail "notes/ missing"
[ -f "$TRUTH" ] && ok "_truth.json exists" || fail "_truth.json missing"
[ -f "${FIXTURE_ROOT}/README.md" ] && ok "README.md exists" || fail "README.md missing"

for cell in cell-A-divergent-inside-colon cell-B-identical-inside-colon cell-C-divergent-plain cell-D-identical-plain cell-E-control-no-duplicates; do
  [ -f "${NOTES}/${cell}.md" ] && ok "${cell}.md exists" || fail "${cell}.md missing"
done

# ─── Section [2/6] Decision matrix per fixture ───────────────────────────────
echo "[2/6] Decision matrix — per-cell verdict simulation against _truth.json"

# Inline simulation: walk the YAML frontmatter, detect (a) shape-β inside-colon
# patterns, (b) duplicate-key collisions on the post-normalize view, (c)
# divergent-vs-identical sub-case. Compute the verdict per Pattern 1 + Pattern 5
# in references/yaml-sanity.md.

extract_frontmatter() {
  local file="$1"
  awk '
    BEGIN { in_fm = 0; fm_seen = 0 }
    /^---$/ {
      if (fm_seen == 0) { fm_seen = 1; in_fm = 1; next }
      else if (in_fm == 1) { in_fm = 0; next }
    }
    in_fm == 1 { print }
  ' "$file"
}

verdict_for() {
  local file="$1"
  local fm
  fm=$(extract_frontmatter "$file")

  # Detect shape-β inside-colon lines.
  local shape_b_count
  shape_b_count=$(printf '%s\n' "$fm" | grep -cE '^[[:space:]]*"[^"]+:"[[:space:]]*:' || true)

  # Build post-normalize view: replace shape-β `"<key>:":<value>` with `<key>:<value>`.
  local normalized
  normalized=$(printf '%s\n' "$fm" | sed -E 's/^([[:space:]]*)"([^"]+):"[[:space:]]*:(.*)$/\1\2:\3/')

  # Extract key-name per line (strip whitespace + value).
  local keys
  keys=$(printf '%s\n' "$normalized" | sed -nE 's/^[[:space:]]*([A-Za-z_][A-Za-z0-9_-]*)[[:space:]]*:.*$/\1/p')

  # Find duplicates.
  local dup_keys
  dup_keys=$(printf '%s\n' "$keys" | sort | uniq -d)

  if [ -n "$dup_keys" ]; then
    # For each dup key, compare values.
    local divergent=0
    local dk
    while IFS= read -r dk; do
      [ -z "$dk" ] && continue
      local vals
      vals=$(printf '%s\n' "$normalized" | awk -v k="$dk" '
        {
          line = $0
          sub(/^[[:space:]]+/, "", line)
          sub(/[[:space:]]*#.*$/, "", line)
          if (match(line, "^" k "[[:space:]]*:")) {
            v = substr(line, RLENGTH + 1)
            sub(/^[[:space:]]+/, "", v)
            sub(/[[:space:]]+$/, "", v)
            print v
          }
        }')
      local distinct
      distinct=$(printf '%s\n' "$vals" | sort -u | wc -l | tr -d ' ')
      if [ "$distinct" -gt 1 ]; then
        divergent=1
      fi
    done <<<"$dup_keys"

    if [ "$divergent" -eq 1 ]; then
      echo "DUPLICATE_KEYS_DIVERGENT_VALUES"; return
    fi
    if [ "$shape_b_count" -gt 0 ]; then
      echo "BROKEN_KEYS_INSIDE_COLON"; return
    fi
    echo "DUPLICATE_KEYS_IDENTICAL_VALUES"; return
  fi

  if [ "$shape_b_count" -gt 0 ]; then
    echo "BROKEN_KEYS_INSIDE_COLON"; return
  fi
  echo "OK"
}

# Bash 3.2-compatible parallel arrays (macOS default bash has no `declare -A`).
CELLS=(
  "cell-A-divergent-inside-colon"
  "cell-B-identical-inside-colon"
  "cell-C-divergent-plain"
  "cell-D-identical-plain"
  "cell-E-control-no-duplicates"
)
EXPECTED_VERDICTS=(
  "DUPLICATE_KEYS_DIVERGENT_VALUES"
  "BROKEN_KEYS_INSIDE_COLON"
  "DUPLICATE_KEYS_DIVERGENT_VALUES"
  "DUPLICATE_KEYS_IDENTICAL_VALUES"
  "OK"
)

i=0
while [ "$i" -lt "${#CELLS[@]}" ]; do
  cell="${CELLS[$i]}"
  expected="${EXPECTED_VERDICTS[$i]}"
  actual=$(verdict_for "${NOTES}/${cell}.md")
  if [ "$actual" = "$expected" ]; then
    ok "${cell}.md → ${actual}"
  else
    fail "${cell}.md → expected ${expected}, got ${actual}"
  fi
  i=$((i+1))
done

# ─── Section [3/6] Recipe-doc content claims (yaml-edits.md) ────────────────
echo "[3/6] yaml-edits.md content claims"

EDITS="${REPO_ROOT}/references/yaml-edits.md"

grep -q "ABORT recipe (f) for this file" "$EDITS" && ok "step 3 sub-case (d) ABORT language present" || fail "step 3 sub-case (d) ABORT language missing"
grep -q "duplicate-key-removed-identical" "$EDITS" && ok "Class-D identical-collision finding category present" || fail "Class-D identical-collision finding category missing"
grep -q "duplicate-key-divergent-values" "$EDITS" && ok "Class-A divergent finding category present" || fail "Class-A divergent finding category missing"
grep -q "Worked example A — recipe (f) identical-value collision" "$EDITS" && ok "worked example A heading present" || fail "worked example A heading missing"
grep -q "Worked example B — recipe (f) divergent-value collision" "$EDITS" && ok "worked example B heading present" || fail "worked example B heading missing"
grep -qF "duplicate-key removed: created (kept original quoted-form value 2024-03-14, removed plain-form value 2025-01-01)" "$EDITS" && fail "old contradicting worked-example finding-text still present" || ok "old contradicting worked-example finding-text removed"

# ─── Section [4/6] Sanity-doc content claims (yaml-sanity.md) ───────────────
echo "[4/6] yaml-sanity.md content claims"

SANITY="${REPO_ROOT}/references/yaml-sanity.md"

grep -q "DUPLICATE_KEYS_DIVERGENT_VALUES" "$SANITY" && ok "new verdict DUPLICATE_KEYS_DIVERGENT_VALUES present" || fail "new verdict DUPLICATE_KEYS_DIVERGENT_VALUES missing"
grep -q "DUPLICATE_KEYS_IDENTICAL_VALUES" "$SANITY" && ok "new verdict DUPLICATE_KEYS_IDENTICAL_VALUES present" || fail "new verdict DUPLICATE_KEYS_IDENTICAL_VALUES missing"
grep -q "Pattern 5 — Duplicate-key detection" "$SANITY" && ok "Pattern 5 section present" || fail "Pattern 5 section missing"
grep -qE "MULTIPLE_FRONTMATTER_BLOCKS.*UNCLOSED_FRONTMATTER.*INVALID_YAML.*DUPLICATE_KEYS_DIVERGENT_VALUES.*BROKEN_KEYS_INSIDE_COLON.*DUPLICATE_KEYS_IDENTICAL_VALUES" "$SANITY" && ok "verdict-priority ladder updated correctly" || fail "verdict-priority ladder missing or wrong order"
grep -q "Exception — divergent-value abort path" "$SANITY" && ok "idempotency exception clause present" || fail "idempotency exception clause missing"

# ─── Section [5/6] SKILL.md cross-references (4 launch-scope skills) ────────
echo "[5/6] SKILL.md cross-references"

# DELIBERATE PIN — do not convert this to the derived pre-flight set.
# Measured 2026-09-21: note-quality-check declares a "## Pre-flight" section,
# so it IS in that population, and it handles the recipe-(f) verdict family
# correctly — but GROUPED (five corruption verdicts routed in one clause)
# rather than per-verdict, so it names the verdict once and never names the
# finding-category slug. The ">= 2 hits" threshold below measures the document
# SHAPE of the four launch-scope skills, not the behavioural contract.
# Deriving here would turn this gate red on a skill that does the right thing.
# That residual — nothing asserts note-quality-check's grouped handling at all
# — is a coverage gap filed as a finding, not something to paper over here.
for skill in property-enrich note-rename inbox-sort property-describe; do
  SKILL_FILE="${REPO_ROOT}/skills/${skill}/SKILL.md"
  [ -f "$SKILL_FILE" ] || { echo "  FAIL: pinned subject missing: $SKILL_FILE"; FAIL=$((FAIL+1)); continue; }
  # Count occurrences (not lines) — both strings often co-occur on one line.
  count=$(grep -oE "DUPLICATE_KEYS_DIVERGENT_VALUES|duplicate-key-divergent-values" "$SKILL_FILE" | wc -l | tr -d ' ')
  if [ "$count" -ge 2 ]; then
    ok "${skill}/SKILL.md references new verdict + finding category (${count} hits)"
  else
    fail "${skill}/SKILL.md missing new verdict references (${count} hits, need ≥ 2)"
  fi
done

# ─── Section [6/6] Grep-uniqueness — single-source-of-truth enforcement ─────
echo "[6/6] Grep-uniqueness"

# DUPLICATE_KEYS_DIVERGENT_VALUES verdict definition lives in yaml-sanity.md only.
# Skills + recipe-doc REFERENCE the verdict by name; they do not redefine it.
# Test: count occurrences of the literal "Verdict | Meaning | Action" table-style
# row defining the verdict — expect exactly 1.
verdict_def_count=$(grep -c "^| \`DUPLICATE_KEYS_DIVERGENT_VALUES\` |" "$SANITY")
if [ "$verdict_def_count" -eq 1 ]; then
  ok "DUPLICATE_KEYS_DIVERGENT_VALUES defined exactly once in yaml-sanity.md verdicts table"
else
  fail "DUPLICATE_KEYS_DIVERGENT_VALUES defined ${verdict_def_count} times (expected 1)"
fi

# Recipe-(f) Step 3 branching logic lives in yaml-edits.md only.
# Test: count occurrences of "ABORT recipe (f) for this file" — expect exactly 2:
# (1) the canonical algorithm statement in step 3 sub-case (d), and
# (2) the worked-example B procedure step 5 referencing the same sub-case.
# Both legitimate (canonical + demonstration); no third occurrence in skills or other docs.
abort_def_count=$(grep -c "ABORT recipe (f) for this file" "$EDITS")
if [ "$abort_def_count" -eq 2 ]; then
  ok "Recipe (f) ABORT clause defined in yaml-edits.md (canonical + worked-example B = 2 hits)"
else
  fail "Recipe (f) ABORT clause appears ${abort_def_count} times in yaml-edits.md (expected 2)"
fi

# Verify the ABORT clause does NOT leak into skills (single-source-of-truth across docs).
abort_skill_leak=$(grep -l "ABORT recipe (f) for this file" "${REPO_ROOT}"/skills/*/SKILL.md 2>/dev/null || true)
if [ -z "$abort_skill_leak" ]; then
  ok "Recipe (f) ABORT clause does not leak into any SKILL.md"
else
  fail "Recipe (f) ABORT clause leaked into: ${abort_skill_leak}"
fi

# ─── Summary ────────────────────────────────────────────────────────────────
echo
echo "──────────────────────────────────────────"
echo "PASS: ${PASS}"
echo "FAIL: ${FAIL}"
echo "──────────────────────────────────────────"

[ "$FAIL" -eq 0 ]
