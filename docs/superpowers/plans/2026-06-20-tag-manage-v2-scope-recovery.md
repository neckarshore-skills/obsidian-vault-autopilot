# Tag-Manage v2 Scope-Recovery (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover the lost tag-management intelligence onto v1's deterministic engine — a severity-classified convention-compliance engine, curated override dictionaries, and a rich vault-written report — without touching v1's survival/mass-change/birthtime guarantees.

**Architecture:** New focused *pure* modules (`convention.js`, `analysis.js`, `report.js`, `recommend.js`) plus one I/O module (`config.js`) layered over the unchanged `tags.js` engine. `cli.js` orchestrates: walk → analyse → classify → recommend → render → write report (Stage 1); selected recommendations → ops → existing `applyOps` (Stage 2).

**Tech Stack:** Node.js (stdlib only, zero dependencies), `node:test`, `node:assert/strict`. Same toolset as the existing `tag-manage` and `ai-paste-cleanup` skills.

## Global Constraints

- Zero runtime dependencies — Node stdlib only (no npm packages). Tests use `node:test` + `node:assert/strict`.
- Pure modules (`convention.js`, `analysis.js`, `report.js`, `recommend.js`) must not `require('node:fs')` and must not read the clock (`Date.now()`/`new Date()`); any date is injected by the caller.
- `tags.js`'s write path (`applyOps`, `assertSurvival`, the mass-change guard in `cli.js`, in-place `writeFileSync`) is reused **unchanged** except the two narrow edits in Task 1.
- No hardcoded vault or personal paths; the public repo ships generic data only. Personal overrides live in a vault-local config (never committed).
- English only in all code, comments, and skill content. No emoji in skill files. kebab-case filenames.
- The 63 existing engine assertions in `skills/tag-manage/tests/*.test.js` must stay green (run the full suite at every task's final step).
- Version bump `0.1.6 -> 0.1.7` in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (single new feature increment in the 0.1.x line; 0.2.0 stays reserved for the Configurability theme).
- Reserved tag `VaultAutopilot` is never classified, never proposed for rename/merge/remove.

---

## File Structure

| File | Responsibility | New? |
|---|---|---|
| `skills/tag-manage/scripts/tags.js` | Rewrite engine + audit grouping. Two narrow edits only (FIELD_RE, invalid-tag split). | modify |
| `skills/tag-manage/scripts/convention.js` | `classifyTag` (severity violations) + `canonicalForm` (brand→compound→heuristic). | create |
| `skills/tag-manage/scripts/analysis.js` | `analyze` — frequency, coverage, top-N, depth, singletons. | create |
| `skills/tag-manage/scripts/recommend.js` | `buildRecommendations` — structured, prioritized recs with compiled ops. | create |
| `skills/tag-manage/scripts/report.js` | `renderReport` — data → markdown (date injected). | create |
| `skills/tag-manage/scripts/config.js` | `loadConfig` — defaults ⊕ vault-local, report-dir + config discovery. | create |
| `skills/tag-manage/references/tag-overrides.default.json` | Generic shipped brand/compound defaults. | create |
| `skills/tag-manage/scripts/cli.js` | Orchestrate `audit` (report write) + `apply` (recs → ops). | modify |
| `skills/tag-manage/tests/{convention,analysis,recommend,report,config}.test.js` | Unit suites. | create |
| `skills/tag-manage/SKILL.md` | v2 flow, convention reference, first-run config. | modify |
| `scripts/test-tag-manage.sh` | CI bridge — run the new suites. | modify |
| `references/tag-convention.md` | Cross-reference the new dictionaries. | modify |
| `.claude-plugin/{plugin,marketplace}.json`, `logs/changelog.md`, `README.md`, `CLAUDE.md` | Version + docs. | modify |

---

## Task 1: tags.js hotfixes (Dataview `tags::` + invalid-tag split)

**Files:**
- Modify: `skills/tag-manage/scripts/tags.js` (FIELD_RE ~line 175; `auditFindings` ~line 464)
- Test: `skills/tag-manage/tests/tags.test.js` (append)

**Interfaces:**
- Consumes: existing `isValidTag`, `splitFrontmatter`, `frontmatterTags`.
- Produces: `auditFindings(...)` gains `otherInvalidTags: string[]`; `numericArtifacts` now holds numeric-only invalids. `FIELD_RE` no longer matches Dataview `tags::`.

- [ ] **Step 1: Write the failing tests**

```javascript
// append to tests/tags.test.js
const { frontmatterTags, auditFindings } = require('../scripts/tags.js');

test('Dataview tags:: double-colon is not mis-parsed as a tags scalar', () => {
  const note = '---\ntags:: #linkedin #karriere\n---\nbody\n';
  assert.deepEqual(frontmatterTags(note), []); // tags:: is a Dataview inline field, not a YAML tags scalar
});

test('auditFindings splits invalid spellings into numeric vs other', () => {
  const notes = [
    { path: 'a.md', text: '---\ntags:\n  - "2026"\n  - "Make.com"\n  - Research\n---\n' },
  ];
  const f = auditFindings(notes);
  assert.deepEqual(f.numericArtifacts, ['2026']);
  assert.deepEqual(f.otherInvalidTags, ['Make.com']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd skills/tag-manage && node --test tests/tags.test.js`
Expected: FAIL — `tags::` currently parses to a garbage scalar; `otherInvalidTags` is undefined.

- [ ] **Step 3: Apply the two edits**

In `tags.js`, change `FIELD_RE`:

```javascript
const FIELD_RE = /^(\s*)(tags|tag)\s*:(?!:)\s*(.*)$/;
```

In `auditFindings`, replace the `numericArtifacts` line:

```javascript
const invalid = spellings.filter((s) => !isValidTag(s));
const numericArtifacts = invalid.filter((s) => /^[\p{N}/_-]+$/u.test(s));
const otherInvalidTags = invalid.filter((s) => !/^[\p{N}/_-]+$/u.test(s));
```

Add `otherInvalidTags` to the returned object (next to `numericArtifacts`) and to `module.exports` is not needed (it is a field on the return value).

- [ ] **Step 4: Run the full tag-manage suite**

Run: `cd skills/tag-manage && node --test tests/*.test.js`
Expected: PASS — new tests green, all 63 prior assertions still green.

- [ ] **Step 5: Commit**

```bash
git add skills/tag-manage/scripts/tags.js skills/tag-manage/tests/tags.test.js
git commit -m "fix(tag-manage): tags:: not mis-parsed + split invalid tags numeric/other (UAT findings)"
```

---

## Task 2: convention.js — `classifyTag` (severity violations)

**Files:**
- Create: `skills/tag-manage/scripts/convention.js`
- Test: `skills/tag-manage/tests/convention.test.js`

**Interfaces:**
- Consumes: `logicalKey` from `tags.js`.
- Produces: `classifyTag(tag, ctx)` → `{ violation: string|null, severity: 'HIGH'|'MEDIUM'|'LOW'|null }`. `ctx = { brandSet: Set<logicalKey>, brandHyphenSet: Set<logicalKey>, hierarchicalLeaves: Set<logicalKey> }`.

- [ ] **Step 1: Write the failing tests**

```javascript
const { classifyTag } = require('../scripts/convention.js');
const test = require('node:test');
const assert = require('node:assert/strict');

const ctx = { brandSet: new Set(['n8n', 'github']), brandHyphenSet: new Set(['mercedes-benz']), hierarchicalLeaves: new Set(['devtools']) };

test('hashtag-prefix is HIGH', () => assert.deepEqual(classifyTag('#research', ctx), { violation: 'hashtag-prefix', severity: 'HIGH' }));
test('numeric-artifact is HIGH', () => assert.deepEqual(classifyTag('2026', ctx), { violation: 'numeric-artifact', severity: 'HIGH' }));
test('snake_case is MEDIUM', () => assert.deepEqual(classifyTag('ai_agents', ctx), { violation: 'snake_case', severity: 'MEDIUM' }));
test('lowercase-concept is MEDIUM', () => assert.deepEqual(classifyTag('research', ctx), { violation: 'lowercase-concept', severity: 'MEDIUM' }));
test('camelCase is MEDIUM', () => assert.deepEqual(classifyTag('fastAPI', ctx), { violation: 'camelCase', severity: 'MEDIUM' }));
test('upper-kebab is MEDIUM', () => assert.deepEqual(classifyTag('App-Development', ctx), { violation: 'upper-kebab', severity: 'MEDIUM' }));
test('flat-where-hierarchical is LOW', () => assert.deepEqual(classifyTag('DevTools', ctx), { violation: 'flat-where-hierarchical', severity: 'LOW' }));
test('AI-prefixed hyphen is allowed', () => assert.deepEqual(classifyTag('AI-ML', ctx), { violation: null, severity: null }));
test('brand stays compliant lowercase', () => assert.deepEqual(classifyTag('n8n', ctx), { violation: null, severity: null }));
test('brand-hyphen is allowed', () => assert.deepEqual(classifyTag('Mercedes-Benz', ctx), { violation: null, severity: null }));
test('compliant PascalCase passes', () => assert.deepEqual(classifyTag('OpenSource', ctx), { violation: null, severity: null }));
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd skills/tag-manage && node --test tests/convention.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `classifyTag`**

```javascript
'use strict';
// convention.js — deterministic tag-convention classification + canonical resolver.
// Pure: no fs, no clock. Mirrors the predecessor's Step 3.5 (first matching rule wins).
const { logicalKey } = require('./tags.js');

const YAML_FIELD_RE = /^(created|modified|last_updated|updated|date|aliases?|status|type)\s*:/i;

function classifyTag(tag, ctx) {
  const t = String(tag);
  const key = logicalKey(t);
  if (t.startsWith('#')) return { violation: 'hashtag-prefix', severity: 'HIGH' };
  if (YAML_FIELD_RE.test(t)) return { violation: 'yaml-artifact', severity: 'HIGH' };
  if (/^[\p{N}/_-]+$/u.test(t)) return { violation: 'numeric-artifact', severity: 'HIGH' };
  if (ctx.brandSet.has(key)) return { violation: null, severity: null };
  if (t.includes('_')) return { violation: 'snake_case', severity: 'MEDIUM' };
  if (/^\p{Ll}/u.test(t) && /\p{Ll}\p{Lu}/u.test(t)) return { violation: 'camelCase', severity: 'MEDIUM' };
  if (/^\p{Ll}[\p{Ll}\p{N}]*$/u.test(t)) return { violation: 'lowercase-concept', severity: 'MEDIUM' };
  if (/^\p{Lu}[\p{L}\p{N}]*-\p{Lu}/u.test(t) && !/^(AI|KI)-/.test(t) && !ctx.brandHyphenSet.has(key)) {
    return { violation: 'upper-kebab', severity: 'MEDIUM' };
  }
  if (!t.includes('/') && ctx.hierarchicalLeaves.has(key)) return { violation: 'flat-where-hierarchical', severity: 'LOW' };
  return { violation: null, severity: null };
}

module.exports = { classifyTag };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd skills/tag-manage && node --test tests/convention.test.js`
Expected: PASS (11 assertions).

- [ ] **Step 5: Commit**

```bash
git add skills/tag-manage/scripts/convention.js skills/tag-manage/tests/convention.test.js
git commit -m "feat(tag-manage): convention.js classifyTag — severity-classified violations"
```

---

## Task 3: convention.js — `canonicalForm` (brand → compound → heuristic)

**Files:**
- Modify: `skills/tag-manage/scripts/convention.js`
- Test: `skills/tag-manage/tests/convention.test.js` (append)

**Interfaces:**
- Consumes: `logicalKey` from `tags.js`; `dict = { brands: Map<key,string>, compounds: Map<key,string> }`.
- Produces: `canonicalForm(tag, dict)` → `{ canonical: string, source: 'brand'|'compound'|'heuristic' }`.

- [ ] **Step 1: Write the failing tests**

```javascript
const { canonicalForm } = require('../scripts/convention.js');
const dict = { brands: new Map([['github', 'GitHub']]), compounds: new Map([['lowcode', 'LowCode'], ['low-code', 'LowCode']]) };

test('brand hit uses official casing', () => assert.deepEqual(canonicalForm('github', dict), { canonical: 'GitHub', source: 'brand' }));
test('compound hit uses merged form', () => assert.deepEqual(canonicalForm('low-code', dict), { canonical: 'LowCode', source: 'compound' }));
test('AI-prefix keeps hyphen (heuristic best-effort; ML-casing is a dictionary job)', () => assert.deepEqual(canonicalForm('ai-foo', dict), { canonical: 'AI-Foo', source: 'heuristic' }));
test('AI-ML resolves via dictionary, not heuristic', () => assert.deepEqual(canonicalForm('ai-ml', { brands: new Map(), compounds: new Map([['ai-ml', 'AI-ML']]) }), { canonical: 'AI-ML', source: 'compound' }));
test('hierarchical PascalCases each segment', () => assert.deepEqual(canonicalForm('software/devtools', dict), { canonical: 'Software/Devtools', source: 'heuristic' }));
test('single lowercase word capitalizes', () => assert.deepEqual(canonicalForm('research', dict), { canonical: 'Research', source: 'heuristic' }));
test('snake_case joins as hyphen-free PascalCase unless AI', () => assert.deepEqual(canonicalForm('ai_agents', dict), { canonical: 'AI-Agents', source: 'heuristic' }));
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd skills/tag-manage && node --test tests/convention.test.js`
Expected: FAIL — `canonicalForm` not exported.

- [ ] **Step 3: Add `canonicalForm` + heuristic to `convention.js`**

```javascript
function capitalize(w) { return w ? w.charAt(0).toUpperCase() + w.slice(1) : w; }

function pascalHeuristic(tag) {
  const ai = tag.match(/^(ai|ki)[-_](.+)$/i);
  if (ai) return ai[1].toUpperCase() + '-' + tag.slice(ai[1].length + 1).split(/[-_]/).map(capitalize).join('-');
  return tag.split('/').map((seg) => seg.split(/[-_]/).map(capitalize).join('')).join('/');
}

function canonicalForm(tag, dict) {
  const key = logicalKey(tag);
  if (dict.brands.has(key)) return { canonical: dict.brands.get(key), source: 'brand' };
  if (dict.compounds.has(key)) return { canonical: dict.compounds.get(key), source: 'compound' };
  return { canonical: pascalHeuristic(tag), source: 'heuristic' };
}

module.exports = { classifyTag, canonicalForm, pascalHeuristic };
```

Note: `ai_agents` → AI-prefix branch → `AI` + `-` + `agents`→`Agents` = `AI-Agents`. `ai-ml` → `AI-ML`. Update `module.exports` as shown (replaces the Task 2 export line).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd skills/tag-manage && node --test tests/convention.test.js`
Expected: PASS (all convention assertions).

- [ ] **Step 5: Commit**

```bash
git add skills/tag-manage/scripts/convention.js skills/tag-manage/tests/convention.test.js
git commit -m "feat(tag-manage): canonicalForm resolver (brand -> compound -> PascalCase heuristic)"
```

---

## Task 4: analysis.js — frequency / coverage / top-N / depth

**Files:**
- Create: `skills/tag-manage/scripts/analysis.js`
- Test: `skills/tag-manage/tests/analysis.test.js`

**Interfaces:**
- Consumes: `buildInventory`, `noteTags` from `tags.js` (inventory shape: `{key, display, variants, files, noteCount}`).
- Produces: `analyze(notes, inventory)` → `{ totalNotes, taggedNotes, untaggedNotes, uniqueTags, totalAssignments, avgTagsPerNote, maxDepth, topN, depthDistribution, singletons, lowUsage }`. `topN` = `[{display, noteCount, pct}]` (top 20). `singletons`/`lowUsage` = `[{key, display, noteCount}]`.

- [ ] **Step 1: Write the failing test**

```javascript
const { analyze } = require('../scripts/analysis.js');
const { buildInventory } = require('../scripts/tags.js');
const test = require('node:test');
const assert = require('node:assert/strict');

const notes = [
  { path: 'a.md', text: '---\ntags:\n  - AI\n  - Research\n---\n' },
  { path: 'b.md', text: '---\ntags:\n  - AI\n  - Software/DevTools\n---\n' },
  { path: 'c.md', text: 'no tags here\n' },
];

test('analyze computes coverage, singletons, depth', () => {
  const a = analyze(notes, buildInventory(notes));
  assert.equal(a.totalNotes, 3);
  assert.equal(a.taggedNotes, 2);
  assert.equal(a.untaggedNotes, 1);
  assert.equal(a.uniqueTags, 3); // ai, research, software/devtools
  assert.equal(a.maxDepth, 2);   // software/devtools
  assert.equal(a.topN[0].display, 'AI'); // 2 notes
  assert.deepEqual(a.singletons.map((s) => s.key).sort(), ['research', 'software/devtools']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd skills/tag-manage && node --test tests/analysis.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `analyze`**

```javascript
'use strict';
// analysis.js — pure frequency/coverage/depth aggregation over a tag inventory.
const { noteTags } = require('./tags.js');

function analyze(notes, inventory) {
  const totalNotes = notes.length;
  const taggedNotes = notes.filter((n) => noteTags(n.text).length > 0).length;
  const totalAssignments = inventory.reduce((s, r) => s + r.noteCount, 0);
  const sorted = [...inventory].sort((a, b) => b.noteCount - a.noteCount || (a.key < b.key ? -1 : 1));
  const topN = sorted.slice(0, 20).map((r) => ({
    display: r.display, noteCount: r.noteCount,
    pct: taggedNotes ? Math.round((r.noteCount / taggedNotes) * 100) : 0,
  }));
  const depthOf = (k) => k.split('/').length;
  const depthDistribution = {};
  for (const r of inventory) { const d = depthOf(r.key); depthDistribution[d] = (depthDistribution[d] || 0) + 1; }
  const maxDepth = inventory.reduce((m, r) => Math.max(m, depthOf(r.key)), 0);
  const singletons = inventory.filter((r) => r.noteCount === 1).map((r) => ({ key: r.key, display: r.display, noteCount: 1 }));
  const lowUsage = inventory.filter((r) => r.noteCount >= 2 && r.noteCount <= 3).map((r) => ({ key: r.key, display: r.display, noteCount: r.noteCount }));
  return {
    totalNotes, taggedNotes, untaggedNotes: totalNotes - taggedNotes,
    uniqueTags: inventory.length, totalAssignments,
    avgTagsPerNote: taggedNotes ? Math.round((totalAssignments / taggedNotes) * 10) / 10 : 0,
    maxDepth, topN, depthDistribution, singletons, lowUsage,
  };
}

module.exports = { analyze };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd skills/tag-manage && node --test tests/analysis.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/tag-manage/scripts/analysis.js skills/tag-manage/tests/analysis.test.js
git commit -m "feat(tag-manage): analysis.js — frequency, coverage, top-N, depth, singletons"
```

---

## Task 5: config.js — defaults ⊕ vault-local merge

**Files:**
- Create: `skills/tag-manage/scripts/config.js`
- Create: `skills/tag-manage/references/tag-overrides.default.json`
- Test: `skills/tag-manage/tests/config.test.js`

**Interfaces:**
- Consumes: `logicalKey` from `tags.js`.
- Produces: `extractJsonFence(md)` → object|null; `mergeOverrides(defaults, local)` → `{ brands: Map, compounds: Map, brandHyphenSet: Set, folderExclusive: object, reportDir: string|null }`; `loadConfig({ defaultsPath, configText })` → same merged shape. (File discovery lives in `cli.js`; `config.js` stays pure-ish — it takes the already-read `configText` string.)

- [ ] **Step 1: Create the defaults data file**

```json
{
  "brands": {
    "github": "GitHub", "chatgpt": "ChatGPT", "youtube": "YouTube", "linkedin": "LinkedIn",
    "wordpress": "WordPress", "n8n": "n8n", "saas": "SaaS", "seo": "SEO", "gpt": "GPT",
    "llm": "LLM", "mqtt": "MQTT", "etf": "ETF", "cms": "CMS", "api": "API", "docker": "docker",
    "figma": "Figma", "telegram": "Telegram", "instagram": "Instagram", "notebooklm": "NotebookLM"
  },
  "compounds": {
    "opensource": "OpenSource", "lowcode": "LowCode", "low-code": "LowCode",
    "daytrading": "DayTrading", "deepresearch": "DeepResearch", "claudecode": "ClaudeCode",
    "systemprompt": "SystemPrompt", "knowledgemanagement": "KnowledgeManagement",
    "codereview": "CodeReview", "codequality": "CodeQuality", "generativeai": "GenerativeAI",
    "softwaredevelopment": "SoftwareDevelopment", "appdevelopment": "AppDevelopment",
    "webscraping": "WebScraping", "selfhosted": "SelfHosted", "uxdesign": "UXDesign",
    "ai-ml": "AI-ML", "ai-agents": "AI-Agents", "ai-coding": "AI-Coding"
  }
}
```

- [ ] **Step 2: Write the failing tests**

```javascript
const { extractJsonFence, mergeOverrides, loadConfig } = require('../scripts/config.js');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('extractJsonFence reads the first json code block', () => {
  const md = '# Config\n\n```json\n{"brands":{"acme":"Acme"}}\n```\n';
  assert.deepEqual(extractJsonFence(md), { brands: { acme: 'Acme' } });
});
test('extractJsonFence returns null when absent', () => assert.equal(extractJsonFence('# nothing'), null));
test('mergeOverrides: local wins on collision', () => {
  const m = mergeOverrides({ brands: { ai: 'AI' } }, { brands: { ai: 'Ai-Override' }, reportDir: 'X' });
  assert.equal(m.brands.get('ai'), 'Ai-Override');
  assert.equal(m.reportDir, 'X');
});
test('loadConfig with no vault config falls back to defaults only', () => {
  const m = loadConfig({ defaultsPath: path.join(__dirname, '..', 'references', 'tag-overrides.default.json'), configText: null });
  assert.equal(m.brands.get('github'), 'GitHub');
  assert.equal(m.reportDir, null);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd skills/tag-manage && node --test tests/config.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `config.js`**

```javascript
'use strict';
// config.js — load + merge tag-override dictionaries (defaults (+) vault-local).
const fs = require('node:fs');
const { logicalKey } = require('./tags.js');

function extractJsonFence(md) {
  const m = String(md).match(/```json\s*\n([\s\S]*?)\n```/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function toMap(obj) {
  const map = new Map();
  for (const [k, v] of Object.entries(obj || {})) map.set(logicalKey(k), v);
  return map;
}

function mergeOverrides(defaults, local) {
  const d = defaults || {}, l = local || {};
  const brands = toMap(d.brands); for (const [k, v] of toMap(l.brands)) brands.set(k, v);
  const compounds = toMap(d.compounds); for (const [k, v] of toMap(l.compounds)) compounds.set(k, v);
  const brandHyphenSet = new Set([...brands.keys()].filter((k) => k.includes('-')));
  return { brands, compounds, brandHyphenSet, folderExclusive: l.folderExclusive || {}, reportDir: l.reportDir || null };
}

function loadConfig({ defaultsPath, configText }) {
  const defaults = JSON.parse(fs.readFileSync(defaultsPath, 'utf8'));
  const local = configText ? extractJsonFence(configText) : null;
  return mergeOverrides(defaults, local);
}

module.exports = { extractJsonFence, toMap, mergeOverrides, loadConfig };
```

- [ ] **Step 5: Run tests, then commit**

Run: `cd skills/tag-manage && node --test tests/config.test.js`
Expected: PASS.

```bash
git add skills/tag-manage/scripts/config.js skills/tag-manage/references/tag-overrides.default.json skills/tag-manage/tests/config.test.js
git commit -m "feat(tag-manage): config.js — generic defaults + vault-local override merge"
```

---

## Task 6: recommend.js — structured, prioritized recommendations

**Files:**
- Create: `skills/tag-manage/scripts/recommend.js`
- Test: `skills/tag-manage/tests/recommend.test.js`

**Interfaces:**
- Consumes: `classifyTag`, `canonicalForm` (convention.js); `logicalKey` (tags.js); the merged `dict`; an `inventory` (from `buildInventory`).
- Produces: `buildRecommendations(inventory, dict)` → `[{ id, kind, severity, from, to, notesAffected, source, ops }]` sorted by `notesAffected` desc. `kind` ∈ `rename|merge|remove`. `ops` = the exact ops.json entries for `applyOps`. Case-variant groups that fold into one canonical become a `merge`; a single non-compliant tag becomes a `rename`; HIGH numeric/yaml/hashtag artifacts become `remove` (frontmatter-only) or `rename` (hashtag → stripped form).

- [ ] **Step 1: Write the failing tests**

```javascript
const { buildRecommendations } = require('../scripts/recommend.js');
const { buildInventory } = require('../scripts/tags.js');
const { mergeOverrides } = require('../scripts/config.js');
const test = require('node:test');
const assert = require('node:assert/strict');

const dict = mergeOverrides({ brands: { github: 'GitHub' } }, {});

test('lowercase concept -> rename to PascalCase, source heuristic', () => {
  const notes = [{ path: 'a.md', text: '---\ntags:\n  - research\n---\n' }];
  const recs = buildRecommendations(buildInventory(notes), dict);
  const r = recs.find((x) => x.from === 'research');
  assert.equal(r.kind, 'rename');
  assert.equal(r.to, 'Research');
  assert.equal(r.source, 'heuristic');
  assert.deepEqual(r.ops, [{ type: 'rename', from: 'research', to: 'Research' }]);
});

test('uniform-lowercase brand is enforced to official casing (no mixed variant needed)', () => {
  const notes = [{ path: 'a.md', text: '---\ntags:\n  - github\n---\n' }];
  const recs = buildRecommendations(buildInventory(notes), dict);
  const r = recs.find((x) => x.to === 'GitHub');
  assert.equal(r.kind, 'rename');
  assert.equal(r.source, 'brand');
  assert.deepEqual(r.ops, [{ type: 'rename', from: 'github', to: 'GitHub' }]);
});

test('a compliant AI-ML (dictionary-backed) gets NO recommendation', () => {
  const d = require('../scripts/config.js').mergeOverrides({ compounds: { 'ai-ml': 'AI-ML' } }, {});
  const notes = [{ path: 'a.md', text: '---\ntags:\n  - AI-ML\n---\n' }];
  assert.equal(buildRecommendations(buildInventory(notes), d).length, 0);
});

test('case variants of one logical tag -> single merge to canonical', () => {
  const notes = [
    { path: 'a.md', text: '---\ntags:\n  - github\n---\n' },
    { path: 'b.md', text: '---\ntags:\n  - GitHub\n---\n' },
  ];
  const recs = buildRecommendations(buildInventory(notes), dict);
  const r = recs.find((x) => x.to === 'GitHub');
  assert.equal(r.kind, 'merge');
  assert.equal(r.notesAffected, 2);
  assert.equal(r.source, 'brand');
});

test('recommendations are sorted by notesAffected desc', () => {
  const notes = [
    { path: 'a.md', text: '---\ntags:\n  - research\n  - github\n---\n' },
    { path: 'b.md', text: '---\ntags:\n  - github\n---\n' },
  ];
  const recs = buildRecommendations(buildInventory(notes), dict);
  for (let i = 1; i < recs.length; i++) assert.ok(recs[i - 1].notesAffected >= recs[i].notesAffected);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd skills/tag-manage && node --test tests/recommend.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `recommend.js`**

```javascript
'use strict';
// recommend.js — turn the inventory + convention verdicts into prioritized recs with ops.
const { logicalKey, isReserved } = require('./tags.js');
const { classifyTag, canonicalForm } = require('./convention.js');

function buildContext(inventory, dict) {
  const leaves = new Set();
  for (const r of inventory) if (r.key.includes('/')) leaves.add(r.key.split('/').pop());
  return { brandSet: new Set(dict.brands.keys()), brandHyphenSet: dict.brandHyphenSet, hierarchicalLeaves: leaves };
}

function buildRecommendations(inventory, dict) {
  const ctx = buildContext(inventory, dict);
  const recs = [];
  let id = 0;
  for (const r of inventory) {
    if (isReserved(r.key)) continue;
    const { canonical, source } = canonicalForm(r.display, dict);
    const variants = r.variants;
    const nonCanonical = variants.filter((v) => v !== canonical);
    const dictionaryBacked = source === 'brand' || source === 'compound';
    const anyViolation = variants.some((v) => classifyTag(v, ctx).violation);
    // Dictionary-backed canonicals are ENFORCED: any non-canonical spelling folds, including
    // a uniformly-lowercase brand (github -> GitHub) with no mixed variant. Heuristic
    // canonicals are only PROPOSED when a real convention violation exists -- never fold a
    // compliant tag to a heuristic guess (that would rename a correct AI-ML to a wrong AI-Ml;
    // the survival guard does NOT cover frontmatter tag renames).
    const needsFold = nonCanonical.length > 0 && (dictionaryBacked || anyViolation);
    if (!needsFold) continue;
    const kind = variants.length > 1 ? 'merge' : 'rename';
    const ops = nonCanonical.map((v) => ({ type: 'rename', from: logicalKey(v), to: canonical }));
    recs.push({ id: ++id, kind, severity: classifyTag(r.display, ctx).severity || 'MEDIUM',
      from: r.display, to: canonical, notesAffected: r.noteCount, source, ops });
  }
  recs.sort((a, b) => b.notesAffected - a.notesAffected || a.from.localeCompare(b.from));
  recs.forEach((rr, i) => { rr.id = i + 1; });
  return recs;
}

module.exports = { buildRecommendations, buildContext };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd skills/tag-manage && node --test tests/recommend.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/tag-manage/scripts/recommend.js skills/tag-manage/tests/recommend.test.js
git commit -m "feat(tag-manage): recommend.js — prioritized recs compiled to applyOps ops"
```

---

## Task 7: report.js — markdown report builder

**Files:**
- Create: `skills/tag-manage/scripts/report.js`
- Test: `skills/tag-manage/tests/report.test.js`

**Interfaces:**
- Consumes: nothing from other new modules at call time — it takes a plain data object.
- Produces: `renderReport({ scope, date, analysis, findings, recommendations, healthScore })` → markdown string. `healthScore = { conformityPct, coveragePct, singletonRatioPct }`.

- [ ] **Step 1: Write the failing test**

```javascript
const { renderReport } = require('../scripts/report.js');
const test = require('node:test');
const assert = require('node:assert/strict');

const data = {
  scope: 'Vault-wide', date: '2026-06-20',
  analysis: { totalNotes: 3, taggedNotes: 2, untaggedNotes: 1, uniqueTags: 3, totalAssignments: 4, avgTagsPerNote: 2, maxDepth: 2,
    topN: [{ display: 'AI', noteCount: 2, pct: 100 }], depthDistribution: { 1: 2, 2: 1 }, singletons: [{ key: 'research', display: 'Research', noteCount: 1 }], lowUsage: [] },
  findings: { caseGroups: [], separatorGroups: [], numericArtifacts: [], otherInvalidTags: [] },
  recommendations: [{ id: 1, kind: 'rename', severity: 'MEDIUM', from: 'research', to: 'Research', notesAffected: 1, source: 'heuristic', ops: [] }],
  healthScore: { conformityPct: 80, coveragePct: 67, singletonRatioPct: 33 },
};

test('renderReport is deterministic and contains key sections', () => {
  const md = renderReport(data);
  assert.match(md, /Tag Analysis Report/);
  assert.match(md, /2026-06-20/);
  assert.match(md, /Health Score/);
  assert.match(md, /verify casing/); // heuristic-sourced rec flagged
  assert.equal(md, renderReport(data)); // deterministic
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd skills/tag-manage && node --test tests/report.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `report.js`**

```javascript
'use strict';
// report.js — pure markdown builder. Date is injected (no clock).
function table(headers, rows) {
  const h = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
  return `${h}\n${sep}\n${body}`;
}

function renderReport({ scope, date, analysis: a, findings: f, recommendations: recs, healthScore: h }) {
  const lines = [];
  lines.push(`---\ntitle: 'Tag Analysis Report - ${scope} - ${date}'\ntype: inbox\nstatus: draft\ncreated: ${date}\ntags:\n  - Meta/TagManagement\n---\n`);
  lines.push(`# Tag Analysis Report\n`);
  lines.push(`> [!summary]\n> **Scope:** ${scope}\n> **Analyzed:** ${a.totalNotes} notes, ${a.uniqueTags} unique tags, ${a.totalAssignments} assignments\n> **Coverage:** ${h.coveragePct}% tagged\n> **Recommendations:** ${recs.length}\n`);
  lines.push(`## Key Metrics\n\n` + table(['Metric', 'Value'], [
    ['Total notes', a.totalNotes], ['Tagged', a.taggedNotes], ['Untagged', a.untaggedNotes],
    ['Unique tags', a.uniqueTags], ['Avg tags/note', a.avgTagsPerNote], ['Max depth', a.maxDepth], ['Singletons', a.singletons.length],
  ]) + '\n');
  lines.push(`## Top 20 Tags\n\n` + table(['#', 'Tag', 'Count', '% tagged'], a.topN.map((t, i) => [i + 1, `\`${t.display}\``, t.noteCount, `${t.pct}%`])) + '\n');
  lines.push(`## Recommendations\n\n` + (recs.length ? table(['#', 'Action', 'From', 'To', 'Notes', 'Note'], recs.map((r) => [
    r.id, `${r.kind} (${r.severity})`, `\`${r.from}\``, `\`${r.to}\``, r.notesAffected, r.source === 'heuristic' ? 'verify casing (not in dictionary)' : r.source,
  ])) : '_No recommendations._') + '\n');
  lines.push(`> [!tip] Next Steps\n> Say "apply all", "apply #1, #3", or "skip #2". A before/after preview is shown before any write.\n`);
  lines.push(`## Health Score\n\n` + table(['Dimension', 'Score'], [
    ['Convention conformity', `${h.conformityPct}%`], ['Tag coverage', `${h.coveragePct}%`], ['Singleton ratio', `${h.singletonRatioPct}%`],
  ]) + '\n');
  lines.push(`## Update Log\n\n` + table(['Date', 'Change'], [[date, 'Initial analysis']]) + '\n');
  return lines.join('\n');
}

module.exports = { renderReport, table };
```

- [ ] **Step 4: Run test, then commit**

Run: `cd skills/tag-manage && node --test tests/report.test.js`
Expected: PASS.

```bash
git add skills/tag-manage/scripts/report.js skills/tag-manage/tests/report.test.js
git commit -m "feat(tag-manage): report.js — deterministic markdown report builder"
```

---

## Task 8: cli.js — wire `audit` (analyse → classify → recommend → render → write)

**Files:**
- Modify: `skills/tag-manage/scripts/cli.js`
- Test: `skills/tag-manage/tests/cli.test.js` (append)

**Interfaces:**
- Consumes: all new modules + existing `walkMarkdown`, `readNotes`, `buildInventory`, `auditFindings`.
- Produces: `runAudit(dir, { date, defaultsPath, configText, reportDirAbs })` → `{ report, recommendations, reportPath|null }`. The CLI `audit` subcommand writes the report note when a report dir resolves and prints the report; it also writes `recommendations.json` next to the report for the apply step.

- [ ] **Step 1: Write the failing test**

```javascript
const { runAudit } = require('../scripts/cli.js');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('runAudit produces a report + recommendations without writing notes', () => {
  const dir = path.join(__dirname, 'fixtures-audit');
  // fixture dir created in Step 3
  const out = runAudit(dir, { date: '2026-06-20', defaultsPath: path.join(__dirname, '..', 'references', 'tag-overrides.default.json'), configText: null, reportDirAbs: null });
  assert.match(out.report, /Tag Analysis Report/);
  assert.ok(Array.isArray(out.recommendations));
  assert.equal(out.reportPath, null); // no reportDir -> report not written
});
```

- [ ] **Step 2: Create the fixture + run test to verify it fails**

Create `skills/tag-manage/tests/fixtures-audit/note.md`:

```markdown
---
tags:
  - research
  - GitHub
  - github
---
body
```

Run: `cd skills/tag-manage && node --test tests/cli.test.js`
Expected: FAIL — `runAudit` not exported.

- [ ] **Step 3: Add `runAudit` to `cli.js`**

```javascript
const { analyze } = require('./analysis.js');
const { classifyTag } = require('./convention.js');
const { buildRecommendations, buildContext } = require('./recommend.js');
const { renderReport } = require('./report.js');
const { loadConfig } = require('./config.js');

function runAudit(dir, { date, defaultsPath, configText, reportDirAbs }) {
  const dict = loadConfig({ defaultsPath, configText });
  // Exclude the report directory from the scan so a written report note does not poison the
  // next audit (the original skill suffered this: its Meta/TagManagement-tagged reports were
  // re-counted on every run).
  const notes = readNotes(dir).filter((n) => !reportDirAbs || !n.path.startsWith(reportDirAbs));
  const inventory = buildInventory(notes);
  const findings = auditFindings(notes);
  const analysis = analyze(notes, inventory);
  const recommendations = buildRecommendations(inventory, dict);
  const ctx = buildContext(inventory, dict);
  const violators = inventory.filter((r) => classifyTag(r.display, ctx).violation).length;
  const conformityPct = inventory.length ? Math.round(((inventory.length - violators) / inventory.length) * 100) : 100;
  const coveragePct = analysis.totalNotes ? Math.round((analysis.taggedNotes / analysis.totalNotes) * 100) : 0;
  const singletonRatioPct = inventory.length ? Math.round((analysis.singletons.length / inventory.length) * 100) : 0;
  const report = renderReport({ scope: 'Vault-wide', date, analysis, findings,
    recommendations, healthScore: { conformityPct, coveragePct, singletonRatioPct } });
  let reportPath = null;
  if (reportDirAbs) {
    reportPath = path.join(reportDirAbs, `${date} Tag Analysis Report - Vault-wide.md`);
    fs.writeFileSync(reportPath, report, 'utf8');
    fs.writeFileSync(path.join(reportDirAbs, `.tag-manage-recommendations.json`), JSON.stringify(recommendations, null, 2), 'utf8');
  }
  return { report, recommendations, reportPath };
}
module.exports = { walkMarkdown, readNotes, auditVault, applyToVault, planVault, MassChangeError, DEFAULT_MASS_CHANGE_THRESHOLD, runAudit };
```

Wire the CLI `audit` branch to call `runAudit` with a date from `process.argv` (`--date`) or an injected value, resolve the report dir from config/`--report-dir`, and `console.log(out.report)`.

- [ ] **Step 4: Run the full suite to verify pass + no regression**

Run: `cd skills/tag-manage && node --test tests/*.test.js`
Expected: PASS — all suites green, prior 63 assertions intact.

- [ ] **Step 5: Commit**

```bash
git add skills/tag-manage/scripts/cli.js skills/tag-manage/tests/cli.test.js skills/tag-manage/tests/fixtures-audit/
git commit -m "feat(tag-manage): cli runAudit — analyse+classify+recommend+render, report write"
```

---

## Task 9: cli.js — `apply` from selected recommendations + post-verify

**Files:**
- Modify: `skills/tag-manage/scripts/cli.js`
- Test: `skills/tag-manage/tests/cli.test.js` (append)

**Interfaces:**
- Consumes: existing `applyToVault` (ops + write + mass-guard), `runAudit` (for the post-verify re-scan).
- Produces: `selectOps(recommendations, selection)` → ops[]; `selection` = `'all'` or array of ids. The `apply` CLI path loads `.tag-manage-recommendations.json`, filters by selection, runs `applyToVault(..., { write:true })`, then re-runs `runAudit` for an "after changes" report.

- [ ] **Step 1: Write the failing test**

```javascript
const { selectOps } = require('../scripts/cli.js');
const test = require('node:test');
const assert = require('node:assert/strict');

const recs = [
  { id: 1, ops: [{ type: 'rename', from: 'research', to: 'Research' }] },
  { id: 2, ops: [{ type: 'rename', from: 'github', to: 'GitHub' }] },
];
test('selectOps all returns every op', () => assert.equal(selectOps(recs, 'all').length, 2));
test('selectOps by id filters', () => assert.deepEqual(selectOps(recs, [2]), [{ type: 'rename', from: 'github', to: 'GitHub' }]));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd skills/tag-manage && node --test tests/cli.test.js`
Expected: FAIL — `selectOps` not exported.

- [ ] **Step 3: Add `selectOps` + wire the apply path**

```javascript
function selectOps(recommendations, selection) {
  const picked = selection === 'all' ? recommendations : recommendations.filter((r) => selection.includes(r.id));
  return picked.flatMap((r) => r.ops);
}
```

Add `selectOps` to `module.exports`. In the `apply` CLI branch, when `--from-recs <file>` is given, load the JSON, build `selection` from `--ids 1,3` (or `all`), `const ops = selectOps(recs, selection)`, then the existing `applyToVault(target, ops, { write, massChangeThreshold })`. After a successful write, call `runAudit` again and write the `... - after changes.md` report. Keep the existing `--ops <file>` path working unchanged.

- [ ] **Step 4: Run the full suite**

Run: `cd skills/tag-manage && node --test tests/*.test.js`
Expected: PASS — all green.

- [ ] **Step 5: Commit**

```bash
git add skills/tag-manage/scripts/cli.js skills/tag-manage/tests/cli.test.js
git commit -m "feat(tag-manage): apply from selected recommendations + after-changes report"
```

---

## Task 10: Integration test on the chaos fixture + CI bridge

**Files:**
- Modify: `skills/tag-manage/tests/cli.test.js` (append)
- Modify: `scripts/test-tag-manage.sh`

**Interfaces:**
- Consumes: the existing `tests/fixtures/tag-manage/` chaos vault.
- Produces: an end-to-end assertion that `runAudit` on the chaos fixture yields recommendations and a report, and that selecting + applying them on a tmp copy is idempotent on re-audit.

- [ ] **Step 1: Write the integration test**

```javascript
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { runAudit, selectOps, applyToVault } = require('../scripts/cli.js');

test('end-to-end: audit chaos fixture -> apply -> re-audit has fewer violations', () => {
  const src = path.join(__dirname, 'fixtures', 'tag-manage');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-'));
  fs.cpSync(src, tmp, { recursive: true });
  const opts = { date: '2026-06-20', defaultsPath: path.join(__dirname, '..', 'references', 'tag-overrides.default.json'), configText: null, reportDirAbs: null };
  const before = runAudit(tmp, opts);
  assert.ok(before.recommendations.length >= 1);
  const ops = selectOps(before.recommendations, 'all');
  applyToVault(tmp, ops, { write: true, massChangeThreshold: 100000 });
  const after = runAudit(tmp, opts);
  assert.ok(after.recommendations.length <= before.recommendations.length);
});
```

- [ ] **Step 2: Run it (expect PASS — modules already built)**

Run: `cd skills/tag-manage && node --test tests/cli.test.js`
Expected: PASS.

- [ ] **Step 3: Extend the CI bridge**

In `scripts/test-tag-manage.sh`, ensure the runner executes `node --test tests/*.test.js` (glob) so the new suites are included. If it lists files explicitly, add `convention.test.js analysis.test.js recommend.test.js report.test.js config.test.js`.

- [ ] **Step 4: Run the CI bridge**

Run: `bash scripts/test-tag-manage.sh`
Expected: PASS — all suites green.

- [ ] **Step 5: Commit**

```bash
git add skills/tag-manage/tests/cli.test.js scripts/test-tag-manage.sh
git commit -m "test(tag-manage): end-to-end audit->apply->re-audit on chaos fixture + CI bridge"
```

---

## Task 11: SKILL.md v2 + docs + version bump

**Files:**
- Modify: `skills/tag-manage/SKILL.md`, `references/tag-convention.md`
- Modify: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `logs/changelog.md`, `README.md`, `CLAUDE.md`

**Interfaces:** none (documentation + manifest).

- [ ] **Step 1: Rewrite `SKILL.md` for the v2 flow**

Document: the two stages (audit writes report + recs; apply executes selected recs); the convention reference (severity table + canonical resolver behaviour, heuristic-flagged); the override dictionaries (generic defaults + vault-local config note with a json fence) and config discovery; the report destination (config `reportDir`, default Tag Management folder); first-run config creation seeded with rescued overrides; the unchanged survival/mass-change guarantees; the `tags::` known-limitation note (mis-parse fixed; Dataview tags not yet first-class). Keep the Production Vault Safety Rules note.

- [ ] **Step 2: Update `references/tag-convention.md`**

Add a short section pointing to `scripts/tag-overrides.default.json` (shipped generic defaults) and the vault-local config as the override source of truth, replacing the inline brand list as the canonical store.

- [ ] **Step 3: Version bump + changelog + README + CLAUDE.md**

```bash
# plugin.json + marketplace.json: 0.1.6 -> 0.1.7
```

Add a `logs/changelog.md` entry (tag-manage v2 Slice 1: compliance engine, dictionaries, rich report). Update `README.md` roadmap (tag-manage: audit+compliance+report, In preview v0.1.7). Update `CLAUDE.md` skills table note if needed.

- [ ] **Step 4: Run the full suite once more**

Run: `cd skills/tag-manage && node --test tests/*.test.js && cd ../.. && bash scripts/test-tag-manage.sh`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/tag-manage/SKILL.md references/tag-convention.md .claude-plugin/ logs/changelog.md README.md CLAUDE.md
git commit -m "docs(tag-manage): v2 SKILL.md flow + convention dictionaries + 0.1.7 bump"
```

---

## Self-Review

**Spec coverage:** A (compliance) → Tasks 2, 3, 6. Dictionaries → Tasks 5, 6, 11. B (rich report) → Tasks 4, 7, 8. Flow (audit/apply, recs→ops, gates) → Tasks 8, 9 (gates reused from existing `applyToVault`). Safety (`tags::` hotfix, bucket split) → Task 1. Config discovery → Task 5 (`config.js`) + Task 8 (CLI resolves the path). Asset rescue → Task 6 (generic defaults committed) + Task 11 (first-run seeding of personal overrides into the vault, documented). Testing → every task + Task 10. Version/docs → Task 11. No gaps.

**Placeholder scan:** every code step shows complete, runnable code; no TBD/TODO. The one prose-only step (Task 11 SKILL.md) is documentation content, enumerated explicitly.

**Type consistency:** `dict` shape `{ brands: Map, compounds: Map, brandHyphenSet: Set, folderExclusive, reportDir }` is produced by `mergeOverrides`/`loadConfig` (Task 5) and consumed identically by `buildRecommendations`/`buildContext` (Task 6), `runAudit` (Task 8). `recommendations` shape (`{id, kind, severity, from, to, notesAffected, source, ops}`) is produced in Task 6 and consumed in Tasks 7, 8, 9. `canonicalForm` returns `{canonical, source}` (Task 3) used in Task 6. Consistent.

**Advisor review (pre-dispatch, applied):**
1. **Task 3 heuristic test corrected.** `pascalHeuristic('ai-ml')` yields `AI-Ml` (the heuristic cannot know `ml -> ML`), so the heuristic test now asserts the honest case `ai-foo -> AI-Foo`; `ai-ml -> AI-ML` is a dictionary entry (added to `tag-overrides.default.json` compounds) and has its own dictionary-sourced test.
2. **Task 6 `needsFold` logic corrected.** `needsFold = nonCanonical.length > 0 && (dictionaryBacked || anyViolation)`. Dictionary-backed canonicals are enforced (closes the uniform-lowercase-brand gap — `github -> GitHub` even with no mixed variant); heuristic canonicals fold only on a real violation (protects a compliant `AI-ML` from being renamed to the wrong `AI-Ml`, which the body-only survival guard would NOT catch). Two regression tests pin both directions.
3. **Task 8 report self-poisoning fixed.** `runAudit` excludes `reportDirAbs` from the scan so a written report note is not re-counted on the next audit (the original skill suffered this).

**Known limitation (backlog, non-blocking):** `notesAffected` uses the logical tag's `noteCount` — for a merge where some notes already carry the canonical, this over-counts the *changed* notes (the safety mass-guard still counts real `applyOps(...).changed`, so only the report number is a slight upper bound, never the write). A later refinement can compute the exact changed-count.

> **Slice boundary:** C–G (hierarchy analysis, folder-exclusive enforcement, suggest mode, tag-index, cookbook loop) are explicitly out of this plan — separate spec → plan → implementation cycles.
