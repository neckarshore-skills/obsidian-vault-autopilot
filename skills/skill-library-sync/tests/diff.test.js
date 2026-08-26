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
