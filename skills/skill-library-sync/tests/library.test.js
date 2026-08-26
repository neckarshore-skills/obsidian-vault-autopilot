'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseNote, isReplaceableZone, STUB, NOTES_HEADING } = require('../scripts/library.js');

const NOTE = `---
title: note-rename
herkunft: eigen
status: aktiv
---

# Skill – note-rename (eigen)

**Zweck:** something

${NOTES_HEADING}

${STUB}
`;

test('parseNote splits frontmatter, machine body and notes zone', () => {
  const parsed = parseNote(NOTE);
  assert.strictEqual(parsed.frontmatter.title, 'note-rename');
  assert.strictEqual(parsed.frontmatter.herkunft, 'eigen');
  assert.strictEqual(parsed.hasNotesHeading, true);
  assert.match(parsed.machineBody, /\*\*Zweck:\*\* something/);
  assert.doesNotMatch(parsed.machineBody, /Notizen/);
  assert.strictEqual(parsed.notesZone.trim(), STUB);
});

test('the stub is replaceable', () => {
  assert.strictEqual(isReplaceableZone(`\n\n${STUB}\n`), true);
});

test('real prose is NOT replaceable', () => {
  const prose = '\n\nDieser Skill laeuft montags und schreibt in den Vault.\n';
  assert.strictEqual(isReplaceableZone(prose), false);
});

test('stub PLUS appended prose is NOT replaceable', () => {
  const mixed = `\n\n${STUB}\n\nSpaeter ergaenzt: laeuft nur auf dem M2.\n`;
  assert.strictEqual(isReplaceableZone(mixed), false);
});

test('an empty zone is replaceable', () => {
  assert.strictEqual(isReplaceableZone('\n\n'), true);
});

test('a note without the heading reports hasNotesHeading false and an empty zone', () => {
  const parsed = parseNote('---\ntitle: x\n---\n\n# Skill – x\n');
  assert.strictEqual(parsed.hasNotesHeading, false);
  assert.strictEqual(parsed.notesZone, '');
});
