# Getting Started

This guide walks you through your first safe run of Vault Autopilot — from installation to your first skill execution on a cloned vault. Follow these steps in order.

## Prerequisites

- [Claude Code](https://claude.ai/code) installed
- An Obsidian vault (any structure, any size)

## Step 1 — Back Up Your Vault

Before anything else, make sure you have a restorable backup of your vault. See [Backup and Recovery](backup-and-recovery.md) for methods that work.

**Quick version for macOS (Time Machine users):** verify your latest backup includes your vault folder. `tmutil latestbackup` shows the timestamp.

**Quick version for Git users:** `git add . && git commit -m "pre-vault-autopilot snapshot"` in your vault directory.

## Step 2 — Clone Your Vault

Create a working copy to test on. **Never run skills on your production vault first.**

**macOS (recommended — preserves birthtimes):**

```bash
ditto -V "$HOME/Vaults/MyVault" "$HOME/Vaults/MyVault-Clone"
```

**macOS (Finder):** Right-click your vault folder → Duplicate. Birthtimes are preserved on macOS (tested with both `ditto` and Finder). Works without extra steps.

**Windows:** Clone your vault with `robocopy`, NOT File Explorer. File Explorer silently drops files at paths exceeding MAX_PATH (260 chars), which is common in deep PARA structures. Use:

```powershell
robocopy "C:\Users\<you>\Documents\Vaults\MyVault" `
         "C:\Users\<you>\Documents\Vaults\MyVault-Clone" /E /COPY:DAT
```

Birthtimes are not reliably preserved on Windows clones even with `/COPY:DAT` (GR-3 empirical finding 2026-05-01: 36.8% of files reset to clone-time). The launch-scope skills detect this at preflight and SKIP date-derivation for affected files — `property-enrich` is recommended first for bulk coverage, other skills auto-enrich `created` per-note during runs. See [Windows Considerations](windows-considerations.md) and [Cloning Guide](cloning-guide.md) for full procedure.

**Linux:**

```bash
rsync -aAX "$HOME/Vaults/MyVault/" "$HOME/Vaults/MyVault-Clone/"
```

Most Linux filesystems (ext4) do not store birthtime — only ctime/mtime/atime. `rsync -aAX` preserves what the filesystem supports, but `created` date coverage will be low on ext4 vaults. `property-enrich` backfills `created` from filename patterns, YAML, and Git history; run it first for the best metadata baseline. XFS and Btrfs do store birthtime and behave like macOS.

For details on why the clone method matters, see [Cloning Guide](cloning-guide.md).

> **If you use Obsidian Sync:** disable it on both the source and the clone before proceeding. See [Cloning Guide — Obsidian Sync Must Be Off](cloning-guide.md#obsidian-sync-must-be-off).

## Step 3 — Install the Plugin

In Claude Code, add the marketplace:

```bash
/plugin marketplace add neckarshore-ai/obsidian-vault-autopilot
```

Then install the plugin:

```bash
/plugin install obsidian-vault-autopilot@neckarshore-ai
```

Run each command as a separate Claude Code input — pasting both lines together causes Claude Code to treat the whole string as the marketplace source and fall back to a failing SSH clone.

(For the manual / local-clone install path, see the README's "Installation" section.)

Set your vault path to point at the **clone** (not your production vault):

```bash
export OBSIDIAN_VAULT_PATH="$HOME/Vaults/MyVault-Clone"
```

## Step 4 — Check Metadata Coverage (Optional)

For the best experience on large vaults, run `property-enrich` to fill missing YAML `created` fields in bulk. Other skills (note-rename, inbox-sort) auto-enrich `created` per-note during their runs, so this step is optional but efficient for vaults with low metadata coverage. See [Metadata Requirements](metadata-requirements.md).

**Check your coverage first:**

```bash
cd "$OBSIDIAN_VAULT_PATH"
TOTAL=$(find . -name "*.md" -not -path "./.obsidian/*" -not -path "./_trash/*" | wc -l)
WITH_CREATED=$(grep -rl "^created:" --include="*.md" . 2>/dev/null | grep -v ".obsidian" | grep -v "_trash" | wc -l)
echo "Coverage: $((WITH_CREATED * 100 / TOTAL))% ($WITH_CREATED / $TOTAL)"
```

- **95% or higher:** you can skip to Step 5.
- **Below 95%:** running `property-enrich` now is recommended for efficiency. It fills `created` from filename date patterns, filesystem metadata, or Git history. It does not move, rename, or delete any file. You can also skip this and let skills auto-enrich per-note.

After `property-enrich`, re-run the coverage check. It should be near 100%.

## Step 5 — Preview Before Running

Every skill supports `--preview` mode. Use it before any real execution:

```
inbox-sort --preview
```

The preview shows what would happen without changing any files. Check:

- Are the proposed moves sensible for your vault structure?
- Is the file count reasonable (not "0 files" — that may indicate a cooldown problem)?
- Are any files being moved that you want to stay put?

## Step 6 — Run Your First Skill

Once the preview looks right, run the skill for real. Start with a small scope if possible — a single folder rather than the entire vault.

**Recommended first-run order:**

| # | Skill | Why this order |
|---|-------|---------------|
| 1 | `property-enrich` | Fills metadata that other skills depend on |
| 2 | `note-rename` | Renames poorly-named files. Depends on metadata from Step 1 |
| 3 | `inbox-sort` | Sorts inbox files into folders. Works best after notes are properly named |

After each skill run, review the changes:

- Check `logs/run-history.md` for a record of what happened.
- Open a few affected notes in Obsidian to verify the changes look right.
- If anything looks wrong, the clone is disposable — delete it and start over.

## Step 7 — Decide About Production

Once you are satisfied with the results on the clone:

1. **Back up your production vault again** (a fresh backup, not the one from Step 1).
2. Point `OBSIDIAN_VAULT_PATH` at your production vault.
3. Run `--preview` first to see what would happen on production.
4. If the preview looks right, run the skill.

**There is no rush.** The clone is yours to experiment with. Run multiple skills, try different configurations, break things and re-clone. That is what clones are for.

## Troubleshooting

| # | Symptom | Likely cause | Fix |
|---|---------|-------------|-----|
| 1 | "0 files processed" on a vault with hundreds of notes | Cooldown is protecting everything — all files appear recently created (clone with reset birthtimes) | Run `property-enrich` to backfill `created` in bulk, or check that auto-enrich is working (skills should fill `created` per-note) |
| 2 | Skill skips files you expected it to process | Files are newer than 3 days (cooldown) or match a protected pattern | Check `created` dates; adjust cooldown if needed |
| 3 | Files moved to `_secret/` unexpectedly | Secret detection found sensitive content (API keys, passwords, financial data) | Review the files — this is a safety feature |
| 4 | "Invalid frontmatter" errors in Obsidian after a run | Corrupted YAML — rare but possible | Restore from backup and file an [issue](https://github.com/neckarshore-ai/obsidian-vault-autopilot/issues) |

## Next Steps

- Read the [Safety section](../README.md#safety) for the full safety feature list.
- Read about the [Birthday Bug](incident-birthday-bug.md) to understand why metadata matters.
- Explore individual skill documentation in `skills/*/SKILL.md` for configuration options.
