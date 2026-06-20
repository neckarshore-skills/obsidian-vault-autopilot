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
