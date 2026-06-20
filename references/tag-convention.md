# Obsidian Vault Tag Convention

Default tagging convention for obsidian-vault skills. All skills that generate or modify tags MUST follow these rules. The brand list and hierarchy prefixes are opinionated defaults — a future config system will make them customizable per vault.

> **Case is cosmetic, not functional.** Obsidian matches tags case-insensitively (`#AI` and `#ai`
> are the same tag) — see [`tag-semantics.md`](tag-semantics.md) for the Step 0 finding. The PascalCase
> rules below are an opinionated *display* convention, not a functional fix. `tag-manage` therefore
> treats case-normalization as an opt-in (default OFF) cosmetic operation, and uses this file as the
> source for the target casing when the user opts in.

## Rules

| # | Rule | Convention | Examples | When to apply |
| ---: | :--- | :--- | :--- | :--- |
| 1 | Standard tags | **PascalCase** | `DevTools`, `OpenSource`, `DayTrading` | All concept/topic tags |
| 2 | Hierarchical tags | **PascalCase with `/`** | `Software/DevTools`, `OpenSource/AI-ML` | When categorization is needed |
| 3 | Compound terms | **Hyphen between parts** | `AI-ML`, `AI-Coding`, `Low-Code` | Only for established terms with natural hyphen |
| 4 | Brand names / abbreviations | **Preserve original casing** | `n8n`, `SaaS`, `LinkedIn`, `BSI`, `MQTT` | Always — brands keep their identity |
| 5 | No `#` prefix | `Research` not `#Research` | — | Never use `#` in YAML frontmatter tags |
| 6 | No lowercase concept tags | `Research` not `research` | — | Always PascalCase unless it's a brand |

## How to apply when generating tags

1. Before writing a tag, check: is it a brand name or abbreviation? If yes, use official casing.
2. If not a brand, apply PascalCase: `security` -> `Security`, `day trading` -> `DayTrading`.
3. For compound terms with natural hyphens, keep the hyphen: `AI-ML`, `AI-Coding`.
4. For hierarchical categorization, use `/`: `Software/DevTools`, `OpenSource/CLI`.
5. Never prefix with `#` — Obsidian YAML tags don't need it.
6. Abbreviations stay uppercase: `ETF`, `ADAC`, `BSI`, `CMS`, `API`, `MQTT`.

## Common brand names (preserve exactly)

`n8n`, `GitHub`, `LinkedIn`, `ChatGPT`, `YouTube`, `WordPress`, `SaaS`, `Figma`,
`Telegram`, `Perplexity`, `Mistral`, `Qwen`, `Tesla`, `Renault`, `ServiceNow`,
`Personio`, `Grafana`, `Juniper`, `Docker`, `Kubernetes`

## Hierarchical tag prefixes in use

| Prefix | Purpose | Examples |
| :--- | :--- | :--- |
| `Software/` | SaaS and commercial software categories | `Software/DevTools`, `Software/FinTech`, `Software/AI-ML` |
| `OpenSource/` | Open-source project categories | `OpenSource/DevTools`, `OpenSource/AI-ML`, `OpenSource/CLI` |
| `Protocol/` | Standards and protocols | `Protocol/Payments`, `Protocol/Identity`, `Protocol/AI` |
| `Meta/` | Vault management and meta-notes | `Meta/TagManagement` |

## Override dictionaries (canonical store for tag-manage)

The `tag-manage` skill enforces this convention via two dictionary layers. **These dictionaries are the authoritative override store** — the brand list and compound list above are documentation; the dictionaries drive the compliance engine.

**Shipped generic defaults** — `skills/tag-manage/references/tag-overrides.default.json`

Contains curated brand and compound entries covering common tools (GitHub, ChatGPT, YouTube, LinkedIn, n8n, SaaS, LLM, API, Figma, Telegram, Instagram, NotebookLM) and common compound terms (OpenSource, LowCode, GenerativeAI, AI-ML, AI-Agents, AI-Coding, ClaudeCode, KnowledgeManagement, and others). MIT-licensed generic defaults — no vault-specific personal brands.

**Vault-local overrides** — `Tag Manage Config.md` in the vault (auto-discovered by filename)

A Markdown note containing a `json` fenced code block with `brands`, `compounds`, and optionally `reportDir` fields. Vault-local entries win over the shipped defaults on collision. Add personal brands, project-specific abbreviations, and vault-specific compound terms here. See the `tag-manage` skill for the full config schema.

The merge follows the rule: vault-local overrides first, shipped defaults fill the rest. Neither layer is edited directly by the engine — the agent writes the vault-local config note as a one-time setup step.
