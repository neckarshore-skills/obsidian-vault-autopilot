# Backup and Recovery

## No Backup, No Mercy

Before you run any skill in this plugin, you need a backup. Not a vague idea of a backup — a real, restorable snapshot of your vault that you can roll back to if something goes wrong.

If you run a destructive skill without a restorable backup and you lose data, we cannot recover it for you. This is a physical fact about how this plugin interacts with your filesystem. There is no support escalation that changes it.

## What Counts as a Real Backup

A real backup satisfies three properties:

1. **Separate from the live vault.** A snapshot in the same directory, on the same disk, under the same sync service is not independent — one failure can take both out.
2. **Time-addressable.** You can choose a specific point in time to restore from. "The backup I took yesterday" is fine. "The current state on the sync server" is not a backup, it is a mirror.
3. **Tested restore at least once.** A backup you have never restored from is a hypothesis, not a backup.

## Backup Methods for Obsidian Vaults

| # | Method | Independent? | Time-addressable? | Obsidian-friendly? | Recommended? |
|---|--------|--------------|-------------------|--------------------|--------------|
| 1 | Time Machine (macOS) | Yes | Yes (hourly snapshots) | Yes | Yes — best for most macOS users |
| 2 | Obsidian Git plugin (commit + push) | Yes | Yes (per commit) | Yes — excludes `.obsidian/workspace.json` by default | Yes — best if your vault is already text-oriented |
| 3 | rsync to external disk | Yes | If you version the target folders | Yes | Yes for Linux / power users |
| 4 | Borg / restic snapshots | Yes | Yes | Yes | Yes for serious backups |
| 5 | Obsidian Sync | No | No (current state only) | Yes — but it is a mirror | **No, not a backup** |
| 6 | iCloud Drive | No (live sync) | No (current state only) | Partial | **No, not a backup** |
| 7 | Full vault clone to another folder | Yes | Only the moment you cloned | Yes | Acceptable for one-shot backups before a skill run |
| 8 | Dropbox / Google Drive | No (live sync) | Depends on plan (revision history is not a backup) | Partial | **No, not a backup** |

> **Sync services are not backups.** iCloud, Dropbox, OneDrive, Google Drive, and Obsidian Sync are **mirrors**. If a skill corrupts your vault, the corruption syncs. If you delete a file, the deletion syncs. Some services offer revision history — check explicitly whether you can restore the whole vault to a specific point in time. If you cannot, it is not a backup for this purpose.

## Recommended Backup Procedure Before Your First Skill Run

1. **Time Machine users:** verify your latest Time Machine backup includes your vault. `tmutil latestbackup`, then navigate to the vault path inside the backup. Confirm the file count matches your live vault.
2. **Git users:** commit everything first. `git add . && git commit -m "pre-skill-run snapshot $(date +%Y-%m-%d)"`. Push if you have a remote.
3. **Neither:** clone the vault to an external disk or a separate folder:
   ```bash
   ditto -V "$HOME/Vaults/MyVault" "/Volumes/Backup/MyVault-$(date +%Y-%m-%d)"
   ```
   Verify the clone has the same file count as the source.

Only after the backup is verified should you proceed to the [Cloning Guide](cloning-guide.md) to create the working clone you will actually run skills against.

## Recovery Procedures by Failure Class

### "The skill moved files to the wrong folder"

**Symptom:** notes are in the wrong subfolder after an `inbox-sort` or similar run.

**Recovery:**

1. Check `logs/run-history.md` — every move is logged with source and destination.
2. If the vault is under Git: `git diff HEAD` shows the exact set of moves. `git checkout -- .` reverts them.
3. If the vault is not under Git: manually move the files back using `logs/run-history.md` as the source of truth.
4. Never re-run the skill hoping to "fix" the sorting — you will compound the problem.

### "The skill soft-deleted files I wanted to keep"

**Symptom:** notes are in `_trash/` that you did not expect.

**Recovery:**

1. Every file in `_trash/` has `trash_source` and `trash_origin` in frontmatter.
2. Move each file back to its `trash_origin` path.
3. Afterwards, consider why the skill trashed them — was the filename matching a pattern? Was content matching? Adjust skill config before the next run.

### "YAML is corrupt after a run"

**Symptom:** Obsidian shows "invalid frontmatter" errors on multiple files.

**Recovery:**

1. If the vault is under Git: `git diff` shows exactly what changed. `git checkout -- <file>` reverts individual files.
2. If not: restore affected files from your backup.
3. Report the issue — a skill should never produce invalid YAML. File an [issue](https://github.com/neckarshore-skills/obsidian-vault-autopilot/issues) with an example file (sanitized) and the run log.

### "Filesystem birthtime is lost / cooldown is behaving strangely"

**Symptom:** Skills report cooldown skips that do not match your expectations.

This is the **birthday-bug** failure mode — see [incident-birthday-bug.md](incident-birthday-bug.md) for the full story.

**Recovery:**

1. Run `property-enrich` to fill YAML `created` fields from filename patterns or filesystem metadata. This makes filesystem birthtime irrelevant because YAML wins.
2. If you need to restore filesystem birthtime itself: `touch -t YYYYMMDDHHMM <file>` for each file, using the YAML `created` value as the target.

### "The whole vault state looks wrong and I do not know what happened"

**Symptom:** widespread changes, unclear what the skill did, panic.

**Recovery:**

1. **Stop running skills.** Do not try to un-run.
2. Close Obsidian.
3. Restore from your most recent pre-skill-run backup.
4. Verify the restore: file count, a sample of notes, the folder structure.
5. Open an [issue](https://github.com/neckarshore-skills/obsidian-vault-autopilot/issues) with the run log from `logs/run-history.md` — we want to understand what happened.

## When to File an Issue vs. When to Just Restore

- **File an issue:** skill produced invalid YAML, moved files in a way that contradicts its own documentation, silently modified files outside its documented scope, or any behavior that looks like a bug in the plugin.
- **Just restore:** you ran a skill with the wrong config or on the wrong folder and got the expected-but-unwanted outcome. That is a user operation, not a bug.

A good heuristic: "is the skill behaving consistently with its own SKILL.md documentation?" If yes, restore and adjust your run. If no, file an issue.
