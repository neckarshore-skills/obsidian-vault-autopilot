---
name: ai-paste-cleanup
status: beta
description: Use when AI-generated or pasted Markdown carries cruft - bold/italic-wrapped headings, citation markers, non-breaking spaces, zero-width characters, trailing whitespace, runs of blank lines. Trigger phrases - "clean this note", "clean up AI paste", "remove the slop", "fix pasted markdown", "clean this folder". Complements the obsidian-linter plugin; cleans notes Claude wrote directly or for users who do not run the linter.
---

# AI-Paste Cleanup

Apply the proven-safe AI-paste cleanup transforms to a note or folder. Deterministic Node script; always dry-run first; never writes without confirmation.

## Principle: Core + Nahbereich + Report

- **Core:** Run the 8 validated transforms (`scripts/rules.js`) over a file or folder.
- **Nahbereich:** None destructive. The fingerprint self-check aborts the whole run rather than risk a bad edit.
- **Report:** Per-rule counts, files changed, anything noticed but not fixed (e.g. broken YAML -> property-enrich).

## How to run

1. **Dry-run (always first):**
   `node "${CLAUDE_PLUGIN_ROOT}/skills/ai-paste-cleanup/scripts/clean.js" <path>`
   Show the user the per-rule counts. For a single file, also show a diff: get the cleaned text via `... clean.js <file> --stdout` and present old vs new.
2. **Human gate:** ask "Apply these changes? (yes/no)". For a folder of more than 10 files, first state: "I will clean N files in <vault>. Confirm?" and wait.
3. **Write (only after yes):**
   `node ".../clean.js" <path> --write`
4. If the script exits non-zero with `ABORTED - Fingerprint guard...` or `... Mass-deletion guard...`, **do not retry blindly**. Report the violation; it means a transform tried to delete unexpected content. Nothing was written.

## Scope and safety

- Folder mode processes `*.md` only and skips `_trash/`, `.obsidian/`, `.git/`, dotfiles.
- The script is the only thing that applies regexes - never hand-edit notes to "clean" them; determinism is the safety guarantee.
- Production-vault runs follow the repo's Production Vault Safety Rules (gate before switching vaults; confirm before > 10 files).

## Known limitations

- **Citation rule operates on the whole file, including frontmatter.** A YAML value whose array begins with `cite:` (e.g. `tags: [cite:foo, bar]`) will be stripped. This matches the obsidian-linter plugin's own behavior. Body-scoping is backlog. Rare in practice.
- **Mass-deletion backstop can abort short, marker-heavy pastes.** A tiny note that is mostly formatting markers (e.g. a 3-word bold heading with little body) can exceed the 25% non-whitespace-removal threshold and abort with nothing written. This fails in the safe direction. Realistic notes with body text are unaffected.
- **No line-ending normalization.** Content is processed as-is; CRLF vs LF is not changed (structural, out of scope).
- **Zero-width strip preserves U+200D (ZWJ).** ZWJ is the joiner in emoji ZWJ-sequences (e.g. person+ZWJ+laptop), so removing it would corrupt emoji. A genuine stray ZWJ used as paste cruft is therefore left in place; ZWSP/ZWNJ/BOM are still stripped. (Real-vault UAT 2026-06-16: 0 stray ZWJ vs 11 emoji-ZWJ.)

## Report format

```
## ai-paste-cleanup Report - <date>
### Done
- Cleaned <n> of <m> files
- <per-rule counts>
### Findings
- <things noticed, routed to other skills>
### Unchanged
- <count> already clean
```
