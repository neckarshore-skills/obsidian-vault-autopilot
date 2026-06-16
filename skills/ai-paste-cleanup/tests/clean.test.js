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

test('folder mode walks *.md only and skips excluded dirs', () => {
  const dir = tmpVault();
  fs.writeFileSync(path.join(dir, 'a.md'), '## **A**\nbody text here\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'b.txt'), '## **B**\nbody text here\n', 'utf8'); // not .md
  fs.mkdirSync(path.join(dir, '_trash'));
  fs.writeFileSync(path.join(dir, '_trash', 'c.md'), '## **C**\nbody text here\n', 'utf8'); // skipped
  const res = cleanPath(dir, { write: false });
  const seen = res.files.map((f) => path.basename(f.path)).sort();
  assert.deepEqual(seen, ['a.md']);
});

test('guard violation: a throwing transform writes NO file (no partial write)', () => {
  const dir = tmpVault();
  const a = path.join(dir, 'a.md');
  const b = path.join(dir, 'b.md');
  fs.writeFileSync(a, '## **A**\nbody text here\n', 'utf8');
  fs.writeFileSync(b, '## **B**\nbody text here\n', 'utf8');
  const beforeA = fs.readFileSync(a, 'utf8');
  const beforeB = fs.readFileSync(b, 'utf8');
  // Inject a transform that throws on the 2nd file. plan-then-write transforms
  // ALL targets before writing ANY, so the throw must abort before any write.
  let n = 0;
  const transform = () => { if (++n === 2) throw new Error('boom'); return { text: 'x', perRule: {}, changed: true }; };
  assert.throws(() => cleanPath(dir, { write: true, transform }));
  assert.equal(fs.readFileSync(a, 'utf8'), beforeA, 'file a must be untouched');
  assert.equal(fs.readFileSync(b, 'utf8'), beforeB, 'file b must be untouched');
});

test('folder --write applies planned changes to changed files only', () => {
  const dir = tmpVault();
  const f = path.join(dir, 'x.md');
  fs.writeFileSync(f, '## **Title**\nbody text here\n', 'utf8');
  const plan = cleanPath(dir, { write: false });
  assert.equal(plan.files[0].changed, true);
  cleanPath(dir, { write: true });
  assert.equal(fs.readFileSync(f, 'utf8'), '## Title\nbody text here\n');
});
