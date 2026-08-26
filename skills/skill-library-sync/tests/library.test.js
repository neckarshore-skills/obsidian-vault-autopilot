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

test('a quoted value containing " and \\ round-trips correctly', () => {
  const text = '---\ndescription: "Trigger phrases - \\"find duplicate photos\\", \\"dedupe\\""\n---\n\n# Test\n';
  const parsed = parseNote(text);
  assert.strictEqual(parsed.frontmatter.description, 'Trigger phrases - "find duplicate photos", "dedupe"');
});

test('an unquoted value keeps its backslashes verbatim', () => {
  const text = '---\nraw: C:\\Users\\x\\file\n---\n\n# Test\n';
  const parsed = parseNote(text);
  assert.strictEqual(parsed.frontmatter.raw, 'C:\\Users\\x\\file');
});

// RULING 2: a note authored with Windows line endings must still parse its
// frontmatter -- the Unix-only regex silently returns NO frontmatter for a
// CRLF file, which downstream reads as a missing `ort` and classifies the
// note for rewrite on every single run, forever.
test('a CRLF-authored note yields its frontmatter', () => {
  const text = NOTE.replace(/\n/g, '\r\n');
  const parsed = parseNote(text);
  assert.strictEqual(parsed.frontmatter.title, 'note-rename');
  assert.strictEqual(parsed.frontmatter.herkunft, 'eigen');
  assert.strictEqual(parsed.hasNotesHeading, true);
});

// Fix-round-1, Critical: the notesZone belongs to the user and the design
// promises never to rewrite it -- so for a CRLF-authored note it must come
// back with ITS OWN \r\n line endings, byte-identical to the zone as it
// sits in the file, not silently converted to LF by the parser.
test('a CRLF-authored note keeps CRLF line endings in its notesZone', () => {
  const lfParsed = parseNote(NOTE);
  const expectedZone = lfParsed.notesZone.replace(/\n/g, '\r\n');
  const crlfParsed = parseNote(NOTE.replace(/\n/g, '\r\n'));
  assert.strictEqual(crlfParsed.notesZone, expectedZone);
  assert.match(crlfParsed.notesZone, /\r\n/);
});

// Companion to the above: the fix must not introduce CRLF where the
// source had none -- an LF note's notesZone stays pure LF.
test('an LF-authored note keeps LF line endings in its notesZone', () => {
  const parsed = parseNote(NOTE);
  assert.doesNotMatch(parsed.notesZone, /\r/);
});

// A note whose frontmatter block is CRLF but whose body/notes-zone is LF
// (plausible: a Windows editor touched only the frontmatter, or the file
// was partially normalised by some other tool). Each region must come back
// in exactly the line ending it had in the source -- neither region may
// borrow the other's.
test('a mixed-ending note keeps each region in its own line ending', () => {
  const mixed = '---\r\ntitle: mixed\r\nherkunft: eigen\r\n---\n\n'
    + '# Skill – mixed (eigen)\n\n' + `${NOTES_HEADING}\n\nMixed body, LF only.\n`;
  const parsed = parseNote(mixed);
  assert.strictEqual(parsed.frontmatter.title, 'mixed');
  assert.strictEqual(parsed.frontmatter.herkunft, 'eigen');
  assert.doesNotMatch(parsed.notesZone, /\r/);
  assert.match(parsed.notesZone, /Mixed body, LF only\./);
});
