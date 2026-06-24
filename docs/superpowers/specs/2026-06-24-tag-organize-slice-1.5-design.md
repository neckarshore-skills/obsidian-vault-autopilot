# tag-organize Slice 1.5 — Human-readable induce proposal + unique report filenames

Date: 2026-06-24
Status: design (approved for plan)
Skill: tag-organize / tag-manage (shared engine)
Predecessor: `2026-06-23-tag-organize-design.md` (Slice 1)

## Context & Motivation

The 2026-06-24 live UAT (1,236-note vault copy, user-PASS) surfaced two user-visible
gaps in the tag-organize / tag-manage surface (OBI-2026-06-24-2 findings 1 + 2):

1. **`induce` writes only a hidden dot-sidecar.** The user asked "where is the
   proposal note?" — `runInduce` writes `.tag-organize-clusters.json` (machine-readable,
   Obsidian-hidden) but no browsable artifact, unlike the audit which already writes a
   human `.md` report **and** a machine `.json`.
2. **The report filename lost its HH:MM stamp — a regression.** Evidence: 2026-06-22
   artifacts carry stamps (`2026-06-22 0911 Tag Analysis Report - Vault-wide.md`),
   2026-06-24 artifacts do not (`2026-06-24 Tag Analysis Report - Vault-wide.md`). The
   current code truncates the clock to `YYYY-MM-DD` (`cli.js` `new Date().toISOString().slice(0, 10)`),
   so two same-day runs collide and **overwrite**. This bit a session run on 2026-06-24:
   a re-audit clobbered the prior same-day report.

These two findings couple: they both concern the report-artifact surface, and Finding 2
is the mechanism that turns a harmless re-run into data loss. Fixing the stamp makes
audit/induce re-runs safe-by-default.

## Guiding principle

**`induce` mirrors the audit exactly.** The audit already writes a dual artifact
(human `.md` + machine `.json`) into the configured report home, carries the
`Meta/TagManagement` frontmatter marker, and backtick-wraps every tag name so the
linter and the inventory scanner ignore it. Slice 1.5 gives `induce` the same dual
write and the same filename-uniqueness, reusing the existing report infrastructure.

## Finding A — Unique report filenames

**Change (cli.js only; `report.js` stays pure — it builds note bodies, not filenames):**

- `resolveReportContext` calls the clock **once** and returns `{ date, fileStamp }`.
  - `date` is unchanged: `--date` value, else `toISOString().slice(0, 10)` (UTC).
  - `fileStamp` is `''` when `--date` is given (deterministic — tests stay green), else
    the `HHMM` from the same UTC instant (matches the 2026-06-22 precedent format).
- The filename becomes `${date}${fileStamp ? ' ' + fileStamp : ''} <kind> - <scope><suffix>.md`.
  The stamp sits **before** `Tag Analysis Report`, so the artifact-exclusion regex is unaffected.
- Factor the stamp derivation into a tiny **pure** helper `reportStamp(isoString, hasExplicitDate)`
  so it is unit-testable without the wall clock.

**Decisions (named, with the honest counter-case):**

- **HHMM, not HHMMSS.** Matches the user's stated expectation ("HH:MM") and the 06-22
  precedent. Counter: same-minute reruns still collide. Accepted — audits are
  human-triggered; same-minute reruns are rare, and HHMMSS trades readability for an
  edge that does not bite in practice.
- **UTC, not local.** Consistent with the already-UTC `date` (no midnight date/stamp
  skew). Counter: a CEST user sees UTC time (−2h) in the filename. Accepted and
  documented; switching only the stamp to local would let date and time disagree near
  midnight.
- **Stamp only on the clock-default path.** `--date` callers (tests, explicit runs) opt
  out of the stamp and keep deterministic names. This is the test seam.

## Finding B — Human-readable proposal note + self-poisoning hardening

**New pure renderer `renderProposal({ date, clusters, scope })` in `report.js`:**

- Frontmatter carries `REPORT_MARKER_TAG` (`Meta/TagManagement`) — so future scans
  exclude it via the marker path, exactly like the audit report.
- **Every parent and child tag name is backtick-wrapped.** This is the load-bearing
  anti-poisoning invariant: `tags.js scanLine` skips inline-code spans, so a wrapped
  tag in the note body is never parsed as a real inline tag (the OBI-2026-06-21-2
  invariant). A non-wrapped name would re-enter the inventory on the next induce.
- Body: a `# | Parent | Children | Basis` table (the families, mirroring the SKILL.md
  presentation), plus a "Next Steps" tip stating these are **name-only proposals to
  prune** (the live UAT proved the biggest family, `Open ← OpenAI, OpenSource, …`, is
  semantically empty) and giving the `set-hierarchy` command shape. No `#`-prefixed
  tokens in prose (linter-inert, same rule as the audit report).

**`runInduce` hardening (cli.js):**

- Call `excludeReportArtifacts(readNotes(dir), dir, reportDirAbs)` before
  `buildInventory` — matches the audit's behavior. **Honest scope of the gap:**
  `walkMarkdown` already skips `_`-prefixed dirs, so with the default `_vault-autopilot/reports/`
  home neither the audit report nor the proposal note is scanned anyway. The exclusion
  bites only when `reportDir` is a **non-underscore** dir (e.g. `Meta/Tag Reports`) — then
  the artifacts ARE walked. The hardening is defensive symmetry + protection for that
  config, not a fix for an actively-firing bug under the default layout.
- Accept a `date` param (from `resolveReportContext`) for the proposal filename.
- Write the human `.md` **only `if (reportDirAbs)`** — mirrors the audit and removes the
  root edge-case where the artifact would land where nothing excludes it (the
  `excludeReportArtifacts` no-op-at-null). The dot-sidecar write is unchanged (dot-prefixed →
  `walkMarkdown` skips it at root, no poisoning).
- Filename: `${date}${stamp} Tag Organize Proposal - <scope>.md`.

**Exclusion regex (cli.js `isReportArtifact`):** generalize the filename test to
`/ Tag (Analysis Report|Organize Proposal) - .+\.md$/` so the proposal note is excluded
from future scans even at root (where the marker path is disabled).

## Components touched

| File | Change |
|------|--------|
| `scripts/report.js` | NEW pure `renderProposal`; export it. `renderReport` unchanged. |
| `scripts/cli.js` | `resolveReportContext` returns `fileStamp`; filename builders use it; `reportStamp` pure helper; `runInduce` excludes artifacts + writes the note `if (reportDirAbs)`; `isReportArtifact` regex generalized. |
| `skills/tag-organize/SKILL.md` | Flow step 1 mentions the browsable proposal note; known-limitations notes that a configured `reportDir` makes audit/induce write (not pure read-only). |
| `README.md`, `logs/changelog.md` | one row each. |

## Testing (non-vacuous)

The **load-bearing** protection against self-poisoning is the **backtick-wrapping**
(plus the `Meta/TagManagement` marker containing `/`, which `clusterByName` skips). A
well-formed proposal note does not form clusters even without exclusion; the exclusion
is belt-and-suspenders for the non-underscore-`reportDir` config. Tests are designed so
the wrapping invariant is the one that fails loudly if broken.

1. **(load-bearing) `renderProposal` backtick-wraps every tag, and the wrapping is what
   protects** — assert each tag name appears only backticked. Then the contrast that
   makes it non-vacuous: feed `scanBody` (tags.js) the rendered body → it returns no
   proposal tags; feed it a deliberately-unwrapped variant of the same body → it DOES
   return them. Pins the OBI-2026-06-21-2 invariant.
2. **Round-trip no self-poisoning, in a WALKED location** — write the proposal note into
   a **non-underscore** dir (so `walkMarkdown` actually scans it — otherwise the test is
   vacuous, since `_`-dirs are skipped regardless), run `induce` → no cluster derives
   from the proposal note's own tags.
3. **`isReportArtifact` excludes the proposal note** — the generalized regex matches
   `<date> Tag Organize Proposal - Vault-wide.md`; a near-miss real note
   (`My Tag Organize Proposal Notes.md`) is NOT dropped.
4. **Filename stamp (pure seam)** — `reportStamp(iso, true)` → `''`;
   `reportStamp(iso, false)` → the `HHMM` of the ISO string. Existing `--date` filename
   assertions stay green (verified: `cli.test.js`, `report-home.test.js` all pass `--date`).

## Out of scope (YAGNI)

- No confidence/quality heuristic on families (a flat table already makes false-positives
  like `Open` easy to prune; a heuristic is Slice-2 territory).
- No body-embedded timestamp (the body date stays the calendar date).
- No collision-suffix logic (`-2`, `-3`); the stamp is the uniqueness mechanism.
- The other OBI-2026-06-24-2 findings (3 acronym-hyphen generalization, 4 `go-Inno`
  mixed-case-kebab, 5 the review-layer insight) are separate, deferred items.

## Captured finding (for the report)

A "read-only audit" is **not** read-only when the vault has a `Tag Manage Config.md`
that sets `reportDir`: `resolveReportContext` auto-discovers it and the audit writes the
report + sidecars regardless of `--report-dir`. Slice 1.5's filename stamp mitigates the
overwrite harm; the SKILL.md known-limitations note makes the write-behavior explicit.
