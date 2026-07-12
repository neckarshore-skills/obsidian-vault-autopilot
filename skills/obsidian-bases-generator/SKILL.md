---
name: obsidian-bases-generator
status: beta
description: Use when the user wants a live, database-like dashboard over their Obsidian notes — a Base (.base file) that filters, groups, or tables notes by their properties or tags. Trigger phrases - "create a dashboard", "generate a base", "make a Bases view", "build a table view of my notes", "show all notes with status X", "surface my draft backlog", "notes missing a property". Also trigger when the user mentions ".base files", "Bases", "table view", "card view", or wants to filter or group notes by a frontmatter property or tag. This skill scans the vault for real property usage first and only proposes dashboards backed by properties that actually exist — it never invents properties that are not in the vault.
---

# Obsidian Bases Generator

Generate live, database-like dashboards over the vault by writing `.base` files. Unlike a passive format reference, this skill is proactive: it inspects which properties are actually populated across the vault and only proposes dashboards that will contain real data. A dashboard built on a property that only three notes use is noise, not signal.

The core principle — scan first, propose second, write third. Never generate a Base against a property that does not meaningfully exist in the vault.

## Principle — Core + Nahbereich + Report

Per `docs/philosophy.md`, every skill has three zones:

- **Core:** Scan the vault's real property usage, propose fitting dashboards, and write validated `.base` files.
- **Nahbereich:** This skill reads notes and writes one config file — it never edits, tags, or moves a note. So its adjacent-fix surface is narrow: when the scan hits notes with unparseable frontmatter (they cannot be indexed), report them, do not repair them. Frontmatter repair is the job of `note-rename` and `property-enrich`.
- **Report:** Every run produces a summary (Done / Findings / Unchanged) and, for anything the user should act on, a findings-file entry. See Report below.

## Shared conventions

This skill obeys the plugin-wide conventions. Read them before writing:

1. `../../references/vault-autopilot-note.md` — protected files and folders the scan must skip (`_vault-autopilot.md`, `_vault-autopilot/`, `_trash/`, and every `_*` / `.*` folder). Note: this file also documents the planned "Obsidian Base View" — this skill is the active realization of it.
2. `../../references/findings-file.md` — the append-only findings ledger and its Class A–D severities.
3. `../../references/config-spec.md` — `folders.excluded_prefixes` (default `["_", "."]`) and `scope` (`inbox` / `vault` / `folder:<path>`).
4. `references/bases-syntax.md` — the Bases file-format: filters, formulas, views, quoting, the two Duration/null pitfalls, and the verified `hasTag` / `inFolder` / `groupBy` matching semantics. Read this before writing any `.base` file.

## Step 1 — Vault discovery and property scan

Resolve the vault via `${OBSIDIAN_VAULT_PATH}` (no hardcoded paths — `docs/philosophy.md`). Then run the bundled scanner, which excludes the protected folders, parses YAML frontmatter, and reports property coverage, the tag inventory, and the folder inventory:

```bash
python3 scripts/scan_properties.py "${OBSIDIAN_VAULT_PATH}" --json /tmp/vault-scan.json
```

Report the result to the user as a coverage table before proposing anything. Coverage — the percentage of notes carrying a property — is the deciding metric. Example shape (yours will differ; always use the live scan, never these numbers):

| Property | Notes | Coverage | Top values |
| :--- | ---: | ---: | :--- |
| `tags` | 1478 | 92% | (see tag inventory) |
| `status` | 734 | 46% | draft, active, referenz, aktiv, final |
| `type` | 638 | 40% | inbox, skill, prompt, reference |
| `description` | 1104 | 69% | TBD, (empty), … |

A property under ~20% coverage is a weak dashboard target — the scanner flags it, and so should you. Do not lead with a weak property, and never propose a dashboard for a property the scan did not find.

## Step 2 — Propose dashboards (one question at a time)

Map real property patterns to dashboard archetypes. Three archetypes ship as starter templates in `assets/`:

1. **Lifecycle** (`status`, `type`) → a grouped table showing the backlog by state — `assets/dashboard-inbox-drafts.base`.
2. **Gap** (a property missing or set to a sentinel like `TBD` on many notes) → a "needs attention" table surfacing exactly those notes — `assets/dashboard-property-gaps.base`.
3. **Category + tag** (`file.hasTag(...)` grouped by a derived category) → a chronological index filtered by tag — `assets/dashboard-research-reports.base`.

Do not propose an archetype the vault does not support. If `status` has good coverage but there is no `priority` property anywhere, do not offer a priority board.

Present the proposal, then ask the single most useful narrowing question — for example whether the draft dashboard should cover only the inbox folder or the whole vault. Reassess after the answer. Keep it to one question at a time.

## Step 3 — Generate the .base file

Read `references/bases-syntax.md` first, then adapt the closest starter template to the real property names and values from Step 1. Never ship a template unchanged if the vault's property names differ — the templates in `assets/` were reconciled against one real vault and will not match another's `status` values, folder names, or category tags.

Three format rules are non-negotiable (full detail in the reference):

1. **Null-guard every note-property formula.** Note properties are absent on many notes. Wrap the whole formula: `if(status, if(status == "draft", "✏️", …), "")`. File metadata (`file.ctime`, `file.mtime`, `file.name`) is always present and needs no guard.
2. **Duration needs field access before rounding.** Date subtraction returns a Duration, not a number. Use `(now() - file.ctime).days.round(0)`, never `.round()` on the raw Duration.
3. **YAML quoting.** Single-quote any formula that contains double quotes; quote strings containing `:` and other special characters.

A `.base` file is pure YAML config — it does NOT get Obsidian Markdown properties (`title::`, `version::` etc.). Those belong to `.md` notes only.

**Status icons and emoji.** The starter templates use emoji glyphs in `status_icon` / gap-marker columns because a glyph column is the idiomatic Bases way to make state scannable at a glance. This is a deliberate exception to the plugin's no-emoji rule, which governs instructional and prose files, not a rendered dashboard column. If the user prefers text, the icons are a one-line change — offer that.

### Filename and placement

1. Filename uses the vault separator em-dash ` – `, e.g. `Dashboard – Inbox Drafts.base`. Max ~70 characters. (The template files in `assets/` use ASCII hyphens in their repo filenames; the generated vault file uses the em-dash.)
2. Default placement: a dedicated `030_Systems/Dashboards/` folder, or the vault root. Ask the user once where dashboards should live and reuse the answer for the session.

## Step 4 — Validate

Validate every generated base before writing is complete. A silently broken base renders as a YAML error, or a column that never appears, in Obsidian:

```bash
python3 scripts/validate_base.py <generated-file>.base
```

The script checks valid YAML and that every `formula.X` referenced in `order`, `groupBy`, `summaries`, or `properties` is defined under `formulas`. It does not check the Bases expression language itself — so also confirm by eye against `references/bases-syntax.md`:

1. Every note-property formula is null-guarded with `if()`.
2. No raw `.round()` / `.floor()` / `.ceil()` on a Duration (field access first).
3. `filters` is a single string or an `and` / `or` / `not` object — never a bare YAML list.
4. Any view that groups by a `formula.X` is flagged to the user to confirm on first open (groupBy-on-formula is not officially documented).

If validation fails, fix before presenting. Never write a base you have not validated.

## Step 5 — Confirm and write

Show the user a preview — the YAML plus a plain-language description of what each view will show — and confirm before writing. This single confirm gate is the only manual step in the run.

On write, follow the same overwrite logic the other skills use:

1. **NEW** — no file at the target path: write it.
2. **EXISTS** — a `.base` already exists at the path: show the diff and ask before overwriting; never silently replace a user-tuned base.
3. **TRASHED** — the target name exists in `_trash/`: treat as NEW at the live path, do not resurrect the trashed copy.

After writing, tell the user:

1. The base filename and folder.
2. How to open it — open the `.base` directly, or embed with `![[Dashboard – Name.base]]`.
3. That a single view embeds as `![[Dashboard – Name.base#View Name]]`.

## Report

Mandatory after every run. Use the plugin's non-negotiable report shape (`docs/philosophy.md`):

```
## Bases Generator Report — [Date]

### Done
- Created [n] bases: [filenames]

### Findings
- [n] notes with unparseable frontmatter (→ note-rename / property-enrich)
- [n] weak-coverage properties flagged (below 20%)

### Unchanged
- [n] notes scanned, read-only — no note was edited
```

For anything the user should act on (unparseable frontmatter, a large metadata gap the scan surfaced), append a Class A–D entry to the findings ledger per `../../references/findings-file.md`:

```
${OBSIDIAN_VAULT_PATH}/_vault-autopilot/findings/<YYYY-MM-DD>-obsidian-bases-generator.md
```

Then append one row to `logs/run-history.md`:

```
| <date> | obsidian-bases-generator | <scope> | <scanned> | <bases created> | <notes edited: always 0> | <findings> |
```

## Quality Checklist

1. The scan ran against the live vault and the coverage table was shown before any proposal.
2. Every filter and formula references only properties or tags the scan actually found.
3. Every generated base passed `scripts/validate_base.py`.
4. Every note-property formula is null-guarded; no raw Duration rounding.
5. No `.base` carries Markdown frontmatter properties.
6. groupBy-on-formula views were flagged for first-open verification.
7. No note was edited — this skill reads notes and writes only `.base` config plus its own findings and run-history entries.
8. User confirmed before the file was written.

## Changelog

- 2026-07-12: Initial version. Bases format reference distilled from kepano/obsidian-skills (MIT) into `references/bases-syntax.md`, extended with verified `hasTag` / `inFolder` / `groupBy` semantics. Automation layer added on top: bundled `scripts/scan_properties.py` (coverage + tag + folder scan with plugin-standard exclusions) and `scripts/validate_base.py` (YAML + formula-reference check across order / groupBy / summaries / properties). Three starter dashboards reconciled against a real vault. Grounded in the plugin's real conventions (`references/vault-autopilot-note.md`, `findings-file.md`, `config-spec.md`) rather than an assumed `_conventions` file; status icons kept as a deliberate, documented emoji exception.

## Run History

| Date | Scope | Notes scanned | Props found | Bases created | Learnings |
|------|-------|---------------|-------------|---------------|-----------|
| 2026-07-12 | vault (build-time scan) | 1610 | 130+ keys; 9 above 20% coverage | 0 (templates reconciled, not written to vault) | Assumed status `polished`/`archived` do not exist (real: draft/active/aktiv/referenz/final); `type: TBD` sentinel does not exist (real type gap is missing type, ~60%); TBD sentinel lives on `description`; assumed `Protocol` category tag absent (real: Trading/Finance dominate, then OpenSource/Software); 11 notes have unparseable frontmatter plus quoted-key artifacts (`created:` / `status:` as keys) — Class-C, routed to note-rename/property-enrich. |

### First-run coverage table (2026-07-12, vault scan of 1610 notes, 1522 with frontmatter)

The dashboard-worthy properties (above the ~20% coverage floor), captured verbatim from `scan_properties.py`:

| Property | Notes | Coverage | Top values |
| :--- | ---: | ---: | :--- |
| `tags` | 1478 | 92% | (see tag inventory) |
| `created` | 1304 | 81% | dates |
| `title` | 1280 | 80% | free text |
| `description` | 1104 | 69% | TBD (33), (empty) (26), … |
| `modified` | 798 | 50% | dates |
| `status` | 734 | 46% | draft (284), active (179), referenz (118), aktiv (91), final (11) |
| `type` | 638 | 40% | inbox (178), skill (158), prompt (73), reference (51) |
| `source` | 471 | 29% | apify/instagram-scraper (42), … |
| `last_modified` | 418 | 26% | dates |

Everything else scanned below 20% coverage (weak targets, not led with). Folder inventory: `020_Processes` (462), `030_Systems` (417), `010_Outcomes` (339), `001_Inbox` (332), `099_Archive` (37). Research-tag sub-scan: 41 notes, category tags Trading (11) / Finance (9) / OpenSource (8, incl. nested `OpenSource/AI-ML`) / Software (4, incl. nested `Software/DevTools`, `Software/Infrastructure`); status draft (22) / abandoned (1).
