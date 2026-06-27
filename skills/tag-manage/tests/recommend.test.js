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

test('separator variant of a hyphenated brand folds to canonical (Finding C)', () => {
  const d = mergeOverrides({ brands: { 'mercedes-benz': 'Mercedes-Benz' } }, {});
  const notes = [
    { path: 'a.md', text: '---\ntags:\n  - Mercedes-Benz\n---\n' },  // already canonical
    { path: 'b.md', text: '---\ntags:\n  - MercedesBenz\n---\n' },   // no-separator variant
    { path: 'c.md', text: '---\ntags:\n  - mercedes_benz\n---\n' },  // underscore variant
  ];
  const recs = buildRecommendations(buildInventory(notes), d);
  assert.ok(!recs.some((x) => x.ops.some((o) => o.from === 'mercedes-benz')), 'the hyphenated form is canonical -> no rec');
  const noSep = recs.find((x) => x.ops.some((o) => o.from === 'mercedesbenz'));
  assert.ok(noSep, 'MercedesBenz gets a fold rec');
  assert.equal(noSep.to, 'Mercedes-Benz');
  assert.equal(noSep.source, 'brand');
  const underscore = recs.find((x) => x.ops.some((o) => o.from === 'mercedes_benz'));
  assert.ok(underscore, 'mercedes_benz gets a fold rec');
  assert.equal(underscore.to, 'Mercedes-Benz');
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

// UAT regression: when the first-seen display is already the canonical form (e.g.
// LinkedIn appears in 3 notes before the minority linkedin), from must show the
// non-canonical variant, not the canonical, and notesAffected must count only the
// notes that actually change (the one carrying linkedin), not total noteCount (4).
test('UAT regression: from = non-canonical variant, notesAffected = real changed-note count', () => {
  const d = require('../scripts/config.js').mergeOverrides({ brands: { linkedin: 'LinkedIn' } }, {});
  const notes = [
    { path: 'a.md', text: '---\ntags:\n  - LinkedIn\n---\n' },
    { path: 'b.md', text: '---\ntags:\n  - LinkedIn\n---\n' },
    { path: 'c.md', text: '---\ntags:\n  - LinkedIn\n---\n' },
    { path: 'd.md', text: '---\ntags:\n  - linkedin\n---\n' },
  ];
  const recs = buildRecommendations(buildInventory(notes), d, notes);
  const r = recs.find((x) => x.to === 'LinkedIn');
  assert.ok(r, 'recommendation for LinkedIn must exist');
  assert.equal(r.from, 'linkedin', 'from must be the non-canonical variant, not the canonical');
  assert.equal(r.to, 'LinkedIn');
  assert.equal(r.notesAffected, 1, 'only d.md changes; a/b/c are already canonical (no-op)');
});

// --- v2 scope-recovery: UAT-driven fixes (b/c/d) + dict seeding (a) ---
const { canonicalForm } = require('../scripts/convention.js');
const defaults = require('../references/tag-overrides.default.json');

test('v2(b): an all-caps acronym variant wins over the Title-case heuristic (geo+GEO -> GEO)', () => {
  const notes = [
    { path: 'a.md', text: '---\ntags:\n  - geo\n---\n' },
    { path: 'b.md', text: '---\ntags:\n  - GEO\n---\n' },
  ];
  const recs = buildRecommendations(buildInventory(notes), dict);
  const r = recs.find((x) => x.to === 'GEO');
  assert.ok(r, 'must fold to the acronym GEO, not the heuristic Geo');
  assert.equal(r.source, 'acronym');
  assert.equal(recs.find((x) => x.to === 'Geo'), undefined, 'must not propose the wrong Title-case Geo');
});

test('v2(d): a case-variant duplicate with no classifiable violation still folds (AI-Testing/AI-testing)', () => {
  const notes = [
    { path: 'a.md', text: '---\ntags:\n  - AI-Testing\n---\n' },
    { path: 'b.md', text: '---\ntags:\n  - AI-testing\n---\n' },
  ];
  const recs = buildRecommendations(buildInventory(notes), dict);
  const r = recs.find((x) => x.to === 'AI-Testing');
  assert.ok(r, 'a real case-variant duplicate must fold even without a classifyTag violation');
  assert.equal(r.from, 'AI-testing');
});

test('v2(d) do-no-harm PIN: a single compliant non-dict tag (Photography) produces NO rec', () => {
  const notes = [{ path: 'a.md', text: '---\ntags:\n  - Photography\n---\n' }];
  assert.equal(buildRecommendations(buildInventory(notes), dict).length, 0,
    'loosening needsFold for duplicates must NOT make single compliant tags produce recs');
});

test('v2(c): a numeric/invalid artifact tag gets NO rename rec (1-3 must not become 13)', () => {
  const notes = [{ path: 'a.md', text: '---\ntags:\n  - 1-3\n---\n' }];
  const recs = buildRecommendations(buildInventory(notes), dict);
  assert.equal(recs.find((x) => x.from === '1-3'), undefined, 'numeric artifact must not produce a rename rec');
  assert.equal(recs.find((x) => x.to === '13'), undefined);
});

test('v2(a): shipped defaults resolve MCP to MCP (the mcp->mcp bug is fixed)', () => {
  const dictReal = mergeOverrides(defaults, {});
  assert.equal(canonicalForm('MCP', dictReal).canonical, 'MCP');
  assert.equal(canonicalForm('mcp', dictReal).canonical, 'MCP');
});

test('v2(a): shipped defaults seed generic tech acronyms/brands (E2E, DevOps)', () => {
  const dictReal = mergeOverrides(defaults, {});
  assert.equal(canonicalForm('e2e', dictReal).canonical, 'E2E');
  assert.equal(canonicalForm('devops', dictReal).canonical, 'DevOps');
});

// do-no-harm PIN (user UAT signal): real-world alphanumeric tags that LOOK numeric but
// carry meaning -- 5G/4G (mobile network), 9a (Noah's school grade), 8bit -- are VALID
// tags (>=1 non-numeric char). They must never be dropped as artifacts and must produce
// no rename rec. Only PURE numerics (1, 2, 1-3) are invalid.
test('v2(c) PIN: meaningful alphanumeric tags (5G, 4G, 9a) are valid and get NO rec', () => {
  for (const tag of ['5G', '4G', '9a']) {
    const notes = [{ path: 'a.md', text: `---\ntags:\n  - ${tag}\n---\n` }];
    const recs = buildRecommendations(buildInventory(notes), dict);
    assert.equal(recs.length, 0, `${tag} is a meaningful tag, not an artifact -- it must not be renamed or removed`);
  }
});
