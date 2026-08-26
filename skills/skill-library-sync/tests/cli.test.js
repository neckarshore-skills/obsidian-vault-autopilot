'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readLibrary, renderPreview } = require('../scripts/cli.js');
const { renderNote } = require('../scripts/render.js');

function libraryWith(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-lib-'));
  for (const e of entries) {
    const sub = path.join(dir, e.folder || '');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, `${e.title}.md`), renderNote(e, ''));
  }
  return dir;
}

const ENTRY = {
  name: 'a', suffix: 'eigen', description: 'd', herkunft: 'eigen',
  ort: '/a', plugin: '', status: 'aktiv',
  created: '2026-08-26 17:00', lastModified: '2026-08-26 17:00',
  title: 'Skill – a (eigen)', folder: 'Eigene Skills',
};

test('readLibrary finds notes in subfolders and skips underscore files', () => {
  const dir = libraryWith([ENTRY]);
  fs.writeFileSync(path.join(dir, '_Skill Library.md'), '# index\n');
  const notes = readLibrary(dir);
  assert.strictEqual(notes.length, 1);
  assert.strictEqual(notes[0].name, 'a');
  assert.strictEqual(notes[0].suffix, 'eigen');
});

test('readLibrary carries the notes zone through', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-lib2-'));
  fs.writeFileSync(path.join(dir, 'Skill – b.md'),
    renderNote({ ...ENTRY, name: 'b', suffix: '' }, '\n\nEigener Text.\n'));
  assert.match(readLibrary(dir)[0].notesZone, /Eigener Text/);
});

test('the preview names every bucket with a count, zeros included', () => {
  const text = renderPreview({
    created: [], relocated: [], retired: [], unchanged: [1, 2], renamed: [], conflicts: [],
  });
  // The preview pads its labels into a column, so the assertion must tolerate
  // the padding rather than pin the exact spacing of a cosmetic choice.
  assert.match(text, /created:\s+0/);
  assert.match(text, /retired:\s+0/);
  assert.match(text, /unchanged:\s+2/);
  assert.match(text, /conflicts:\s+0/);
});

// RULING 1: conflicts is a fifth bucket, and the preview must name each
// conflict on its own line the way it already names creations/retirements --
// this is the one channel built to surface ambiguous data, so hiding it in
// the preview would be invisible at the exact moment a human decides
// whether to write.
test('the preview counts conflicts and names each one', () => {
  const text = renderPreview({
    created: [], relocated: [], retired: [], unchanged: [], renamed: [],
    conflicts: [
      { kind: 'duplicate-note-title', detail: { title: 'Skill – x', notes: [{}, {}] } },
      {
        kind: 'duplicate-inventory-entry',
        detail: { name: 'y', herkunft: 'eigen', entries: [{ ort: '/y1' }, { ort: '/y2' }] },
      },
    ],
  });
  assert.match(text, /conflicts:\s+2/);
  assert.match(text, /duplicate-note-title.*Skill – x/);
  assert.match(text, /duplicate-inventory-entry.*y/);
});

// RULING 2: a CRLF-authored note must still yield its frontmatter, because
// a missing `ort` would make downstream classify it as needing rewrite on
// every run, forever.
test('readLibrary reads a CRLF note\'s ort', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-lib-crlf-'));
  const note = renderNote({ ...ENTRY, name: 'c', suffix: '' }, '\n\nText.\n');
  fs.writeFileSync(path.join(dir, 'Skill – c.md'), note.replace(/\n/g, '\r\n'));
  const notes = readLibrary(dir);
  assert.strictEqual(notes.length, 1);
  assert.strictEqual(notes[0].frontmatter.ort, '/a');
});

// Fix-round-1, Important: a missing library directory is a legitimate
// state (the config may point at a folder that does not exist yet), so it
// must degrade to an empty note list like every other reader in this
// skill -- not throw a raw stack trace out of a read-only command.
test('readLibrary on a missing directory returns an empty list, not a throw', () => {
  const missing = path.join(os.tmpdir(), 'sls-lib-does-not-exist-' + Date.now());
  assert.doesNotThrow(() => readLibrary(missing));
  assert.deepStrictEqual(readLibrary(missing), []);
});

// Companion: any OTHER filesystem error (here: the "directory" is actually
// a file, so readdirSync fails with ENOTDIR, not ENOENT) must still throw,
// naming the directory, per the readLibrary/skillsIn/loadConfig convention
// of ENOENT-only silence.
test('readLibrary throws (naming the path) when the library path is not a directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-lib-notdir-'));
  const notADir = path.join(dir, 'not-a-directory');
  fs.writeFileSync(notADir, 'x');
  assert.throws(() => readLibrary(notADir), (err) => err.message.includes(notADir));
});
