#!/usr/bin/env bash
# Behavioral assertion harness for property-classify's deterministic rules
# (skills/property-classify/SKILL.md). Phase 2 of the 2026-06-11
# skill-hardening plan.
#
# Carries a reference implementation of: status hierarchy (protected >
# archived > reviewed > polished > draft), two-layer type classification
# (content signals over folder path, filename excluded), conflict handling,
# `Status` casing Nahbereich, and the yaml-sanity additive-only skip policy.
# Asserts it against tests/fixtures/property-classify/vault/ and pins the
# SKILL.md hardening (preflight, sanity routing, Source-Hierarchy cooldown,
# yaml-edits binding, findings file) via spec-claim greps.
#
# Mirrors scripts/test-yaml-sanity-verdicts.sh structure. Bash 3.2 + BSD awk.

set -u
set -o pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE_ROOT="${REPO_ROOT}/tests/fixtures/property-classify"
VAULT="${FIXTURE_ROOT}/vault"
TRUTH="${FIXTURE_ROOT}/_truth.json"
SKILL="${REPO_ROOT}/skills/property-classify/SKILL.md"
SANITY="${REPO_ROOT}/references/yaml-sanity.md"

PASS=0
FAIL=0

ok()   { echo "  PASS: $*"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL+1)); }

# ─── Reference implementation ────────────────────────────────────────────────
# Prints "<status> <type> <action>" for a note. "-" marks untouched fields
# (protected / skip-sanity cells). The truth matrix never bends to this
# implementation — disagreement means a spec gap, fixed together.

classify() {
  local file="$1" relpath="$2"
  awk -v relpath="$relpath" '
    {
      line = $0
      sub(/\r$/, "", line)
      lines[NR] = line
    }
    END {
      n = NR

      # Frontmatter bounds (fixtures are well-formed; defensive anyway).
      close_i = 0
      if (n >= 1 && lines[1] == "---")
        for (i = 2; i <= n; i++) if (lines[i] == "---") { close_i = i; break }

      # yaml-sanity skip policy (additive-only): shape-beta or any
      # duplicate-key collision -> skip + finding, never classify.
      shape_b = 0; nk = 0; caseflag = 0
      for (i = 2; i < close_i; i++) {
        l = lines[i]
        key = ""; rest = ""
        if (l ~ /^[ \t]*"[^"]+:"[ \t]*:/) { shape_b++; continue }
        if (match(l, /^[ \t]*[A-Za-z_][A-Za-z0-9_-]*[ \t]*:/)) {
          key = substr(l, RSTART, RLENGTH)
          sub(/^[ \t]*/, "", key)
          sub(/[ \t]*:$/, "", key)
          rest = substr(l, RLENGTH + 1)
          v = rest
          sub(/[ \t]*#.*$/, "", v)
          sub(/^[ \t]*/, "", v); sub(/[ \t]*$/, "", v)
          lk = tolower(key)
          if ((lk == "status" || lk == "type") && key != lk) caseflag = 1
          nk++; keyname[nk] = lk; keyval[nk] = v
          if (!(lk in fm)) fm[lk] = v
        }
      }
      dup = 0
      for (i = 1; i <= nk; i++)
        for (j = i + 1; j <= nk; j++)
          if (keyname[i] == keyname[j]) dup = 1
      if (shape_b || dup) { print "- - skip-sanity"; exit }

      # Protected: permanent/evergreen are skipped entirely.
      if (fm["status"] == "permanent" || fm["status"] == "evergreen") {
        print fm["status"] " - protected"; exit
      }

      # Body signals.
      checked = 0; unchecked = 0
      isbn = 0; author = 0; agenda = 0
      for (i = close_i + 1; i <= n; i++) {
        if (lines[i] ~ /^[ \t]*- \[x\]/) checked++
        if (lines[i] ~ /^[ \t]*- \[ \]/) unchecked++
        if (lines[i] ~ /ISBN/) isbn = 1
        if (lines[i] ~ /^Author:/) author = 1
        if (lines[i] ~ /^#+ .*Agenda|^Agenda:/) agenda = 1
      }
      # Content signals may also live in frontmatter (ISBN/Author fields).
      for (i = 2; i < close_i; i++) {
        if (lines[i] ~ /ISBN/) isbn = 1
        if (lines[i] ~ /^[Aa]uthor[ \t]*:/) author = 1
        if (lines[i] ~ /^[Aa]genda[ \t]*:/) agenda = 1
      }

      # Aliases count (block list under aliases:).
      aliases = 0; in_al = 0
      for (i = 2; i < close_i; i++) {
        if (lines[i] ~ /^aliases[ \t]*:[ \t]*$/) { in_al = 1; continue }
        if (in_al) {
          if (lines[i] ~ /^[ \t]+- /) aliases++
          else in_al = 0
        }
      }

      # Placeholder fields block polished.
      placeholder = 0
      for (i = 1; i <= nk; i++) {
        v = keyval[i]
        if (v == "TBD" || v == "TODO" || v == "FIXME" || v == "PLACEHOLDER" || v == "...") placeholder = 1
      }
      desc = ("description" in fm) ? fm["description"] : ""
      desc_real = (length(desc) >= 10 && desc != "TBD" && desc != "TODO") ? 1 : 0

      # Status hierarchy (highest wins). Path semantics: folder path only,
      # excluding the filename; any segment containing "archive",
      # case-insensitive.
      dir = relpath
      sub(/\/[^\/]*$/, "", dir)
      ld = tolower(dir)
      if (ld ~ /archive/)                                  st = "archived"
      else if (checked > 0 && unchecked == 0)              st = "reviewed"
      else if (desc_real && aliases >= 3 && !placeholder)  st = "polished"
      else                                                 st = "draft"

      # Type: Layer 1 content signals first, Layer 2 folder-path fallback.
      if (isbn || author)        ty = "book"
      else if (agenda)           ty = "meeting"
      else if (ld ~ /inbox/)     ty = "inbox"
      else if (ld ~ /project/)   ty = "project"
      else if (ld ~ /people/ || ld ~ /contact/) ty = "person"
      else if (ld ~ /meeting/)   ty = "meeting"
      else if (ld ~ /resource/)  ty = "resource"
      else if (ld ~ /archive/)   ty = "archive"
      else if (ld ~ /template/)  ty = "template"
      else                       ty = "TBD"

      # Conflict: existing type (not TBD/inbox) that differs stays on disk.
      act = "set"
      ex = ("type" in fm) ? fm["type"] : ""
      if (ex != "" && ex != "TBD" && ex != "inbox" && ex != ty) { act = "conflict"; ty = ex }
      if (caseflag && act == "set") act = "normalize-casing"

      print st " " ty " " act
    }
  ' "$file"
}

# ─── Section [1/5] Fixture structure ─────────────────────────────────────────
echo "[1/5] Fixture structure"

[ -d "$VAULT" ] && ok "vault/ exists" || fail "vault/ missing"
[ -f "$TRUTH" ] && ok "_truth.json exists" || fail "_truth.json missing"
[ -f "${FIXTURE_ROOT}/README.md" ] && ok "README.md exists" || fail "README.md missing"

cell_count=$(find "$VAULT" -name '*.md' | wc -l | tr -d ' ')
[ "$cell_count" -eq 22 ] && ok "22 cells present" || fail "expected 22 cells, found ${cell_count}"

# ─── Section [2/5] Truth matrix ──────────────────────────────────────────────
echo "[2/5] Truth matrix — per-cell classification vs _truth.json"

CELLS=(
  "099_Archive/s03-archived-by-path"
  "099_Archive/s09-priority-archived-over-reviewed"
  "inbox/s01-protected-permanent"
  "inbox/s02-protected-evergreen"
  "inbox/s04-reviewed-checkboxes"
  "inbox/s05-not-reviewed-mixed-checkboxes"
  "inbox/s06-polished"
  "inbox/s07-polished-blocked-by-placeholder"
  "inbox/s08-default-draft"
  "inbox/s10-casing-nahbereich"
  "inbox/t02-meeting-agenda"
  "inbox/t03-type-by-path-inbox"
  "inbox/x01-f26-broken-keys"
  "inbox/x02-divergent-dup"
  "notes/t06-no-match-tbd"
  "people/t05-person"
  "projects/t04-type-by-path-project"
  "projects/t07-conflict-existing-type"
  "projects/t08-overwrite-tbd"
  "projects/t09-overwrite-inbox-type"
  "resources/t01-book-isbn"
  "templates/t10-template"
)
EXPECTED=(
  "archived archive set"
  "archived archive set"
  "permanent - protected"
  "evergreen - protected"
  "reviewed inbox set"
  "draft inbox set"
  "polished inbox set"
  "draft inbox set"
  "draft inbox set"
  "draft inbox normalize-casing"
  "draft meeting set"
  "draft inbox set"
  "- - skip-sanity"
  "- - skip-sanity"
  "draft TBD set"
  "draft person set"
  "draft project set"
  "draft resource conflict"
  "draft project set"
  "draft project set"
  "draft book set"
  "draft template set"
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
  st=$(echo "$expected" | cut -d' ' -f1)
  ty=$(echo "$expected" | cut -d' ' -f2)
  act=$(echo "$expected" | cut -d' ' -f3)
  if grep -qF "\"${cell}\": {\"status\": \"${st}\", \"type\": \"${ty}\", \"action\": \"${act}\"}" "$TRUTH"; then
    ok "truth entry: ${cell}"
  else
    fail "truth entry mismatch or missing for ${cell} (script expects ${st}/${ty}/${act})"
  fi
  i=$((i+1))
done

# ─── Section [4/5] SKILL.md hardening claims (the gaps Phase 2 closes) ──────
echo "[4/5] SKILL.md hardening claims"

# (a) Pre-flight: clone + windows preflight, like every launch-scope skill.
grep -q "clone-preflight.md" "$SKILL" \
  && ok "preflight: clone-preflight.md referenced" \
  || fail "preflight: no clone-preflight.md reference — date-derivation runs without clone-cluster WARN"
grep -q "windows-preflight.md" "$SKILL" \
  && ok "preflight: windows-preflight.md referenced" \
  || fail "preflight: no windows-preflight.md reference — trailing-dot folders silently invisible on Windows"

# (b) yaml-sanity verdict routing (additive-only policy: SKIP + finding).
grep -q "yaml-sanity.md" "$SKILL" \
  && ok "sanity: yaml-sanity.md referenced" \
  || fail "sanity: no yaml-sanity.md call — classify writes frontmatter on possibly-broken YAML"
grep -q "DUPLICATE_KEYS_DIVERGENT_VALUES" "$SKILL" \
  && ok "sanity: divergent-duplicate verdict routed" \
  || fail "sanity: DUPLICATE_KEYS_DIVERGENT_VALUES not routed"

# (c) Cooldown safety gate: Source Hierarchy + clone-cluster gate, not raw
# birthtime (the bypass this phase closes — user adjustment 2026-06-11).
grep -qF "Use file creation date (birthtime)" "$SKILL" \
  && fail "cooldown: stale raw-birthtime date source still present (clone-poisoning bypass)" \
  || ok "cooldown: stale raw-birthtime date source removed"
grep -q "Source Hierarchy" "$SKILL" \
  && ok "cooldown: Source Hierarchy referenced" \
  || fail "cooldown: no Source Hierarchy reference"
grep -q "clone-cluster-detection.md" "$SKILL" \
  && ok "cooldown: clone-cluster gate referenced" \
  || fail "cooldown: no clone-cluster-detection.md reference"

# (d) Write discipline + findings ledger.
grep -q "yaml-edits.md" "$SKILL" \
  && ok "write: yaml-edits.md recipes bound" \
  || fail "write: Step 5 not bound to yaml-edits.md recipes (the F19/F25/F26 bug surface)"
grep -q "findings-file.md" "$SKILL" \
  && ok "report: findings-file.md step present" \
  || fail "report: no findings-file step — Class-A findings have no ledger"

# (e) Archive-rule consistency + path semantics.
grep -qF '`/archive/`' "$SKILL" \
  && fail "status rule: literal '/archive/' (with slashes) misses the vault's own 099_Archive/ convention" \
  || ok "status rule: slash-literal archive match removed"
grep -q "099_Archive" "$SKILL" \
  && ok "status rule: 099_Archive example present" \
  || fail "status rule: no 099_Archive example (archived-status rule not aligned with type rule)"
grep -q "excluding the filename" "$SKILL" \
  && ok "path semantics: filename excluded from Layer-2 matching" \
  || fail "path semantics: 'path contains' ambiguity — a note named 'Meeting with Bob.md' would classify by its own filename"

# (f) yaml-sanity.md per-skill row no longer deferred to v0.2.0.
grep -qF '`property-classify` (v0.2.0)' "$SANITY" \
  && fail "yaml-sanity.md: per-skill row still tagged (v0.2.0) — classify is hardened now" \
  || ok "yaml-sanity.md: per-skill row no longer tagged (v0.2.0)"

# ─── Section [5/5] Drift guards (already-true claims, pinned) ────────────────
echo "[5/5] Drift guards"

grep -q "Rule-based, no AI" "$SKILL" \
  && ok "skill stays rule-based (no AI dependency creep)" \
  || fail "'Rule-based, no AI' claim missing"
grep -q "permanent.*evergreen\|evergreen.*permanent" "$SKILL" \
  && ok "protected status values present" || fail "protected status values missing"
grep -qi "conflict" "$SKILL" \
  && ok "conflict handling section present" || fail "conflict handling missing"
grep -q "_vault-autopilot.md" "$SKILL" \
  && ok "protected files section present" || fail "protected files section missing"

# ─── Summary ────────────────────────────────────────────────────────────────
echo
echo "──────────────────────────────────────────"
echo "PASS: ${PASS}"
echo "FAIL: ${FAIL}"
echo "──────────────────────────────────────────"

[ "$FAIL" -eq 0 ]
