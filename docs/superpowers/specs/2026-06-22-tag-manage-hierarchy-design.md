# Tag-Manage — Intelligent Hierarchy / Restructure Layer (Design)

- **Date:** 2026-06-22
- **Author:** Obi (Skill Master)
- **Skill:** `tag-manage` (Obsidian Vault Autopilot)
- **Status:** Build order locked (user, 2026-06-22) — Phase 1 (deterministic nest mechanics) builds now; Phase 2 (content-based suggestion) is the committed next build; the name-based suggester is **dropped**.
- **Supersedes:** the "Handover: Tag Manager — Intelligent Restructure Layer" note (v1.0, two parallel chat sessions) — treated as design *input*, not ground truth (see Provenance)

## Decision (2026-06-22, user)

Build order locked: **build the deterministic nest mechanics first; content-based suggestion is the committed next phase.**

- **Build now (Phase 1 = "v1" below):** the `hierarchy` config block, the `nest` recommendation class, the `set-hierarchy` CLI, and the deterministic tests — on synthetic fixtures (no production-vault access required to build).
- **Dropped:** the name-based cluster suggester. It was a throwaway half-step — Phase 2's content-based suggestion supersedes it, so we skip it rather than build-then-replace.
- **Committed next (Phase 2 = "v2" below) — its OWN skill:** content-sampled suggestion (the LLM reads note bodies to propose clusters), behind its own production-read gate. This is where the skill **splits in two**: Phase 2 becomes a separate skill `tag-organize` (the user's "Tag Optimierung") — the home of the AI-driven restructure. The concrete clusters for the user's vault are defined once the in-flight production cleanup exposes the real residual flat tags.
- **Skill split lands at the Phase 2 boundary, NOT now.** Phase 1 is engine plumbing with no standalone user-facing step (the name-based suggester — its only user step — was just dropped). A Phase-1-only second skill would be hollow at birth: nobody hand-authors a taxonomy config. So Phase 1 is an extended step in the existing `tag-manage` (shared engine); the second skill is born when Phase 2 is built. The two-skill question IS the Phase 2 question.
- **Label note (this was the confusion):** "v1 / v2" in this document are **build phases of the hierarchy feature** — NOT the shipped `tag-manage` v1/v2 (the audit + compliance cleanup, already merged in #42–#47). Two different axes; the shipped cleanup does rename/merge/remove, the hierarchy feature adds the new `nest` operation.

## Provenance & how to read this

This design consolidates two sources into one authoritative version:

1. **This brainstorm** — grounded in the shipped v0.2.1 code (SKILL.md, `convention.js`, the dictionaries) read this session.
2. **The handover note** from a parallel chat session — useful vision, but **not grounded in the v0.2.1 code**. Where it diverges from the code or from the skill's safety DNA, the code wins and the divergence is named explicitly (see "Divergences from the handover").

When this document and the handover disagree, **this document is authoritative.**

## Current state (grounded in v0.2.1)

`tag-manage` today does, deterministically:

- **`audit`** (read-only) — full tag inventory + convention scoring + recommendations; writes a Markdown report + `.tag-manage-recommendations.json`.
- **`plan`** (dry-run) → **`apply --write`** (after explicit confirm) — executes approved ops, re-audits for an after-changes report.
- **Convention engine** (`convention.js`) — severity-classified violation rules, first-match-wins.
- **Canonical resolver** — brand dictionary → compounds dictionary → PascalCase heuristic.
- **Dictionaries** — shipped `tag-overrides.default.json` + vault-local `Tag Manage Config.md` (`brands`, `compounds`, `reportDir`).
- **Six on-disk tag representations** rewritten consistently; **survival + mass-change guards**; birthtime preserved; report-artifact self-exclusion via the `Meta/TagManagement` marker.

**What is missing:** an active *restructure* step — nothing today proposes turning a sprawl of flat / singleton tags into a clean nested taxonomy. Hierarchy is only handled passively (`#parent/child` is treated as a whole-path unit; a LOW `flat-where-hierarchical` flag fires when a flat tag duplicates an already-existing hierarchy leaf).

## The non-negotiable safety invariant

> **LLM proposes → human approves → written to config → deterministic engine applies. The write path NEVER executes LLM text.**

The engine stays deterministic and AI-agnostic (philosophy.md: determinism is the safety guarantee; the AI logic lives in plain Markdown instructions, not in the scripts). Every byte-level note rewrite is done by the deterministic engine reading the **user-approved config**, never raw model output.

## Architecture: two passes

```
[Vault] → Pass 1: DETERMINISTIC ENGINE        → Pass 2: AGENT/LLM (read-only)   → Review/Approve → Engine applies
          normalize · dedupe/merge · dictionary·   induction over RESIDUALS only       (recs + --ids)   (deterministic
          declared-hierarchy NEST                   (tags the rules are silent on)                        write path)
          rules = CONSTRAINTS                        proposes structure + advisory notes
                                                     never overrides a firing rule
```

- **Pass 1 — deterministic engine.** The existing audit/convention/canonical/dictionary machinery, plus the new declared-hierarchy NEST (v1). Rules are **constraints** here.
- **Pass 2 — agent/LLM, read-only.** Operates only on the **residuals** — tags Pass 1 left unresolved (flat singletons, ungrouped tags). Proposes nesting/merging + optional advisory notes. It **never overrides a rule that fired in Pass 1**; it only acts where the rules are silent. (This is the deliberate downgrade of the handover's "rules are hypotheses" — see Divergences.)

This two-pass split is not only an LLM-complexity decision (the handover's own critical review #1) — it is the **safety boundary**: deterministic-and-rule-bound first, model-and-residual-only second, human gate between Pass 2 and any write.

## Layers

| Layer | Change | v1 / v2 |
|---|---|---|
| Config (`Tag Manage Config.md`) | New `hierarchy` block (parent → children) | v1 |
| Engine (`convention.js` / `recommend.js`) | Hierarchy = a canonical layer; declared flat child → `nest` recommendation | v1 |
| Apply / survival (`tags.js`) | **Unchanged** — NEST is a rename onto a slash path, through the existing recs/apply/survival path | v1 |
| CLI (`cli.js`) | New deterministic `set-hierarchy` command (writes approved clusters into config) | v1 |
| Agent layer (SKILL.md) | ~~Name-based cluster suggestion step~~ — **DROPPED** (Phase 2's content-based suggestion supersedes it) | — |
| Agent layer (new skill `tag-organize`) | Content-sampled rule-aware induction over residuals + advisory notes | v2 |

---

## v1 — build now

### Config: the `hierarchy` block

Authored as **parent → children** (human-readable); the engine derives the internal mapping.

```json
{
  "brands": { "...": "..." },
  "compounds": { "...": "..." },
  "reportDir": "020_Processes/.../SecondBrain/Tag Management for Obsidian",
  "hierarchy": {
    "Investing": ["DayTrading", "SwingTrading", "LongTermInvesting", "WealthBuilding"],
    "AI":        ["AIAgent", "AIAssistant", "GenerativeAI", "PromptInjection"]
  }
}
```

- Each child is a logical key; the engine resolves a flat occurrence to `Parent/Child` (e.g. `daytrading` → casing-canonical `DayTrading` → nested `Investing/DayTrading`).
- Merge semantics identical to `brands`/`compounds`: vault-local, additive, preserved on rewrite.

**Config validation (hard):**

- Child must be a **valid Obsidian tag** — letters/digits/`_`/`-`/`/` only, **no spaces** (the exact `"Tag Management"` trap). Invalid child → config error, reported, never applied.
- **One parent per child** — a child key under two parents is a config error.
- **No cycles** — a declared child must not equal one of its ancestors.

### Engine: the `nest` recommendation (NEST)

- A flat tag that (a) is declared as a child in `hierarchy` and (b) actually occurs flat in the vault inventory → produces a **new recommendation class `nest`**: `promote DayTrading → Investing/DayTrading`.
- `nest` is a **real recommendation, not cosmetic**, but **not bundled into the default cleanup** — it changes tag identity across potentially many notes, so it is opt-in per id via the existing `--ids` selection.
- Composes with casing: `daytrading` → `Investing/DayTrading` is a single `nest` op.
- The existing LOW `flat-where-hierarchical` stays for *organically* pre-existing hierarchies; `nest` is the *declared* case.
- All counts (`notesAffected`) come from the **engine inventory**, never from a model claim.
- **Apply path unchanged:** a `nest` is a rename onto a slash path → flows through `applyOps` + survival + mass-change guards + the six representations. No new write code.

### CLI: `set-hierarchy` (deterministic config writer)

```bash
node ".../cli.js" set-hierarchy <vault> --parent Investing \
  --children DayTrading,SwingTrading,LongTermInvesting,WealthBuilding
```

- Writes/merges the cluster into the `hierarchy` block of `Tag Manage Config.md` (created if absent; `brands`/`compounds`/`reportDir` preserved).
- Pure file I/O — **no LLM**. Runs the same config validation before writing.
- This is the only way Pass-2 suggestions become durable, and it requires explicit invocation after user approval.

### Agent layer: name-based suggestion (the v1 slice of B) — DROPPED (2026-06-22)

> **Dropped per the 2026-06-22 decision.** Phase 2's content-based suggestion supersedes a names-only guesser; building it now would be throwaway work. Phase 1 ships with **no** agent-layer suggestion step — clusters are authored directly via `set-hierarchy` (config writer) until the `tag-organize` skill (Phase 2) provides the AI suggestion. The flow below is retained for design reference only.

In SKILL.md, after `audit`:

1. The agent reads the audit inventory's **flat tags + singletons** (already produced, deterministically).
2. The agent proposes candidate clusters **from tag names only** (v1 — no content reading yet), as a **read-only table**, each flagged `verify — AI suggestion`, respecting existing parents (`OpenSource/`, `Software/`, `Meta/`).
3. **Gate:** user reviews / edits / accepts clusters. Nothing is written.
4. Accepted clusters are persisted via `set-hierarchy`.
5. Re-`audit` → `nest` recommendations appear (Pass 1) → `plan` → `apply` through the normal gate.

### Validation guard (applies to every proposed op)

Before any suggested op is shown as *applicable*, the engine validates it: target is a valid tag (no spaces), the path is well-formed, counts are engine-derived. A model's "12 Dev-notes" is a claim to verify, not a fact.

### Docs (v1)

- **Cookbook** (`Obsidian Tag Management — Cookbook.md` in the vault): add `Meta/` as a sanctioned parent prefix (the Option-1 deliverable); add a "Tag Hierarchy Strategy" subsection (declared taxonomy + growing it via the suggestion flow); reference the `hierarchy` config field.
- **SKILL.md**: document the `hierarchy` field, the `nest` recommendation class, the suggestion workflow, and `set-hierarchy`.

### Tests (v1)

Deterministic, unit-tested:

- hierarchy parse from config; flat → `Parent/Child` resolution; `nest` recommendation generation.
- `nest` applied → hits all six representations + survives the survival guard.
- idempotency / convergence — once nested, a re-run proposes no new `nest` for that tag.
- edge cases — child already nested → no-op; invalid child (space) → config error; child under two parents → config error; cycle → config error.
- `set-hierarchy` — deterministic config write (merge, preserves existing keys, valid JSON out).

The name-based suggestion is **agent-layer** and is **not** unit-tested as an LLM (honest: we do not fake a model test). It is covered by the workflow gates (read-only, human approval).

### Out of v1 (YAGNI)

- No content-based reading/induction (that is v2).
- No content-based auto-tagging (still permanently out of scope for this skill).
- No multi-parent / DAG — strict tree, one parent per child.
- No auto-demotion (nested → flat).
- No CHALLENGE machinery (see v2's reduced form).

---

## v2 — named follow-up (deferred; separate spec)

**Spec name:** `tag-manage-restructure-induction` (to be written when v1 ships + is validated).

### Content-sampled rule-aware induction over residuals

- **Input:** the residual tags from Pass 1 (unresolved flat/singletons) + their frequencies + a **bounded content sample** + the current rules (`tag-convention.md` + config) given explicitly to the model.
- **Processing:** the model proposes structure where the rules are silent — nesting and sibling-merges — each annotated with its basis (`[induced: N notes]` vs `[rule: ...]`).
- **Output → approval → `set-hierarchy` / ops → deterministic apply.** Same invariant; same write path.

### Op vocabulary (handover) mapped to engine reality

| Handover op | Engine reality | Notes |
|---|---|---|
| RENAME | existing rename op | already shipped |
| MERGE | existing merge op | already shipped (irreversible — confirm gate) |
| NEST | `nest` recommendation | v1 (declared) → v2 (induced) |
| KEEP | report annotation (no-op affirmation) | e.g. proper nouns kept flat |
| DELETE | maps to existing **frontmatter-only** remove | a zero-note tag is not in the inventory; no special DELETE path |
| CHALLENGE | reduced → "convention observations" note | see below |

### CHALLENGE → reduced to "convention observations"

The handover's CHALLENGE (model proposes amending a *rule*) risks meta-discussion over results (its own critical review #2). v2 reduces it to: the suggestion step may append a short **free-text "convention observations"** note for the human. **No op type, no confidence threshold, no auto-amendment workflow.** Amending the convention stays a deliberate, rare, human action, fully outside the per-run tag-op flow.

### Content-read gate + sampling strategy

Reading note **bodies** is a new, larger production-vault data-access surface (today the skill reads only tags/frontmatter). v2 gates it as its own capability:

- Sample **only residual tags** (not the whole vault).
- Default **top-3 notes per residual tag**, with a global cap.
- Explicit user gate stating scope ("restructure N residual tags, sampling M notes — proceed?").
- Honors the Production Vault Safety Rules (read is gated for production).

### Open design questions for the v2 spec

- One-pass vs explicit two-LLM-pass (rule-application then residual-induction) — measure on the real residual set first.
- Sample selection (most-recent? longest? highest-linked?) — start simple (most-recent 3), revisit with data.
- How `nest` interacts with merges proposed in the same round (ordering / conflict resolution).

---

## Divergences from the handover (explicit, knowingly accepted)

1. **"Rules are hypotheses, the LLM can CHALLENGE them" → downgraded.** Here, rules are **constraints** for the deterministic pass; the LLM acts only where rules are **silent** (residuals) and never overrides a firing rule. CHALLENGE shrinks to an advisory free-text note.
2. **Handover "Current State" item 3 ("Tag-Vorschläge") is not the shipped reality.** v0.2.1 SKILL.md explicitly puts content-based suggestion out of scope. The handover is design input, not a current-state description.
3. **DELETE is not a first-class op** — it collapses into the existing frontmatter-only remove + the fact that zero-note tags aren't inventoried.
4. **Restructure splits across the phase boundary** (handover open question 4, refined 2026-06-22): Phase 1 (deterministic nest mechanics) is an extended step in the existing `tag-manage` — shared engine, no standalone user step. Phase 2 (AI content-based restructure) is its **own skill** `tag-organize`. The split lands when Phase 2 is built, not before.

## Answers to the handover's open questions (grounded)

1. **Where do the rules live?** `references/tag-convention.md` (human convention + canonical casing) + `references/tag-semantics.md` (Obsidian case-insensitivity) + `scripts/convention.js` (enforced severity rules, first-match-wins) + the dictionaries (`tag-overrides.default.json` + vault-local `Tag Manage Config.md`). Documented, not undocumented. The model gets `tag-convention.md` + config as explicit input.
2. **Approval UI — per-op or bulk?** Selectable-bulk: the recommendations table + `--ids` ("apply all" / "apply 1, 3" / "skip 2"). Restructure reuses this.
3. **CHALLENGE — interrupt or separate?** Separate, advisory, never interrupts; in this design reduced to a free-text observations note.
4. **New skill or extended step?** Both — at different phases. Phase 1 (deterministic nest mechanics): extended step in `tag-manage` (shared engine, no standalone user step). Phase 2 (AI content-based restructure): its own skill `tag-organize` — the user's "Tag Optimierung". Phase 1 alone does not warrant a separate skill (nobody hand-authors a taxonomy config); the split is the Phase 2 question.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Model output reaching the write path | Hard invariant: write path reads only user-approved config; `set-hierarchy` is deterministic |
| Invalid tag from a suggestion (e.g. spaces) | Config + op validation rejects non-tags before they are applicable |
| Bulk NEST changing hundreds of notes | `nest` is opt-in per id; mass-change guard (50) + >10-note confirm both still fire |
| Content sampling cost / privacy (v2) | Residual-only, top-3, capped, own production-read gate |
| Non-convergence (re-proposing applied structure) | Idempotency test; engine proposes `nest` only for still-flat declared children |
| Handover scope creep | v1 locked to deterministic hierarchy; v2 is a separate named spec |
