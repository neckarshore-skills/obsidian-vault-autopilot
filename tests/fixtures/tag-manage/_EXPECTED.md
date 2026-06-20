# tag-manage chaos vault — expected audit findings

> This file is underscore-prefixed so the engine's walk **excludes it** from the audit.
> It documents what `node skills/tag-manage/scripts/cli.js audit <this-dir>` should report,
> so a UAT reviewer can eyeball the result. Notes 01-10 are the synthetic chaos surface.

## What each note exercises

| Note | Exercises |
|------|-----------|
| 01-block-list | rep 1 (block list); `AI`, `Ml`, `ai-coding` |
| 02-inline-array | rep 2 (inline array); `JavaScript` / `javascript` case pair |
| 03-scalar | rep 3 (single scalar `tags: ai`) |
| 04-legacy-singular | rep 4 (legacy `tag: ai`) |
| 05-body-inline | reps 5 + 6 (inline `#ai`, `#AI`, nested `#parent/child`) |
| 06-survival | survival: code fence, inline code, URL `#frag`, ATX heading, wikilink — only `#realtag` + frontmatter `realtag` count |
| 07-separator-variants | `ai-ml` / `ai_ml` group; `ai/ml` stays distinct (nested) |
| 08-orphan-numeric | orphan `SoloTopic`; numeric artifact `2024` |
| 09-untagged | untagged note |
| 10-reserved | `VaultAutopilot` excluded from all findings |
| 11-multi-key | real-shaped frontmatter: keys before AND after `tags:` — surrounding keys stay byte-exact on apply |

## Expected findings (summary)

- **Cosmetic (case variants):** `ai` → `{ AI, ai }` (frontmatter + body across notes 01/02/03/04/05/08/10);
  `javascript` → `{ JavaScript, javascript }` (note 02). These are FUNCTIONAL no-ops in Obsidian — fix is opt-in.
- **Functional duplicates (separator):** `{ ai-ml, ai_ml }` (note 07). `ai/ml` is NOT in this group.
- **Orphans (single-note tags):** e.g. `ml`, `ai-coding`, `realtag`, `ai-ml`, `ai_ml`, `ai/ml`, `solotopic`,
  `parent/child` — any logical tag used in exactly one note.
- **Numeric artifacts:** `2024` (note 08) — invalid, never a merge target.
- **Untagged notes:** `09-untagged.md`.
- **Never surfaced:** `VaultAutopilot` (reserved) — not an orphan, not a suggestion.

## Survival check (the critical one)

In `06-survival.md`, the only real tags are the frontmatter `realtag` and the inline `#realtag`.
Every `#ai`-looking token inside the code fence, inline code, the URL, the heading text, and the
wikilink must be reported as NON-tags — and on any `apply` run, left byte-for-byte unchanged.
