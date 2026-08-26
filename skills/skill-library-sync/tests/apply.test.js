'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyPlan } = require('../scripts/cli.js');
const { renderNote } = require('../scripts/render.js');

function vaultFixture({ ownSkills = ['alpha'], notes = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-apply-'));
  const vault = path.join(root, 'vault');
  const lib = path.join(vault, 'Library', 'Skill Library');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(vault, '_vault-autopilot-config.md'),
    ['```yaml', 'skill_library:', '  library_path: "Library/Skill Library"', '```'].join('\n'));
  for (const n of notes) fs.writeFileSync(path.join(lib, `${n.title}.md`), n.body);
  return { root, vault, lib };
}

test('without --write nothing is written', () => {
  const f = vaultFixture();
  const before = fs.readdirSync(f.lib);
  applyPlan(f.vault, { write: false, inventory: [{ name: 'x', herkunft: 'eigen', ort: '/x', plugin: '', description: 'd' }] });
  assert.deepStrictEqual(fs.readdirSync(f.lib), before);
});

test('a relocated note keeps its created value and its birthtime', () => {
  const body = renderNote({
    name: 'alpha', suffix: '', description: 'd', herkunft: 'eigen', ort: '/old',
    plugin: '', status: 'aktiv', created: '2026-07-05 15:45', lastModified: '2026-07-05 15:45',
  }, '');
  const f = vaultFixture({ notes: [{ title: 'Skill – alpha', body }] });
  const file = path.join(f.lib, 'Skill – alpha.md');
  const birthBefore = fs.statSync(file).birthtimeMs;

  applyPlan(f.vault, { write: true, inventory: [{ name: 'alpha', herkunft: 'eigen', ort: '/new', plugin: '', description: 'd' }] });

  const after = fs.readFileSync(file, 'utf8');
  assert.match(after, /ort: "\/new"/);
  assert.match(after, /created: 2026-07-05 15:45/);
  assert.strictEqual(fs.statSync(file).birthtimeMs, birthBefore);
});

test('a hand-written notes zone survives the rewrite verbatim', () => {
  const body = renderNote({
    name: 'alpha', suffix: '', description: 'd', herkunft: 'eigen', ort: '/old',
    plugin: '', status: 'aktiv', created: '2026-07-05 15:45', lastModified: '2026-07-05 15:45',
  }, '\n\nLaeuft nur auf dem M2.\n');
  const f = vaultFixture({ notes: [{ title: 'Skill – alpha', body }] });

  applyPlan(f.vault, { write: true, inventory: [{ name: 'alpha', herkunft: 'eigen', ort: '/new', plugin: '', description: 'd' }] });

  assert.match(fs.readFileSync(path.join(f.lib, 'Skill – alpha.md'), 'utf8'), /Laeuft nur auf dem M2\./);
});

test('a retired note moves and flips status, and is never deleted', () => {
  const body = renderNote({
    name: 'gone', suffix: '', description: 'd', herkunft: 'extern', ort: '/gone',
    plugin: '', status: 'referenz', created: '2026-07-05 15:45', lastModified: '2026-07-05 15:45',
  }, '');
  const f = vaultFixture({ notes: [{ title: 'Skill – gone', body }] });

  applyPlan(f.vault, { write: true, inventory: [{ name: 'alpha', herkunft: 'eigen', ort: '/keep', plugin: '', description: 'd' }] });

  assert.ok(!fs.existsSync(path.join(f.lib, 'Skill – gone.md')));
  const moved = path.join(f.lib, 'Entfallen', 'Skill – gone.md');
  assert.ok(fs.existsSync(moved));
  const text = fs.readFileSync(moved, 'utf8');
  assert.match(text, /status: entfallen/);
  assert.match(text, /entfallen_am: \d{4}-\d{2}-\d{2}/);
});

test('a renamed note is moved to its new title, not recreated beside the old one', () => {
  const body = renderNote({
    name: 'twin', suffix: '', description: 'd', herkunft: 'eigen', ort: '/own',
    plugin: '', status: 'aktiv', created: '2026-07-05 15:45', lastModified: '2026-07-05 15:45',
  }, '\n\nEigener Text.\n');
  const f = vaultFixture({ notes: [{ title: 'Skill – twin', body }] });

  applyPlan(f.vault, { write: true, inventory: [
    { name: 'twin', herkunft: 'eigen', ort: '/own', plugin: '', description: 'd' },
    { name: 'twin', herkunft: 'extern', ort: '/plugin', plugin: 'p@1', description: 'd' },
  ] });

  assert.ok(!fs.existsSync(path.join(f.lib, 'Skill – twin.md')), 'old title survived');
  const renamed = path.join(f.lib, 'Eigene Skills', 'Skill – twin (eigen).md');
  assert.ok(fs.existsSync(renamed), 'renamed note missing');
  assert.match(fs.readFileSync(renamed, 'utf8'), /Eigener Text\./, 'user prose lost in the rename');
  assert.match(fs.readFileSync(renamed, 'utf8'), /created: 2026-07-05 15:45/, 'creation date lost');
});

test('a plan over the mass-change ceiling refuses and writes nothing', () => {
  const f = vaultFixture();
  const inventory = Array.from({ length: 200 }, (_, i) =>
    ({ name: `s${i}`, herkunft: 'eigen', ort: `/s${i}`, plugin: '', description: 'd' }));
  assert.throws(() => applyPlan(f.vault, { write: true, inventory, max: 50 }), /Mass-change guard/);
  assert.deepStrictEqual(fs.readdirSync(f.lib), []);
});

// CARRIED RULING 1: an empty inventory must never be treated as "everything
// retired". A corrupt/misconfigured source that yields zero skills sits
// under the mass-change ceiling with any realistic library size (161 < 200),
// so the ceiling alone does not save it -- applyPlan must refuse on its own,
// before a single byte is written, whatever caused the empty inventory.
test('an empty inventory refuses outright, even under the mass-change ceiling', () => {
  const body = renderNote({
    name: 'solo', suffix: '', description: 'd', herkunft: 'eigen', ort: '/solo',
    plugin: '', status: 'aktiv', created: '2026-07-05 15:45', lastModified: '2026-07-05 15:45',
  }, '');
  const f = vaultFixture({ notes: [{ title: 'Skill – solo', body }] });

  assert.throws(
    () => applyPlan(f.vault, { write: true, inventory: [] }),
    /empty inventory/i,
  );
  assert.ok(fs.existsSync(path.join(f.lib, 'Skill – solo.md')), 'note was moved despite the refusal');
  assert.ok(!fs.existsSync(path.join(f.lib, 'Entfallen')), 'retired folder created despite the refusal');
});

test('an empty inventory refuses even in preview (write: false)', () => {
  const f = vaultFixture();
  assert.throws(
    () => applyPlan(f.vault, { write: false, inventory: [] }),
    /empty inventory/i,
  );
});

// CARRIED RULING 2: a note caught in a conflict is excluded from every
// action bucket by diffLibrary already -- this test proves that guarantee
// holds all the way through the write path (never written, moved, or
// renamed), and that the conflict is visible on the returned result so a
// report can name it. Two files in different subfolders that both derive
// the SAME note title ("Skill – dup") produce a genuine
// duplicate-note-title conflict -- readLibrary's title comes from the
// filename alone, not the folder, so this collides exactly like two real
// notes a user (or an earlier bug) left with the same name in two places.
test('a note in a conflict is neither written, moved, nor renamed', () => {
  const bodyA = renderNote({
    name: 'dup', suffix: '', description: 'first', herkunft: 'eigen', ort: '/dup-a',
    plugin: '', status: 'aktiv', created: '2026-07-05 15:45', lastModified: '2026-07-05 15:45',
  }, '\n\nErste Kopie.\n');
  const bodyB = renderNote({
    name: 'dup', suffix: '', description: 'second', herkunft: 'extern', ort: '/dup-b',
    plugin: '', status: 'referenz', created: '2026-07-06 09:00', lastModified: '2026-07-06 09:00',
  }, '\n\nZweite Kopie.\n');
  const f = vaultFixture();
  const dirA = path.join(f.lib, 'Eigene Skills');
  const dirB = path.join(f.lib, 'Externe Plugins');
  fs.mkdirSync(dirA, { recursive: true });
  fs.mkdirSync(dirB, { recursive: true });
  const fileA = path.join(dirA, 'Skill – dup.md');
  const fileB = path.join(dirB, 'Skill – dup.md');
  fs.writeFileSync(fileA, bodyA);
  fs.writeFileSync(fileB, bodyB);
  const beforeA = fs.readFileSync(fileA, 'utf8');
  const beforeB = fs.readFileSync(fileB, 'utf8');

  // Deliberately no inventory row for 'dup': the point of this test is the
  // note-side conflict alone. An inventory row that happened to target the
  // same folder+title as a conflicted note would be a second, unrelated way
  // to collide -- excluded here so the assertion isolates the one guarantee
  // under test.
  const result = applyPlan(f.vault, { write: true, inventory: [
    { name: 'other', herkunft: 'eigen', ort: '/other', plugin: '', description: 'd' },
  ] });

  assert.strictEqual(fs.readFileSync(fileA, 'utf8'), beforeA, 'a conflicted note must not be rewritten');
  assert.strictEqual(fs.readFileSync(fileB, 'utf8'), beforeB, 'a conflicted note must not be rewritten');
  assert.ok(!fs.existsSync(path.join(f.lib, 'Entfallen', 'Skill – dup.md')), 'a conflicted note must not be retired');
  assert.ok(Array.isArray(result.conflicts), 'result must carry the conflicts array');
  assert.strictEqual(result.conflicts.length, 1);
  assert.strictEqual(result.conflicts[0].kind, 'duplicate-note-title');
  assert.strictEqual(result.conflicts[0].detail.title, 'Skill – dup');
});

// CARRIED RULING 3: parseNote now returns notesZone byte-identical to the
// file, CRLF included. A user who authored their own prose in an editor
// that writes CRLF must get that prose back byte-for-byte after the
// machine zone above it is rewritten -- not silently normalised to LF.
test('a CRLF-authored note\'s hand-written prose survives the rewrite byte-for-byte', () => {
  const zone = '\n\nEigener Text mit Sonderzeichen: ä ö ü, geschrieben unter Windows.\n';
  const lfBody = renderNote({
    name: 'crlf', suffix: '', description: 'd', herkunft: 'eigen', ort: '/old',
    plugin: '', status: 'aktiv', created: '2026-07-05 15:45', lastModified: '2026-07-05 15:45',
  }, zone);
  const crlfBody = lfBody.replace(/\n/g, '\r\n');
  const f = vaultFixture({ notes: [{ title: 'Skill – crlf', body: crlfBody }] });
  const file = path.join(f.lib, 'Skill – crlf.md');
  const expectedZone = zone.replace(/\n/g, '\r\n');

  applyPlan(f.vault, { write: true, inventory: [{ name: 'crlf', herkunft: 'eigen', ort: '/new', plugin: '', description: 'd' }] });

  const after = fs.readFileSync(file, 'utf8');
  assert.match(after, /ort: "\/new"/, 'machine zone was not rewritten');
  assert.ok(after.endsWith(expectedZone), 'the CRLF prose zone was not byte-identical after the rewrite');
});
