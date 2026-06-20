'use strict';
// Stage 1 audit aggregation (pure — operates on in-memory note objects, no fs).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildInventory, auditFindings } = require('../scripts/tags.js');

const NOTES = [
  { path: 'a.md', text: '---\ntags: [AI, ml]\n---\nbody #AI here\n' },
  { path: 'b.md', text: '---\ntags:\n  - ai\n---\nplain body\n' },
  { path: 'c.md', text: '---\ntags:\n  - ai-ml\n  - ai_ml\n---\nx\n' },
  { path: 'd.md', text: 'no tags at all here\n' },
];

test('buildInventory: note-count, variants, and first-seen display per logical tag', () => {
  const inv = buildInventory(NOTES);
  const ai = inv.find((r) => r.key === 'ai');
  assert.equal(ai.noteCount, 2);                              // a.md + b.md (deduped within a.md)
  assert.deepEqual(new Set(ai.variants), new Set(['AI', 'ai']));
  assert.equal(ai.display, 'AI');                             // first occurrence wins
  assert.deepEqual(ai.files.sort(), ['a.md', 'b.md']);
});

test('auditFindings: orphans are single-note tags (excludes reserved)', () => {
  const f = auditFindings(NOTES);
  const orphanKeys = new Set(f.orphans.map((o) => o.key));
  assert.ok(orphanKeys.has('ml'));        // only in a.md
  assert.ok(!orphanKeys.has('ai'));       // in two notes
});

test('auditFindings: case variants surface as a cosmetic group', () => {
  const f = auditFindings(NOTES);
  const keys = f.caseGroups.map((g) => g.key);
  assert.ok(keys.includes('ai'));         // {AI, ai}
});

test('auditFindings: separator variants surface (- <-> _), distinct from nested', () => {
  const f = auditFindings(NOTES);
  assert.equal(f.separatorGroups.length, 1);
  assert.deepEqual(new Set(f.separatorGroups[0].variants), new Set(['ai-ml', 'ai_ml']));
});

test('auditFindings: numbers-only frontmatter token is flagged as a numeric artifact', () => {
  const f = auditFindings([{ path: 'n.md', text: '---\ntags:\n  - 2024\n  - real\n---\nx\n' }]);
  assert.ok(f.numericArtifacts.includes('2024'));
  assert.ok(!f.numericArtifacts.includes('real'));
});

test('auditFindings: untagged notes are listed', () => {
  const f = auditFindings(NOTES);
  assert.deepEqual(f.untagged, ['d.md']);
});

test('auditFindings: reserved VaultAutopilot is never an orphan or a suggestion', () => {
  const f = auditFindings([{ path: 'z.md', text: '---\ntags:\n  - VaultAutopilot\n---\nx\n' }]);
  assert.equal(f.orphans.length, 0);
  assert.equal(f.caseGroups.length, 0);
});
