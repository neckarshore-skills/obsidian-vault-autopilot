# Windows Considerations

> **86% of Obsidian users are on Windows.** This document captures Windows-specific filesystem behavior that affects Vault Autopilot, based on empirical testing on Windows 11 (NTFS, German locale) on 2026-04-26.

## TL;DR for Windows Users

1. **Use `robocopy` to clone your vault, not File Explorer.** File Explorer (PowerShell `Copy-Item` underneath) silently drops files at long paths. `robocopy /E /COPY:DAT` reliably preserves all files. **However, CreationTime preservation is NOT reliable on Windows clones** — even with `robocopy /COPY:DAT`. The GR-3 strict-path validation on 2026-05-01 found 36.8 % (189 / 514) of files clustering at clone-time, regardless of source CreationTime values (likely post-clone Defender / Indexer / Obsidian-cache resets). The launch-scope skills detect this pattern at preflight time (WARN) and SKIP date-derivation for affected files at runtime — see [`references/clone-cluster-detection.md`](../references/clone-cluster-detection.md).
2. **Enable Long Path support before running any skill.** Windows defaults to a 260-character path limit. Vaults with deep folder hierarchies and long descriptive folder names exceed this routinely. Without long path support enabled, Vault Autopilot skills cannot see those files and will silently skip them.
3. **Always run `property-enrich` first on a Windows clone.** Filesystem creation date is unreliable on Windows after copying. YAML `created` is the source of truth.
4. **Start a fresh Claude Code session before invoking a skill.** "Resume Session" can short-circuit the Windows preflight gate using a cached pass-state from earlier in the conversation, even if the registry value has changed since. Fresh session = fresh gate.
5. **Start Claude Code from your home directory or a project folder, not from `C:\WINDOWS\system32`.** Project-level config in the working directory can disable plugins that you enabled at the user level.

## Session Discipline & First-Run Gotchas

These are not bugs in Vault Autopilot — they are platform-level behaviors of Claude Code on Windows that affect how skills run. Worth knowing once.

### 1. Resume Session can skip the preflight gate

Empirically observed 2026-04-27: a Windows user toggled `LongPathsEnabled` from `1` to `0` mid-session, then used `Resume Session` to re-trigger a skill. Claude Code skipped the preflight entirely (no registry check, no STOP message), used a cached pass-state from an earlier successful run in the same conversation, and proceeded to the workflow. Had the run been against a real degraded vault, files at long paths would have been silently skipped.

The preflight gate's wording was strengthened in v0.1.1 to instruct "run on EVERY invocation, no caching across turns" — but the most reliable habit is:

> **Before invoking a skill on Windows, exit and start a fresh Claude Code session.** Do not rely on `Resume Session` for skill runs. The 3 seconds of restart cost are worth the certainty that the gate ran fresh.

This applies to any skill that depends on registry state, environment variables, or filesystem flags — not just Vault Autopilot.

### 2. PowerShell first-use authorization

The first time a Vault Autopilot skill calls `powershell.exe` from Claude Code on Windows (Step 2 of the preflight), Claude Code may prompt the user to authorize the tool call. This is normal Claude Code behavior — approve once, and subsequent calls in the same session run without re-prompting.

If you decline the authorization, the preflight will fall through to the manual fallback path (Step 4 in `references/windows-preflight.md`), which asks you to run the registry check yourself.

### 3. Project-level vs user-level plugin enablement

Claude Code stores plugin enablement in two places:

| # | Scope | File | Wins when conflict? |
|---|-------|------|---------------------|
| 1 | User-level | `~/.claude/settings.json` | No |
| 2 | Project-level | `<cwd>/.claude/settings.local.json` | **Yes — project wins over user** |

If you start Claude Code from `C:\WINDOWS\system32` (the default `cmd.exe` working directory), Claude Code may create a project-level `settings.local.json` in `C:\WINDOWS\system32\.claude\` with the plugin auto-disabled. Symptom: `/reload-plugins` reports "0 skills loaded" despite a successful `/plugin install`.

**Fix:** start Claude Code from your home directory or a project folder:

```cmd
cd %USERPROFILE%
claude
```

Or check the offending project-level file:

```cmd
type C:\WINDOWS\system32\.claude\settings.local.json
```

If `enabledPlugins` shows your plugin as `false`, either delete that file or start Claude Code from a different directory.

### 4. Right-click pastes OAuth codes (Ctrl+V does not)

On Windows, the Claude Code TUI's OAuth login prompt does not respond to `Ctrl+V`. Use **right-click** to paste the OAuth code instead. This is a generic Claude Code platform behavior, not specific to Vault Autopilot, but it is the friction point most first-time Windows users hit.

### 5. Why a `/plugin marketplace update` may not actually update

Claude Code's marketplace caches plugin content keyed on the `plugin.json` version field, not the commit SHA. If you run `/plugin marketplace update neckarshore-ai` followed by `/reload-plugins` and both report success — but you still see old behavior — the cache likely matched on an unchanged version number and skipped the re-fetch.

**User-side workaround:** full uninstall + reinstall.

```
/plugin uninstall obsidian-vault-autopilot
/plugin install obsidian-vault-autopilot@neckarshore-ai
/reload-plugins
```

**Process implication for Vault Autopilot itself:** every release that touches plugin content bumps the version field in `plugin.json`, even for docs-only or wiring-only changes. Without that bump, no existing install would receive the update.

## Long Path Limit (MAX_PATH 260)

### What it is

Windows traditionally limited file paths to 260 characters total (drive + folders + filename + extension). Modern Windows 10/11 supports longer paths, but it must be **explicitly enabled** in the registry or per-application via manifest.

### Why it matters for Obsidian vaults

A typical descriptive PARA-style vault routinely produces paths like:

```
C:\Users\<username>\Documents\Vaults\<vault-name>\010_Outcomes - WHAT I WANT - Everything with a concrete goal, decision, or expected result\10_Projects\10 - <Project Name> - <Description>\Components\<Component Name>\<Note Title>.md
```

That is 250+ characters before you reach the filename. One descriptive note title and you cross 260.

### What we measured

On a 1856-note vault (Mac-origin, transferred to Windows):

- **PowerShell `Get-ChildItem` could not enumerate ~14 subfolders** with paths exceeding 260 characters. Errors thrown silently per folder; the recursion continued but missed those files.
- **PowerShell `Copy-Item` (= File Explorer drag-drop) dropped 140 files** in cloning operations to the same destination. Same root cause: the API hits MAX_PATH and skips the file without raising a fatal error.
- **`robocopy /E` copied all 1856 files successfully.** Robocopy uses a different code path that bypasses MAX_PATH.

### Implications

| # | Risk | Affects |
|---|------|---------|
| 1 | Vault Autopilot skills cannot see files at long paths if MAX_PATH is not raised | All skills, all Windows users with deep vault structures |
| 2 | File Explorer-cloned vaults are missing files vs. source | Anyone who clones via Ctrl+C → Ctrl+V or drag-drop |
| 3 | Skills that scan `inbox/` may report "0 files" when actually some are at long paths | inbox-sort, note-quality-check |

### How to enable Long Path support on Windows

```powershell
# As administrator, run once:
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
# Then restart your shell (close and reopen the terminal).
```

This raises the limit to ~32,767 characters (UNC \\?\\ prefix mode). It is required for Vault Autopilot to operate correctly on vaults with deep folder structures.

After enabling, verify in PowerShell:

```powershell
(Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem").LongPathsEnabled
# Should return 1
```

## Clone Method Behavior — Measured 2026-04-26

We cloned the same 1856-note source vault three times using three methods, then measured file count and timestamp preservation.

| # | Method | Files copied | CreationTime preserved | LastWriteTime preserved |
|---|--------|--------------|------------------------|-------------------------|
| 1 | **`scp` from macOS** (reference) | 1856 / 1856 | No — set to transfer time | Yes |
| 2 | **PowerShell `Copy-Item`** (= File Explorer copy-paste) | 1716 / 1856 — **140 files dropped** | No — set to copy time | Yes |
| 3 | **`robocopy /E`** | 1856 / 1856 | Preserved at clone-time, but unreliable in practice (see below) | Yes |

> **2026-05-01 update — empirical CreationTime cluster on robocopy clone.** A second strict-path validation (GR-3) on a fresh `robocopy /E /COPY:DAT` clone found 36.8 % (189 / 514) of inbox-tree files with `CreationTime = 2026-04-16T20:33:23Z` (the clone moment), clustered within ±30 s. The 2026-04-26 measurement above (taken immediately after the copy) showed CreationTime preserved; by 2026-05-01 a large subset had been reset, most likely by post-clone Defender / Indexer / Obsidian-cache writes. The launch-scope skills mitigate this at runtime via [`references/clone-cluster-detection.md`](../references/clone-cluster-detection.md) — files in the cluster window with no alternate date source are SKIPPED rather than enriched with the clone-time value. The Windows preflight ([`references/windows-preflight.md`](../references/windows-preflight.md) Step 7) surfaces the cluster as a WARN at the start of every skill run so the user has visibility before SKIPs accumulate as Class-C findings.

### What this means for Vault Autopilot's `created` field

The plugin's auto-enrich logic uses a fallback chain to determine the `created` YAML field when missing: filename date > git history > filesystem CreationTime.

On Windows, filesystem CreationTime is the **least reliable** source because it depends on how the file got there:

- If you cloned with **File Explorer** or **PowerShell Copy-Item**: CreationTime reflects when you copied the vault, not when the note was actually written. Auto-enrich will write that wrong date into your YAML.
- If you cloned with **`robocopy`**: CreationTime is preserved at clone-time, but is empirically unreliable thereafter on Windows — post-clone background services (Defender, Search Indexer, Obsidian's startup cache) can reset it to the clone moment, producing a birthtime cluster. The skills' clone-cluster gate handles this automatically; see [`references/clone-cluster-detection.md`](../references/clone-cluster-detection.md).
- If your vault came from **macOS via SCP/AirDrop**: CreationTime is the transfer time, not the original write time.

### Recommendation

Always run `property-enrich` as the first skill on a Windows clone. It populates YAML `created` from filename patterns and git history when those are available, leaving filesystem CreationTime as the lowest-priority fallback. Once YAML `created` is filled, subsequent skills no longer depend on CreationTime.

## Recommended Windows Setup

Step-by-step before running any Vault Autopilot skill on Windows:

```powershell
# 1. Enable Long Path support (one-time, administrator)
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force

# 2. Restart your shell, then verify
(Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem").LongPathsEnabled

# 3. Clone your vault with robocopy (NOT File Explorer)
robocopy "C:\Users\<you>\Documents\Vaults\MyVault" `
         "C:\Users\<you>\Documents\Vaults\MyVault-Clone" /E /COPY:DAT

# 4. Verify clone has the same file count as source
(Get-ChildItem "C:\Users\<you>\Documents\Vaults\MyVault" -Recurse -Filter *.md).Count
(Get-ChildItem "C:\Users\<you>\Documents\Vaults\MyVault-Clone" -Recurse -Filter *.md).Count
# Both numbers must match.

# 5. Set the vault path (use the clone, not the source, for first runs)
$env:OBSIDIAN_VAULT_PATH = "C:\Users\<you>\Documents\Vaults\MyVault-Clone"

# 6. Run property-enrich first (populates YAML `created` for everything)
# Then run other skills — by then, YAML is the source of truth and CreationTime is moot.
```

## Test Methodology

Source vault: 1856 Markdown files, mixed depth, descriptive PARA-style structure with long folder names. Original on macOS APFS. Transferred to Windows 11 NTFS via three methods on 2026-04-16, measured 2026-04-26.

Hardware: ThinkCentre M-class, Windows 11 22H2, German locale, NTFS. Path: `C:\Users\<user>\Documents\Vaults\`. SSH access via OpenSSH server.

Tools used: PowerShell 5.1, cmd.exe, `Get-ChildItem`, `Get-Item`, `robocopy`, `scp` (from macOS side).

Sample file used for timestamp comparison: `OPS - Phase 1.1 - Semantic Backbone (Concrete Execution).md` at vault root, identical content across all three clones.

## See Also

- [Cloning Guide](cloning-guide.md) — full clone procedure for macOS, Windows, Linux
- [Metadata Requirements](metadata-requirements.md) — why YAML `created` matters
- [Backup and Recovery](backup-and-recovery.md) — what to do if a skill misbehaves
- [`references/windows-preflight.md`](../references/windows-preflight.md) — the runtime check the skills perform automatically before each run
