'use strict';
// Issue #91: renderNote wrote the frontmatter as a fixed list, so a relocate or
// a rename replaced the whole block above `## Notizen` -- any key the user had
// added, and any tag beyond the two generated ones, was gone with no conflict,
// no warning, exit 0. The `## Notizen` zone was already safe; this closes the
// half above it.
//
// The renderer OWNS a fixed set of keys and the `Claude/ClaudeCode` +
// `Skill/<herkunft>` tags -- those it regenerates, because they are derived
// from the inventory and a stale one has to be replaced (a relocate can change
// `herkunft`, and the old `Skill/*` tag must not survive). Everything else in
// that block belongs to the user and is carried through verbatim.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyPlan } = require('../scripts/cli.js');
const { renderNote } = require('../scripts/render.js');

process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-carry-home-'));

function fixture(notes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-carry-'));
  const vault = path.join(root, 'vault');
  const lib = path.join(vault, 'Library', 'Skill Library');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(vault, '_vault-autopilot-config.md'),
    ['```yaml', 'skill_library:', '  library_path: "Library/Skill Library"', '```'].join('\n'));
  for (const n of notes) fs.writeFileSync(path.join(lib, `${n.title}.md`), n.body);
  return { root, vault, lib };
}

// A note as the user actually keeps it: the generated block plus his own key
// and his own tag. Written by hand rather than via renderNote, because that is
// the situation -- renderNote cannot produce this today.
function handWritten({ herkunft = 'eigen', ort = '/old', extra = [], tags = [] } = {}) {
  return [
    '---',
    'title: "alpha"',
    'type: skill',
    'description: "d"',
    `herkunft: ${herkunft}`,
    `ort: "${ort}"`,
    'plugin: ""',
    'status: aktiv',
    'created: 2026-07-05 15:45',
    'last_modified: 2026-07-05 15:45',
    ...extra,
    'tags:',
    '  - Claude/ClaudeCode',
    `  - Skill/${herkunft}`,
    ...tags.map((t) => `  - ${t}`),
    '---',
    '',
    '# Skill – alpha',
    '',
    '## Notizen',
    '',
    'Handgeschrieben.',
    '',
  ].join('\n');
}

const RELOCATE = [{ name: 'alpha', herkunft: 'eigen', ort: '/new', plugin: '', description: 'd' }];

test('a user-added frontmatter key survives a relocate', () => {
  const f = fixture([{ title: 'Skill – alpha', body: handWritten({ extra: ['bewertung: 5'] }) }]);

  applyPlan(f.vault, { write: true, inventory: RELOCATE });

  const after = fs.readFileSync(path.join(f.lib, 'Skill – alpha.md'), 'utf8');
  assert.match(after, /^bewertung: 5$/m, 'the user key was dropped by the rewrite');
  assert.match(after, /ort: "\/new"/, 'the relocate itself must still happen');
});

test('a multi-line user value survives verbatim', () => {
  const extra = ['verwandt:', '  - "[[Skill – beta]]"', '  - "[[Skill – gamma]]"'];
  const f = fixture([{ title: 'Skill – alpha', body: handWritten({ extra }) }]);

  applyPlan(f.vault, { write: true, inventory: RELOCATE });

  const after = fs.readFileSync(path.join(f.lib, 'Skill – alpha.md'), 'utf8');
  assert.match(after, /verwandt:\n {2}- "\[\[Skill – beta\]\]"\n {2}- "\[\[Skill – gamma\]\]"/);
});

test('a user tag survives, and the generated tags stay', () => {
  const f = fixture([{ title: 'Skill – alpha', body: handWritten({ tags: ['OGC'] }) }]);

  applyPlan(f.vault, { write: true, inventory: RELOCATE });

  const after = fs.readFileSync(path.join(f.lib, 'Skill – alpha.md'), 'utf8');
  assert.match(after, /^ {2}- OGC$/m, 'the user tag was dropped');
  assert.match(after, /^ {2}- Claude\/ClaudeCode$/m);
  assert.match(after, /^ {2}- Skill\/eigen$/m);
});

// The renderer owns `Skill/*`: a relocate can change `herkunft`, and carrying
// the old tag through as if it were the user's would leave the note tagged with
// an origin it no longer has. Ownership is what makes carrying the REST safe.
test('a stale generated origin tag is replaced, not carried', () => {
  const f = fixture([{ title: 'Skill – alpha',
    body: handWritten({ herkunft: 'extern', tags: ['OGC'] }) }]);

  applyPlan(f.vault, { write: true,
    inventory: [{ name: 'alpha', herkunft: 'eigen', ort: '/new', plugin: '', description: 'd' }] });

  const after = fs.readFileSync(path.join(f.lib, 'Skill – alpha.md'), 'utf8');
  assert.match(after, /^ {2}- Skill\/eigen$/m);
  assert.ok(!/Skill\/extern/.test(after), 'the superseded origin tag must not survive');
  assert.match(after, /^ {2}- OGC$/m, 'the user tag must still survive');
});

// 162 notes in the real library carry nothing extra. If this change rewrote
// them differently it would produce a diff on every one of them for no reason.
test('a note with nothing extra renders byte-identical to before', () => {
  const entry = {
    name: 'alpha', suffix: '', description: 'd', herkunft: 'eigen', ort: '/new',
    plugin: '', status: 'aktiv', created: '2026-07-05 15:45', lastModified: '2026-07-05 15:45',
  };
  const withoutCarry = renderNote(entry, '');
  const withEmptyCarry = renderNote(entry, '', { extraBlocks: [], userTags: [] });
  assert.strictEqual(withEmptyCarry, withoutCarry);
});

test('a second run changes nothing (idempotent)', () => {
  const f = fixture([{ title: 'Skill – alpha',
    body: handWritten({ extra: ['bewertung: 5'], tags: ['OGC'] }) }]);
  const inv = [{ name: 'alpha', herkunft: 'eigen', ort: '/new', plugin: '', description: 'd' }];

  applyPlan(f.vault, { write: true, inventory: inv, now: new Date('2026-09-01T10:00:00Z') });
  const first = fs.readFileSync(path.join(f.lib, 'Skill – alpha.md'), 'utf8');
  applyPlan(f.vault, { write: true, inventory: inv, now: new Date('2026-09-01T10:00:00Z') });
  const second = fs.readFileSync(path.join(f.lib, 'Skill – alpha.md'), 'utf8');

  assert.strictEqual(second, first);
});

// The block splitter keys off a column-0 `key:` line, and a bare URL at column
// zero inside a multi-line value looks exactly like one (`https:` + the rest).
// It is therefore split into a block of its own -- which is harmless ONLY
// because blocks are emitted in order and carried as lines, never
// re-serialised. Pinned, because the day someone re-serialises instead of
// carrying, this note quietly changes shape.
test('a value the splitter misreads as a key still survives in order', () => {
  const extra = ['quelle:', '  gefunden bei:', 'https://example.com/a', '  ende: ja'];
  const f = fixture([{ title: 'Skill \u2013 alpha', body: handWritten({ extra }) }]);

  applyPlan(f.vault, { write: true, inventory: RELOCATE });

  const after = fs.readFileSync(path.join(f.lib, 'Skill \u2013 alpha.md'), 'utf8');
  assert.match(after, /quelle:\n {2}gefunden bei:\nhttps:\/\/example\.com\/a\n {2}ende: ja/);
});
