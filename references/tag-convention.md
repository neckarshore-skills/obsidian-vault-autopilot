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
