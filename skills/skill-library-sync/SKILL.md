---
name: skill-library-sync
status: beta
description: Use when a vault holds a library of notes about Claude Code skills and it has drifted from the skills that actually exist. Trigger phrases - "sync the skill library", "is the skill library up to date", "check the skill library", "which skills are missing from the vault", "update the skill notes". Also trigger when the user mentions a skill they built that has no note, an index that no longer matches its folder, or notes pointing at plugin paths that have moved. This skill reads the real inventory from named sources only - it never searches the filesystem for skills.
---

# Skill Library Sync

Reconcile the vault's Skill Library against the skills that actually exist: the
user's own skills, the installed plugins, and the repositories named in the
config. Create what is missing, re-locate what moved, retire what is gone.

The core principle - a library maintained by hand drifts at exactly the rate the
estate grows, and nothing detects it. Scan the ground first, show the difference,
write only after the user confirms.

## Principle - Core + Nahbereich + Report

- **Core:** reconcile the library against the inventory.
- **Nahbereich:** dead wikilinks in the index and a stale count in its prose are
  fixed in passing. Nothing else. This skill does not write skill documentation.
- **Report:** counts per bucket including the zeros, every rename by name, plus a
  findings entry.

## Fences

1. **The body boundary.** Everything above `## Notizen` belongs to this skill.
   Everything below belongs to the user and is never written. The placeholder stub
   is the one exception and is matched byte-for-byte - never by length.
2. **No filesystem discovery.** Only paths the config names or that
   `installed_plugins.json` names. Never a tree walk. Outside the vault this skill
   is read-only, always.
3. **Nothing is deleted.** A skill that vanished gets `status: entfallen` and moves
   to the retired subfolder.

## Shared conventions

1. `../../references/vault-autopilot-note.md` - protected files and folders.
2. `../../references/findings-file.md` - the append-only findings ledger. This
   skill's own ledger diverges from that convention - see "Findings" below.
3. `../../references/config-spec.md` - the `skill_library` config section.

## Step 1 - Scan

    node scripts/cli.js scan "$OBSIDIAN_VAULT_PATH"

Prints how many skills exist and how many notes describe them. Writes nothing.

## Step 2 - Diff

    node scripts/cli.js diff "$OBSIDIAN_VAULT_PATH"

Prints the four buckets - created, relocated, retired, renamed - plus conflicts,
each with a count, and names every note that would change. Writes nothing.

Show this output to the user. Do not proceed without an explicit confirmation.

## Step 3 - Apply

    node scripts/cli.js apply "$OBSIDIAN_VAULT_PATH"
    node scripts/cli.js apply "$OBSIDIAN_VAULT_PATH" --write

`apply` without `--write` is a preview, but it is not the same preview as
`diff`: `diff` only classifies notes into buckets, while `apply` in preview
mode also runs every write-side guard (the two caps below, the library-path
checks) exactly as `--write` would. Because of that its output is shaped
differently - it cannot show the four named buckets, since some of what
would be touched may already be blocked by a guard before it is counted.
Preview mode prints:

- `planned` - the total number of notes that would be created, relocated,
  retired, or renamed if you ran with `--write` right now.
- `unchanged` - notes that already match the inventory.
- `conflicts` - notes the run would refuse to touch, each named on its own
  line (see diff's conflict channel).
- `warning` - printed only when `library_path` is unconfigured or the
  configured directory does not exist; `--write` would refuse outright in
  either case.

Only run `--write` after the user has seen Step 2's per-bucket breakdown and
confirmed.

### The two caps

Two independent ceilings guard `apply --write`, and they catch different
failure shapes:

- **Mass-change cap** - refuses when `created + relocated + retired + renamed`
  exceeds a threshold. Default 200; override with `--max <n>`.
- **Retire cap** - refuses when the number of notes to retire alone exceeds
  `floor(max(10, notes_read * 0.25))` - a quarter of the notes currently in
  the library, floored at 10 so a small library is not blocked by rounding.
  Override with `--retire-max <n>`.

Both caps exist because the mass-change cap alone does not catch "retire
nearly everything" against a library comfortably under 200 notes. Neither
number above is a fact to memorize - both are computed against the library
as it stands at run time, which is why the retire cap is stated as a formula
here rather than a number.

An empty inventory (zero skills found across every named source) refuses
outright, in both preview and write mode, before anything is classified -
an empty inventory would make every existing note look retired, and that
combination is never a legitimate sync outcome.

### Exit codes

- `0` - success (scan, diff, or a completed apply).
- `1` - a refusal: the mass-change cap, the retire cap, or the empty-inventory
  guard. The run understood the situation and declined; nothing was written.
- `2` - a guard error (`library_path` unconfigured, or the configured
  directory does not exist) or a usage error (missing command/vault, an
  unknown flag, a missing or non-numeric `--max`/`--retire-max` value). The
  run was misconfigured or malformed rather than merely declined.

Every refusal and guard error prints its message to stderr.

## Report

    ## Skill Library Sync Report - <date>

    ### Done
    - Created N notes
    - Relocated N notes
    - Retired N notes to <subfolder>
    - Renamed N notes (origin suffix)

    ### Unchanged
    - N notes already matched the inventory

    ### Findings
    - <anything the user should act on>

## Findings

Every `apply --write` run appends a block to
`${OBSIDIAN_VAULT_PATH}/_vault-autopilot/findings/<date>-skill-library-sync.md`:
a `## Run HH:MM` heading, then a `counts:` list (created, retired, renamed,
unchanged, conflicts) and one line per conflict. This records that a run
happened and what it touched - it does not classify individual findings by
severity.

That is narrower than `../../references/findings-file.md`, which specifies
per-finding `F<n>` ids, a `Class A-D` severity, `file_refs`, and frontmatter
`counts.*` updated on every append. Reconciling the two schemas is open and
is not this skill's call to make alone - the convention's frontmatter-mutation
requirement conflicts with the append-only write shape this ledger was built
to guarantee.
