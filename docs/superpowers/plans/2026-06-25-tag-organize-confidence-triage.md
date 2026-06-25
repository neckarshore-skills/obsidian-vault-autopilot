# tag-organize Confidence Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic structural confidence score (0–100) and an Implement / Decide / Ignore triage to the `induce` proposal, so the proposal note ranks what should actually be touched.

**Architecture:** The pure engine (`induce.js`) enriches each name-cluster with per-child note counts, a family total, and a structural score that buckets it into one of three categories. The renderer (`report.js`) splits the proposal note into three score-sorted tables. The CLI (`cli.js`) feeds the config's declared parents into the scorer and writes the enriched artifacts. The agent layer (`SKILL.md`) treats `Implement` as a recommended batch behind the existing confirm gate. No new write surface; nesting still rides the Phase-1 `applyOps` rail.

**Tech Stack:** Node.js (`node:test`, `node:assert/strict`), plain CommonJS modules. No new dependencies.

## Global Constraints

- **Engine purity:** `induce.js` stays pure — no `fs`, no clock, no LLM, no network. `scoreCluster` is total and throw-free.
- **`Implement` is never auto-apply.** Every nest still goes through `set-hierarchy → audit → plan → apply --write` behind the confirm gate ("I will nest tags in N notes in `<vault>`. Confirm?").
- **Score weights (verbatim):** base `40`; size `+10` per child over 2, cap `+30`; frequency `+0` (`<5`) / `+10` (`5..60`) / `+20` (`>60`); enumeration suffix (majority) `+15`; declared-parent match (case-insensitive) `+25`; coincidence-prefix penalty `−35`. Clamp to `0..100`.
- **Thresholds (verbatim):** `Implement ≥ 70`, `Decide 40..69`, `Ignore < 40`.
- **Coincidence-prefix stoplist (verbatim, A→Z, lowercase):** `auto, big, deep, early, free, front, full, go, high, large, local, long, low, make, multi, new, online, open, power, real, self, share, smart, static, work`.
- **Proposal-note invariants preserved:** `Meta/TagManagement` frontmatter marker only; every tag name backtick-wrapped; no bare `#token` in prose.
- **Test runner:** `node --test skills/tag-manage/tests/*.test.js`; full suite via `bash scripts/test-tag-manage.sh`. Run a single file with `node --test skills/tag-manage/tests/<file>.test.js`.
- **`notesTotal` = sum of per-child counts** (a note with two family tags is counted twice — accepted for ordinal triage).
- **No emoji in skill/code files; English only.**

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `skills/tag-manage/scripts/induce.js` | Pure clustering + scoring | Enrich `clusterByName` children with counts + `notesTotal`; add `COINCIDENCE_PREFIXES`, `isEnumerationSuffix`, `scoreCluster`; export them |
| `skills/tag-manage/scripts/report.js` | Note rendering | `renderProposal` → three score-sorted tables, `Notes`/`Score` columns, three-way summary |
| `skills/tag-manage/scripts/cli.js` | Orchestration + fs | `runInduce` takes `declaredParents`, scores clusters, writes enriched artifacts; `induce` command derives declared parents from config |
| `skills/tag-organize/SKILL.md` | Agent flow | Three-table triage; `Implement` as default batch behind the gate |
| `README.md`, `logs/changelog.md` | Docs | One row each |
| `skills/tag-manage/tests/induce.test.js` | Engine tests | Extend: counts, `isEnumerationSuffix`, `scoreCluster` |
| `skills/tag-manage/tests/report.test.js` | Render tests | Update `PROPOSAL_SAMPLE` + 3 existing tests; add 3-table tests |
| `skills/tag-manage/tests/cli.test.js` | Integration | Extend: `runInduce` writes scored/categorized JSON |

---

## Task 1: Pure helpers — `isEnumerationSuffix` + `COINCIDENCE_PREFIXES`

**Files:**
- Modify: `skills/tag-manage/scripts/induce.js`
- Test: `skills/tag-manage/tests/induce.test.js`

**Interfaces:**
- Produces:
  - `COINCIDENCE_PREFIXES: Set<string>` — frozen set of 25 lowercase prefix strings.
  - `isEnumerationSuffix(suffix: string): boolean` — true for purely numeric (`"0"`, `"27001"`) or version-like (`"v2"`) suffixes; false otherwise.

- [ ] **Step 1: Write the failing tests**

Append to `skills/tag-manage/tests/induce.test.js`:

```js
const { isEnumerationSuffix, COINCIDENCE_PREFIXES } = require('../scripts/induce.js');

test('isEnumerationSuffix: numeric and version-like suffixes are enumerations', () => {
  assert.equal(isEnumerationSuffix('0'), true);
  assert.equal(isEnumerationSuffix('1'), true);
  assert.equal(isEnumerationSuffix('27001'), true);
  assert.equal(isEnumerationSuffix('v2'), true);
  assert.equal(isEnumerationSuffix('V3'), true);
});

test('isEnumerationSuffix: word suffixes are NOT enumerations', () => {
  assert.equal(isEnumerationSuffix('ai'), false);
  assert.equal(isEnumerationSuffix('source'), false);
  assert.equal(isEnumerationSuffix('hosting'), false);
  assert.equal(isEnumerationSuffix(''), false);
});

test('COINCIDENCE_PREFIXES contains the curated stoplist and is frozen', () => {
  assert.equal(COINCIDENCE_PREFIXES.has('open'), true);
  assert.equal(COINCIDENCE_PREFIXES.has('self'), true);
  assert.equal(COINCIDENCE_PREFIXES.has('work'), true);
  assert.equal(COINCIDENCE_PREFIXES.has('business'), false); // a real parent, not a coincidence prefix
  assert.equal(COINCIDENCE_PREFIXES.size, 25);
  assert.throws(() => COINCIDENCE_PREFIXES.add('zzz')); // frozen
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test skills/tag-manage/tests/induce.test.js 2>&1 | tail -20`
Expected: FAIL — `isEnumerationSuffix is not a function` / `COINCIDENCE_PREFIXES` undefined.

- [ ] **Step 3: Implement the helpers**

In `skills/tag-manage/scripts/induce.js`, after the `require` on line 7, add:

```js
// Common words that unrelated tags share by accident (OpenAI vs OpenSource). A leading
// token on this list pushes a family's score down. Curated from the live 54-family run.
const COINCIDENCE_PREFIXES = Object.freeze(new Set([
  'auto', 'big', 'deep', 'early', 'free', 'front', 'full', 'go', 'high', 'large',
  'local', 'long', 'low', 'make', 'multi', 'new', 'online', 'open', 'power', 'real',
  'self', 'share', 'smart', 'static', 'work',
]));

// A suffix is an "enumeration" when it is purely numeric (Phase0, ISO27001) or
// version-like (v2). Such families (Phase0-4) are strong real-family signals.
function isEnumerationSuffix(suffix) {
  return /^\d+$/.test(suffix) || /^v\d+$/i.test(suffix);
}
```

- [ ] **Step 4: Update the module exports**

Change the final line of `skills/tag-manage/scripts/induce.js` from:

```js
module.exports = { tokenizeTag, leadingSegment, clusterByName };
```

to:

```js
module.exports = { tokenizeTag, leadingSegment, clusterByName, isEnumerationSuffix, COINCIDENCE_PREFIXES };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test skills/tag-manage/tests/induce.test.js 2>&1 | tail -20`
Expected: PASS (all induce tests green).

- [ ] **Step 6: Commit**

```bash
git add skills/tag-manage/scripts/induce.js skills/tag-manage/tests/induce.test.js
git commit -m "feat(tag-organize): scoring helpers — isEnumerationSuffix + COINCIDENCE_PREFIXES"
```

---

## Task 2: Enrich `clusterByName` children with note counts

**Files:**
- Modify: `skills/tag-manage/scripts/induce.js:54-82` (the `clusterByName` function)
- Test: `skills/tag-manage/tests/induce.test.js`

**Interfaces:**
- Consumes: inventory records `{ key, variants, noteCount, files }` (from `buildInventory`).
- Produces: `clusterByName(inventory, opts?)` now returns clusters of shape
  `{ parent: string, children: Array<{ name: string, count: number }>, notesTotal: number, basis: string }`.
  Children stay sorted A→Z (case-insensitive) by `name`. Clusters stay sorted by child count desc, then parent A→Z. **Breaking shape change:** `children` was `string[]`, now `{name,count}[]`.

- [ ] **Step 1: Update the existing `clusterByName` test to the new child shape**

In `skills/tag-manage/tests/induce.test.js`, find the test `clusterByName groups flat tags sharing a leading token into a family` and replace its assertions on `children` so they read the new object shape. Replace the body's child assertions (the lines asserting `family.children` as strings) with:

```js
  // children are now { name, count } objects, A->Z by name
  assert.deepEqual(family.children.map((c) => c.name), ['Business-Strategy', 'BusinessModel', 'business-dev']);
  assert.deepEqual(family.children.map((c) => c.count), [3, 2, 1]);
  assert.equal(family.notesTotal, 6); // 3 + 2 + 1
```

(Keep the rest of that test — the `parent` assertion and the singleton-exclusion assertion — unchanged.)

- [ ] **Step 2: Add a dedicated count-enrichment test**

Append to `skills/tag-manage/tests/induce.test.js`:

```js
test('clusterByName enriches children with note counts and a family total', () => {
  const inventory = [
    inv('phase0', 12, ['Phase0']),
    inv('phase1', 9, ['Phase1']),
    inv('phase2', 4, ['Phase2']),
  ];
  const [family] = clusterByName(inventory);
  assert.equal(family.parent, 'Phase');
  assert.deepEqual(family.children, [
    { name: 'Phase0', count: 12 },
    { name: 'Phase1', count: 9 },
    { name: 'Phase2', count: 4 },
  ]);
  assert.equal(family.notesTotal, 25);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test skills/tag-manage/tests/induce.test.js 2>&1 | tail -25`
Expected: FAIL — children are still strings; `notesTotal` undefined.

- [ ] **Step 4: Implement the enrichment**

In `skills/tag-manage/scripts/induce.js`, inside `clusterByName`, replace the `children` construction and the `clusters.push(...)` line (currently lines ~76-78):

```js
    const children = distinct.map((e) => e.variants[0] || e.key)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())); // A->Z, case-insensitive
    clusters.push({ parent, children, basis: `name: ${children.length} tags share leading token "${stem}"` });
```

with:

```js
    const children = distinct
      .map((e) => ({ name: e.variants[0] || e.key, count: e.noteCount || 0 }))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())); // A->Z, case-insensitive
    const notesTotal = children.reduce((sum, c) => sum + c.count, 0);
    clusters.push({ parent, children, notesTotal, basis: `name: ${children.length} tags share leading token "${stem}"` });
```

The cluster sort on the next line (`b.children.length - a.children.length`) still works — `children` is still an array.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test skills/tag-manage/tests/induce.test.js 2>&1 | tail -25`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add skills/tag-manage/scripts/induce.js skills/tag-manage/tests/induce.test.js
git commit -m "feat(tag-organize): clusterByName enriches children with note counts + notesTotal"
```

---

## Task 3: `scoreCluster` — structural confidence + category

**Files:**
- Modify: `skills/tag-manage/scripts/induce.js`
- Test: `skills/tag-manage/tests/induce.test.js`

**Interfaces:**
- Consumes: a cluster `{ parent, children: {name,count}[], notesTotal }` + `{ declaredParents: string[] }`.
- Produces: `scoreCluster(cluster, { declaredParents? }): { score: number, category: 'implement'|'decide'|'ignore', basis: string }`. `score` is clamped `0..100`; `basis` is the `+`-joined list of signals that fired (`'base'` if none).

- [ ] **Step 1: Write the failing tests**

Append to `skills/tag-manage/tests/induce.test.js`:

```js
const { scoreCluster } = require('../scripts/induce.js');

// minimal scored-cluster factory: n children with given total notes, parent name
const fam = (parent, childNames, notesTotal = 0) => ({
  parent,
  children: childNames.map((name) => ({ name, count: 0 })),
  notesTotal,
});

test('scoreCluster: base score for a plain 2-child family with no signals', () => {
  const r = scoreCluster(fam('Customer', ['CustomerDiscovery', 'CustomerService'], 0));
  assert.equal(r.score, 40);     // base only
  assert.equal(r.category, 'decide');
  assert.equal(r.basis, 'base');
});

test('scoreCluster: size bonus is +10 per child over 2, capped at +30', () => {
  assert.equal(scoreCluster(fam('A', ['A1', 'A2', 'A3'], 0)).score, 50);            // +10
  assert.equal(scoreCluster(fam('A', ['A1', 'A2', 'A3', 'A4'], 0)).score, 60);      // +20
  assert.equal(scoreCluster(fam('A', ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'], 0)).score, 70); // cap +30
});

test('scoreCluster: frequency tiers add 0 / 10 / 20', () => {
  assert.equal(scoreCluster(fam('A', ['A1', 'A2'], 4)).score, 40);   // <5 -> +0
  assert.equal(scoreCluster(fam('A', ['A1', 'A2'], 5)).score, 50);   // 5..60 -> +10
  assert.equal(scoreCluster(fam('A', ['A1', 'A2'], 60)).score, 50);  // boundary -> +10
  assert.equal(scoreCluster(fam('A', ['A1', 'A2'], 61)).score, 60);  // >60 -> +20
});

test('scoreCluster: enumeration-suffix majority adds +15', () => {
  const r = scoreCluster(fam('Phase', ['Phase0', 'Phase1', 'Phase2'], 0));
  assert.equal(r.score, 65);  // base 40 + size 10 (3 children) + enum 15
  assert.match(r.basis, /enum/);
});

test('scoreCluster: declared-parent match adds +25 (case-insensitive)', () => {
  const r = scoreCluster(fam('Business', ['BusinessX', 'BusinessY'], 0), { declaredParents: ['business', 'AI'] });
  assert.equal(r.score, 65);  // base 40 + declared 25
  assert.match(r.basis, /declared/);
});

test('scoreCluster: coincidence-prefix subtracts 35', () => {
  const r = scoreCluster(fam('Open', ['OpenAI', 'OpenSource'], 0));
  assert.equal(r.score, 5);   // base 40 - 35
  assert.equal(r.category, 'ignore');
  assert.match(r.basis, /coincidence-prefix/);
});

test('scoreCluster: thresholds — implement >= 70, decide 40..69, ignore < 40', () => {
  assert.equal(scoreCluster(fam('A', ['A1', 'A2'], 0)).category, 'decide');             // 40
  assert.equal(scoreCluster(fam('A', ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'], 61)).category, 'implement'); // 40+30+20=90
  assert.equal(scoreCluster(fam('Open', ['OpenAI', 'OpenSource'], 0)).category, 'ignore'); // 5
});

test('scoreCluster: score clamps to 0..100', () => {
  // max-stacked: declared + size cap + freq + enum
  const hi = scoreCluster(
    fam('Phase', ['Phase0', 'Phase1', 'Phase2', 'Phase3', 'Phase4', 'Phase5'], 61),
    { declaredParents: ['Phase'] },
  );
  assert.equal(hi.score, 100);  // 40+30+20+15+25 = 130 -> clamp 100
  // min: coincidence prefix with no positives
  assert.equal(scoreCluster(fam('Open', ['OpenAI', 'OpenSource'], 0)).score >= 0, true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test skills/tag-manage/tests/induce.test.js 2>&1 | tail -25`
Expected: FAIL — `scoreCluster is not a function`.

- [ ] **Step 3: Implement `scoreCluster`**

In `skills/tag-manage/scripts/induce.js`, add before the `module.exports` line:

```js
// Deterministic structural confidence for a cluster. Pure, total, throw-free. The score
// is an ordinal triage aid (signal strength), NOT a calibrated probability. See
// docs/superpowers/specs/2026-06-25-tag-organize-confidence-triage-design.md.
function scoreCluster(cluster, { declaredParents = [] } = {}) {
  const signals = [];
  let score = 40; // base

  const sizeBonus = Math.min(30, Math.max(0, (cluster.children.length - 2) * 10));
  if (sizeBonus) { score += sizeBonus; signals.push('size'); }

  const total = cluster.notesTotal || 0;
  const freqBonus = total > 60 ? 20 : total >= 5 ? 10 : 0;
  if (freqBonus) { score += freqBonus; signals.push('freq'); }

  const enumCount = cluster.children
    .filter((c) => isEnumerationSuffix(tokenizeTag(c.name)[1] || '')).length;
  if (enumCount * 2 > cluster.children.length) { score += 15; signals.push('enum'); }

  const declaredLc = new Set(declaredParents.map((p) => String(p).toLowerCase()));
  if (declaredLc.has(cluster.parent.toLowerCase())) { score += 25; signals.push('declared'); }

  if (COINCIDENCE_PREFIXES.has(cluster.parent.toLowerCase())) { score -= 35; signals.push('coincidence-prefix'); }

  score = Math.max(0, Math.min(100, score));
  const category = score >= 70 ? 'implement' : score >= 40 ? 'decide' : 'ignore';
  return { score, category, basis: signals.join('+') || 'base' };
}
```

Add `scoreCluster` to the exports:

```js
module.exports = { tokenizeTag, leadingSegment, clusterByName, scoreCluster, isEnumerationSuffix, COINCIDENCE_PREFIXES };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test skills/tag-manage/tests/induce.test.js 2>&1 | tail -25`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/tag-manage/scripts/induce.js skills/tag-manage/tests/induce.test.js
git commit -m "feat(tag-organize): scoreCluster — structural confidence + Implement/Decide/Ignore"
```

---

## Task 4: `renderProposal` — three score-sorted tables

**Files:**
- Modify: `skills/tag-manage/scripts/report.js:140` (the `renderProposal` function)
- Test: `skills/tag-manage/tests/report.test.js`

**Interfaces:**
- Consumes: `renderProposal({ scope, date, clusters })` where each cluster now carries
  `{ parent, children: {name,count}[], notesTotal, score, category, basis }`.
- Produces: a Markdown note with frontmatter (marker only), a three-way summary callout, and three sections (Implement / Decide / Ignore), each a score-sorted table with columns `# | Parent | Children | Notes | Score | Basis`, or an `(none)` line when empty.

- [ ] **Step 1: Update the `PROPOSAL_SAMPLE` fixture + existing tests**

In `skills/tag-manage/tests/report.test.js`, find the `PROPOSAL_SAMPLE` constant used by the Slice-1.5 tests and replace it with the scored shape:

```js
const PROPOSAL_SAMPLE = [
  { parent: 'Phase', children: [{ name: 'Phase0', count: 12 }, { name: 'Phase1', count: 9 }],
    notesTotal: 21, score: 85, category: 'implement', basis: 'size+enum' },
  { parent: 'Customer', children: [{ name: 'CustomerDiscovery', count: 3 }, { name: 'CustomerService', count: 2 }],
    notesTotal: 5, score: 50, category: 'decide', basis: 'freq' },
  { parent: 'Open', children: [{ name: 'OpenAI', count: 8 }, { name: 'OpenSource', count: 4 }],
    notesTotal: 12, score: 25, category: 'ignore', basis: 'coincidence-prefix' },
];
```

The three existing tests (`frontmatter carries ONLY the report marker tag`, `body emits NO bare #token`, `every parent and child is backtick-wrapped`) keep their assertions — they still hold against the new render. The backtick-wrap test should assert child *names* are wrapped; if it iterates `clusters[].children` as strings, change it to `c.children.map((ch) => ch.name)`.

- [ ] **Step 2: Add the three-table tests**

Append to `skills/tag-manage/tests/report.test.js`:

```js
test('renderProposal: renders three category sections in Implement/Decide/Ignore order', () => {
  const md = renderProposal({ scope: 'Vault-wide', date: '2026-06-25', clusters: PROPOSAL_SAMPLE });
  const iImpl = md.indexOf('## Implement');
  const iDec = md.indexOf('## Decide');
  const iIgn = md.indexOf('## Ignore');
  assert.ok(iImpl > -1 && iDec > -1 && iIgn > -1, 'all three headings present');
  assert.ok(iImpl < iDec && iDec < iIgn, 'sections in Implement -> Decide -> Ignore order');
});

test('renderProposal: tables carry Notes and Score columns', () => {
  const md = renderProposal({ scope: 'Vault-wide', date: '2026-06-25', clusters: PROPOSAL_SAMPLE });
  assert.match(md, /\| Notes \| Score \|/);
  assert.match(md, /`Phase0` \(12\)/);   // per-child count inline
  assert.match(md, /\| 21 \| 85 \|/);    // Phase row: notesTotal + score
});

test('renderProposal: summary shows the three-way distribution', () => {
  const md = renderProposal({ scope: 'Vault-wide', date: '2026-06-25', clusters: PROPOSAL_SAMPLE });
  assert.match(md, /Implement 1 . Decide 1 . Ignore 1/);
});

test('renderProposal: an empty category renders a "(none)" line, not a broken table', () => {
  const onlyImpl = [PROPOSAL_SAMPLE[0]];
  const md = renderProposal({ scope: 'Vault-wide', date: '2026-06-25', clusters: onlyImpl });
  const decIdx = md.indexOf('## Decide');
  const ignIdx = md.indexOf('## Ignore');
  assert.match(md.slice(decIdx, ignIdx), /\(none\)/);
});

test('renderProposal: rows within a section are sorted by score descending', () => {
  const clusters = [
    { parent: 'Low', children: [{ name: 'LowA', count: 1 }, { name: 'LowB', count: 1 }], notesTotal: 2, score: 45, category: 'decide', basis: 'base' },
    { parent: 'Market', children: [{ name: 'MarketA', count: 9 }, { name: 'MarketB', count: 9 }], notesTotal: 18, score: 60, category: 'decide', basis: 'freq' },
  ];
  const md = renderProposal({ scope: 'Vault-wide', date: '2026-06-25', clusters });
  assert.ok(md.indexOf('`Market`') < md.indexOf('`Low`'), 'higher score first');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test skills/tag-manage/tests/report.test.js 2>&1 | tail -25`
Expected: FAIL — single-table render has no `## Implement` heading / no `Notes | Score` columns.

- [ ] **Step 4: Read the current `renderProposal` to preserve its frontmatter/marker**

Run: `sed -n '140,151p' skills/tag-manage/scripts/report.js`
Note the exact frontmatter block + `REPORT_MARKER_TAG` usage + the `table()` helper signature so the rewrite reuses them.

- [ ] **Step 5: Rewrite `renderProposal`**

Replace the whole `renderProposal` function (lines ~140-151) in `skills/tag-manage/scripts/report.js` with:

```js
function renderProposal({ scope, date, clusters }) {
  const CATS = [
    ['implement', 'Implement (recommended — review, then apply as a batch)'],
    ['decide', 'Decide (your call — content-sample the unclear ones)'],
    ['ignore', 'Ignore (likely name-coincidence — skip)'],
  ];
  const counts = { implement: 0, decide: 0, ignore: 0 };
  for (const c of clusters) counts[c.category] = (counts[c.category] || 0) + 1;

  const childrenCell = (c) =>
    c.children.map((ch) => `\`${ch.name}\` (${ch.count})`).join(', ');

  const section = ([cat, heading]) => {
    const rows = clusters
      .filter((c) => c.category === cat)
      .sort((a, b) => b.score - a.score || a.parent.localeCompare(b.parent));
    const body = rows.length
      ? [
          '| # | Parent | Children | Notes | Score | Basis |',
          '| --- | --- | --- | --- | --- | --- |',
          ...rows.map((c, i) =>
            `| ${i + 1} | \`${c.parent}\` | ${childrenCell(c)} | ${c.notesTotal} | ${c.score} | ${c.basis} |`),
        ].join('\n')
      : '_(none)_';
    return `## ${heading}\n\n${body}\n`;
  };

  return [
    '---',
    `title: 'Tag Organize Proposal - ${scope} - ${date}'`,
    'type: inbox',
    'status: draft',
    `created: ${date}`,
    'tags:',
    `  - ${REPORT_MARKER_TAG}`,
    '---',
    '',
    '# Tag Organize Proposal',
    '',
    '> [!summary]',
    `> **Scope:** ${scope}`,
    `> **Candidate families:** ${clusters.length} -> Implement ${counts.implement} . Decide ${counts.decide} . Ignore ${counts.ignore}`,
    '> Score = structural signal strength (not a probability) — see Basis. Implement is a recommended batch, still applied behind the confirm gate; nothing is auto-applied.',
    '',
    ...CATS.map(section),
    '> [!tip] Next Steps',
    '> For each family you approve: `cli.js set-hierarchy <vault> --parent <Parent> --children <Child1,Child2>`, then re-audit and apply the nests behind the confirm gate. Skip families that do not represent a real parent.',
    '',
  ].join('\n');
}
```

(Keep the existing `module.exports` — `renderProposal` is already exported.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test skills/tag-manage/tests/report.test.js 2>&1 | tail -25`
Expected: PASS (the 3 updated + 5 new tests green).

- [ ] **Step 7: Commit**

```bash
git add skills/tag-manage/scripts/report.js skills/tag-manage/tests/report.test.js
git commit -m "feat(tag-organize): renderProposal — three score-sorted Implement/Decide/Ignore tables"
```

---

## Task 5: Wire scoring into `runInduce` + the `induce` command

**Files:**
- Modify: `skills/tag-manage/scripts/cli.js` (`runInduce` ~line 253; the `induce` command handler ~line 303; the `require` on line 18)
- Test: `skills/tag-manage/tests/cli.test.js`

**Interfaces:**
- Consumes: `clusterByName`, `scoreCluster` from `induce.js`; `loadConfig` from `config.js`; config `dict.hierarchy` (keys = declared parents).
- Produces: `runInduce(dir, { reportDirAbs, date, fileStamp?, scope?, declaredParents? })` writes a `.tag-organize-clusters.json` whose entries carry `score`, `category`, `notesTotal`, and `{name,count}` children; and (when `reportDirAbs` is set) the three-table proposal note.

- [ ] **Step 1: Write the failing integration test**

Append to `skills/tag-manage/tests/cli.test.js` (reuse the file's existing temp-dir + note-writing helpers; the snippet below assumes a `mkTmpVault(files)` style helper — match whatever the file already uses to create a vault dir and read JSON):

```js
test('runInduce: writes scored, categorized clusters; declared-parent match lands in implement', () => {
  const { runInduce } = require('../scripts/cli.js');
  // a vault where 'Project' is a declared parent and two flat ProjectX tags exist
  const dir = mkTmpVault([
    { path: 'a.md', body: '#ProjectManagement #ProjectInstructions' },
    { path: 'b.md', body: '#ProjectManagement' },
  ]);
  const reportDirAbs = path.join(dir, '_reports');
  const { clusters } = runInduce(dir, {
    reportDirAbs, date: '2026-06-25', declaredParents: ['Project'],
  });
  const project = clusters.find((c) => c.parent === 'Project');
  assert.ok(project, 'Project family proposed');
  assert.equal(project.category, 'implement');     // base 40 + declared 25 (+ freq) >= 70? see note
  assert.ok(typeof project.score === 'number');
  assert.ok(project.children.every((ch) => typeof ch.count === 'number'));
  // the written JSON carries the enriched shape
  const written = JSON.parse(fs.readFileSync(path.join(reportDirAbs, '.tag-organize-clusters.json'), 'utf8'));
  assert.ok(written[0].category && typeof written[0].score === 'number');
});
```

> **Note for the implementer:** verify the score arithmetic for this fixture before asserting `implement`. base 40 + declared 25 = 65 (Decide) unless frequency pushes it over. If the fixture's `notesTotal` is `< 5`, the family scores 65 → `decide`. Either (a) add enough notes so `notesTotal ≥ 5` (→ +10 → 75 → implement), or (b) assert `category === 'decide'` and a separate larger-fixture asserts `implement`. Pick one and make the fixture match the assertion — do not assert a category the arithmetic does not produce. The fixture above has 3 ProjectManagement + 1 ProjectInstructions occurrences across 2 notes; compute `noteCount` per tag (deduped per note) and size the fixture accordingly.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test skills/tag-manage/tests/cli.test.js 2>&1 | tail -25`
Expected: FAIL — clusters lack `category`/`score`, or `runInduce` ignores `declaredParents`.

- [ ] **Step 3: Import `scoreCluster` + `loadConfig` access in `cli.js`**

Change line 18 of `skills/tag-manage/scripts/cli.js` from:

```js
const { clusterByName } = require('./induce.js');
```

to:

```js
const { clusterByName, scoreCluster } = require('./induce.js');
```

(`loadConfig` is already imported on line 20.)

- [ ] **Step 4: Score the clusters inside `runInduce`**

In `runInduce` (~line 253), update the signature and the cluster construction. Replace:

```js
function runInduce(dir, { reportDirAbs, date, fileStamp = '', scope = 'Vault-wide' } = {}) {
  const inventory = buildInventory(excludeReportArtifacts(readNotes(dir), dir, reportDirAbs));
  const clusters = clusterByName(inventory);
```

with:

```js
function runInduce(dir, { reportDirAbs, date, fileStamp = '', scope = 'Vault-wide', declaredParents = [] } = {}) {
  const inventory = buildInventory(excludeReportArtifacts(readNotes(dir), dir, reportDirAbs));
  const clusters = clusterByName(inventory).map((c) => ({ ...c, ...scoreCluster(c, { declaredParents }) }));
```

The rest of `runInduce` (writing the JSON, the proposal note via `renderProposal`) is unchanged — it now serializes the enriched clusters.

- [ ] **Step 5: Derive `declaredParents` in the `induce` command handler**

In the `if (cmd === 'induce')` block (~line 303), replace:

```js
      const { reportDirAbs, date, fileStamp } = resolveReportContext(target, rest);
      const { clusters, outPath, notePath } = runInduce(target, { reportDirAbs, date, fileStamp });
      console.error(`induce: ${clusters.length} candidate ${clusters.length === 1 ? 'family' : 'families'} proposed -> ${outPath}`);
```

with:

```js
      const { defaultsPath, configText, reportDirAbs, date, fileStamp } = resolveReportContext(target, rest);
      const dict = loadConfig({ defaultsPath, configText });
      const declaredParents = Object.keys(dict.hierarchy || {});
      const { clusters, outPath, notePath } = runInduce(target, { reportDirAbs, date, fileStamp, declaredParents });
      const byCat = { implement: 0, decide: 0, ignore: 0 };
      for (const c of clusters) byCat[c.category] = (byCat[c.category] || 0) + 1;
      console.error(`induce: ${clusters.length} candidate ${clusters.length === 1 ? 'family' : 'families'} proposed (implement ${byCat.implement} / decide ${byCat.decide} / ignore ${byCat.ignore}) -> ${outPath}`);
```

(Leave the two following `console.error` lines — the proposal-note path + the set-hierarchy hint — unchanged.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test skills/tag-manage/tests/cli.test.js 2>&1 | tail -25`
Expected: PASS.

- [ ] **Step 7: Run the full tag-manage suite (no regressions)**

Run: `bash scripts/test-tag-manage.sh 2>&1 | tail -15`
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add skills/tag-manage/scripts/cli.js skills/tag-manage/tests/cli.test.js
git commit -m "feat(tag-organize): runInduce scores clusters + induce derives declared parents from config"
```

---

## Task 6: Skill flow + docs

**Files:**
- Modify: `skills/tag-organize/SKILL.md`
- Modify: `README.md`
- Modify: `logs/changelog.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Update the SKILL.md flow**

In `skills/tag-organize/SKILL.md`, update the induce/presentation/apply steps so they describe the three-table triage. Replace the "**2. Present the proposal.**" block (the single-table example) with:

```markdown
**2. Present the proposal (three tables).** `induce` scores each family by structural
signal and splits them into three sections in the proposal note:

- **Implement** — high structural confidence (e.g. enumerated families, or a parent that
  matches a declared config parent). Propose the whole bucket as a default batch: show the
  one table, let the user deselect any they reject, then persist + apply the rest.
- **Decide** — the uncertain middle. Work through individually; for families whose names do
  not settle the call, use the content-read gate below.
- **Ignore** — likely name-coincidence (a common-word prefix, e.g. `Open`). Skipped by
  default; the user may still promote one.

The `Score` (0–100) is a structural signal strength, not a probability, and `Notes` is how
many notes the family touches — use both to triage. `Implement` is a recommendation, not
auto-apply: every nest still goes through the confirm gate in step 5.
```

- [ ] **Step 2: Update the README row**

In `README.md`, find the `tag-organize` row/description and append a clause noting the scored Implement/Decide/Ignore triage. Exact text to add to the tag-organize description: ` — proposals are scored and split into Implement / Decide / Ignore so you can triage by confidence and note-impact.`

- [ ] **Step 3: Add the changelog row**

In `logs/changelog.md`, add under the current unreleased/beta section:

```markdown
- tag-organize: `induce` now scores each candidate family (structural 0–100 confidence) and
  splits the proposal note into Implement / Decide / Ignore tables with note-counts, so the
  user triages by confidence and impact. Engine stays pure; Implement is a recommended batch
  behind the existing confirm gate (never auto-apply).
```

- [ ] **Step 4: Verify no code broke (docs-only, but run the suite)**

Run: `bash scripts/test-tag-manage.sh 2>&1 | tail -5`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add skills/tag-organize/SKILL.md README.md logs/changelog.md
git commit -m "docs(tag-organize): document scored Implement/Decide/Ignore triage flow"
```

---

## Task 7: Calibration run on the live vault

**Files:** none (produces data + optional tuning commit).

**Interfaces:** none. This is the spec's mandatory calibration step.

- [ ] **Step 1: Run induce on the live test-vault copy**

Run:

```bash
node skills/tag-manage/scripts/cli.js induce "/Users/germanrauhut.com/Vaults/TM/20260624 UTA nexus v1"
```

Expected: a one-line `induce: N families (implement X / decide Y / ignore Z) -> …` summary.

- [ ] **Step 2: Read the generated proposal note**

Read the newest `_vault-autopilot/reports/<date> <HHMM> Tag Organize Proposal - Vault-wide.md`. Inspect the three tables.

- [ ] **Step 3: Sanity-check the distribution against the spec's intent**

Confirm: enumerated/declared families (e.g. `Phase`, any parent matching a config-hierarchy key) are in `Implement`; coincidence-prefix families (`Open`, `Self`, `Low`, `Mc`-style) are in `Ignore` or low `Decide`; high-frequency dup-variants (`Baden`, `Mercedes`) sit in `Decide` (not `Implement`). Capture the actual counts.

- [ ] **Step 4: Present the distribution to the user and tune if needed**

Show the user the Implement/Decide/Ignore counts + a few example rows per bucket. If a clearly-wrong family is mis-bucketed (e.g. a real family stuck in Ignore, or a coincidence promoted to Implement), adjust **only** the stoplist or a threshold/weight in `induce.js`, re-run, and commit:

```bash
git add skills/tag-manage/scripts/induce.js
git commit -m "fix(tag-organize): calibrate score weights/stoplist against live vault distribution"
```

If the distribution is already sensible, note that no tuning was needed (no commit).

- [ ] **Step 5: Final full-suite green + push**

```bash
bash scripts/test-tag-manage.sh 2>&1 | tail -5
git push -u origin obi/2026-06-25-tag-organize-confidence-triage
```

Then open the PR. The user owns the UAT PASS; MASCHIN owns the read-the-code PIR.

---

## Self-Review

**Spec coverage:**
- Scoring model (base/size/freq/enum/declared/coincidence + clamp) → Tasks 1+3. ✓
- Thresholds → Task 3. ✓
- Stoplist constant → Task 1. ✓
- Per-child counts + `notesTotal` → Task 2. ✓
- Three score-sorted tables + `Notes`/`Score` columns + `(none)` + summary → Task 4. ✓
- `declaredParents` from config → Task 5. ✓
- Enriched JSON shape → Task 5. ✓
- Flow change (Implement batch behind gate) → Task 6. ✓
- Calibration run on live vault → Task 7. ✓
- Invariants (marker-only frontmatter, backtick-wrap, no bare `#token`) → preserved + tested in Task 4. ✓
- YAGNI exclusions (no dup-detector, no content-scoring, no new write surface) → honored; Finding C left as a captured backlog note (no task). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; the Task-5 fixture carries an explicit implementer note to make arithmetic and assertion agree (a guard against an unverifiable assertion, not a placeholder).

**Type consistency:** `children` is `{name,count}[]` from Task 2 onward — used consistently in Tasks 3 (`c.name`), 4 (`ch.name`, `ch.count`), 5 (`ch.count`). `scoreCluster` returns `{score,category,basis}` — consumed in Task 5's merge and Task 4's render. `category` values `implement|decide|ignore` consistent across Tasks 3/4/5. `runInduce` param `declaredParents` consistent Tasks 5. ✓
