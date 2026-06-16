'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cleanPath } = require('../scripts/clean.js');

function tmpVault() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'apc-'));
}

// Note on fixtures: rules.js carries a mass-deletion backstop (abort if a run
// drops > 25% of a note's non-whitespace chars). Bare one-liners like
// "## **Title**\n" lose 4 asterisks out of 11 non-whitespace chars (36%) and
// trip that guard. Real notes have body text, so fixtures carry a short neutral
// body line to stay in the guard's realistic operating range. The assertion
// intent is unchanged: the bold/asterisk heading is unwrapped to a plain heading.

test('dry-run does not modify the file', () => {
  const dir = tmpVault();
  const f = path.join(dir, 'note.md');
  fs.writeFileSync(f, '## **Title**\nbody x   \n', 'utf8');
  const before = fs.readFileSync(f, 'utf8');
  const res = cleanPath(f, { write: false });
  assert.equal(fs.readFileSync(f, 'utf8'), before, 'dry-run must not write');
  assert.equal(res.files.length, 1);
  assert.equal(res.files[0].changed, true);
});

test('--write applies the transforms', () => {
  const dir = tmpVault();
  const f = path.join(dir, 'note.md');
  fs.writeFileSync(f, '## **Title**\nbody text here\n', 'utf8');
  cleanPath(f, { write: true });
  assert.equal(fs.readFileSync(f, 'utf8'), '## Title\nbody text here\n');
});

test('cleanText helper returns cleaned content for diffing', () => {
  const { cleanText } = require('../scripts/clean.js');
  assert.equal(cleanText('## **Title**\nbody text here'), '## Title\nbody text here');
});
