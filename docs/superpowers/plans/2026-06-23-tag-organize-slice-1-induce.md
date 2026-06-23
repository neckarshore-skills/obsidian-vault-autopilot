# tag-organize Slice 1 (Induce-Structure) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic name-based clustering that proposes a candidate tag hierarchy over a vault's flat residual tags, surfaced as a reviewable proposal the agent turns into approved nests via the existing Phase-1 rail.

**Architecture:** A new pure helper `induce.js` clusters flat residual tags by their shared leading token into candidate families (`parent -> children`). A new `induce` CLI command builds the audit inventory, runs the clusterer, and writes a `.tag-organize-clusters.json` proposal sidecar. A new `tag-organize` skill (SKILL.md) orchestrates: run hygiene first, run `induce`, review the proposal, read note content only for families the agent judges uncertain, then persist approved clusters via the existing `set-hierarchy` command and apply the resulting nests via the existing plan/apply path. **No new write code in Slice 1** — nesting rides the Phase-1 `applyOps`/survival path.

**Tech Stack:** Node.js (CommonJS), `node:test` + `node:assert/strict`, no runtime dependencies. Shared engine lives in `skills/tag-manage/scripts/`.

## Global Constraints

- Language: all code, comments, and skill instructions in English. No emoji in any skill or script file.
- Naming: kebab-case for files; skill name `tag-organize` (`[domain]-[action]`).
- No hardcoded paths: vault path comes from the caller / `${OBSIDIAN_VAULT_PATH}`; engine path resolved the same way `tag-manage/SKILL.md` resolves `cli.js` (mirror it verbatim — do not invent a new mechanism).
- `induce.js` is PURE: no `fs`, no clock (`Date`), no network, no LLM call. Same discipline as `hierarchy.js`.
- Slice 1 adds NO new write primitive. Nesting reuses the existing `applyOps` path via `set-hierarchy` + `buildNestRecommendations`.
- Test runner: `node --test skills/tag-manage/tests/*.test.js` (CI bridge `scripts/test-tag-manage.sh` already globs `*.test.js`; a new `induce.test.js` is auto-included — no workflow edit).
- Reserved tags (`isReserved`) and already-nested tags (key contains `/`) are never clustered (convergence).
- Inventory entry shape (from `buildInventory` in `tags.js`): `{ key, variants, noteCount, files }` where `key` is the lowercased logical key, `variants` is an array of display spellings, `noteCount` is a number, `files` is an array of note paths.

---

### Task 1: induce.js foundations — `tokenizeTag` + `leadingSegment`

**Files:**
- Create: `skills/tag-manage/scripts/induce.js`
- Test: `skills/tag-manage/tests/induce.test.js`

**Interfaces:**
- Consumes: nothing (pure string helpers).
- Produces:
  - `tokenizeTag(tag: string) -> string[]` — lowercase word tokens, split on `-`, `_`, `/`, camelCase boundary (lower→upper), and letter→digit boundary.
  - `leadingSegment(tag: string) -> string` — the verbatim display substring of the first token (preserves original casing, e.g. acronyms).

- [ ] **Step 1: Write the failing test**

```js
'use strict';
// induce.js — Slice 1: deterministic name-based clustering of flat residual tags.
// See docs/superpowers/specs/2026-06-23-tag-organize-design.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const { tokenizeTag, leadingSegment } = require('../scripts/induce.js');

test('tokenizeTag splits camelCase, separators, and letter->digit', () => {
  assert.deepEqual(tokenizeTag('BusinessModel'), ['business', 'model']);
  assert.deepEqual(tokenizeTag('day-trading'), ['day', 'trading']);
  assert.deepEqual(tokenizeTag('AI_Agents'), ['ai', 'agents']);
  assert.deepEqual(tokenizeTag('GPT4'), ['gpt', '4']);
  assert.deepEqual(tokenizeTag('investing'), ['investing']);
});

test('leadingSegment returns the first token in its original display casing', () => {
  assert.equal(leadingSegment('BusinessModel'), 'Business');
  assert.equal(leadingSegment('AI-Agents'), 'AI');
  assert.equal(leadingSegment('business-dev'), 'business');
  assert.equal(leadingSegment('investing'), 'investing');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/tag-manage/tests/induce.test.js`
Expected: FAIL with "Cannot find module '../scripts/induce.js'".

- [ ] **Step 3: Write minimal implementation**

```js
'use strict';
// induce.js — Slice 1: deterministic name-based clustering of flat residual tags.
// Pure logic, no fs, no clock, no LLM. Proposes candidate families (tags sharing a
// leading token) that the tag-organize agent reviews and persists via set-hierarchy;
// the nest itself rides the existing Phase-1 applyOps/survival path (no new write code).
// See docs/superpowers/specs/2026-06-23-tag-organize-design.md.

// Index where the first token ends: first separator, camelCase boundary, or letter->digit.
function firstTokenEnd(tag) {
  for (let i = 1; i < tag.length; i++) {
    const prev = tag[i - 1];
    const cur = tag[i];
    if (cur === '-' || cur === '_' || cur === '/') return i;
    if (/[a-z]/.test(prev) && /[A-Z]/.test(cur)) return i;       // camelCase
    if (/[A-Za-z]/.test(prev) && /[0-9]/.test(cur)) return i;    // letter->digit
    if (/[0-9]/.test(prev) && /[A-Za-z]/.test(cur)) return i;    // digit->letter
  }
  return tag.length;
}

function leadingSegment(tag) {
  return tag.slice(0, firstTokenEnd(tag));
}

function tokenizeTag(tag) {
  const tokens = [];
  let rest = tag;
  while (rest.length) {
    const seg = leadingSegment(rest);
    if (seg) tokens.push(seg.toLowerCase());
    let next = rest.slice(seg.length);
    next = next.replace(/^[-_/]/, ''); // drop the boundary separator
    if (next === rest) break;          // safety: no progress
    rest = next;
  }
  return tokens;
}

module.exports = { tokenizeTag, leadingSegment };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/tag-manage/tests/induce.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add skills/tag-manage/scripts/induce.js skills/tag-manage/tests/induce.test.js
git commit -m "feat(tag-organize): induce.js tokenizer foundations (tokenizeTag + leadingSegment)"
```

---

### Task 2: `clusterByName` — propose candidate families

**Files:**
- Modify: `skills/tag-manage/scripts/induce.js`
- Test: `skills/tag-manage/tests/induce.test.js`

**Interfaces:**
- Consumes: `tokenizeTag`, `leadingSegment` (Task 1); `logicalKey`, `isReserved` from `./tags.js`.
- Produces:
  - `clusterByName(inventory, opts = {}) -> Array<{ parent, children, basis }>`
    - `inventory`: array of `{ key, variants, noteCount, files }`.
    - `opts.minMembers`: number, default `2`.
    - Each result: `parent` (most frequent `leadingSegment` among members, ties A→Z), `children` (member display tags = `variants[0]`, sorted A→Z), `basis` (e.g. `name: 3 tags share leading token "business"`).
    - Excludes reserved tags and already-nested tags (`key` contains `/`). Families with `< minMembers` distinct members are dropped. Sorted by member count desc, then `parent` A→Z.

- [ ] **Step 1: Write the failing test**

```js
const { clusterByName } = require('../scripts/induce.js');

const inv = (key, noteCount = 1, variants = [key]) => ({ key, variants, noteCount, files: [] });

test('clusterByName groups flat tags sharing a leading token into a family', () => {
  const inventory = [
    inv('business-strategy', 3, ['Business-Strategy']),
    inv('businessmodel', 2, ['BusinessModel']),
    inv('business-dev', 1, ['business-dev']),
    inv('investing', 5, ['Investing']),       // singleton stem -> no family
    inv('daytrading', 4, ['DayTrading']),      // singleton stem -> no family
  ];
  const clusters = clusterByName(inventory);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].parent, 'Business');  // most frequent leading segment casing
  assert.deepEqual(clusters[0].children, ['Business-Strategy', 'BusinessModel', 'business-dev']);
  assert.match(clusters[0].basis, /3 tags share leading token "business"/);
});

test('clusterByName excludes reserved and already-nested tags, honors minMembers', () => {
  const inventory = [
    inv('investing/daytrading', 2, ['Investing/DayTrading']), // already nested
    inv('ai-agents', 2, ['AI-Agents']),
    inv('ai-tools', 1, ['AI-Tools']),
  ];
  const clusters = clusterByName(inventory);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].parent, 'AI');
  assert.deepEqual(clusters[0].children, ['AI-Agents', 'AI-Tools']);
  assert.deepEqual(clusterByName(inventory, { minMembers: 3 }), []); // raise the floor -> nothing
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/tag-manage/tests/induce.test.js`
Expected: FAIL with "clusterByName is not a function".

- [ ] **Step 3: Write minimal implementation**

Add to `induce.js` (and extend `module.exports`):

```js
const { logicalKey, isReserved } = require('./tags.js');

function mode(strings) {
  const counts = new Map();
  for (const s of strings) counts.set(s, (counts.get(s) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

function clusterByName(inventory, opts = {}) {
  const minMembers = opts.minMembers || 2;
  const families = new Map(); // stem token -> array of entries
  for (const e of inventory) {
    if (isReserved(e.key)) continue;
    if (e.key.includes('/')) continue;            // already nested -> convergence
    const tokens = tokenizeTag(e.variants[0] || e.key);
    if (tokens.length < 2) continue;              // single-token tag is not a family member
    const stem = tokens[0];
    if (!families.has(stem)) families.set(stem, []);
    families.get(stem).push(e);
  }
  const clusters = [];
  for (const [stem, entries] of families) {
    const distinct = [...new Map(entries.map((e) => [logicalKey(e.variants[0] || e.key), e])).values()];
    if (distinct.length < minMembers) continue;
    const parent = mode(distinct.map((e) => leadingSegment(e.variants[0] || e.key)));
    const children = distinct.map((e) => e.variants[0] || e.key).sort((a, b) => a.localeCompare(b));
    clusters.push({ parent, children, basis: `name: ${children.length} tags share leading token "${stem}"` });
  }
  clusters.sort((a, b) => b.children.length - a.children.length || a.parent.localeCompare(b.parent));
  return clusters;
}
```

Update exports: `module.exports = { tokenizeTag, leadingSegment, clusterByName };`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/tag-manage/tests/induce.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add skills/tag-manage/scripts/induce.js skills/tag-manage/tests/induce.test.js
git commit -m "feat(tag-organize): clusterByName proposes candidate families by leading token"
```

---

### Task 3: `induce` CLI command + proposal sidecar

**Files:**
- Modify: `skills/tag-manage/scripts/cli.js`
- Test: `skills/tag-manage/tests/cli.test.js`

**Interfaces:**
- Consumes: `clusterByName` (Task 2); the existing inventory build used by `runAudit` (`buildInventory` + `walkMarkdown`); the existing arg-parsing + `target` resolution in `cli.js`.
- Produces: command `node cli.js induce <vault>` that builds the inventory, runs `clusterByName`, and writes `.tag-organize-clusters.json` (an array of `{ parent, children, basis }`) into the resolved report dir (same dir logic as `.tag-manage-recommendations.json`). Prints a one-line summary to stderr and the apply hint (`set-hierarchy ... per approved cluster`). The dot-prefixed sidecar is never scanned (same exclusion as the existing sidecars).

- [ ] **Step 1: Write the failing test**

Add to `cli.test.js` (mirror the existing temp-vault fixture pattern already used there):

```js
test('induce writes a .tag-organize-clusters.json proposal from flat residual tags', () => {
  const dir = mkTempVault({
    'a.md': '---\ntags: [Business-Strategy, BusinessModel]\n---\nbody',
    'b.md': '---\ntags: [business-dev, Investing]\n---\nbody',
  });
  runCli(['induce', dir]);
  const sidecar = path.join(dir, '.tag-organize-clusters.json');
  assert.ok(fs.existsSync(sidecar), 'proposal sidecar exists');
  const clusters = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].parent, 'Business');
  assert.deepEqual(clusters[0].children, ['Business-Strategy', 'BusinessModel', 'business-dev']);
});
```

> Use the helpers `cli.test.js` already defines (`mkTempVault`, `runCli`, etc.). If their names differ, match the existing file — do not introduce a second fixture style.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/tag-manage/tests/cli.test.js`
Expected: FAIL (no `induce` command; sidecar not written).

- [ ] **Step 3: Write minimal implementation**

In `cli.js`, add a `require` for `clusterByName` at the top with the other engine requires, then add the command branch next to the `set-hierarchy` branch (mirror its `target` resolution + report-dir logic):

```js
if (cmd === 'induce') {
  if (!target) throw Object.assign(new Error('usage: cli.js induce <vault>'), { usage: true });
  const notes = walkMarkdown(target).map((p) => ({ path: p, text: fs.readFileSync(p, 'utf8') }));
  const inventory = buildInventory(notes);
  const clusters = clusterByName(inventory);
  const outDir = reportDirAbs || target;             // same dir resolution as the audit sidecars
  const outPath = path.join(outDir, '.tag-organize-clusters.json');
  fs.writeFileSync(outPath, JSON.stringify(clusters, null, 2), 'utf8');
  console.error(`induce: ${clusters.length} candidate families proposed -> ${outPath}`);
  console.error('  review, then per approved cluster: cli.js set-hierarchy <vault> --parent <P> --children <C1,C2>');
  return;
}
```

> Match the actual names in `cli.js` for the inventory build, `walkMarkdown`, `reportDirAbs`/report-dir resolution, and the return/exit convention. Read the `audit` and `set-hierarchy` branches first and copy their shape exactly.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/tag-manage/tests/cli.test.js`
Expected: PASS (the new test green, existing cli tests still green).

- [ ] **Step 5: Run the full tag-manage suite (no regression)**

Run: `bash scripts/test-tag-manage.sh`
Expected: all suites PASS (existing + induce.test.js + the new cli test).

- [ ] **Step 6: Commit**

```bash
git add skills/tag-manage/scripts/cli.js skills/tag-manage/tests/cli.test.js
git commit -m "feat(tag-organize): induce CLI command writes a cluster-proposal sidecar"
```

---

### Task 4: `tag-organize` SKILL.md (agent orchestration layer)

**Files:**
- Create: `skills/tag-organize/SKILL.md`

**Interfaces:**
- Consumes: the `induce` command (Task 3); the existing `set-hierarchy`, `audit`, `plan`, `apply` commands; the cross-skill engine in `../tag-manage/scripts/cli.js`.
- Produces: a triggerable skill that runs the Slice-1 induce flow end to end behind gates.

- [ ] **Step 1: Read the engine-invocation pattern**

Read `skills/tag-manage/SKILL.md` and note exactly how it invokes `cli.js` (path resolution, `${OBSIDIAN_VAULT_PATH}` usage, the preview/confirm gate wording, the report format). The new SKILL.md mirrors this — do not invent a different invocation style.

- [ ] **Step 2: Write SKILL.md**

Create `skills/tag-organize/SKILL.md` with valid YAML frontmatter and the orchestration. Content requirements (write them out fully — no placeholders):

- Frontmatter:

```yaml
---
name: tag-organize
description: Use when an Obsidian vault's flat tags should be organized into a nested hierarchy by proposing parent/child families over existing tags. Trigger phrases - "organize tags", "tag hierarchy", "group my tags", "tag structure", "nest my flat tags", "tag optimization", "restructure tags". Runs AFTER tag-manage cleanup. Does NOT invent tags from note content in Slice 1 (that is the later auto-tag slice); proposes structure over EXISTING tags only.
---
```

- Body sections, in order:
  1. **What this does / does not do (Slice 1).** Proposes a hierarchy over existing flat tags; reads note content only to disambiguate uncertain families; does not auto-assign tags to notes (that is Slice 2, not yet built).
  2. **Prerequisite — run hygiene first.** Recommend `tag-manage` cleanup before organizing, so structure is induced over a clean tag set.
  3. **Production Vault Safety Rules.** Restate the gate: test vault first; production read is user-gated even for read-only; no filesystem discovery outside the configured vault; confirm before touching > 10 files.
  4. **Flow:**
     a. Run `cli.js induce <vault>` -> read `.tag-organize-clusters.json`.
     b. Present the candidate families as a numbered table (`parent | children | basis`).
     c. For families the agent judges uncertain (homonyms, mixed-sense stems), read a bounded content sample (top-N notes per ambiguous tag) BEHIND the content-read gate ("read N notes to disambiguate M families — proceed?"), then decide placement.
     d. After user approval of a cluster, persist it: `cli.js set-hierarchy <vault> --parent <P> --children <C1,C2>`.
     e. Re-run `cli.js audit <vault>` to surface the resulting `nest` recommendations, then `cli.js plan ... --from-recs <.tag-manage-nest.json> --ids <ids>` and, on confirm, `cli.js apply ... --write`. Nesting reuses the existing guarded write path.
  5. **Report (Core + Nahbereich + Report).** Output: families proposed, clusters approved + persisted, nests applied (with note counts), families deferred for content review, and anything reported-not-fixed.

- [ ] **Step 3: Smoke-verify the skill shape**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('skills/tag-organize/SKILL.md','utf8');if(!/^---[\s\S]*name: tag-organize[\s\S]*---/.test(s))throw new Error('frontmatter');if(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s))throw new Error('emoji');console.log('SKILL.md shape OK')"`
Expected: prints `SKILL.md shape OK`.

- [ ] **Step 4: Commit**

```bash
git add skills/tag-organize/SKILL.md
git commit -m "feat(tag-organize): SKILL.md agent layer — induce flow behind gates (Slice 1)"
```

---

### Task 5: User-facing docs + changelog

**Files:**
- Modify: `README.md`
- Modify: `logs/changelog.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a discoverability pointer for the new skill and an internal changelog row.

- [ ] **Step 1: Add the README pointer**

Add a `tag-organize` row to the skills table in `README.md` (match the existing row format) with a one-line description: "Organize flat tags into a nested hierarchy (AI-proposed families over existing tags)." Mark it beta / in-development consistent with `tag-manage`.

- [ ] **Step 2: Add the internal changelog row**

Append a row to `logs/changelog.md` under the current beta section: "tag-organize Slice 1 (induce-structure): deterministic name-based family proposal + induce CLI command + agent flow. Nesting reuses the Phase-1 rail." Do NOT touch the user-facing `CHANGELOG.md` (tag-organize is beta — consistent with the tag-manage v0.2.x precedent).

- [ ] **Step 3: Run the full suite once more**

Run: `bash scripts/test-tag-manage.sh`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md logs/changelog.md
git commit -m "docs(tag-organize): README pointer + internal changelog row (Slice 1)"
```

---

## Self-Review

**Spec coverage (Slice 1 scope only):**
- Pass A name-first clustering -> Tasks 1-2. Content-read for ambiguous families -> Task 4 (agent layer, gated). Reuse of the nest rail (no new write code) -> Task 4 flow steps d-e. Convergence (no re-cluster of nested tags) -> Task 2 (excludes `/`). The proposal sidecar (mirrors the existing sidecar pattern) -> Task 3. README docs -> Task 5.
- Out of Slice 1 by design (Slice 2): `addTagsToNote`, auto-tag, closed+gated-new vocabulary, approval-at-scale (group-by-tag / confidence-sort / per-run ceiling), content-read of under-tagged notes. None appear as tasks here — correct.

**Placeholder scan:** Tasks 1-3 carry real test code and real implementations. Task 4 is a documentation deliverable with fully enumerated section content. Task 5 specifies exact file edits. The two "match the existing file" notes (Task 3 fixture helpers, Task 4 invocation pattern) point the implementer at the authoritative source rather than guessing — they are grounding instructions, not deferred work.

**Type consistency:** `tokenizeTag`/`leadingSegment` (Task 1) are consumed by `clusterByName` (Task 2); `clusterByName`'s `{ parent, children, basis }` output is consumed by Task 3's sidecar and Task 4's table + `set-hierarchy` calls. The cluster shape is identical across all references.

**Known simplifications (documented, agent-correctable):** the parent name is the most-frequent leading display segment among members; acronym/casing edge cases (and the homonym placement question) are resolved by the agent at review (it has the dictionary + content), not by the deterministic clusterer. This is the intended name-first-then-agent division.
