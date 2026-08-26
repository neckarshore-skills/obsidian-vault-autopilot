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

// --- Fix round 1: reviewer-measured Criticals, Importants, Minors ---

// CRITICAL 1: readLibrary must never re-read a note already inside the
// retired subfolder as a live library note -- otherwise a second run
// classifies it `retired` again, with a move target identical to its
// source, and the (pre-fix) move loop's unconditional rmSync deleted it.
// Reproduces the reviewer's own measurement: run1 retires it, run2 must
// leave it exactly where run1 put it.
test('a second consecutive apply leaves every already-retired note in place', () => {
  const body = renderNote({
    name: 'gone', suffix: '', description: 'd', herkunft: 'extern', ort: '/gone',
    plugin: '', status: 'referenz', created: '2026-07-05 15:45', lastModified: '2026-07-05 15:45',
  }, '');
  const f = vaultFixture({ notes: [{ title: 'Skill – gone', body }] });
  const inventory = [{ name: 'keep', herkunft: 'eigen', ort: '/keep', plugin: '', description: 'd' }];

  const run1 = applyPlan(f.vault, { write: true, inventory });
  const retiredFile = path.join(f.lib, 'Entfallen', 'Skill – gone.md');
  assert.ok(fs.existsSync(retiredFile), 'run1 must retire the note');
  const afterRun1 = fs.readFileSync(retiredFile, 'utf8');

  const run2 = applyPlan(f.vault, { write: true, inventory });

  assert.ok(fs.existsSync(retiredFile), 'run2 deleted a note run1 had already retired');
  assert.strictEqual(fs.readFileSync(retiredFile, 'utf8'), afterRun1, 'run2 must not rewrite an already-retired note');
  assert.strictEqual(run2.moved.length, 0, 'run2 must not classify the tombstone for retirement again');
  assert.deepStrictEqual(fs.readdirSync(path.join(f.lib, 'Entfallen')), ['Skill – gone.md']);
});

// CRITICAL 2: a `created` entry's target is computed from folder + title
// with no existence check. Two files in different subfolders that both
// derive the title "Skill – dup" collide as a duplicate-note-title
// conflict (excluded from `notes`/`cleanNotes`), but an inventory row for
// the SAME name+herkunft then finds no note and falls into `created` --
// landing on one of the two conflicted files. Reproduces the reviewer's
// exact fixture: two same-named notes plus a matching inventory entry.
test('a created note must never overwrite a conflicted note holding the user\'s prose', () => {
  const bodyA = renderNote({
    name: 'dup', suffix: '', description: 'first', herkunft: 'eigen', ort: '/dup-a',
    plugin: '', status: 'aktiv', created: '2026-07-05 15:45', lastModified: '2026-07-05 15:45',
  }, '\n\nErste Kopie, meine eigene Notiz.\n');
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

  // The inventory entry that would, absent the guard, be classified
  // `created` and land its write on fileA's exact path.
  const result = applyPlan(f.vault, { write: true, inventory: [
    { name: 'dup', herkunft: 'eigen', ort: '/dup-a', plugin: '', description: 'first' },
  ] });

  assert.match(fs.readFileSync(fileA, 'utf8'), /Erste Kopie, meine eigene Notiz\./, 'the user\'s prose must survive');
  assert.strictEqual(result.created.includes(fileA), false, 'nothing may be written to an occupied target');
  const occupied = result.conflicts.find((c) => c.kind === 'target-occupied');
  assert.ok(occupied, 'the skipped create must be reported as a conflict');
  assert.strictEqual(occupied.detail.title, 'Skill – dup');
  assert.strictEqual(occupied.detail.path, fileA);
});

// CRITICAL 3: DEFAULTS.libraryPath is '', so path.join(vault, '') is the
// vault root. Harmless for read-only scan/diff; not harmless once apply
// writes -- a note outside the library could be moved, and folders created,
// at the vault root. Write mode must refuse, naming which of the two causes
// applies; preview mode may still run but must say so plainly.
test('apply --write refuses when no library_path is configured', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-apply-nopath-'));
  const vault = path.join(root, 'vault');
  fs.mkdirSync(vault, { recursive: true });
  // Deliberately no _vault-autopilot-config.md at all -> DEFAULTS.libraryPath === ''.
  assert.throws(
    () => applyPlan(vault, { write: true, inventory: [{ name: 'x', herkunft: 'eigen', ort: '/x', plugin: '', description: 'd' }] }),
    /no library_path is configured/i,
  );
});

test('apply --write refuses when the configured library directory does not exist', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-apply-missingdir-'));
  const vault = path.join(root, 'vault');
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, '_vault-autopilot-config.md'),
    ['```yaml', 'skill_library:', '  library_path: "Library/Skill Library"', '```'].join('\n'));
  // The configured path is never created on disk.
  assert.throws(
    () => applyPlan(vault, { write: true, inventory: [{ name: 'x', herkunft: 'eigen', ort: '/x', plugin: '', description: 'd' }] }),
    /does not exist/i,
  );
});

test('preview mode still runs with no library_path configured, and says so', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-apply-nopath-preview-'));
  const vault = path.join(root, 'vault');
  fs.mkdirSync(vault, { recursive: true });
  const result = applyPlan(vault, { write: false, inventory: [{ name: 'x', herkunft: 'eigen', ort: '/x', plugin: '', description: 'd' }] });
  assert.match(result.libraryPathWarning || '', /no library_path is configured/i);
});

// IMPORTANT 1: the shared mass-change ceiling (200) sits above the entire
// 161-note library, so a plan retiring ALL of them sails through it, and
// EmptyInventoryError only covers the zero-inventory cause of a mass
// retirement. `retired` gets its own library-relative cap (25% of notes
// read, floor 10). A real run against the user's library retires 29 of 161
// (18%) and must still pass.
function libraryOf(n, retiredNames) {
  const f = vaultFixture();
  const notesToWrite = [];
  for (let i = 0; i < n; i += 1) {
    const name = `s${i}`;
    notesToWrite.push({
      title: `Skill – ${name}`,
      body: renderNote({
        name, suffix: '', description: 'd', herkunft: 'eigen', ort: `/${name}`,
        plugin: '', status: 'aktiv', created: '2026-07-05 15:45', lastModified: '2026-07-05 15:45',
      }, ''),
    });
  }
  for (const n2 of notesToWrite) fs.writeFileSync(path.join(f.lib, `${n2.title}.md`), n2.body);
  const inventory = [];
  for (let i = 0; i < n; i += 1) {
    if (retiredNames.has(`s${i}`)) continue; // absent from inventory -> retired
    inventory.push({ name: `s${i}`, herkunft: 'eigen', ort: `/s${i}`, plugin: '', description: 'd' });
  }
  return { f, inventory };
}

test('retiring 29 of 161 notes (18%) passes the retire-specific cap', () => {
  const retiredNames = new Set(Array.from({ length: 29 }, (_, i) => `s${i}`));
  const { f, inventory } = libraryOf(161, retiredNames);
  const result = applyPlan(f.vault, { write: true, inventory });
  assert.strictEqual(result.moved.length, 29);
});

test('retiring 100 of 161 notes refuses the retire-specific cap and writes nothing', () => {
  const retiredNames = new Set(Array.from({ length: 100 }, (_, i) => `s${i}`));
  const { f, inventory } = libraryOf(161, retiredNames);
  assert.throws(() => applyPlan(f.vault, { write: true, inventory }), /Retire guard/);
  assert.ok(!fs.existsSync(path.join(f.lib, 'Entfallen')), 'nothing may be written on refusal');
});

// M1 + M2: the retire path must go through the body boundary (parseNote),
// never a regex over the WHOLE raw file -- a user whose prose happens to
// contain a line starting with "status: " must not have it mangled. And the
// inserted entfallen_am line must match the file's OWN line ending, not
// always a bare LF.
test('retiring a note never touches the user\'s prose, even when it looks like frontmatter', () => {
  const zone = '\n\nMeine Notiz:\nstatus: mein eigener Status, kein YAML.\nlast_modified: das hier ist auch nur Text.\n';
  const body = renderNote({
    name: 'lookalike', suffix: '', description: 'd', herkunft: 'extern', ort: '/lookalike',
    plugin: '', status: 'referenz', created: '2026-07-05 15:45', lastModified: '2026-07-05 15:45',
  }, zone);
  const f = vaultFixture({ notes: [{ title: 'Skill – lookalike', body }] });

  applyPlan(f.vault, { write: true, inventory: [{ name: 'keep', herkunft: 'eigen', ort: '/keep', plugin: '', description: 'd' }] });

  const after = fs.readFileSync(path.join(f.lib, 'Entfallen', 'Skill – lookalike.md'), 'utf8');
  assert.match(after, /^status: entfallen$/m, 'the real frontmatter status must still flip');
  assert.match(after, /Meine Notiz:\nstatus: mein eigener Status, kein YAML\.\nlast_modified: das hier ist auch nur Text\.\n$/,
    'the user\'s prose lines must survive verbatim, even though they look like frontmatter keys');
});

test('the inserted entfallen_am line matches a CRLF file\'s own line ending', () => {
  const body = renderNote({
    name: 'crlfgone', suffix: '', description: 'd', herkunft: 'extern', ort: '/crlfgone',
    plugin: '', status: 'referenz', created: '2026-07-05 15:45', lastModified: '2026-07-05 15:45',
  }, '\n\nEigener Text.\n').replace(/\n/g, '\r\n');
  const f = vaultFixture({ notes: [{ title: 'Skill – crlfgone', body }] });

  applyPlan(f.vault, { write: true, inventory: [{ name: 'keep', herkunft: 'eigen', ort: '/keep', plugin: '', description: 'd' }] });

  const after = fs.readFileSync(path.join(f.lib, 'Entfallen', 'Skill – crlfgone.md'), 'utf8');
  assert.match(after, /last_modified: 2026-07-05 15:45\r\nentfallen_am: \d{4}-\d{2}-\d{2}\r\n/,
    'entfallen_am must be CRLF-joined in a CRLF file, not a bare LF');
});

// --- Fix round 2: reviewer-measured findings ---

// N1: the moves loop is the only write path with no occupancy check, and it
// is the one loop that both writes AND deletes. Reproduces the reviewer's
// exact three-run cycle: run 1 retires a note carrying the user's prose;
// run 2 the skill returns and a fresh stub is created back in the live
// folder; run 3 it retires again -- landing on the SAME tombstone path run 1
// already used. The prose must survive run 3, and the stub must stay
// exactly where it is (not silently deleted, not silently overwritten).
test('a note retiring for a second time onto an existing tombstone is refused, not overwritten', () => {
  const originalBody = renderNote({
    name: 'flappy', suffix: '', description: 'd', herkunft: 'eigen', ort: '/flappy',
    plugin: '', status: 'aktiv', created: '2026-07-01 09:00', lastModified: '2026-07-01 09:00',
  }, '\n\nEigene Notizen zu flappy, die niemals verloren gehen duerfen.\n');
  const f = vaultFixture({ notes: [{ title: 'Skill – flappy', body: originalBody }] });
  const tombstone = path.join(f.lib, 'Entfallen', 'Skill – flappy.md');
  const keepOnly = [{ name: 'keep', herkunft: 'eigen', ort: '/keep', plugin: '', description: 'd' }];
  const withFlappy = [
    { name: 'keep', herkunft: 'eigen', ort: '/keep', plugin: '', description: 'd' },
    { name: 'flappy', herkunft: 'eigen', ort: '/flappy-2', plugin: '', description: 'd' },
  ];

  // Run 1: flappy leaves -> retired, prose preserved in the tombstone.
  applyPlan(f.vault, { write: true, inventory: keepOnly });
  assert.ok(fs.existsSync(tombstone), 'run 1 must retire flappy');
  const tombstoneAfterRun1 = fs.readFileSync(tombstone, 'utf8');
  assert.match(tombstoneAfterRun1, /Eigene Notizen zu flappy/);

  // Run 2: flappy returns -> a fresh stub is created back in the live folder
  // (readLibrary excludes the retired subfolder, so nothing there is seen).
  applyPlan(f.vault, { write: true, inventory: withFlappy });
  const revivedStub = path.join(f.lib, 'Eigene Skills', 'Skill – flappy.md');
  assert.ok(fs.existsSync(revivedStub), 'run 2 must create a fresh stub for the returning skill');
  assert.strictEqual(fs.readFileSync(tombstone, 'utf8'), tombstoneAfterRun1, 'run 2 must not touch the existing tombstone');

  // Run 3: flappy leaves again -> would retire the stub onto the SAME
  // tombstone path. Must be refused, not overwritten.
  const result = applyPlan(f.vault, { write: true, inventory: keepOnly });

  assert.strictEqual(fs.readFileSync(tombstone, 'utf8'), tombstoneAfterRun1,
    'the original tombstone (and its prose) must survive run 3 untouched');
  assert.ok(fs.existsSync(revivedStub), 'the stub must stay exactly where it was, not be silently deleted');
  const occupied = result.conflicts.find((c) => c.kind === 'target-occupied');
  assert.ok(occupied, 'the refused retirement must be reported as a conflict');
  assert.strictEqual(occupied.detail.path, tombstone);
  assert.strictEqual(occupied.detail.from, revivedStub);
  assert.strictEqual(result.moved.includes(tombstone), false);
});

// N2: a duplicate-inventory-entry conflict must not block the SURVIVING
// valid row for the same name. splitInventoryConflicts removes the
// ambiguous rows before multiOriginNames runs, so a lone valid row for that
// name legitimately becomes single-origin (suffix '') and renders to the
// bare title -- blocking that title as "conflicted" dropped a legitimate
// create on every run and reported a target-occupied conflict for a path
// that never existed. Reproduces the reviewer's exact inventory.
test('a legitimate create survives a same-name duplicate-inventory-entry conflict', () => {
  const f = vaultFixture();
  const result = applyPlan(f.vault, { write: true, inventory: [
    { name: 'dup', herkunft: 'eigen', ort: '/a', plugin: '', description: 'd' },
    { name: 'dup', herkunft: 'eigen', ort: '/b', plugin: '', description: 'd' },
    { name: 'dup', herkunft: 'extern', ort: '/plugin', plugin: 'p@1', description: 'd' },
  ] });

  const expected = path.join(f.lib, 'Externe Plugins', 'Skill – dup.md');
  assert.ok(result.created.includes(expected), 'the valid (dup, extern) entry must be created');
  assert.ok(fs.existsSync(expected));
  const bogus = result.conflicts.find((c) => c.kind === 'target-occupied');
  assert.strictEqual(bogus, undefined, 'no target-occupied conflict may be reported for a path that was never occupied');
  const invConflict = result.conflicts.find((c) => c.kind === 'duplicate-inventory-entry');
  assert.ok(invConflict, 'the two ambiguous eigen rows must still be reported as a duplicate-inventory-entry conflict');
});

// N3: readLibrary only requires the FILENAME to match, so a note with no
// frontmatter at all -- or one missing last_modified -- is still readable.
// Moving such a note produced no status/entfallen_am stamp and nothing
// reported it. A note that cannot be correctly stamped must not be moved.
test('a note with no frontmatter at all is not retired, and is reported as unstampable', () => {
  const f = vaultFixture({ notes: [{
    title: 'Skill – nofrontmatter',
    body: `# Skill – nofrontmatter\n\n${'## Notizen'}\n\nEigener Text ohne Frontmatter.\n`,
  }] });
  const original = fs.readFileSync(path.join(f.lib, 'Skill – nofrontmatter.md'), 'utf8');

  const result = applyPlan(f.vault, { write: true, inventory: [{ name: 'keep', herkunft: 'eigen', ort: '/keep', plugin: '', description: 'd' }] });

  assert.ok(fs.existsSync(path.join(f.lib, 'Skill – nofrontmatter.md')), 'the note must stay in the live folder');
  assert.strictEqual(fs.readFileSync(path.join(f.lib, 'Skill – nofrontmatter.md'), 'utf8'), original);
  assert.ok(!fs.existsSync(path.join(f.lib, 'Entfallen', 'Skill – nofrontmatter.md')));
  const unstampable = result.conflicts.find((c) => c.kind === 'unstampable-note');
  assert.ok(unstampable, 'the skipped retirement must be reported');
  assert.strictEqual(unstampable.detail.missing, 'status');
});

test('a note missing last_modified is not retired, and names the missing field', () => {
  const body = [
    '---',
    'title: "partial"',
    'type: skill',
    'description: "d"',
    'herkunft: eigen',
    'ort: "/partial"',
    'plugin: ""',
    'status: aktiv',
    'created: 2026-07-05 15:45',
    'tags:',
    '  - Claude/ClaudeCode',
    '---',
    '',
    '# Skill – partial',
    '',
    '## Notizen',
    '',
  ].join('\n');
  const f = vaultFixture({ notes: [{ title: 'Skill – partial', body }] });

  const result = applyPlan(f.vault, { write: true, inventory: [{ name: 'keep', herkunft: 'eigen', ort: '/keep', plugin: '', description: 'd' }] });

  assert.ok(fs.existsSync(path.join(f.lib, 'Skill – partial.md')), 'the note must stay in the live folder');
  assert.ok(!fs.existsSync(path.join(f.lib, 'Entfallen', 'Skill – partial.md')));
  const unstampable = result.conflicts.find((c) => c.kind === 'unstampable-note');
  assert.ok(unstampable);
  assert.strictEqual(unstampable.detail.missing, 'last_modified');
});

// Small fix: retireCap must be an integer both in the comparison and in the
// user-facing message -- the number read must be the number applied.
test('the retire-cap refusal message reports an integer, not a fraction', () => {
  const retiredNames = new Set(Array.from({ length: 100 }, (_, i) => `s${i}`));
  const f = vaultFixture();
  for (let i = 0; i < 161; i += 1) {
    const name = `s${i}`;
    fs.writeFileSync(path.join(f.lib, `Skill – ${name}.md`), renderNote({
      name, suffix: '', description: 'd', herkunft: 'eigen', ort: `/${name}`,
      plugin: '', status: 'aktiv', created: '2026-07-05 15:45', lastModified: '2026-07-05 15:45',
    }, ''));
  }
  const inventory = [];
  for (let i = 0; i < 161; i += 1) {
    if (retiredNames.has(`s${i}`)) continue;
    inventory.push({ name: `s${i}`, herkunft: 'eigen', ort: `/s${i}`, plugin: '', description: 'd' });
  }
  try {
    applyPlan(f.vault, { write: true, inventory });
    assert.fail('expected a RetireCapError');
  } catch (err) {
    assert.match(err.message, /cap 40\b/, 'the reported cap must be floored (40, not 40.25)');
    assert.doesNotMatch(err.message, /40\.25/);
  }
});
