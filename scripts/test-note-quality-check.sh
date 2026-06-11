#!/usr/bin/env bash
# Behavioral assertion harness for note-quality-check's deterministic core
# (skills/note-quality-check/SKILL.md). Phase 3 of the 2026-06-11
# skill-hardening plan.
#
# Carries a reference implementation of: protected files/folders, Nahbereich
# candidacy (0-byte / whitespace-only ONLY — fail-safe default), the five
# intentional-content survival signals, and yaml-sanity exclusion routing.
# Pins the SKILL.md hardening — including the FLAGGED behavior change
# (destructive actions moved behind the preview/user gate) — via spec-claim
# greps.
#
# Mirrors scripts/test-property-classify.sh structure. Bash 3.2 + BSD awk.

set -u
set -o pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE_ROOT="${REPO_ROOT}/tests/fixtures/note-quality-check"
VAULT="${FIXTURE_ROOT}/vault"
TRUTH="${FIXTURE_ROOT}/_truth.json"
SKILL="${REPO_ROOT}/skills/note-quality-check/SKILL.md"

PASS=0
FAIL=0

ok()   { echo "  PASS: $*"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL+1)); }

# ─── Reference implementation ────────────────────────────────────────────────
# Prints "<disposition> <signal>". Dispositions: protected, delete-candidate,
# trash-candidate, exclude-sanity, review. Signal names the intentional-
# content guard that protects a review note (embed > wikilink > frontmatter >
# lines3 > filename > none). The truth matrix never bends to this
# implementation.

classify() {
  local file="$1" relpath="$2"

  # Protected: _-prefixed root files and anything inside _trash/.
  case "$relpath" in
    _*|*/_trash/*|_trash/*) echo "protected -"; return ;;
  esac

  # 0-byte: permanent-delete candidate (gated behind preview).
  if [ ! -s "$file" ]; then echo "delete-candidate -"; return; fi

  # Whitespace-only: soft-delete candidate (gated behind preview).
  if ! grep -q '[^[:space:]]' "$file"; then echo "trash-candidate -"; return; fi

  awk -v relpath="$relpath" '
    {
      line = $0
      sub(/\r$/, "", line)
      lines[NR] = line
    }
    END {
      n = NR

      # Frontmatter bounds.
      close_i = 0
      if (n >= 1 && lines[1] == "---")
        for (i = 2; i <= n; i++) if (lines[i] == "---") { close_i = i; break }

      # yaml-sanity exclusion: shape-beta or duplicate keys -> excluded from
      # scoring. A corrupted file is a repair case, not a low-quality note.
      shape_b = 0; nk = 0
      meaningful_fm = 0
      for (i = 2; i < close_i; i++) {
        l = lines[i]
        if (l ~ /^[ \t]*"[^"]+:"[ \t]*:/) { shape_b++; continue }
        if (match(l, /^[ \t]*[A-Za-z_][A-Za-z0-9_-]*[ \t]*:/)) {
          key = substr(l, RSTART, RLENGTH)
          sub(/^[ \t]*/, "", key)
          sub(/[ \t]*:$/, "", key)
          rest = substr(l, RLENGTH + 1)
          v = rest
          sub(/[ \t]*#.*$/, "", v)
          sub(/^[ \t]*/, "", v); sub(/[ \t]*$/, "", v)
          nk++; keyname[nk] = tolower(key)
          lk = tolower(key)
          if ((lk == "title" || lk == "description") && length(v) > 0) meaningful_fm = 1
          if (lk == "tags" && length(v) > 0) meaningful_fm = 1
        }
        if (l ~ /^[ \t]+- [^ \t]/) meaningful_fm = 1   # block-list item (tags/aliases)
      }
      dup = 0
      for (i = 1; i <= nk; i++)
        for (j = i + 1; j <= nk; j++)
          if (keyname[i] == keyname[j]) dup = 1
      if (shape_b || dup) { print "exclude-sanity -"; exit }

      # Intentional-content signals (body = lines after frontmatter close).
      body_start = (close_i > 0) ? close_i + 1 : 1
      embed = 0; wikilink = 0; nonws = 0
      for (i = body_start; i <= n; i++) {
        if (lines[i] ~ /!\[\[[^]]*\]\]/) embed = 1
        else if (lines[i] ~ /\[\[[^]]*\]\]/) wikilink = 1
        if (lines[i] ~ /[^ \t]/) nonws++
      }

      # Descriptive filename: NOT a generic capture name.
      base = relpath
      sub(/^.*\//, "", base)
      sub(/\.md$/, "", base)
      generic = 0
      if (base ~ /^(Untitled|Unbenannt|New Note|Draft|Quick Note|Blank note|Note from iPhone)( [0-9]+)?$/) generic = 1

      sig = "none"
      if (embed)              sig = "embed"
      else if (wikilink)      sig = "wikilink"
      else if (meaningful_fm) sig = "frontmatter"
      else if (nonws >= 3)    sig = "lines3"
      else if (!generic)      sig = "filename"

      # Fail-safe default: ANY non-whitespace content -> review, never an
      # automatic Nahbereich candidate. Only the user can say Trash.
      print "review " sig
    }
  ' "$file"
}

# ─── Section [1/5] Fixture structure ─────────────────────────────────────────
echo "[1/5] Fixture structure"

[ -d "$VAULT" ] && ok "vault/ exists" || fail "vault/ missing"
[ -f "$TRUTH" ] && ok "_truth.json exists" || fail "_truth.json missing"
[ -f "${FIXTURE_ROOT}/README.md" ] && ok "README.md exists" || fail "README.md missing"

cell_count=$(find "$VAULT" -name '*.md' | wc -l | tr -d ' ')
[ "$cell_count" -eq 12 ] && ok "12 cells present" || fail "expected 12 cells, found ${cell_count}"

# Byte invariants — candidacy cells are only meaningful with exact content.
size3=$(wc -c < "${VAULT}/inbox/Untitled 3.md" | tr -d ' ')
[ "$size3" -eq 0 ] && ok "Untitled 3.md is 0 bytes" || fail "Untitled 3.md is ${size3} bytes (expected 0)"
grep -q '[^[:space:]]' "${VAULT}/inbox/Untitled 2.md" \
  && fail "Untitled 2.md contains non-whitespace (must stay whitespace-only)" \
  || ok "Untitled 2.md is whitespace-only"

# ─── Section [2/5] Truth matrix ──────────────────────────────────────────────
echo "[2/5] Truth matrix — per-cell disposition vs _truth.json"

CELLS=(
  "_trash/old-note"
  "_vault-autopilot"
  "inbox/2024 Tax Strategy Notes"
  "inbox/Draft"
  "inbox/New Note"
  "inbox/Quick Note"
  "inbox/Unbenannt"
  "inbox/Untitled"
  "inbox/Untitled 2"
  "inbox/Untitled 3"
  "inbox/Untitled 4"
  "inbox/Untitled 5"
)
EXPECTED=(
  "protected -"
  "protected -"
  "review filename"
  "review lines3"
  "review embed"
  "review frontmatter"
  "exclude-sanity -"
  "review wikilink"
  "trash-candidate -"
  "delete-candidate -"
  "exclude-sanity -"
  "review none"
)

i=0
while [ "$i" -lt "${#CELLS[@]}" ]; do
  cell="${CELLS[$i]}"
  expected="${EXPECTED[$i]}"
  if [ -f "${VAULT}/${cell}.md" ]; then
    actual=$(classify "${VAULT}/${cell}.md" "${cell}.md")
    if [ "$actual" = "$expected" ]; then
      ok "${cell}.md → ${actual}"
    else
      fail "${cell}.md → expected '${expected}', got '${actual}'"
    fi
  else
    fail "${cell}.md missing"
  fi
  i=$((i+1))
done

# ─── Section [3/5] Script ↔ _truth.json consistency ─────────────────────────
echo "[3/5] Script arrays match _truth.json"

i=0
while [ "$i" -lt "${#CELLS[@]}" ]; do
  cell="${CELLS[$i]}"
  expected="${EXPECTED[$i]}"
  disp=$(echo "$expected" | cut -d' ' -f1)
  sig=$(echo "$expected" | cut -d' ' -f2)
  if grep -qF "\"${cell}\": {\"disposition\": \"${disp}\", \"signal\": \"${sig}\"}" "$TRUTH"; then
    ok "truth entry: ${cell}"
  else
    fail "truth entry mismatch or missing for ${cell} (script expects ${disp}/${sig})"
  fi
  i=$((i+1))
done

# ─── Section [4/5] SKILL.md hardening claims (the gaps Phase 3 closes) ──────
echo "[4/5] SKILL.md hardening claims"

# (a) FLAGGED BEHAVIOR CHANGE — destruction gate. The pre-hardening skill
# executed 0-byte deletes and whitespace trashes in Phase 1, BEFORE any
# preview. Every destructive action must sit behind the preview/user gate.
grep -qF "No destructive action happens before the preview" "$SKILL" \
  && ok "destruction gate: explicit pre-preview prohibition present" \
  || fail "destruction gate: no pre-preview prohibition — Nahbereich deletes still fire before the user sees anything"
grep -qF "Nahbereich: permanently delete 0-byte files. Trash whitespace-only files. Log each." "$SKILL" \
  && fail "destruction gate: Phase-1 immediate-delete step still present (pre-preview destruction)" \
  || ok "destruction gate: Phase-1 immediate-delete step removed"

# (b) Fail-safe default — uncertainty resolves to KEEP/DEFER, never auto-trash.
grep -q "KEEP/DEFER" "$SKILL" \
  && ok "fail-safe: KEEP/DEFER uncertainty default present" \
  || fail "fail-safe: no KEEP/DEFER default — signal uncertainty has no specified resolution"

# (c) yaml-sanity preflight before any frontmatter read; corrupted files are
# repair cases, never scored.
grep -q "yaml-sanity.md" "$SKILL" \
  && ok "sanity: yaml-sanity.md referenced" \
  || fail "sanity: no yaml-sanity.md call — frontmatter read without verdict routing"
grep -q "DUPLICATE_KEYS_DIVERGENT_VALUES" "$SKILL" \
  && ok "sanity: divergent-duplicate verdict routed" \
  || fail "sanity: DUPLICATE_KEYS_DIVERGENT_VALUES not routed"
grep -qF "not a low-quality note" "$SKILL" \
  && ok "sanity: corrupted-file-is-repair-case rule present" \
  || fail "sanity: corrupted files can be scored as low quality (false trash-suggestion vector)"

# (d) Cooldown/age safety gate: Source Hierarchy + clone-cluster DEFER, not
# raw birthtime (F3/GR-3 class — same fix as property-classify Phase 2).
grep -qF "Use file creation date (birthtime)" "$SKILL" \
  && fail "cooldown: stale raw-birthtime date source still present (clone-poisoning bypass)" \
  || ok "cooldown: stale raw-birthtime date source removed"
grep -q "Source Hierarchy" "$SKILL" \
  && ok "cooldown/age: Source Hierarchy referenced" \
  || fail "cooldown/age: no Source Hierarchy reference"
grep -q "clone-cluster-detection.md" "$SKILL" \
  && ok "cooldown/age: clone-cluster gate referenced" \
  || fail "cooldown/age: no clone-cluster-detection.md reference"

# (e) Pre-flight + write discipline + findings ledger.
grep -q "clone-preflight.md" "$SKILL" \
  && ok "preflight: clone-preflight.md referenced" \
  || fail "preflight: no clone-preflight.md reference"
grep -q "windows-preflight.md" "$SKILL" \
  && ok "preflight: windows-preflight.md referenced" \
  || fail "preflight: no windows-preflight.md reference"
grep -q "yaml-edits.md" "$SKILL" \
  && ok "write: trash-metadata + skill-log edits bound to yaml-edits.md" \
  || fail "write: trash-metadata + skill-log edits not bound to yaml-edits.md recipes"
grep -q "findings-file.md" "$SKILL" \
  && ok "report: findings-file.md step present" \
  || fail "report: no findings-file step"

# ─── Section [5/5] Drift guards (already-true claims, pinned) ────────────────
echo "[5/5] Drift guards"

grep -q "Never Recommend Trash" "$SKILL" \
  && ok "golden rule present" || fail "golden rule missing"
grep -q "Intentional Content Signals" "$SKILL" \
  && ok "intentional-content signals section present" || fail "signals section missing"
grep -qc "batch_size" "$SKILL" >/dev/null \
  && ok "batch_size walk-through parameter present" || fail "batch_size missing"
grep -q "_vault-autopilot.md" "$SKILL" \
  && ok "protected files section present" || fail "protected files section missing"
grep -q "trash-concept.md" "$SKILL" \
  && ok "trash-concept (soft-delete) referenced" || fail "trash-concept reference missing"

# ─── Summary ────────────────────────────────────────────────────────────────
echo
echo "──────────────────────────────────────────"
echo "PASS: ${PASS}"
echo "FAIL: ${FAIL}"
echo "──────────────────────────────────────────"

[ "$FAIL" -eq 0 ]
