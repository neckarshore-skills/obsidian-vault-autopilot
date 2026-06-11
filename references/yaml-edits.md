# YAML and Markdown Edits — Shared Convention

> **Run this procedure for EVERY YAML or Markdown edit in EVERY skill.**
>
> Do not invent a regex. Do not use `str.replace` for anything beyond a single-line atomic value change. Do not match across newlines. The recipes in this file are the only allowed approach for editing YAML frontmatter and Markdown blocks. Deviation is a bug, not a stylistic choice. This rule applies in resumed sessions, in continued conversations, and after any tool call that could have altered file state. When in doubt: read the file line-by-line, edit line-by-line, write the file back.

## Why this exists

v0.1.2 ships after two mid-run regex bugs in two different skills, on identical task surfaces:

- **F8 (inbox-sort, GR-1):** the callout-append regex did not account for the `> ` blockquote prefix on the table separator line, so the move-row was inserted in the wrong place — 93 of 105 files in the run were missing the row.
- **F15 (property-enrich, GR-2):** the tag-block regex `(?ms)^tags:\s*\r?\n((?:\s*-\s*.+\r?\n?)+)` matched greedily across newlines because `.+` matches newlines under `(?s)`, so the new `- VaultAutopilot` line landed at the end of the frontmatter instead of inside the tags list — 16 notes affected.

Both bugs share a root cause: each LLM-run of each skill wrote its own ad-hoc multi-line regex. Each new regex was a new bug-surface. This file is the fix.

## Forbidden patterns

| Forbidden | Why |
|-----------|-----|
| `re.sub(r'(?s)...', ...)` over a multi-line span | `(?s)` makes `.` match newlines; `.+`/`.*` becomes greedy across the whole file |
| `re.sub(r'(?m)...', ...)` with `.+` or `.*` against multi-line content | Under `(?m)` alone, anchors become per-line — but if the regex still matches `.+`/`.*` across newlines, the whole regex is fragile |
| Any regex containing `.+` or `.*` against input that may span newlines | Greedy across newlines, every time |
| `str.replace(old_block, new_block)` where either contains a newline | A single matching prefix anywhere else in the file corrupts it |
| `str.replace` on YAML field values when the value is not unique in the file | The value may also appear in body text |
| Reading the entire file into one string and patching the string | The whole class of bugs F8/F15 belongs to |

The only `str.replace` allowed: a single-line atomic value change where the entire matched line is unique in the file. Even then, prefer the line-by-line procedure below.

## The single allowed approach: line-by-line

1. Read the file.
2. Split into lines (preserve line endings: detect CRLF vs LF once at the top, write back with the same).
3. Walk lines with an index. Find the relevant boundaries (frontmatter open, frontmatter close, tag block start/end, callout block start/end) by exact-string line match — never by regex over the joined text.
4. Mutate the line list (insert, replace, delete).
5. Join with the detected line ending and write back.

Boundaries are identified by full-line equality after `.rstrip('\r\n')`:

- Frontmatter open: the first line equal to `---`
- Frontmatter close: the next line equal to `---` after the open
- Skill-log callout open: a line equal to `> [!info] Vault Autopilot`
- Tag block start: a line whose `.rstrip()` equals `tags:` inside the frontmatter
- Tag block end: the first subsequent frontmatter line that does NOT match `^\s*-\s` (a per-line regex, single-line input — safe)

Per-line regex is fine. Multi-line regex is not.

## Recipe (a) — Read the YAML frontmatter block

```text
1. Read file → lines.
2. Strip a UTF-8 BOM (U+FEFF, bytes EF BB BF) from lines[0] before any
   comparison. Preserve the BOM on write-back — recipe (a) reads, it does
   not re-encode.
3. If lines[0].rstrip() != '---': no frontmatter exists. Return None.
4. Walk i from 1; the first i where lines[i].rstrip() == '---' is the close.
5. frontmatter = lines[1:close_index]    # the slice between the two ---
6. body = lines[close_index+1:]
```

If the file has fewer than two `---` lines, treat the file as having no frontmatter. Never invent a frontmatter block from a single `---`.

> **Note:** "Return None" is a read-result, not a health verdict. A file whose line 0 (after BOM-strip) is `---` with no closing `---` is classified `UNCLOSED_FRONTMATTER` (Class-A) by `references/yaml-sanity.md` Pattern 3 — the sanity-check runs its structural checks before treating the file as frontmatter-free.

## Recipe (b) — Replace a single field value

```text
1. Read frontmatter lines (recipe a).
2. Find the first frontmatter line whose .lstrip() starts with "<field>:" and the character after the colon is whitespace or end-of-line.
3. Preserve the original indent of that line.
4. Replace the entire line with: f"{indent}{field}: {new_value}".
5. Write the frontmatter + body back.
```

Never match `<field>:` against the joined frontmatter string — it may also appear inside another field's value.

## Recipe (c) — Add a new field

```text
1. Read frontmatter lines (recipe a). If none, create one: ['---', f'{field}: {value}', '---', ''] then prepend body.
2. If the field already exists (recipe b's match): use recipe (b) to replace, do not add a duplicate.
3. Otherwise: insert the new line as the LAST line of the frontmatter slice (immediately before the closing ---).
4. Never insert in the middle of an existing list-field block (e.g. between `- TagA` and `- TagB`).
5. Never insert before an opening field that "looks related". Frontmatter is order-insignificant for YAML; appending at the end is always safe.
```

## Recipe (d) — Append to a list field (e.g. `tags:`)

This is the F15 surface. Read it twice.

```text
1. Read frontmatter lines (recipe a).
2. Convert inline `tags: [X, Y]` to block format if needed (per references/skill-log.md):
   a. If a line matches `tags: [...]` exactly (per-line regex), parse the items.
   b. Replace that single line with: `tags:` followed by one `  - <item>` per item.
3. Find the tags-block start: the first frontmatter line whose .rstrip() == 'tags:'.
4. Walk forward from start+1. The tags-block end is the first frontmatter line that
   does NOT match the per-line regex `^\s*-\s+\S` (i.e. the first line that is no longer a
   list item — could be the next field, a blank line, or the closing ---).
5. Idempotency: if any line in tags-block-start+1 .. tags-block-end-1 has .strip() == f'- {value}',
   STOP — the tag is already present. Do nothing.
6. Insert the new line immediately BEFORE the tags-block-end index, with indent matching
   the existing list items (read it from the first list item; default `  - ` if none).
```

The new line is inserted *inside* the list, not after it. The tag block does NOT extend to the closing `---`.

## Recipe (e) — Append a row to the skill-log callout

This is the F8 surface. Read it twice.

```text
1. Read full file lines.
2. Find callout start: the first line whose .rstrip() == '> [!info] Vault Autopilot'.
   If none: skip to "Create new callout" below.
3. Walk forward from start+1. The callout end is the first line that does NOT start with '>'
   after .lstrip() — i.e. the first non-blockquote line. End-of-file also counts as end.
4. Inside the callout, find the LAST line whose .lstrip() starts with '> |' AND whose
   second pipe-segment is NOT all dashes (i.e. it is a data row, not the separator).
   The separator line looks like: `> |------|-------|--------|` — note the leading `> `.
5. Idempotency: if any data row in the callout has the same date+skill+action triple,
   STOP. Do not duplicate.
6. Insert the new row line directly AFTER the last data row index. Format:
   `> | YYYY-MM-DD HH:MM | <skill> | <action> |`
   Do not insert before the separator. Do not insert after the callout end. Do not insert
   between the title line and the separator.

Create new callout (when step 2 finds none):
   a. Ensure file ends with exactly one trailing newline before appending.
   b. If the last non-empty line is not blank, append one blank line first (separator).
   c. Append the four lines:
      > [!info] Vault Autopilot
      >
      > | Date | Skill | Action |
      > |------|-------|--------|
      > | YYYY-MM-DD HH:MM | <skill> | <action> |
```

The blockquote prefix `> ` is on every line of the callout — including the separator. The F8 bug was caused by an append-after-separator regex that did not account for the `> ` prefix on the separator. Step 4 above fixes this by matching the leading `> |` and excluding all-dash second-segments.

## Idempotency

Re-running the same edit MUST be a no-op. This is non-negotiable.

| Edit | Idempotency check |
|------|-------------------|
| Add field | If field already present (recipe b match), do nothing |
| Append to tags list | If `- VaultAutopilot` (or whatever value) already present in the tags block, do nothing |
| Append callout row | If a data row with identical date+skill+action triple already present, do nothing |
| Create callout | If `> [!info] Vault Autopilot` already present, append a row to it instead — never create a second callout |

The check happens BEFORE the insert, not after. If you have to undo an insert, the check was wrong.

## Worked example — appending VaultAutopilot tag

**Input:**

```yaml
---
title: Budget Review
created: 2024-06-15
tags:
  - Finance
  - Quarterly
modified: 2026-04-13
description: Q2 budget review notes for the team.
---

# Budget Review
```

**Procedure (recipe d):**

1. Frontmatter slice = lines 1..7 (between the two `---`).
2. Tags block start: index 3 (the `tags:` line, 0-indexed in the slice). Indent of list items: 2 spaces, prefix `- `.
3. Walk forward: index 4 is `  - Finance` (matches list-item per-line regex), index 5 is `  - Quarterly` (matches), index 6 is `modified: 2026-04-13` (does NOT match — this is the tags-block end).
4. Idempotency: scan indices 4..5. No `- VaultAutopilot`. Proceed.
5. Insert `  - VaultAutopilot` at index 6 (the tags-block-end), pushing `modified` down by one.

**Output:**

```yaml
---
title: Budget Review
created: 2024-06-15
tags:
  - Finance
  - Quarterly
  - VaultAutopilot
modified: 2026-04-13
description: Q2 budget review notes for the team.
---

# Budget Review
```

Re-run on the output: step 4 finds `- VaultAutopilot` at index 6, stops. Zero-diff.

## DO NOT — F8 bug pattern

```python
# F8 BUG. DO NOT WRITE THIS.
# Intent: append a row after the table separator inside the callout.
content = re.sub(
    r'(\| Date \| Skill \| Action \|\n\|------\|-------\|--------\|)\n',
    rf'\1\n> | {date} | {skill} | {action} |\n',
    content,
)
# Why it failed: the separator line in the actual callout has the `> ` blockquote
# prefix → it is `> |------|-------|--------|`, not `|------|-------|--------|`.
# The regex did not match. The new row was inserted nowhere or in the wrong place.
# 93 of 105 files in the F8 run were missing the row.
```

Use recipe (e) instead. Walk lines. Find `> [!info] Vault Autopilot`. Walk forward. Insert after the last `> | ... |` data row. Do not write a multi-line regex.

## DO NOT — F15 bug pattern

```python
# F15 BUG. DO NOT WRITE THIS.
# Intent: append a tag inside the existing `tags:` block.
content = re.sub(
    r'(?ms)^tags:\s*\r?\n((?:\s*-\s*.+\r?\n?)+)',
    lambda m: f"tags:\n{m.group(1).rstrip()}\n  - VaultAutopilot\n",
    content,
)
# Why it failed: under (?s), `.+` matches newlines. The (?:\s*-\s*.+\r?\n?)+ group
# was greedy across the rest of the frontmatter — it consumed every line up to the
# closing `---` (which also matches `\s*-\s*.+`, since `---` is dashes). The
# replacement put the new tag at the END of the frontmatter block, not inside the
# tags list. 16 notes received an orphan `- VaultAutopilot` line above `---`.
```

Use recipe (d) instead. Walk lines. Find `tags:`. Walk forward to the first non-list-item line. Insert before that line. Do not write a multi-line regex.

## Why per-line regex is fine

A per-line regex like `^\s*-\s+\S` against a single-line input is safe — there is no multi-line ambiguity, no greedy newline match. Use per-line regex freely for classification ("is this line a list item?", "is this line `tags:`?"). Just never join lines and regex the joined string.

## Recipe (f) — Normalize inside-colon quoted-keys (F26 repair)

This is the F26 cluster surface (shape β — inside-colon). Read it twice.

> **Scope:** Recipe (f) targets ONLY shape β (`"<key>:":` with inside-colon AND outside-colon). It does NOT touch shape α standard quoted-keys (`"<key>":` with no inside-colon — valid YAML). See `references/yaml-sanity.md` § "Detection patterns" for the distinction.

```text
1. Read frontmatter lines (recipe a). If no frontmatter, no-op.
2. Walk frontmatter lines with index. For each line where the per-line regex
   F26_INSIDE_COLON_PATTERN = re.compile(r'^(\s*)"([^"]+):"\s*:(.*)$') matches:
   a. Extract groups: indent, key_name, value_with_colon_separator.
   b. Replace line with: f"{indent}{key_name}:{value_with_colon_separator}".
3. After all replacements (in-memory; do NOT write yet), walk the computed line
   list. Build a key-name → list-of-values index. For each key-name appearing
   on ≥ 2 lines:
   a. Extract per-line normalized value: strip leading whitespace, strip the
      `<key>:` prefix, strip leading/trailing whitespace from the remainder,
      strip a trailing comment (`# ...`).
   b. Compare values byte-wise across the lines for this key-name.
   c. **All values byte-identical** (the safe-collision sub-case):
      - Keep the FIRST occurrence, remove subsequent occurrences from the
        in-memory list.
      - Log each removed line as Class-D finding "duplicate-key-removed-identical"
        (file_ref + key_name + value).
   d. **Any value differs from another** (the divergent sub-case — F7 family):
      - **ABORT recipe (f) for this file.** Do NOT write the in-memory list
        back to disk. The on-disk file is left exactly as it was when recipe
        (f) was invoked.
      - Log a Class-A finding "duplicate-key-divergent-values" (file_ref +
        key_name + list of all observed values) per affected key-name.
      - Return signal `DIVERGENT` to caller. Caller skips the file per per-skill
        policy in `references/yaml-sanity.md` § "Per-skill policy".
   e. If no divergent collisions are present (all collisions were identical-value
      OR no collisions at all), proceed to step 6 with the deduplicated in-memory
      line list.
4. Idempotency: if no lines matched in step 2, the function is a no-op.
   Re-running on already-normalized frontmatter returns unchanged.
5. Standard quoted-keys (shape α — `"description":` with no inside-colon) are
   untouched by this recipe. They are valid YAML and pass through.
6. Write frontmatter + body back per recipe (a) write-back semantics.
```

### Worked example A — recipe (f) identical-value collision (silent dedup, Class-D)

**Input (broken — shape β + identical-value collision):**

```yaml
---
"created:": 2024-03-14
created: 2024-03-14
"modified:": 2024-06-15
"description:": Apple Notes export
tags: [AppleNoteImport]
---
```

**Procedure:**

1. Walk frontmatter lines 1..5.
2. Line 1 matches `F26_INSIDE_COLON_PATTERN`: groups `("", "created", " 2024-03-14")` → would replace with `created: 2024-03-14` (in-memory).
3. Line 2: no match (already plain). Value `2024-03-14`.
4. Line 3 matches: groups `("", "modified", " 2024-06-15")` → would replace with `modified: 2024-06-15`.
5. Line 4 matches: groups `("", "description", " Apple Notes export")` → would replace with `description: Apple Notes export`.
6. Line 5: no match.
7. Post-replacement walk (in-memory): two `created:` lines (line 1 = `2024-03-14`, line 2 = `2024-03-14`). Compare normalized values: byte-identical. Sub-case (c): keep first, remove second. Log Class-D finding "duplicate-key-removed-identical: created (kept value `2024-03-14`)".
8. No divergent collisions. Proceed to write back the deduplicated normalized line list.

**Output:**

```yaml
---
created: 2024-03-14
modified: 2024-06-15
description: Apple Notes export
tags: [AppleNoteImport]
---
```

Re-running recipe (f) on the output: step 2 matches no lines, step 3 finds no duplicates, function is a no-op. Idempotent.

### Worked example B — recipe (f) divergent-value collision (ABORT, Class-A, F7 case)

**Input (broken — shape β + divergent-value collision; mirrors the empirical F7 finding from GR-3 Cell 1, 2026-05-01, on `neckarshore.ai brand style guide brief.md`):**

```yaml
---
"status:": draft
status: ready-for-designer
title: F7 case
---
```

**Procedure:**

1. Walk frontmatter lines 1..3.
2. Line 1 matches `F26_INSIDE_COLON_PATTERN`: groups `("", "status", " draft")` → would replace with `status: draft` (in-memory).
3. Line 2: no match (already plain). Value `ready-for-designer`.
4. Line 3: no match.
5. Post-replacement walk (in-memory): two `status:` lines (line 1 = `draft`, line 2 = `ready-for-designer`). Compare normalized values: byte-different. Sub-case (d): **ABORT recipe (f) for this file.** Do NOT write the in-memory list back. Log Class-A finding "duplicate-key-divergent-values: status (observed values: `draft`, `ready-for-designer`)".
6. Return signal `DIVERGENT` to caller.

**Output:** file on disk is unchanged (still has shape β `"status:"` line + plain `status:` line). The in-memory normalized list is discarded.

**Caller behavior** (per `references/yaml-sanity.md` per-skill policy):
- `property-enrich`: skip file, route to user / note-rename.
- `note-rename`: skip file, route to user (do NOT rename — user may legitimately need to merge values first).
- `inbox-sort`: skip file, route to user / note-rename.
- `property-describe`: skip file, route to user / property-enrich.

**Why ABORT vs auto-pick:** Either pick (first/last/heuristic) commits a silent semantic-shift on a field the user explicitly disagreed with (two values exist precisely because the user wrote them — even if one was an old import-residue and one was a manual edit). Recipe (f)'s job is structural normalization, not authorship-arbitration. The user must merge the values manually; the skill must NOT pretend it knows.

Re-running recipe (f) on the unchanged file: same outcome — sub-case (d), ABORT, log, return DIVERGENT. Idempotent in the abort sense (same input → same outcome → same verdict).

### DO NOT — broken normalize patterns

```python
# DO NOT WRITE THIS — multi-line regex over joined frontmatter
content = re.sub(
    r'(?ms)"([^"]+):"\s*:\s*(.+?)\n',
    lambda m: f'{m.group(1)}: {m.group(2)}\n',
    content,
)
# Why it fails: under (?s), `.+?` matches across newlines (non-greedy still
# matches newlines). The lazy quantifier saves you from greedy-eat-everything
# but YAML quoted-string values can themselves span newlines — corrupting
# multi-line values. Per-line regex is fine. Multi-line regex is not.
```

Use recipe (f) as defined. Walk lines. Per-line regex match. Replace per line.
