# Findings File — Shared Convention

## Purpose

When a skill encounters something the user should know about — a corrupted note, a sensitive-data flag, a metadata gap that no source could fill — that observation is a *finding*. Findings used to live only in the run report (`logs/run-history.md` in the plugin repo). That worked for single-session debugging but not for cross-session continuity: the orchestrator (Obi) cannot read the user's plugin repo on session start, only the user's vault.

This file defines the vault-side findings convention: a ledger written into the vault itself, append-only, that any skill can write and any future Obi session can read.

## Storage vs Presentation — OVA self-output standard

OVA enforces a canonical frontmatter standard on the user's notes (`title`/`description`/`tags`, canonical property order — see `references/yaml-edits.md` recipe (g)). Its own output under `_vault-autopilot/` must be honest about that standard, not silently escape it via the `_*` scan-exclusion. The rule follows the Storage-vs-Presentation split:

| OVA output | Class | Frontmatter standard |
|------------|-------|----------------------|
| `_vault-autopilot/findings/*.md` | **Storage** (machine-parsed by Obi on session start) | The documented machine schema below (`date`/`skill`/`scope`/`counts`). **Intentionally exempt** from `title`/`description`/`tags` — exempt because it is Storage, NOT because the path is protected. A skill must never flag a findings file as "missing title". |
| Report notes (e.g. tag-manage `Tag Analysis Report - *.md`) | **Presentation** (human-facing Markdown) | MUST satisfy the canonical standard: `title` + `description` + `tags` in canonical order. These reports already carry a distinct marker tag (`Meta/TagManagement`) so they do NOT merge into the `VaultAutopilot`-touched-notes filter. |

**Net principle:** `_vault-autopilot/` is protected from scanning, but OVA's *Presentation* output must still satisfy the canonical frontmatter standard. OVA's *Storage* output follows its documented machine schema and is an explicit, documented exception — not an accidental one.

## Path

```
${OBSIDIAN_VAULT_PATH}/_vault-autopilot/findings/<YYYY-MM-DD>-<skill-name>.md
```

- `<YYYY-MM-DD>` is the date the skill ran, in the local timezone.
- `<skill-name>` is the skill name as listed in plugin.json (`inbox-sort`, `note-rename`, `property-enrich`, `property-describe`).
- Multiple runs of the same skill on the same day write into the same file — see "Append-only" below.

The `_vault-autopilot/` folder is plugin-managed (see `references/vault-autopilot-note.md`). Skills create the `_vault-autopilot/` folder and the `findings/` subfolder if either is missing.

## File format

YAML frontmatter (file-level metadata) + Markdown body (one section per run).

```markdown
---
date: 2026-04-27
skill: inbox-sort
scope: inbox
counts:
  total: 105
  classA: 0
  classB: 2
  classC: 1
  classD: 4
---

## Run 14:32

- **F1** (Class B, sensitive-content): 1 sentence summary. file_refs: `Inbox/Some Note.md`
- **F2** (Class C, metadata-gap): 1 sentence summary. file_refs: `Inbox/Other Note.md`, `Inbox/Third Note.md`
- **F3** (Class D, observation): 1 sentence summary. file_refs: —

## Run 18:05

- **F4** (Class B, corrupted-yaml): 1 sentence summary. file_refs: `Inbox/Junk.md`
```

### Frontmatter fields

| Field | Required | Description |
|-------|----------|-------------|
| `date` | yes | YYYY-MM-DD, local timezone, of the first run that day |
| `skill` | yes | Skill name (e.g. `inbox-sort`) |
| `scope` | yes | Scope the skill ran on (`inbox`, `vault`, `folder:<path>`) |
| `counts.total` | yes | Total notes processed (sum across runs that day) |
| `counts.classA` | yes | Number of Class A findings (data loss / corruption) |
| `counts.classB` | yes | Number of Class B findings (security / sensitive content) |
| `counts.classC` | yes | Number of Class C findings (correctness / metadata gaps) |
| `counts.classD` | yes | Number of Class D findings (observations / suggestions) |

### Body

One `## Run HH:MM` section per skill run. Each section contains a flat bulleted list of findings — never nested, never reordered.

### Each finding

- `id`: auto-incremented per file, format `F<n>` starting at `F1`. Counts continue across runs in the same file. Never reused, never gapped.
- `severity`: one of Class A / Class B / Class C / Class D.
- `category`: free-text (e.g. `sensitive-content`, `metadata-gap`, `corrupted-yaml`, `cluster-detected`).
- `summary`: one sentence.
- `file_refs`: comma-separated list of vault-relative paths, or `—` if not applicable.

### Severity classes

| Class | Meaning |
|-------|---------|
| **A** | Data loss or corruption detected. The user must act. |
| **B** | Security / sensitive content (secrets, recovery phrases, credentials). The user should act. |
| **C** | Correctness / metadata gap (no created date source found, ambiguous classification, etc.). |
| **D** | Observation / suggestion for future runs (cluster, naming pattern, idea for tag). |

## Append-only

Re-running the same skill on the same day **MUST**:

1. Read the existing file.
2. Append a new `## Run HH:MM` section at the end of the body.
3. Update the frontmatter `counts.*` to the new totals (this is the only frontmatter mutation allowed — use the line-by-line procedure in `references/yaml-edits.md`).
4. Continue the `id` numbering from where the previous run left off.

Skills MUST NOT:

- Edit any prior `## Run HH:MM` section.
- Edit any prior finding line.
- Renumber findings.
- Delete sections or findings.
- Overwrite the file.

The findings file is a ledger. Once a line is written, it is immutable. If a finding turns out to be wrong, write a new finding in the next run that supersedes it.

## Folder creation

On first write, the skill:

1. Checks for `${OBSIDIAN_VAULT_PATH}/_vault-autopilot/`. Creates it if missing.
2. Checks for `${OBSIDIAN_VAULT_PATH}/_vault-autopilot/findings/`. Creates it if missing.
3. Checks for the dated file. Creates it (with frontmatter + first `## Run HH:MM` section) if missing. Otherwise appends.

The folder is plugin-managed. Skills must skip it during all scans (already covered by the `_*` exclusion in launch-scope skills).

## How Obi reads findings on session start

```bash
ls "${OBSIDIAN_VAULT_PATH}/_vault-autopilot/findings/"*.md 2>/dev/null \
  | sort -r \
  | head -5
```

Read the most recent file (or the most recent N for context). The frontmatter `counts` give an at-a-glance summary; the body gives full detail. Obi never modifies these files; it reads them and uses the information to decide what to surface to the user.

If the folder does not exist, Obi treats it as "no findings yet" and proceeds normally.

## Why a file per skill per day

- One file per day per skill keeps each file small and easy to read.
- Multiple skills running the same day produce separate files, easy to grep by skill name.
- Sorting `ls` output by name gives chronological order.
- The `<skill>` suffix means Obi can read just the skills it cares about without parsing every file.

## Worked example

inbox-sort runs at 14:32 on 2026-04-27, finds 3 findings. The file `_vault-autopilot/findings/2026-04-27-inbox-sort.md` does not exist. The skill creates the folder chain and writes:

```markdown
---
date: 2026-04-27
skill: inbox-sort
scope: inbox
counts:
  total: 42
  classA: 0
  classB: 1
  classC: 1
  classD: 1
---

## Run 14:32

- **F1** (Class B, sensitive-content): Recovery phrase detected in plaintext. file_refs: `Inbox/Crypto Notes.md`
- **F2** (Class C, metadata-gap): No date source could be derived (no filename date, no Git, birthtime stat failed). file_refs: `Inbox/Untitled.md`
- **F3** (Class D, cluster-detected): 4 notes share the topic "Q2 planning" — consider a common prefix. file_refs: `Inbox/A.md`, `Inbox/B.md`, `Inbox/C.md`, `Inbox/D.md`
```

inbox-sort runs again at 18:05 the same day on a different scope, finds 1 finding. The file already exists. The skill reads it, appends a new section, updates counts:

```markdown
---
date: 2026-04-27
skill: inbox-sort
scope: inbox
counts:
  total: 47
  classA: 0
  classB: 2
  classC: 1
  classD: 1
---

## Run 14:32

- **F1** (Class B, sensitive-content): Recovery phrase detected in plaintext. file_refs: `Inbox/Crypto Notes.md`
- **F2** (Class C, metadata-gap): No date source could be derived (no filename date, no Git, birthtime stat failed). file_refs: `Inbox/Untitled.md`
- **F3** (Class D, cluster-detected): 4 notes share the topic "Q2 planning" — consider a common prefix. file_refs: `Inbox/A.md`, `Inbox/B.md`, `Inbox/C.md`, `Inbox/D.md`

## Run 18:05

- **F4** (Class B, sensitive-content): API key prefix `sk-` detected. file_refs: `Inbox/Dev Snippets.md`
```

The 14:32 section is byte-identical. F1..F3 are byte-identical. F4 continues the numbering. The frontmatter counts updated to total 47, classB 2.
