#!/usr/bin/env bash
# Behavioral assertion harness for the yaml-sanity verdict classifier
# (references/yaml-sanity.md). Phase 1 of the 2026-06-11 skill-hardening plan.
#
# Carries a faithful bash/awk reference implementation of the spec's detection
# patterns (Pattern 1 shape-beta, 1b shape-alpha, 2 multi-block fence-aware,
# 3 unclosed, 5 duplicate-keys post-normalize) plus the verdict-priority
# ladder, and asserts it against tests/fixtures/yaml-sanity-verdicts/ and the
# five historical repro files in test-data/.
#
# Mirrors scripts/test-recipe-f-duplicate-keys.sh structure. Bash 3.2 + BSD
# awk compatible (macOS default toolchain).

set -u
set -o pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE_ROOT="${REPO_ROOT}/tests/fixtures/yaml-sanity-verdicts"
NOTES="${FIXTURE_ROOT}/notes"
TRUTH="${FIXTURE_ROOT}/_truth.json"
SANITY="${REPO_ROOT}/references/yaml-sanity.md"
EDITS="${REPO_ROOT}/references/yaml-edits.md"

PASS=0
FAIL=0

ok()   { echo "  PASS: $*"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL+1)); }

# ─── Reference implementation of the verdict classifier ─────────────────────
# Implements the spec's Procedure + detection patterns. Where the spec and
# this implementation disagree on a truth cell, either the spec or this
# implementation has a gap — both are fixed together, the truth matrix never
# bends to the implementation.

classify() {
  awk '
    {
      line = $0
      sub(/\r$/, "", line)            # CRLF tolerance (rstrip semantics)
      lines[NR] = line
    }
    END {
      n = NR
      for (i = 1; i <= n; i++) {
        r = lines[i]
        sub(/[ \t]+$/, "", r)
        rs[i] = r
      }
      first = (n >= 1) ? rs[1] : ""
      bom = sprintf("%c%c%c", 239, 187, 191)   # UTF-8 BOM, portable across awks
      if (index(first, bom) == 1) first = substr(first, 4)  # strip before line-0 check

      # No frontmatter open at line 0: nothing to inspect.
      if (n == 0 || first != "---") { print "OK_NO_FRONTMATTER"; exit }

      # Find the frontmatter close.
      close_i = 0
      for (i = 2; i <= n; i++) if (rs[i] == "---") { close_i = i; break }

      # Pattern 3 — unclosed frontmatter (structural check BEFORE any
      # no-frontmatter early-return; an unclosed block is Class-A, not
      # "no frontmatter").
      if (close_i == 0) { print "UNCLOSED_FRONTMATTER"; exit }

      # Patterns 1 / 1b / 5 — walk frontmatter lines.
      shape_b = 0; shape_a = 0; nk = 0
      for (i = 2; i < close_i; i++) {
        l = lines[i]
        key = ""; rest = ""
        if (l ~ /^[ \t]*"[^"]+:"[ \t]*:/) {
          shape_b++
          tmp = l
          sub(/^[ \t]*"/, "", tmp)
          p = index(tmp, ":\"")
          key = substr(tmp, 1, p - 1)
          rest = substr(tmp, p + 2)
          sub(/^[ \t]*:/, "", rest)
        } else if (l ~ /^[ \t]*"[^":]+"[ \t]*:/) {
          shape_a++
          tmp = l
          sub(/^[ \t]*"/, "", tmp)
          p = index(tmp, "\"")
          key = substr(tmp, 1, p - 1)
          rest = substr(tmp, p + 1)
          sub(/^[ \t]*:/, "", rest)
        } else if (match(l, /^[ \t]*[A-Za-z_][A-Za-z0-9_-]*[ \t]*:/)) {
          key = substr(l, RSTART, RLENGTH)
          sub(/^[ \t]*/, "", key)
          sub(/[ \t]*:$/, "", key)
          rest = substr(l, RLENGTH + 1)
        }
        if (key != "") {
          v = rest
          sub(/[ \t]*#.*$/, "", v)     # strip trailing comment
          sub(/^[ \t]*/, "", v)
          sub(/[ \t]*$/, "", v)
          nk++
          keyname[nk] = key
          keyval[nk] = v
        }
      }

      # Pattern 5 — duplicate detection on the post-normalize view.
      divergent = 0; identical = 0
      for (i = 1; i <= nk; i++) {
        for (j = i + 1; j <= nk; j++) {
          if (keyname[i] == keyname[j]) {
            if (keyval[i] != keyval[j]) divergent = 1
            else identical = 1
          }
        }
      }

      # Pattern 2 — multi-block walk after the close, code-fence aware.
      multi = 0; fence = 0; open2 = 0
      for (i = close_i + 1; i <= n; i++) {
        if (rs[i] ~ /^```/) { fence = 1 - fence; continue }
        if (fence) continue
        if (rs[i] == "---") {
          if (open2 == 0) { open2 = i }
          else {
            keyish = 0
            for (k = open2 + 1; k < i; k++) {
              if (lines[k] ~ /^[ \t]*[A-Za-z_][A-Za-z0-9_-]*[ \t]*:/ ||
                  lines[k] ~ /^[ \t]*"[^"]+"[ \t]*:/) { keyish = 1; break }
            }
            if (keyish) { multi = 1; break }
            open2 = 0                  # horizontal-rule pair, keep scanning
          }
        }
      }

      # Verdict-priority ladder (yaml-sanity.md § Verdicts).
      if (multi)     { print "MULTIPLE_FRONTMATTER_BLOCKS"; exit }
      if (divergent) { print "DUPLICATE_KEYS_DIVERGENT_VALUES"; exit }
      if (shape_b)   { print "BROKEN_KEYS_INSIDE_COLON"; exit }
      if (identical) { print "DUPLICATE_KEYS_IDENTICAL_VALUES"; exit }
      if (shape_a)   { print "OK_QUOTED"; exit }
      print "OK"
    }
  ' "$1"
}

# ─── Section [1/6] Fixture structure ─────────────────────────────────────────
echo "[1/6] Fixture structure"

[ -d "$NOTES" ] && ok "notes/ exists" || fail "notes/ missing"
[ -f "$TRUTH" ] && ok "_truth.json exists" || fail "_truth.json missing"
[ -f "${FIXTURE_ROOT}/README.md" ] && ok "README.md exists" || fail "README.md missing"

cell_count=$(find "$NOTES" -name 'cell-*.md' | wc -l | tr -d ' ')
[ "$cell_count" -eq 18 ] && ok "18 cells present" || fail "expected 18 cells, found ${cell_count}"

# Encoding invariants — these cells are only meaningful with their bytes intact.
file "${NOTES}/cell-17-bom-frontmatter.md" | grep -q "BOM" \
  && ok "cell-17 carries UTF-8 BOM" || fail "cell-17 lost its BOM"
file "${NOTES}/cell-18-crlf-frontmatter.md" | grep -q "CRLF" \
  && ok "cell-18 carries CRLF endings" || fail "cell-18 lost its CRLF endings"

# ─── Section [2/6] Truth matrix — fixture cells ──────────────────────────────
echo "[2/6] Truth matrix — per-cell verdict vs _truth.json"

# Bash 3.2-compatible parallel arrays, mirroring _truth.json "cells".
CELLS=(
  "cell-01-ok-plain"
  "cell-02-ok-quoted-alpha"
  "cell-03-no-frontmatter"
  "cell-04-broken-inside-colon"
  "cell-05-mixed-alpha-beta"
  "cell-06-divergent-plain"
  "cell-07-identical-plain"
  "cell-08-identical-after-comment-strip"
  "cell-09-empty-vs-nonempty-dup"
  "cell-10-multi-frontmatter-blocks"
  "cell-11-body-horizontal-rules"
  "cell-12-yaml-in-code-fence"
  "cell-13-unclosed-frontmatter"
  "cell-14-beta-divergent-collision"
  "cell-15-beta-identical-collision"
  "cell-16-prose-colon-between-body-rules"
  "cell-17-bom-frontmatter"
  "cell-18-crlf-frontmatter"
)
EXPECTED=(
  "OK"
  "OK_QUOTED"
  "OK_NO_FRONTMATTER"
  "BROKEN_KEYS_INSIDE_COLON"
  "BROKEN_KEYS_INSIDE_COLON"
  "DUPLICATE_KEYS_DIVERGENT_VALUES"
  "DUPLICATE_KEYS_IDENTICAL_VALUES"
  "DUPLICATE_KEYS_IDENTICAL_VALUES"
  "DUPLICATE_KEYS_DIVERGENT_VALUES"
  "MULTIPLE_FRONTMATTER_BLOCKS"
  "OK"
  "OK"
  "UNCLOSED_FRONTMATTER"
  "DUPLICATE_KEYS_DIVERGENT_VALUES"
  "BROKEN_KEYS_INSIDE_COLON"
  "MULTIPLE_FRONTMATTER_BLOCKS"
  "OK"
  "OK"
)

i=0
while [ "$i" -lt "${#CELLS[@]}" ]; do
  cell="${CELLS[$i]}"
  expected="${EXPECTED[$i]}"
  if [ -f "${NOTES}/${cell}.md" ]; then
    actual=$(classify "${NOTES}/${cell}.md")
    if [ "$actual" = "$expected" ]; then
      ok "${cell}.md → ${actual}"
    else
      fail "${cell}.md → expected ${expected}, got ${actual}"
    fi
  else
    fail "${cell}.md missing"
  fi
  i=$((i+1))
done

# ─── Section [3/6] Truth matrix — historical repros (test-data/ wiring) ──────
echo "[3/6] Truth matrix — historical repro files"

REPROS=(
  "f2-repro"
  "f19-repro"
  "f25-repro"
  "f26-repro"
  "f26-mixed-shapes-repro"
)
REPRO_EXPECTED=(
  "OK"
  "BROKEN_KEYS_INSIDE_COLON"
  "OK_QUOTED"
  "DUPLICATE_KEYS_DIVERGENT_VALUES"
  "BROKEN_KEYS_INSIDE_COLON"
)

i=0
while [ "$i" -lt "${#REPROS[@]}" ]; do
  repro="${REPROS[$i]}"
  expected="${REPRO_EXPECTED[$i]}"
  f="${REPO_ROOT}/test-data/${repro}.md"
  if [ -f "$f" ]; then
    actual=$(classify "$f")
    if [ "$actual" = "$expected" ]; then
      ok "test-data/${repro}.md → ${actual}"
    else
      fail "test-data/${repro}.md → expected ${expected}, got ${actual}"
    fi
  else
    fail "test-data/${repro}.md missing"
  fi
  i=$((i+1))
done

# ─── Section [4/6] Script ↔ _truth.json consistency ─────────────────────────
echo "[4/6] Script arrays match _truth.json"

i=0
while [ "$i" -lt "${#CELLS[@]}" ]; do
  cell="${CELLS[$i]}"
  expected="${EXPECTED[$i]}"
  if grep -qF "\"${cell}\": \"${expected}\"" "$TRUTH"; then
    ok "truth entry: ${cell} = ${expected}"
  else
    fail "truth entry mismatch or missing for ${cell} (script expects ${expected})"
  fi
  i=$((i+1))
done

i=0
while [ "$i" -lt "${#REPROS[@]}" ]; do
  repro="${REPROS[$i]}"
  expected="${REPRO_EXPECTED[$i]}"
  if grep -qF "\"test-data/${repro}.md\": \"${expected}\"" "$TRUTH"; then
    ok "truth entry: ${repro} = ${expected}"
  else
    fail "truth entry mismatch or missing for ${repro} (script expects ${expected})"
  fi
  i=$((i+1))
done

# ─── Section [5/6] Spec content claims (the gaps this suite closes) ─────────
echo "[5/6] Spec content claims"

# (a) Procedure ordering: structural checks (Patterns 2 + 3) must run BEFORE
# the no-frontmatter early-return, otherwise an unclosed block exits as
# OK_NO_FRONTMATTER and recipe (c) corrupts the file further.
grep -q "before the no-frontmatter early-return" "$SANITY" \
  && ok "yaml-sanity.md: structural-before-early-return ordering documented" \
  || fail "yaml-sanity.md: Procedure lets unclosed files exit early as OK_NO_FRONTMATTER (Pattern 3 unreachable)"

# (b) BOM handling: line-0 check must strip a UTF-8 BOM, in both the
# sanity-check procedure and recipe (a).
grep -qi "UTF-8 BOM" "$SANITY" \
  && ok "yaml-sanity.md: BOM-strip documented" \
  || fail "yaml-sanity.md: no BOM handling — BOM-prefixed frontmatter classifies as OK_NO_FRONTMATTER"
grep -qi "UTF-8 BOM" "$EDITS" \
  && ok "yaml-edits.md: recipe (a) BOM-strip documented" \
  || fail "yaml-edits.md: recipe (a) line-0 check has no BOM handling"

# (c) f26-repro.md must describe current W4 semantics, not the pre-W4
# silent-winner-pick that yaml-edits.md already retracted.
grep -q "DUPLICATE_KEYS_DIVERGENT_VALUES" "${REPO_ROOT}/test-data/f26-repro.md" \
  && ok "f26-repro.md: references the W4 divergent verdict" \
  || fail "f26-repro.md: stale — never mentions the W4 divergent verdict its shape now triggers"
grep -qF "keep first (= the normalized-from-quoted" "${REPO_ROOT}/test-data/f26-repro.md" \
  && fail "f26-repro.md: pre-W4 silent-winner-pick walkthrough still present (contradicts recipe (f) ABORT)" \
  || ok "f26-repro.md: pre-W4 silent-winner-pick walkthrough removed"

# ─── Section [6/6] Drift guards (already-true claims, pinned) ────────────────
echo "[6/6] Drift guards"

grep -qE "MULTIPLE_FRONTMATTER_BLOCKS.*UNCLOSED_FRONTMATTER.*INVALID_YAML.*DUPLICATE_KEYS_DIVERGENT_VALUES.*BROKEN_KEYS_INSIDE_COLON.*DUPLICATE_KEYS_IDENTICAL_VALUES" "$SANITY" \
  && ok "verdict-priority ladder present and ordered" \
  || fail "verdict-priority ladder missing or reordered"
grep -q "Pattern 5 — Duplicate-key detection" "$SANITY" \
  && ok "Pattern 5 section present" || fail "Pattern 5 section missing"
grep -q "Pattern 3 — Unclosed frontmatter" "$SANITY" \
  && ok "Pattern 3 section present" || fail "Pattern 3 section missing"
verdict_def_count=$(grep -c "^| \`UNCLOSED_FRONTMATTER\` |" "$SANITY")
[ "$verdict_def_count" -eq 1 ] \
  && ok "UNCLOSED_FRONTMATTER defined exactly once in verdicts table" \
  || fail "UNCLOSED_FRONTMATTER defined ${verdict_def_count} times (expected 1)"

# ─── Summary ────────────────────────────────────────────────────────────────
echo
echo "──────────────────────────────────────────"
echo "PASS: ${PASS}"
echo "FAIL: ${FAIL}"
echo "──────────────────────────────────────────"

[ "$FAIL" -eq 0 ]
