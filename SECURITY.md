# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

Only the current release receives security updates.

## Data Handling

Obsidian Vault Autopilot is structured to keep your vault content as
close to your machine as possible, but the full picture has two parts
worth distinguishing:

**The plugin code itself makes no network calls.** The skills are pure
Markdown and Bash; no HTTP libraries are imported; no telemetry, no
analytics, no auto-updates, no error reporting are sent anywhere by the
plugin's own code. You can verify this with `grep -rn 'http\|fetch\|curl'`
across the repo.

**Skill execution happens inside Claude Code, which uses Anthropic's API.**
When you invoke a skill — `inbox-sort`, `note-rename`, `property-enrich`,
`property-describe`, or any of the in-development skills — Claude Code
reads the relevant note content and sends it to Anthropic's API to
generate the skill's output (rename suggestions, sort decisions, property
text). The note content processed by each skill is transmitted to
Anthropic during that invocation.

This means:

- For a vault you'd be comfortable processing through any cloud-based
  AI assistant (general notes, project files, public-domain content),
  the data-flow is unchanged from your normal Claude Code usage.
- For privacy-sensitive vaults (medical, legal, financial, family
  records), this is a real consideration. The plugin does not change
  Claude Code's data handling — but it does invoke Claude Code, and
  the note content reaches Anthropic during invocation.

Anthropic's privacy policy and data handling commitments apply to the
API calls Claude Code makes:
**https://www.anthropic.com/privacy**

If you need stricter data confinement than Anthropic's API offers
(self-hosted models, no third-party data processors), this plugin is
not the right tool for your use case today. If your threat model fits
within Anthropic's data handling commitments, the plugin code adds no
additional data-flow beyond what Claude Code itself does.

## Scope

The plugin reads and writes files within your configured `OBSIDIAN_VAULT_PATH`. It does
not access files outside that path.

## Reporting a Vulnerability

Report security issues via [GitHub Issues](https://github.com/neckarshore-skills/obsidian-vault-autopilot/issues).

Include:

1. **What you found** — describe the vulnerability
2. **How to reproduce** — steps to trigger the issue
3. **Impact** — what could go wrong if exploited

**Response time:** Best-effort. This is a solo-maintained open-source project, not a
commercial service with an SLA.

**No separate email channel.** Since the plugin runs locally with no network component,
GitHub Issues provides sufficient visibility and tracking for security reports.
