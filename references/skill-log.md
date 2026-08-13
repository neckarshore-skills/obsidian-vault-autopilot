# Skill Log

Every skill that modifies a note must leave a trace: a tag in frontmatter and a row in the skill log callout.

> **Important:** The callout is appended to the **note body**, not to frontmatter. It is the one body write every note-modifying skill performs, and it is sanctioned by this contract. A skill's Boundaries section must therefore never claim it leaves the body untouched — the correct claim is that it does not *rewrite* body content, with this callout named as the appended exception. A boundary that denies the callout puts the executing model in front of a silent choice between two authoritative instructions.

## Tag

Add `VaultAutopilot` to the `tags` list in YAML frontmatter if not already present. This marks the note as "touched by automation" and makes it searchable.

```yaml
tags:
  - ExistingTag
  - VaultAutopilot
```

### Tag Format Rules

YAML allows two formats for lists. Both are valid, but skills must handle both and always write block format:

```yaml
# Inline format (from imports, e.g. Apple Notes) — read this
tags: [AppleNoteImport, Obsidian]

# Block format (Obsidian standard) — always write this
tags:
  - AppleNoteImport
  - Obsidian
```

- **Read:** Accept both inline `[X, Y]` and block `- X` formats.
- **Write:** Always write block format. If a note has inline tags, convert to block when adding `VaultAutopilot`.
- **Never crash** on unexpected tag formats. If the format is unrecognizable, report it as a finding instead of failing.

## Skill Log Callout

Append an Obsidian callout block at the **end** of the note. If the callout already exists, append a new row to the table. Never duplicate existing rows.

### Format

```markdown
> [!info] Vault Autopilot
>
> | Date | Skill | Action |
> |------|-------|--------|
> | 2026-04-06 14:32 | inbox-sort | Moved from Inbox root to _Work |
```

### Rules

1. **Position:** Always the last block in the note. No content after it.
2. **Date:** `YYYY-MM-DD HH:MM` format (24h), use current date and time. Older entries with `YYYY-MM-DD` only are valid — no need to backfill.
3. **Skill:** Skill name as listed in plugin.json (e.g., `inbox-sort`, `note-rename`, `property-enrich`).
4. **Action:** One-line summary of what happened. Be specific:
   - inbox-sort: `Moved from [source] to [target bucket]`
   - note-rename: `Renamed from [old name]` or `Reviewed — name already descriptive`
   - note-quality-check: `[Action] — [reason]` (e.g., `Archived to 099_Archive/`)
   - property-classify: `Set status: [value], type: [value]`
   - property-describe: `Generated description ([char count] chars)`
   - property-enrich: `Added [field list]`
5. **Existing callout:** Detect by looking for `> [!info] Vault Autopilot` at the end of the file. If found, append a new `> | date | skill | action |` row. If not found, create the full block.
6. **Separator:** Add one blank line before the callout if there is none.

### Idempotency Rules

Every skill must follow these rules to prevent duplicates and ensure safe re-runs:

1. **Tag:** Check if `VaultAutopilot` exists in `tags` before adding. Never duplicate. If no `tags` field exists, create one.
2. **Callout:** Check if `> [!info] Vault Autopilot` exists at end of file before creating. If it exists, append a row — never create a second callout block.
3. **Rows:** Do not duplicate identical rows (same date/time + same skill + same action). A re-run with the same outcome should not add a second identical row.
4. **Re-processing:** If a skill runs again and performs a different action (e.g., re-rename), add a new row. The callout is a history — multiple entries from the same skill are valid when the actions differ.

## Birthtime Preservation

Every skill that writes to a note (tag, callout, or any edit) **must restore the filesystem birthtime** after the write. On APFS, Claude Code's Edit/Write tools create a new inode, resetting birthtime to "now". This destroys the original creation date.

### Procedure

1. **Before writing:** Read YAML `created` from frontmatter. If absent, read filesystem birthtime via `stat -f %B` (macOS) or `stat -c %W` (Linux). Store the timestamp.
2. **After writing:** Restore birthtime via `touch -t YYYYMMDDhhmm.ss <file>`. On APFS, `touch -t` sets birthtime when the target timestamp is older than the current birthtime.
3. **If no date source exists after auto-enrich:** This is rare — it means no filename date, no Git history, and no readable filesystem birthtime. If it occurs, restore from the pre-write filesystem birthtime captured before the write. Report the note as a Finding. Do not fabricate timestamps.

### Why This Matters

Without preservation, every skill run resets the file's creation date. Cooldown logic (`cooldown_days`) uses YAML `created` as primary source and filesystem birthtime as fallback. If both are wrong, cooldown decisions become unreliable — the skill processes files it should skip, or skips files it should process.

As of v0.1.0, note-rename and inbox-sort auto-enrich the YAML `created` field when missing (Nahbereich), using the Source Hierarchy from `docs/metadata-requirements.md`. This ensures a date source is almost always available for birthtime restoration.

### Cross-Platform Notes

- **macOS (APFS):** `touch -t` updates birthtime if the new timestamp is older than current. `stat -f %B` reads birthtime as epoch.
- **Linux (ext4):** Birthtime support varies by kernel version and filesystem. `stat -c %W` returns birthtime if available (0 if not). `touch -t` only sets mtime/atime — birthtime cannot be restored on ext4. On Linux, YAML `created` is the only reliable source.

## Detection

To check if a note has been processed by any skill:

- **Tag search:** Filter by `VaultAutopilot` tag in Obsidian
- **Callout search:** Search for `[!info] Vault Autopilot` across vault
- **Specific skill:** Search callout table for skill name

## Why Both Tag and Callout

- **Tag:** Fast filtering in Obsidian (sidebar, Dataview, search). Answers: "has automation touched this?"
- **Callout:** Full history. Answers: "what happened, when, by which skill?"
