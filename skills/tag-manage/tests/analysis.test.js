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
