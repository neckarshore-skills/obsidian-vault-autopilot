# skill-library-sync — Design

**Status:** proposed · **Date:** 2026-08-26 · **Author:** Obi

## Why this exists

The user maintains a Skill Library in his Obsidian vault: one note per Claude Code
skill, plus an index. It was built by hand on 2026-07-05 and has been nudged by hand
since. Measured on 2026-08-26 against the actual inventory:

| | |
|---|---|
| Skills that exist | 186 unique names, 207 entries across origins |
| Notes in the library | 161 |
| Skills with no note at all | 78 |
| Notes whose recorded path no longer exists | 40 |
| Notes whose skill no longer exists anywhere | 29 |

That is 147 operations — 78 notes to create and 69 existing notes to change, against
a library of 161. The number is the argument: a library kept
current by hand drifts at exactly the rate the estate grows, and nothing detects it.
The drift was found because the user asked, not because anything watched.

`photo-dedup` — shipped 2026-08-20, merged, in production — is absent from the
library. So is `obsidian-bases-generator`, which is *installed on this machine*.

## What it does

Three stages, the plugin's established shape (`tag-manage`, `obsidian-bases-generator`):

1. **scan** — read the real inventory from named sources only.
2. **diff** — classify every skill and every note into one of four buckets.
3. **apply** — write, but only after the user confirms the preview.

### The four buckets

| Bucket | Meaning | Action |
|---|---|---|
| `new` | A skill exists, no note describes it | Create the note |
| `relocated` | A note exists, its `ort` is stale, the skill is findable by name | Rewrite the machine zone |
| `retired` | A note exists, no skill of that name exists anywhere | `status: entfallen`, move to `Entfallen/` |
| `unchanged` | Note and reality agree | Touch nothing |

`unchanged` is a real bucket and is reported with its count. A run that changes
nothing must say so, rather than printing silence that reads as "nothing was checked".

## Safety contracts

These are the load-bearing part of the design. Each is a rule, not an implementation
detail, and each has a named test.

### 1. The body boundary

**Everything above `## Notizen` belongs to the machine. Everything below it is never
written.** The user's own documentation survives every run by construction rather than
by care.

The complication is the placeholder. Measured 2026-08-26: 157 notes carry the exact
string `(noch keine vertiefende Dokumentation — Stub aus der Bestandsaufnahme 2026-07-05)`
under that heading, three carry real prose (`presseschau`, `ogc-reply`, `ogc-triage`),
one zone is empty, and **no note currently mixes the two**. The placeholder is machine
text and may be replaced; the prose may not.

**The stub is matched byte-for-byte, never by length and never fuzzily.** A length
threshold is how an 869-character note survives today and a 90-character note is
destroyed next month. Mixed content — stub plus appended prose — is preserved
*entirely*; the skill does not try to surgically remove a stub from prose it did not
write. No such note exists today, which is exactly why the case needs a test: it will
exist the first time the user appends a line under a stub, and that day nobody will be
looking.

This contract is written with issue [#41](https://github.com/neckarshore-skills/obsidian-vault-autopilot/issues/41)
in view: a documented body boundary in this same plugin contradicted the write it
mandated. A boundary is only worth what its tests are worth.

### 2. No filesystem discovery — a new capability class for this plugin

Every existing OVA skill reads the vault and writes the vault. This one reads
**outside** it, and that deserves an explicit fence rather than a footnote:

- The skill reads only paths that the config names, or that
  `~/.claude/plugins/installed_plugins.json` names as an install path.
- **It never walks a tree looking for skills.** No `find ~`, no globbing over a
  projects directory, no auto-detection of repositories.
- Outside the vault it is **read-only, always**. The only writes are inside
  `library_path` and `_vault-autopilot/`.

Vault Safety Rule 2 governs vault discovery; this fence is its sibling for the
inventory side, and it is why the auto-detect design was rejected rather than merely
not chosen.

### 3. Writes preserve birthtime

A note that loses its creation date loses the only record of when it entered the
vault. **Corrected during planning against the repo's own code:** `tag-manage`
already solves this more simply than the capture-and-restore pattern this spec
originally proposed — an in-place `fs.writeFileSync` on an existing path creates no
new inode, so APFS birthtime survives untouched. No `touch -t`, no restore step, no
window in which the value is wrong.

The consequence is a rule: **never write-to-temp-then-rename for an existing note.**
A test reads `birthtimeMs` before and after a rewrite and asserts equality.

### 4. Nothing is deleted

`retired` notes are moved and re-labelled, never removed. The library keeps the trace
of skills that once existed; a plugin that changed its skill set is history worth
reading.

## Configuration

The plugin already has a config surface: `_vault-autopilot-config.md` in the vault
root, protected, with `_extend` / `_override` list semantics (`references/config-spec.md`).
This skill uses it rather than introducing a second one.

> The option presented to the user said "a config note in the library folder". The
> established file satisfies the same intent — sources visible in the vault, no
> hardcoded paths — and adding a second config surface to a plugin that has one would
> be the worse answer. Recorded here so the option text and the implementation are not
> read as disagreeing.

```yaml
skill_library:
  library_path: "020_Processes - HOW I DO IT - Reusable workflows, routines, templates, and standards/Library Meta/Skill Library"
  retired_subfolder: "Entfallen"
  source_roots_extend:
    - "~/Developer/projects/neckarshore-skills/photo-autopilot"
    - "~/Developer/projects/neckarshore-skills/social-scrapers"
```

Built-in sources, always read: `~/.claude/skills/` and every install path in
`installed_plugins.json`. `source_roots` adds repository roots whose `skills/`
subdirectory holds skills that are not installed as plugins.

## The note schema

Frontmatter, canonical order, `tags` last (the vault's own convention):

```yaml
title, type: skill, description, herkunft, ort, plugin, status,
created, last_modified, tags
```

Two rules the current library gets wrong and this skill must not inherit:

1. **Descriptions are not truncated mid-word.** The existing notes are cut at ~300
   characters wherever the character landed — "give this a be". Either carry the full
   description, or cut on a word boundary with an ellipsis. A test pins it.
2. **The origin suffix is applied consistently.** 21 names exist in two origins and
   carry a `(herkunft)` suffix to keep wikilinks unambiguous. A skill that *acquires*
   a second origin needs its existing note **renamed** — a different operation from
   creating one, and one that must update the index's wikilink in the same run.

## The index

`_Skill Library.md` is regenerated from the notes: one row per note, renumbered
without gaps, sorted A→Z. The prose "Bestandsaufnahme" paragraph currently states a
count that the table contradicts (158 against 162 rows) — the count moves out of prose
and is derived, one fact with one home.

## Report

Per `docs/philosophy.md`, Core + Nahbereich + Report:

- **Core:** reconcile the library against the inventory.
- **Nahbereich:** dead wikilinks in the index and the stale prose count are fixed in
  passing — same file, same run, unambiguous. Nothing else.
- **Report:** counts per bucket, every rename listed by name, plus a findings-file
  entry at `_vault-autopilot/findings/<date>-skill-library-sync.md`.

## Out of scope

- Writing skill *documentation*. The skill records what exists and where; what a skill
  is *for* stays the user's to write, under `## Notizen`.
- The Prompt Library. Same vault, same shape, different inventory — a separate skill
  if it is ever wanted.
- Any judgment about whether a skill is useful, current, or worth keeping.

## Testing

Fixture-based, no live vault:

1. Stub zone is replaced; prose zone is preserved verbatim; mixed zone is preserved entirely.
2. A `new` skill produces a note with full, non-truncated description.
3. A `relocated` note keeps its `created` value and its birthtime.
4. A `retired` note moves, flips status, and its content survives.
5. A skill acquiring a second origin renames the note and updates the index wikilink.
6. The scanner reaches exactly one level into a `skills/` directory: a skill
   buried deeper is NOT found, which is the fence of contract 2 as an assertion.
7. An index regenerated from N notes has N rows numbered 1..N with no gaps.
8. A run with no differences reports `unchanged: N` rather than empty output.
