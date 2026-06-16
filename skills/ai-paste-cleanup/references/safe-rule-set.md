# Safe Rule Set - ai-paste-cleanup

The validated transform set applied by `scripts/rules.js`, in fixed order. Patterns are reused byte-for-byte from the obsidian-linter custom regexes (verified against the live plugin config `data.json`) and the two regex provenance docs - never re-derived.

## Engine-fidelity invariant (non-negotiable)

Every pattern runs as `new RegExp(source, "gm")` - global + multiline, **never the `u` flag** - to match the obsidian-linter's JavaScript engine. **`\x{...}` is forbidden; use `\uXXXX`.** This is incident-backed: on 2026-06-04 a `\x{200B}` form was silently reinterpreted by the no-`u`-flag engine as the literal set `[xBCDEF02{}]`, deleting those characters from every note it touched. The per-rule fingerprint guard exists to catch exactly this class of bug.

## Rules (fixed order)

| # | Name | Find (flags `gm`) | Replace | Removal allowlist | Fixes |
|---|------|-------------------|---------|-------------------|-------|
| 1 | unbold-headings | `^(#{1,6} )\*\*(.+)\*\*[ \t]*$` | `$1$2` | `*` | Whole-line bold-wrapped headings |
| 2 | citation-markers | `\s?\[cite:[^\]]*\]` | (empty) | span-based (null) | `[cite:...]` citation markers |
| 3 | nbsp-to-space | ` ` | (space) | ` ` | Non-breaking spaces |
| 4 | zero-width-strip | `[U+200B U+200C U+FEFF]` | (empty) | those 3 | Zero-width chars + BOM (ZWJ U+200D excluded - see Divergence) |
| 5 | italic-headings-asterisk | `^(#{1,6} )\*([^*]+)\*[ \t]*$` | `$1$2` | `*` | Whole-line `*italic*` headings |
| 6 | italic-headings-underscore | `^(#{1,6} )_([^_]+)_[ \t]*$` | `$1$2` | `_` | Whole-line `_italic_` headings |
| 7 | collapse-blank-lines | `\n{3,}` | `\n\n` | `\n` | 3+ blank lines -> one |
| 8 | strip-trailing-whitespace | `[ \t]+$` | (empty) | space, tab | Trailing spaces/tabs |

## Divergence from the plugin (intentional)

The three heading rules (#1, #5, #6) use `[ \t]*$` where the plugin's `data.json` uses `\s*$`. Reason: under the `m` flag `\s` matches `\n`, so `\s*$` greedily deletes the blank line(s) after a wrapped heading. The plugin tolerates this (no guard); our fingerprint guard correctly rejects deleting `\n` outside a heading rule's `['*']`/`['_']` allowlist. Using `[ \t]*$` keeps heading-unwrapping line-local and leaves blank-line management to rule #7/`collapse-blank-lines`. Net behavioral difference: the plugin eats trailing blank lines after a heading; this skill does not (collapse-blank-lines normalizes spacing deterministically instead).

Rule #4 (zero-width-strip) additionally **excludes U+200D (ZWJ)**. The plugin's `data.json` strips it, but U+200D is the joiner inside emoji ZWJ-sequences (e.g. person + ZWJ + laptop = technologist), so removing it silently corrupts emoji. Real-vault UAT on 2026-06-16 found **0 stray ZWJ versus 11 emoji-ZWJ across 1592 notes** - every ZWJ in the vault was load-bearing. A context-aware "strip only non-emoji ZWJ" rule would need Unicode-aware lookarounds and thus the `u` flag, which the engine-fidelity invariant forbids; excluding U+200D entirely is the invariant-preserving fix. Genuine zero-width cruft (U+200B ZWSP, U+200C ZWNJ, U+FEFF BOM) is still stripped.

## Safety layers

1. **Per-rule fingerprint guard** - after each rule, the multiset of removed characters must be a subset of the rule's `allowedRemovals`, else abort the whole run (write nothing). Catches the 2026-06-04 incident class.
2. **Span-based citation rule (#2)** has `allowedRemovals: null` - the charset guard cannot cover arbitrary content inside a matched `[cite:...]` span, so its safety rests on (a) the byte-exact marker-scoped pattern and (b) mandatory negative tests proving wikilinks `[[Note]]`, links `[t](url)`, embeds `![[x.png]]`, and checkboxes `- [ ]`/`- [x]` survive.
3. **Coarse mass-deletion backstop** - abort if a run drops more than 25% of the note's non-whitespace characters, even if per-rule guards pass. Defense-in-depth against an unforeseen pathological combination (chiefly a span rule going rogue).

## Known limitations

- **Citation rule is whole-file:** a frontmatter array value beginning with `cite:` (e.g. `tags: [cite:foo]`) is stripped. Matches plugin behavior. Body-scoping is backlog.
- **Mass-deletion false-positive on tiny marker-heavy pastes:** a short note dominated by formatting markers can trip the 25% backstop and abort (safe direction). Realistic notes are unaffected. Tuning (absolute floor, or counting only span-rule removals) is a backlog decision.
- **No line-ending normalization (CRLF/LF):** content is processed as-is.
- **ZWNJ (U+200C) is still stripped.** Unlike ZWJ it has no emoji role, but it carries meaning in some scripts (Persian/Arabic, Indic) and rare typographic joins. No real-vault hits to date; revisit (same class as the ZWJ exclusion) if a script-heavy vault surfaces false positives.

## Provenance

- `OPS - Obsidian Linter Setup (AI-Paste Cleanup)` (Nexus vault) - the rule definitions.
- `OPS - Linter Regex Test & Incident (Before-After)` (Nexus vault) - the before/after cases + the 2026-06-04 incident.
- Live plugin config `data.json` (`customRegexes`) - byte-exact verification of rule #2 (citation) and the rule #4 invisible-char set (U+200D subsequently excluded - see Divergence), read under a user-gated production-vault access on 2026-06-16.
