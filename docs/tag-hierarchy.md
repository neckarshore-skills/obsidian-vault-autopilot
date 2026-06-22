# Tag Hierarchy (Nesting)

`tag-manage` can promote a **flat** tag to a **nested** one under a parent you declare —
`#daytrading` becomes `#Investing/DayTrading`. This turns a flat sprawl of sibling topic
tags into a browsable tree in Obsidian's tag pane.

Nesting is **declared, not guessed.** You tell the skill which children belong under which
parent; the engine applies the change safely and deterministically. It never infers structure
from your note content — that is a separate, future skill (see [Phase boundary](#what-this-does-not-do)).

> **Note:** This is the user-facing overview. For the exact commands, config schema, and engine
> behavior, see the skill itself: [`skills/tag-manage/SKILL.md`](../skills/tag-manage/SKILL.md).

## When You'd Want This

- You have many flat sibling tags that belong under one umbrella (`#stocks`, `#etf`,
  `#daytrading` → all under `#Investing/`).
- You want Obsidian's tag pane to show a tree instead of one long flat list.
- You have just run a cleanup pass (rename / merge / remove) and the survivors are clean but
  still flat — nesting is the natural next step.

It is **not** for inventing a taxonomy you have not thought about yet. Nesting applies the
structure *you* declare. Letting the AI read note content and propose clusters is a separate,
later skill (`tag-organize`).

## How It Works

Four steps, each behind the same preview-and-confirm safety you get from every `tag-manage`
operation:

| # | Step | What happens |
|---|------|--------------|
| 1 | **Declare the cluster** | You tell the skill the parent and its children — e.g. "nest `DayTrading`, `SwingTrading` under `Investing`." This is saved to your vault-local `Tag Manage Config.md`. |
| 2 | **Audit** | A normal tag audit now also computes **nest recommendations** for any flat tag that matches a declared child. These are kept separate from the cleanup recommendations. |
| 3 | **Review** | Nest recommendations are **opt-in, one at a time** — they are never part of "apply all." You pick which ones to apply. |
| 4 | **Apply** | A nest rides the same write path, survival guarantees, and confirm gate as every other tag change. A before/after preview is shown before any file is touched. |

Nesting **converges**: once `#Investing/DayTrading` exists, a re-audit proposes no further nest
for it. Running the audit twice is safe.

## Choosing Your Parents

- Use **PascalCase** for both parent and children — `Investing/DayTrading`, not
  `investing/daytrading`. See the [tag convention](../references/tag-convention.md) for the full
  casing rules.
- **The child string you declare sets the leaf casing verbatim.** Declare `DayTrading`, not
  `daytrading` — the engine writes the path exactly as you declared it. A flat occurrence in any
  casing (`daytrading`, `DayTrading`) still matches and nests to that one canonical path.
- An invalid cluster is **refused** outright (nothing is written): a child with a space, a child
  already declared under a different parent, or a cycle.

The [tag convention](../references/tag-convention.md#hierarchical-tag-prefixes-in-use) lists the
sanctioned hierarchy prefixes already in use (`Software/`, `OpenSource/`, `Protocol/`, `Meta/`).

## "Why Is `Meta/TagManagement` in My Vault?"

`tag-manage` tags its own report notes with `Meta/TagManagement` so it can recognize and **exclude
them** from future scans — that way a report can never inflate your tag counts or be rewritten by a
later run. It is the skill's own bookkeeping marker, **sanctioned by convention, not a violation.**
You do not need to clean it up, and the audit skips these artifacts automatically.

## What This Does NOT Do

Phase 1 (this feature) nests **declared** hierarchies only. The AI-driven version — where the model
reads note *content* and proposes clusters for you — is **Phase 2**, a separate future skill
(`tag-organize`) with its own content-read gate. A name-only guesser was deliberately dropped because
the content-based version supersedes it.

See the design spec for the full reasoning:
[`docs/superpowers/specs/2026-06-22-tag-manage-hierarchy-design.md`](superpowers/specs/2026-06-22-tag-manage-hierarchy-design.md).

## See Also

- [`skills/tag-manage/SKILL.md`](../skills/tag-manage/SKILL.md) — commands, config schema, engine behavior
- [`references/tag-convention.md`](../references/tag-convention.md) — casing rules and sanctioned prefixes
- [Getting Started](getting-started.md) — back up, clone, preview, first run
