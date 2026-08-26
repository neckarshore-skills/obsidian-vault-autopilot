'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { diffLibrary } = require('../scripts/diff.js');

const inv = (name, herkunft, ort) => ({ name, herkunft, ort, plugin: '', description: 'd' });
const note = (name, suffix, ort) => ({
  title: suffix ? `Skill – ${name} (${suffix})` : `Skill – ${name}`,
  name, suffix, frontmatter: { ort, status: 'aktiv' },
});

test('a skill with no note is created', () => {
  const d = diffLibrary([inv('photo-dedup', 'org-plugin', '/a')], []);
  assert.strictEqual(d.created.length, 1);
  assert.strictEqual(d.created[0].name, 'photo-dedup');
});

test('a note whose ort still exists in the inventory is unchanged', () => {
  const d = diffLibrary([inv('a', 'eigen', '/a')], [note('a', 'eigen', '/a')]);
  assert.strictEqual(d.unchanged.length, 1);
  assert.strictEqual(d.relocated.length, 0);
});

test('a note whose ort moved is relocated, not recreated', () => {
  const d = diffLibrary([inv('a', 'eigen', '/new')], [note('a', 'eigen', '/old')]);
  assert.strictEqual(d.relocated.length, 1);
  assert.strictEqual(d.relocated[0].ort, '/new');
  assert.strictEqual(d.created.length, 0);
});

test('a note with no skill anywhere is retired', () => {
  const d = diffLibrary([], [note('sentry-go-sdk', '', '/gone')]);
  assert.strictEqual(d.retired.length, 1);
  assert.strictEqual(d.retired[0].name, 'sentry-go-sdk');
});

test('a skill acquiring a second origin renames the existing suffix-less note', () => {
  const d = diffLibrary(
    [inv('agents-sdk', 'eigen', '/own'), inv('agents-sdk', 'extern', '/plugin')],
    [note('agents-sdk', '', '/own')],
  );
  assert.deepStrictEqual(d.renamed, [
    { from: 'Skill – agents-sdk', to: 'Skill – agents-sdk (eigen)' },
  ]);
  assert.strictEqual(d.created.length, 1);
  assert.strictEqual(d.created[0].suffix, 'extern');
});

test('a single-origin skill gets no suffix', () => {
  const d = diffLibrary([inv('solo', 'eigen', '/a')], []);
  assert.strictEqual(d.created[0].suffix, '');
});

test('every note lands in exactly one bucket', () => {
  const notes = [note('a', 'eigen', '/a'), note('b', '', '/old'), note('c', '', '/gone')];
  const d = diffLibrary([inv('a', 'eigen', '/a'), inv('b', 'eigen', '/new')], notes);
  const total = d.unchanged.length + d.relocated.length + d.retired.length;
  assert.strictEqual(total, notes.length);
});

// --- Findings from the review of the Task 5 reference implementation ---

test('two notes sharing a title: every note is accounted for across the four buckets plus conflicts', () => {
  const n1 = note('dup', '', '/a');
  const n2 = note('dup', '', '/b'); // same title "Skill – dup" as n1, different ort
  const d = diffLibrary([inv('dup', 'eigen', '/a')], [n1, n2]);

  const bucketTotal = d.unchanged.length + d.relocated.length + d.retired.length;
  const titleConflicts = d.conflicts.filter((c) => c.kind === 'duplicate-note-title');
  const conflictNoteTotal = titleConflicts.reduce((sum, c) => sum + c.detail.notes.length, 0);

  assert.strictEqual(bucketTotal + conflictNoteTotal, 2, 'no note may vanish or double-count');
  assert.strictEqual(titleConflicts.length, 1);
  assert.strictEqual(titleConflicts[0].detail.notes.length, 2);
  // Ambiguous data must not be silently matched: the inventory entry finds no note.
  assert.strictEqual(d.unchanged.length, 0);
  assert.strictEqual(d.relocated.length, 0);
  assert.strictEqual(d.created.length, 1);
});

test('two inventory rows, same name and herkunft, different ort: reported as a conflict, no colliding title', () => {
  const d = diffLibrary([inv('z', 'eigen', '/a'), inv('z', 'eigen', '/b')], []);
  assert.strictEqual(d.created.length, 0, 'ambiguous rows must not silently become two created stubs');
  const invConflicts = d.conflicts.filter((c) => c.kind === 'duplicate-inventory-entry');
  assert.strictEqual(invConflicts.length, 1);
  assert.strictEqual(invConflicts[0].detail.entries.length, 2);
  assert.strictEqual(invConflicts[0].detail.name, 'z');
  assert.strictEqual(invConflicts[0].detail.herkunft, 'eigen');
});

test('exact duplicate inventory rows (same name, herkunft AND ort) are deduplicated silently', () => {
  const d = diffLibrary([inv('z', 'eigen', '/a'), inv('z', 'eigen', '/a')], []);
  assert.strictEqual(d.created.length, 1);
  assert.strictEqual(d.conflicts.length, 0);
});

test('rename anchored on ort: same result for an inventory in either order', () => {
  const bareNote = [note('q', '', '/B')];
  const fwd = diffLibrary([inv('q', 'eigen', '/A'), inv('q', 'extern', '/B')], bareNote);
  const rev = diffLibrary([inv('q', 'extern', '/B'), inv('q', 'eigen', '/A')], bareNote);
  const expected = [{ from: 'Skill – q', to: 'Skill – q (extern)' }];
  assert.deepStrictEqual(fwd.renamed, expected);
  assert.deepStrictEqual(rev.renamed, expected);
});

test('rename with no ort match: deterministic by sorted herkunft, regardless of order', () => {
  const bareNote = [note('q', '', '/Z')]; // matches neither entry's ort
  const fwd = diffLibrary([inv('q', 'eigen', '/A'), inv('q', 'extern', '/B')], bareNote);
  const rev = diffLibrary([inv('q', 'extern', '/B'), inv('q', 'eigen', '/A')], bareNote);
  const expected = [{ from: 'Skill – q', to: 'Skill – q (eigen)' }]; // 'eigen' < 'extern'
  assert.deepStrictEqual(fwd.renamed, expected);
  assert.deepStrictEqual(rev.renamed, expected);
});

test('rename anchor: two entries sharing the note\'s ort still resolve deterministically by herkunft', () => {
  // Both 'eigen' and 'extern' report the same ort as the bare note (e.g. the
  // skill dir is reachable via two origins) -- a bare `.find()` would pick
  // whichever came first in the input array. The tie must break the same
  // way (sorted herkunft) in either order.
  const bareNote = [note('r', '', '/SAME')];
  const fwd = diffLibrary([inv('r', 'eigen', '/SAME'), inv('r', 'extern', '/SAME')], bareNote);
  const rev = diffLibrary([inv('r', 'extern', '/SAME'), inv('r', 'eigen', '/SAME')], bareNote);
  const expected = [{ from: 'Skill – r', to: 'Skill – r (eigen)' }]; // 'eigen' < 'extern'
  assert.deepStrictEqual(fwd.renamed, expected);
  assert.deepStrictEqual(rev.renamed, expected);
});

test('a single-origin entry must not claim a note carrying a different origin suffix', () => {
  const d = diffLibrary([inv('x', 'eigen', '/a')], [note('x', 'extern', '/b')]);
  assert.strictEqual(d.created.length, 1, 'the eigen entry gets its own bare stub');
  assert.strictEqual(d.retired.length, 1, 'the stale extern-suffixed note is retired, not reused');
  assert.strictEqual(d.relocated.length, 0);
  assert.strictEqual(d.unchanged.length, 0);
});
