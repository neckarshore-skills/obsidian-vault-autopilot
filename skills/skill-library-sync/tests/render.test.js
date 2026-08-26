'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { renderNote, renderIndex, noteTitle } = require('../scripts/render.js');
const { parseNote, STUB } = require('../scripts/library.js');

const ENTRY = {
  name: 'photo-dedup',
  suffix: 'org-plugin',
  description: 'Use when a photo library has near-duplicate images. Trigger phrases - "find duplicate photos", "dedupe my pictures", "near-duplicate photos".',
  herkunft: 'org-plugin',
  ort: '/Users/x/Developer/projects/neckarshore-skills/photo-autopilot/skills/photo-dedup',
  plugin: 'neckarshore-skills/photo-autopilot',
  status: 'aktiv',
  created: '2026-08-26 17:00',
  lastModified: '2026-08-26 17:00',
};

test('a rendered note round-trips through parseNote', () => {
  const parsed = parseNote(renderNote(ENTRY, ''));
  assert.strictEqual(parsed.frontmatter.title, 'photo-dedup');
  assert.strictEqual(parsed.frontmatter.herkunft, 'org-plugin');
  assert.strictEqual(parsed.frontmatter.description, ENTRY.description);
  assert.strictEqual(parsed.hasNotesHeading, true);
});

test('a title containing a colon round-trips correctly', () => {
  const entry = { ...ENTRY, name: 'skill:colon', suffix: '' };
  const parsed = parseNote(renderNote(entry, ''));
  assert.strictEqual(parsed.frontmatter.title, 'skill:colon');
});

test('the description is carried in full and never cut mid-word', () => {
  const out = renderNote(ENTRY, '');
  assert.ok(out.includes('near-duplicate photos".'), 'description was truncated');
});

test('a long description is cut on a word boundary with an ellipsis', () => {
  const long = { ...ENTRY, description: 'word '.repeat(200).trim() };
  const parsed = parseNote(renderNote(long, ''));
  const value = parsed.frontmatter.description;
  assert.ok(value.length <= 500, 'over the cap');
  assert.ok(value.endsWith('…'), 'no ellipsis');
  assert.doesNotMatch(value, /wor…$/, 'cut mid-word');
});

test('tags come last in the frontmatter', () => {
  const lines = renderNote(ENTRY, '').split('\n');
  const fmEnd = lines.indexOf('---', 1);
  assert.strictEqual(lines[fmEnd - 3], 'tags:');
});

test('a carried notes zone survives verbatim', () => {
  const zone = '\n\nDieser Skill laeuft nur auf dem M2.\n';
  assert.ok(renderNote(ENTRY, zone).endsWith(zone));
});

test('a new note gets the stub', () => {
  assert.ok(renderNote(ENTRY, '').includes(STUB));
});

test('noteTitle appends the origin suffix only when given', () => {
  assert.strictEqual(noteTitle({ name: 'x' }), 'Skill – x');
  assert.strictEqual(noteTitle({ name: 'x', suffix: 'eigen' }), 'Skill – x (eigen)');
});

test('renderIndex numbers rows 1..N with no gaps and sorts A to Z', () => {
  const md = renderIndex([
    { title: 'Skill – b', herkunft: 'eigen', status: 'aktiv', hint: '' },
    { title: 'Skill – a', herkunft: 'extern', status: 'referenz', hint: 'p@1' },
  ]);
  const rows = md.split('\n').filter((l) => /^\| \d+ \|/.test(l));
  assert.strictEqual(rows.length, 2);
  assert.match(rows[0], /^\| 1 \| \[\[Skill – a\]\]/);
  assert.match(rows[1], /^\| 2 \| \[\[Skill – b\]\]/);
});
