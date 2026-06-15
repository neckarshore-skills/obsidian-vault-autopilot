# ai-paste-cleanup — Design Spec

> **Status:** approved (brainstorm 2026-06-15). Builder: obi (Skill Master), terminal-only per AT-1.
> **Source PRD:** Nexus vault `020_Processes/OPS – PRD AI-Paste Cleanup Skill (Handoff for obi)` (v0.1).
> **Transform source of truth:** the two regex docs — `OPS – Obsidian Linter Setup (AI-Paste Cleanup)` and `OPS – Linter Regex Test & Incident (Before-After)`. Patterns are reused, never re-derived.

## 1. Summary

A Claude Code skill in the Obsidian Vault Autopilot family that applies the proven-safe AI-paste cleanup transformations from Claude's side — on a single note or a folder, on demand. It **complements** the obsidian-linter plugin (which cleans on save-in-Obsidian); this skill cleans notes Claude writes directly (research reports, scraper output) so they arrive clean, and serves users who do not run the linter plugin at all.

The skill is reactive (Phase 1 / MVP). The auto-hook after note-generating skills is Phase 2 (out of scope here).

## 2. Goals and Non-Goals

**Goals**

1. Apply the proven-safe cleanup set to a single note or a folder, from Claude.
2. Always show a dry-run diff before writing; require explicit confirmation.
3. Be idempotent and non-destructive, with a fingerprint self-check that aborts on suspected mass deletion (the 2026-06-04 incident guard).
4. Reuse the exact validated patterns from the regex docs — `\uXXXX` only, never `\x{}`.
5. Run the patterns through the same engine semantics as the plugin (`new RegExp(p, "gm")`, no `u`-flag) so behavior matches.

**Non-Goals**

1. Not a replacement for the obsidian-linter plugin.
2. Not a full Markdown formatter / prettier / markdownlint.
3. Not a wholesale reimplementation of the plugin's built-in rules.
4. Not auto-run vault-wide without explicit per-run confirmation.
5. Not linter-config management or recovery (a separate skill — see Backlog).

## 3. Decisions Locked in Brainstorm (2026-06-15)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Transform language (PRD OpenQ#2) | **Node / JavaScript** | Runs the exact patterns through the same engine as the linter (`new RegExp(p,"gm")`, no `u`-flag) → byte-identical behavior. Eliminates the Python `re` divergence (`\s` matches NBSP by default in Python). |
| 2 | MVP rule scope (PRD OpenQ#3) | **6 validated regexes + 2 safe-whitespace fixes** | The 6 have empirical before/after proof (unit tests come free). The 2 whitespace fixes (collapse runs of blank lines to one, strip trailing whitespace) are low-risk, high AI-paste value. Full Block-2 built-in reimplementation rejected (Non-Goal #3). |
| 3 | Skill name (PRD OpenQ#1) | **`ai-paste-cleanup`** | Consistent with the doc ecosystem (PRD title, linter-setup doc) and the Phase-3 LinkedIn brand. Follows the `note-quality-check` shape (modifier-domain + action). |
| 4 | Entry point (PRD OpenQ#5) | **One skill, one entry point**; path arg auto-detects file vs folder | Simpler; matches the path-parameter design. No reason to split into two commands. |
| 5 | Execution model | **Tested Node script**, not AI-applied regex | Mandated by PRD §7 ("tested function set" + "unit tests reusing the exact before/after cases"). Determinism is the safety story. |
| 6 | Backup on `--write` | **No backup in MVP** | Dry-run is the safety net; transforms are non-destructive + idempotent + fingerprint-guarded. Git / Time Machine is the recommended undo. `--backup` to `_trash/` deferred to backlog. |

## 4. Architecture

```
skills/ai-paste-cleanup/
  SKILL.md            # Orchestrator: dry-run -> show diff -> user gate -> --write
  scripts/
    rules.js          # Transform lib: each rule a pure function (text) -> {text, removed[]}
    clean.js          # CLI: path arg, file|folder auto-detect, dry-run default
  tests/
    rules.test.js     # node:test (built-in, 0 deps): before/after cases + idempotency + guard
  references/
    safe-rule-set.md  # the validated patterns + provenance (links to the two regex docs)
```

Test runner: Node's built-in `node:test` → **zero dependencies**, consistent with the scraper family's stdlib-only doctrine. CI wires `node --test skills/ai-paste-cleanup/tests/` into `.github/workflows/test.yml`.

**Unit boundaries**

1. `rules.js` knows nothing about files, CLI, or diffs — it is a pure text→text library with one exported function per rule plus an ordered `applyAll(text)` that returns `{text, perRule, removed}`. Testable in isolation against the before/after cases.
2. `clean.js` knows nothing about regex internals — it does file IO, folder walking, diff rendering, the fingerprint self-check call, and the dry-run/write gate. It consumes `rules.js`.
3. `SKILL.md` knows nothing about either internal — it documents *when* to run, orchestrates dry-run → human gate → write, and produces the report.

## 5. Transform Library (8 rules, fixed order)

Each rule is a pure function returning the new text plus the list of removed character spans (for the fingerprint check). Applied in this fixed deterministic order:

| # | Rule | Find (flags `gm`, no `u`) | Replace | Removal allowlist |
|---|------|---------------------------|---------|-------------------|
| 1 | unbold-headings | `^(#{1,6} )\*\*(.+)\*\*\s*$` | `$1$2` | `*` only |
| 2 | citation-markers | **byte-exact from `data.json` — see §5 gate** | *(empty)* | `[`, `]`, optional leading space, and content inside a matched span |
| 3 | nbsp-to-space | ` ` | `" "` (one normal space) | net change is U+00A0 → U+0020 (no net deletion) |
| 4 | zero-width-strip | `[​‌‍﻿]` | *(empty)* | U+200B, U+200C, U+200D, U+FEFF only |
| 5a | italic-headings-asterisk | `^(#{1,6} )\*([^*]+)\*\s*$` | `$1$2` | `*` only |
| 5b | italic-headings-underscore | `^(#{1,6} )_([^_]+)_\s*$` | `$1$2` | `_` only |
| 6 | collapse-blank-lines | `\n{3,}` | `\n\n` | newline characters only |
| 7 | strip-trailing-whitespace | `[ \t]+$` | *(empty)* | space, tab only |

**Application scope:** the full file content (matching the linter's custom-regex behavior). Heading rules (#1, #5) are anchored to `^#{1,6} ` and will not match inside well-formed YAML frontmatter; the invisible-char rules (#3, #4) cleaning frontmatter values is desirable (invisible chars in property values break search/parsing). The fingerprint self-check is the guard against any unintended frontmatter mutation.

> **Build-phase gate (R2 — byte-exact verification):** Rules #2 (citation) and #4 (invisible chars) are **lossy in the rendered Markdown docs** — the brackets and invisible characters were swallowed by the renderer. Before coding these two, verify the byte-exact patterns against the live plugin config `.obsidian/plugins/obsidian-linter/data.json` (`customRegexes` array). **This is a production-vault read — a gate, not a step. obi asks the user explicitly before reading.** The other 6 rows (#1, #3, #5a, #5b, #6, #7) are written exactly from the docs (the `\uXXXX` escapes and anchored patterns are unambiguous).

> **Rule #2 is the highest-risk rule — wikilink/link/checkbox safety.** A naive citation pattern such as `\s?\[[^\]]*\]` would **corrupt** Obsidian wikilinks (`[[Note]]` → `[[Note]`), Markdown links (`[text](url)`), and task checkboxes (`- [ ]`, `- [x]`). The doc's own broader variant is marker-scoped (`\s?\[(cite|source|ref):[^\]]*\]`), which strongly implies the real pattern targets a **specific marker format**, not arbitrary brackets. The fingerprint guard (§6) does **not** protect against an over-broad citation pattern — the removed characters would sit inside a matched span, so the allowlist passes. Rule #2's correctness therefore rests on (a) the byte-exact pattern from `data.json` and (b) mandatory negative tests (§10) proving wikilinks, links, and checkboxes survive. If `data.json` reveals an unexpectedly broad pattern, narrow it for the skill and report the divergence.

## 6. Safety Layer — Fingerprint Self-Check (the incident guard)

Derived directly from the 2026-06-04 incident: a `\x{...}` character class was silently reinterpreted by the no-`u`-flag engine as the literal set `[xBCDEF02{}]`, deleting those characters from every note it touched. Detected after the fact via a fingerprint (zero occurrences of `x B C D E F 0 2`).

**Mechanism — per-rule allowlist guard:**

1. Each rule declares the set of characters it is *allowed* to remove (the "Removal allowlist" column above).
2. After each rule runs, the actual removed-character multiset is computed from the diff.
3. If a rule removed any character **outside** its declared allowlist → **ABORT the whole run, write nothing, report the violation.**

This catches the exact incident class: rule #4's broken form would have removed `x, B, C, D, E, F, 0, 2` — all outside its declared allowlist of four zero-width code points → immediate abort.

For rule #2 (citation removes arbitrary content inside a bracketed span), the check is span-scoped: every removed character must have belonged to a `\[...\]` span the rule actually matched. Verifiable by re-deriving the matched spans.

**Secondary guard (defense-in-depth):** abort if the total characters removed across all rules exceeds a threshold relative to file size (e.g. > 5% of the file, excluding rule #6/#7 whitespace), even if per-rule allowlists pass. Catches an unforeseen pathological combination.

**Whitespace-tier interaction:** rules #6 and #7 legitimately remove whitespace. The fingerprint check operates on **meaning-bearing character classes** (letters, digits, punctuation, the declared markers/invisibles) — whitespace removal by #6/#7 is expected and does not trip the meaning-bearing alarm.

## 7. CLI Contract — Dry-Run + Human Gate (two layers)

```
node clean.js <path> [--write]
```

1. `<path>` — a file **or** a directory (auto-detected via `stat`). Directory → recurse over `*.md` only (skips `_trash/`, `.obsidian/`, `.git/`, and dotfiles).
2. **Default = dry-run.** Without `--write`, the script reads, transforms in memory, runs the fingerprint check, and prints the diff + per-rule counts. It writes nothing.
3. `--write` — applies changes to disk. The fingerprint check still runs and still aborts on violation before any write.

**Two-layer gate:**

- The script never writes without `--write`.
- The skill (SKILL.md) never passes `--write` until the user has confirmed the dry-run.

**Folder safety:** in folder mode the dry-run summary surfaces the file count up front. Before `--write` on more than 10 files, the skill states `I will clean N files in <vault>. Confirm?` and waits — aligned with the repo's Production Vault Safety Rule #4.

## 8. Idempotency

Every rule is naturally idempotent: after `**` is removed from a heading, a re-run finds no `**`; `\n{3,}` leaves no 3+ run; trailing-whitespace strip leaves none. The whole pipeline is therefore idempotent.

**Test:** feed the output of a first run back through `applyAll` → expect zero changes and an empty per-rule count.

## 9. Report Format (Core + Nahbereich + Report)

Per philosophy.md, every run produces a summary:

```
## ai-paste-cleanup Report — <date>

### Done
- Cleaned 12 of 40 files
- unbold-headings: 7 | citation-markers: 19 | nbsp-to-space: 4 | zero-width-strip: 6
  | italic-headings: 3 | collapse-blank-lines: 11 | strip-trailing-whitespace: 28

### Findings
- 2 files with broken YAML frontmatter (-> property-enrich)   # reported, not fixed

### Unchanged
- 28 files already clean
```

Folder runs show the aggregate plus a per-file breakdown. Single-note runs show the inline diff.

## 10. Tests

1. **Rule before/after cases** — reuse the exact cases from `OPS – Linter Regex Test & Incident (Before-After)`, run via `new RegExp(p,"gm")`. Includes the heading negative cases that must stay untouched (`## The **important** thing`, `## *a* b *c*`, `## **Bold stays bold**`, `## snake_case word`).
2. **Rule #2 wikilink/link/checkbox safety (mandatory)** — these must stay byte-for-byte untouched: `[[Note Name]]`, `[[Note|alias]]`, `[text](https://url)`, `- [ ] task`, `- [x] done`, `![[embed.png]]`. This is the gate that proves the citation pattern is marker-scoped, not bracket-greedy.
3. **Idempotency** — second pass over first-pass output yields zero changes.
4. **Fingerprint guard** — a deliberately broken pattern (the `\x{}` form) is rejected by the allowlist guard; assert ABORT + no write.
5. **CLI** — dry-run writes nothing; `--write` applies; folder mode walks `*.md` only and skips excluded dirs.

## 11. Out of Scope / Backlog

1. **Phase 2 — auto-hook** after note-generating skills (scrapers, research). The real long-term value; separate design.
2. **Linter-admin skill** (separate): safely add/enable/disable/remove custom regexes in `data.json`, the `\x{}` guard + regex test harness, corruption fingerprint scan, recovery. Config-management, distinct from content-cleanup.
3. **`--backup`** to `_trash/ai-paste-cleanup-<timestamp>/` before `--write`.
4. **Configurable per-rule toggling** (Phase 3).
5. **Vault-wide auto-run** (high risk) — explicitly out.
6. **Non-Obsidian generic Markdown targets** — possible later given the path-based design.

## 12. Build-Phase Gates (carry into writing-plans)

1. **Byte-exact pattern verification** (§5 gate) — production-vault read of `data.json`, user-gated, before coding rules #2 and #4.
2. **CI wiring** — extend `.github/workflows/test.yml` to run `node --test` for this skill.
3. **SKILL.md conventions** — valid YAML frontmatter (`name`, `description` starting with "Use when…", 3+ trigger phrases), no hardcoded paths (`${OBSIDIAN_VAULT_PATH}`), no emoji, English only.
4. **Version bump + changelog** at ship time (release-time decision, not part of in-review).

## Related

- PRD: Nexus `020_Processes/OPS – PRD AI-Paste Cleanup Skill (Handoff for obi)`
- `OPS – Obsidian Linter Setup (AI-Paste Cleanup)`
- `OPS – Linter Regex Test & Incident (Before-After)`
