#!/usr/bin/env bash
# Assertion harness for recipe-(g) canonical property order (block-aware reorder).
# Mirrors scripts/test-recipe-f-duplicate-keys.sh structure.

set -u
set -o pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE_ROOT="${REPO_ROOT}/tests/fixtures/recipe-g-property-order"
CASES="${FIXTURE_ROOT}/cases"
VALIDATOR="${REPO_ROOT}/scripts/validate-recipe-g.py"
EDITS="${REPO_ROOT}/references/yaml-edits.md"

PASS=0
FAIL=0

ok()   { echo "  PASS: $*"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL+1)); }

# ─── Section [1/5] Fixture structure ─────────────────────────────────────────
echo "[1/5] Fixture structure"

[ -d "$CASES" ] && ok "cases/ exists" || fail "cases/ missing"
[ -f "${FIXTURE_ROOT}/README.md" ] && ok "README.md exists" || fail "README.md missing"
[ -f "$VALIDATOR" ] && ok "validate-recipe-g.py exists" || fail "validate-recipe-g.py missing"

for cell in 01-title-last-goes-first 02-description-second 03-custom-preserved-order \
            04-aliases-block-no-orphan 05-already-canonical-idempotent \
            06-blank-lines-removed 07-comment-preserved 08-folded-scalar-intact; do
  [ -f "${CASES}/${cell}/in.md" ] && ok "${cell}/in.md exists" || fail "${cell}/in.md missing"
  [ -f "${CASES}/${cell}/expected.md" ] && ok "${cell}/expected.md exists" || fail "${cell}/expected.md missing"
done

# ─── Section [2/5] Validator (golden fixtures + in-memory invariants) ─────────
echo "[2/5] Validator — golden fixtures + selftest invariants"

if command -v python3 >/dev/null 2>&1; then
  if python3 "$VALIDATOR" > /tmp/recipe-g-out.txt 2>&1; then
    ok "validate-recipe-g.py exit 0 (all cases + selftest pass)"
  else
    fail "validate-recipe-g.py NON-zero exit:"
    sed 's/^/    /' /tmp/recipe-g-out.txt
  fi
  grep -q "SELFTEST: all invariants pass" /tmp/recipe-g-out.txt \
    && ok "selftest invariants pass (CRLF/BOM/no-frontmatter/idempotency)" \
    || fail "selftest invariants did not all pass"
  grep -q "FAIL " /tmp/recipe-g-out.txt \
    && fail "at least one fixture case FAILed" \
    || ok "no fixture case FAILed"
else
  fail "python3 not available"
fi

# ─── Section [3/5] yaml-edits.md recipe-(g) content claims ────────────────────
echo "[3/5] yaml-edits.md content claims"

grep -q "Recipe (g) — Canonical property order" "$EDITS" && ok "recipe (g) heading present" || fail "recipe (g) heading missing"
grep -q "Reorder UNITS" "$EDITS" && ok "reorder-units (orphan-safety) rule present" || fail "reorder-units rule missing"
grep -q "reorder only" "$EDITS" && ok "scope (reorder-only) clause present" || fail "scope clause missing"
grep -q "scripts/validate-recipe-g.py" "$EDITS" && ok "reference-implementation pointer present" || fail "reference-impl pointer missing"
grep -q "DO NOT — line-sort orphan pattern" "$EDITS" && ok "DO NOT line-sort anti-pattern present" || fail "DO NOT anti-pattern missing"
grep -q "last: \`tags\`" "$EDITS" && ok "tags-last trailer documented" || fail "tags-last trailer missing"

# ─── Section [4/5] Recipe (c) cross-reference ─────────────────────────────────
echo "[4/5] Recipe (c) cross-reference"

grep -q "Insert with (c); reorder with (g)" "$EDITS" && ok "recipe-c -> recipe-g finalize cross-ref present" || fail "recipe-c cross-ref missing"

# ─── Section [5/5] property-enrich SKILL.md integration ───────────────────────
echo "[5/5] property-enrich SKILL.md integration"

PE="${REPO_ROOT}/skills/property-enrich/SKILL.md"
grep -q "Finalize canonical property order (recipe g)" "$PE" && ok "property-enrich applies recipe (g) as finalize step" || fail "property-enrich missing recipe (g) finalize step"
grep -q "Canonical property order" "$PE" && ok "property-enrich documents canonical order" || fail "property-enrich missing canonical-order section"
grep -qF 'YYYY-MM-DD HH:MM' "$PE" && ok "property-enrich writes modified with HH:MM" || fail "property-enrich missing HH:MM modified format"

# ─── Summary ──────────────────────────────────────────────────────────────────
echo
echo "──────────────────────────────────────────"
echo "PASS: ${PASS}"
echo "FAIL: ${FAIL}"
echo "──────────────────────────────────────────"

[ "$FAIL" -eq 0 ]
