# Obsidian Bases — Syntax Reference

> Format knowledge distilled from kepano/obsidian-skills (MIT License) and the official
> Obsidian Bases docs (https://help.obsidian.md/bases/syntax). This file is a reference,
> not an executable skill. The generator skill reads it before writing any `.base` file.

Base files use the `.base` extension and contain valid YAML. Top-level sections:
`filters`, `formulas`, `properties`, `summaries`, `views`.

## Top-Level Schema

```yaml
# Global filters apply to ALL views in the base
filters:
  and: []        # all must be true
  or: []         # any may be true
  not: []        # exclude matches

# Computed properties usable across all views
formulas:
  formula_name: 'expression'

# Display-name and settings overrides
properties:
  property_name:
    displayName: "Display Name"
  formula.formula_name:
    displayName: "Formula Display Name"

# Custom summary formulas
summaries:
  custom_name: 'values.mean().round(3)'

# One or more views
views:
  - type: table | cards | list | map
    name: "View Name"
    limit: 30                 # optional
    groupBy:                  # optional
      property: property_name
      direction: ASC | DESC
    filters:                  # view-specific, ANDed with global
      and: []
    order:                    # properties shown, in order
      - file.name
      - property_name
      - formula.formula_name
    summaries:
      property_name: Average
```

## Filters

```yaml
# Single filter
filters: 'status == "done"'

# AND
filters:
  and:
    - 'status == "done"'
    - 'priority > 3'

# OR
filters:
  or:
    - 'file.hasTag("book")'
    - 'file.hasTag("article")'

# NOT
filters:
  not:
    - 'file.hasTag("archived")'

# Nested
filters:
  or:
    - file.hasTag("tag")
    - and:
        - file.hasTag("book")
        - file.hasLink("Textbook")
```

Operators: `==` `!=` `>` `<` `>=` `<=` `&&` `||` `!`

## Property Types

1. **Note properties** — from frontmatter: `note.author` or just `author`
2. **File properties** — file metadata (table below)
3. **Formula properties** — computed: `formula.my_formula`

### File Properties

| Property | Type | Description |
| --- | --- | --- |
| `file.name` | String | File name |
| `file.basename` | String | Name without extension |
| `file.path` | String | Full path |
| `file.folder` | String | Parent folder |
| `file.ext` | String | Extension |
| `file.size` | Number | Size in bytes |
| `file.ctime` | Date | Created time |
| `file.mtime` | Date | Modified time |
| `file.tags` | List | All tags |
| `file.links` | List | Internal links |
| `file.backlinks` | List | Files linking here |
| `file.properties` | Object | All frontmatter |

Useful file methods in filters: `file.hasTag("x")`, `file.inFolder("path")`,
`file.hasLink("Note")`.

### The `this` Keyword

- Main content area: refers to the base file itself
- When embedded: refers to the embedding file
- Sidebar: refers to the active file in main content

## Formulas

```yaml
formulas:
  total: "price * quantity"
  status_icon: 'if(done, "✅", "⏳")'
  formatted_price: 'if(price, price.toFixed(2) + " dollars")'
  created: 'file.ctime.format("YYYY-MM-DD")'
  days_old: '(now() - file.ctime).days'
  days_until_due: 'if(due_date, (date(due_date) - today()).days, "")'
```

### Key Functions

| Function | Signature | Description |
| --- | --- | --- |
| `date()` | `date(string): date` | Parse `YYYY-MM-DD HH:mm:ss` |
| `now()` | `now(): date` | Current date+time |
| `today()` | `today(): date` | Current date (00:00:00) |
| `if()` | `if(cond, trueResult, falseResult?)` | Conditional |
| `duration()` | `duration(string): duration` | Parse duration |
| `link()` | `link(path, display?): Link` | Create a link |

### Date Arithmetic

```
"now() + \"1 day\""            # Tomorrow
"today() + \"7d\""            # A week from today
"now() - file.ctime"          # Returns a Duration
"(now() - file.ctime).days"   # Days as a number
```

Duration units: `y/year/years`, `M/month/months`, `d/day/days`, `w/week/weeks`,
`h/hour/hours`, `m/minute/minutes`, `s/second/seconds`.

## Two Critical Pitfalls

### 1. Duration is NOT a number

Subtracting two dates returns a **Duration**. It does NOT support `.round()`, `.floor()`,
`.ceil()` directly. Access a numeric field first (`.days`, `.hours`, ...), then round.

```
# CORRECT
"(date(due_date) - today()).days"
"(date(due_date) - today()).days.round(0)"

# WRONG — Duration has no division-then-round
"((date(due) - today()) / 86400000).round(0)"
# WRONG — round on raw Duration
"(now() - file.ctime).round(0)"
```

Duration fields: `.days`, `.hours`, `.minutes`, `.seconds`, `.milliseconds`.

### 2. Null-guard every property-touching formula

Properties may be absent on some notes. An unguarded formula crashes the view for the
whole vault — critical here because notes with `type: TBD` or partial frontmatter are
common in a real vault.

```
# WRONG — crashes when due_date is empty
"(date(due_date) - today()).days"

# CORRECT — guard with if()
'if(due_date, (date(due_date) - today()).days, "")'
```

## View Types

- **table** — columns from `order`, optional `groupBy` and `summaries`
- **cards** — gallery; put an image property early in `order`
- **list** — minimal, name + one or two properties
- **map** — needs latitude/longitude properties and the Maps community plugin

## Default Summary Formulas

`Average`, `Min`, `Max`, `Sum`, `Range`, `Median`, `Stddev` (numbers);
`Earliest`, `Latest`, `Range` (dates); `Checked`, `Unchecked` (booleans);
`Empty`, `Filled`, `Unique` (any).

## Embedding

```
![[MyBase.base]]              # whole base
![[MyBase.base#View Name]]    # a specific view
```

## YAML Quoting Rules

1. Single-quote formulas containing double quotes: `'if(done, "Yes", "No")'`
2. Double-quote simple strings: `"My View Name"`
3. Quote any string containing: `: { } [ ] , & * # ? | - < > = ! % @` `` ` ``

```yaml
# WRONG — colon in unquoted string
displayName: Status: Active
# CORRECT
displayName: "Status: Active"

# WRONG — double quotes inside double quotes
label: "if(done, "Yes", "No")"
# CORRECT
label: 'if(done, "Yes", "No")'
```

## Common Errors Checklist

1. Unquoted special characters in strings → quote them
2. Mismatched quotes in formulas → wrap double-quote formulas in single quotes
3. Duration math without field access → add `.days` etc. before rounding
4. Missing null checks → guard with `if(prop, ..., "")`
5. Referencing `formula.X` without defining `X` in `formulas` → fails silently

## Verified Matching Semantics

Confirmed against the official Obsidian docs (obsidian.md/help/bases) — these
three points decide whether a filter or a category formula actually matches, so
verify them rather than assuming:

1. **`file.hasTag()` is hierarchical.** `file.hasTag("Software")` matches a note
   tagged `#Software/DevTools` or `#Software/Infrastructure` — "it also includes
   any nested tags." So a category formula can key on the parent tag and catch
   every child. Signature: `file.hasTag(...values: string): boolean` (matches if
   the note has any of the given tags).
2. **`file.inFolder()` includes sub-folders.** `file.inFolder("001_Inbox")`
   returns true for a note "in the specified folder or one of its sub-folders."
   It matches by folder name, and the name must be the real one — if the folder
   is `099_Archive - Completed…`, then `inFolder("099_Archive")` does NOT match.
   Use the exact folder name from the scan.
3. **`groupBy` on a formula is undocumented — flag it.** `order`, `properties`,
   and `summaries` accept `formula.X` (documented). The official docs do not
   document `groupBy: {property: formula.X}`, though kepano-style bases use it
   and it commonly works. When a view groups by a formula, tell the user to
   confirm that grouping on first open in Obsidian; if it does not render,
   fall back to grouping by a real property. `validate_base.py` still verifies
   the referenced formula is defined — that is the machine-checkable half.

## Source Links

- Bases Syntax: https://help.obsidian.md/bases/syntax
- Functions: https://help.obsidian.md/bases/functions
- Views: https://help.obsidian.md/bases/views
- Formulas: https://help.obsidian.md/formulas
- Upstream (MIT): https://github.com/kepano/obsidian-skills/tree/main/skills/obsidian-bases
