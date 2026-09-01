'use strict';
// Edge cases of the retirement point-check (issue #90). Kept in their own file
// because both of them turn on how a recorded `ort` is INTERPRETED, not on the
// classification around it.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyPlan, verifyRetirements } = require('../scripts/cli.js');
const { renderNote } = require('../scripts/render.js');

process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-edge-home-'));

const OTHER = [{ name: 'alpha', herkunft: 'eigen', ort: '/keep', plugin: '', description: 'd' }];

function note(name, ort) {
  return renderNote({
    name, suffix: '', description: 'd', herkunft: 'eigen', ort,
    plugin: '', status: 'aktiv', created: '2026-07-05 15:45', lastModified: '2026-07-05 15:45',
  }, '');
}

function fixture(notes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-edge-'));
  const vault = path.join(root, 'vault');
  const lib = path.join(vault, 'Library', 'Skill Library');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(vault, '_vault-autopilot-config.md'),
    ['```yaml', 'skill_library:', '  library_path: "Library/Skill Library"', '```'].join('\n'));
  for (const n of notes) fs.writeFileSync(path.join(lib, `${n.title}.md`), n.body);
  return { root, vault, lib };
}

// A path the filesystem refuses to even evaluate is not evidence that the skill
// is gone -- it is evidence that the question could not be asked. Two earlier
// versions of this branch were wrong in different ways: the first caught the
// throw and retired the note anyway (contradicting its own comment), the second
// used existsSync, which swallows EVERY error and returns false, so the catch
// could never fire at all.
//
// MEASURED, and the reason this is a unit test rather than an end-to-end one:
// such a path cannot reach verifyRetirements through a note. renderNote's YAML
// escaping plus parseNote's unescaping turn a NUL byte into a backslash on the
// round-trip, so the note path neutralises it. The branch is defensive, the
// function is exported, and its contract is tested where the contract lives.
test('verifyRetirements treats an unevaluable location as unverified', () => {
  const bad = `/tmp/broken${String.fromCharCode(0)}path`;
  const { verified, unverified } = verifyRetirements([
    { title: 'Skill – broken', hasFrontmatter: true, frontmatter: { ort: bad } },
  ]);

  assert.strictEqual(verified.length, 0, 'an unanswerable question must never become a retirement');
  assert.strictEqual(unverified.length, 1);
  assert.strictEqual(unverified[0].reason, 'unreadable-recorded-location');
});

// Notes are hand-editable, and a human writes `~/...`. config.js already owns
// the expansion; the check has to use it or every hand-written location reads
// as gone.
test('a tilde-prefixed recorded location is expanded before it is checked', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-tilde-home-'));
  const prev = process.env.HOME;
  process.env.HOME = home;
  try {
    const dir = path.join(home, 'skills', 'tilde-skill');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: tilde-skill\ndescription: d\n---\n');
    const f = fixture([{ title: 'Skill – tilde-skill', body: note('tilde-skill', '~/skills/tilde-skill') }]);

    const result = applyPlan(f.vault, { write: true, inventory: OTHER });

    assert.strictEqual(result.moved.length, 0);
    assert.strictEqual(result.unverified[0].reason, 'skill-still-at-recorded-location');
  } finally {
    process.env.HOME = prev;
  }
});
