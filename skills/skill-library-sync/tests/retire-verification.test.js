'use strict';
// The retire path must be able to tell "I looked there and it is gone" from
// "I was never told to look" (issue #90). A note is only retired when the
// location it itself records no longer holds a SKILL.md. Everything else is
// UNVERIFIED: reported by name, never moved, never stamped.
//
// Measured on the live vault 2026-08-27: five notes naming skills that exist
// (goldoni-empfehlungskarte, instagram-scraper, ogc-reply, ogc-triage,
// presseschau) were planned for retirement solely because `source_roots` was
// empty. Nothing is destroyed by a retirement -- the note moves and keeps its
// frontmatter -- but a library whose job is telling you what you have would
// have told the user five things he has are gone.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyPlan } = require('../scripts/cli.js');
const { renderNote } = require('../scripts/render.js');

process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-verify-home-'));

function note(name, ort) {
  return renderNote({
    name, suffix: '', description: 'd', herkunft: 'eigen', ort,
    plugin: '', status: 'aktiv', created: '2026-07-05 15:45', lastModified: '2026-07-05 15:45',
  }, '');
}

function fixture(notes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-verify-'));
  const vault = path.join(root, 'vault');
  const lib = path.join(vault, 'Library', 'Skill Library');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(vault, '_vault-autopilot-config.md'),
    ['```yaml', 'skill_library:', '  library_path: "Library/Skill Library"', '```'].join('\n'));
  for (const n of notes) fs.writeFileSync(path.join(lib, `${n.title}.md`), n.body);
  return { root, vault, lib };
}

function livingSkill(root, name) {
  const dir = path.join(root, 'repo', 'skills', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: d\n---\n`);
  return dir;
}

const OTHER = [{ name: 'alpha', herkunft: 'eigen', ort: '/keep', plugin: '', description: 'd' }];

test('a note whose recorded location still holds a SKILL.md is never retired', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-live-'));
  const ort = livingSkill(root, 'ogc-reply');
  const f = fixture([{ title: 'Skill – ogc-reply', body: note('ogc-reply', ort) }]);

  const result = applyPlan(f.vault, { write: true, inventory: OTHER });

  assert.ok(fs.existsSync(path.join(f.lib, 'Skill – ogc-reply.md')),
    'the note was moved even though the skill it names is on disk');
  assert.ok(!fs.existsSync(path.join(f.lib, 'Entfallen', 'Skill – ogc-reply.md')));
  assert.strictEqual(result.moved.length, 0);
  assert.strictEqual(result.unverified.length, 1);
  assert.strictEqual(result.unverified[0].title, 'Skill – ogc-reply');
  assert.strictEqual(result.unverified[0].reason, 'skill-still-at-recorded-location');
});

test('a note whose recorded location is gone is still retired', () => {
  const f = fixture([{ title: 'Skill – gone', body: note('gone', '/nowhere/at/all/skills/gone') }]);

  const result = applyPlan(f.vault, { write: true, inventory: OTHER });

  assert.ok(fs.existsSync(path.join(f.lib, 'Entfallen', 'Skill – gone.md')));
  assert.strictEqual(result.moved.length, 1);
  assert.strictEqual(result.unverified.length, 0);
});

test('a note that records no location at all is not retired (fail closed)', () => {
  const f = fixture([{ title: 'Skill – nowhere', body: note('nowhere', '') }]);

  const result = applyPlan(f.vault, { write: true, inventory: OTHER });

  assert.ok(fs.existsSync(path.join(f.lib, 'Skill – nowhere.md')));
  assert.strictEqual(result.moved.length, 0);
  assert.strictEqual(result.unverified[0].reason, 'no-recorded-location');
});

test('the retire cap counts verified retirements only', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-cap-'));
  const notes = [];
  for (let i = 0; i < 30; i += 1) {
    const name = `live-${i}`;
    notes.push({ title: `Skill – ${name}`, body: note(name, livingSkill(root, name)) });
  }
  const f = fixture(notes);

  // 30 notes, retire cap = max(10, 30*0.25) = 10. Unfixed, all 30 land in
  // `retired` and the run dies on the cap before it can report anything
  // useful. Verified, none of them are retirements at all.
  const result = applyPlan(f.vault, { write: true, inventory: OTHER, retireMax: 10 });
  assert.strictEqual(result.moved.length, 0);
  assert.strictEqual(result.unverified.length, 30);
});

test('preview mode reports unverified notes too', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-prev-'));
  const ort = livingSkill(root, 'presseschau');
  const f = fixture([{ title: 'Skill – presseschau', body: note('presseschau', ort) }]);

  const result = applyPlan(f.vault, { write: false, inventory: OTHER });
  assert.strictEqual(result.unverified.length, 1);
});

// Reporting: an unverified note that is never NAMED is a note the user cannot
// act on. It must appear in the diff preview, in both apply renderings, and in
// the findings ledger -- with the reason, because "still on disk" and "no
// location recorded" call for different fixes (configure a source root vs.
// repair the note).
const { renderPreview, renderApplyPreview, renderApplyResult, writeFindings, collect,
  verifyRetirements } = require('../scripts/cli.js');
const { diffLibrary } = require('../scripts/diff.js');
const { main } = require('../scripts/cli.js');

test('the diff preview names unverified notes and does not count them as retired', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-diffprev-'));
  const ort = livingSkill(root, 'ogc-triage');
  const f = fixture([{ title: 'Skill – ogc-triage', body: note('ogc-triage', ort) }]);

  const { inventory, notes } = collect(f.vault);
  // diff.js stays pure -- it classifies inventory against library and knows
  // nothing about the filesystem. The verification is composed on top, which
  // is exactly what the `diff` command does.
  const raw = diffLibrary(inventory, notes);
  const { verified, unverified } = verifyRetirements(raw.retired);
  const out = renderPreview({ ...raw, retired: verified, unverified });

  assert.match(out, /retired:\s+0/);
  assert.match(out, /unverified:\s+1/);
  assert.match(out, /unverified: Skill – ogc-triage \(skill-still-at-recorded-location\)/);
});

test('both apply renderings carry the unverified count', () => {
  const r = { planned: 0, unchanged: 0, conflicts: [], created: [], relocated: [], moved: [], renamed: [],
    unverified: [{ title: 'Skill – x', reason: 'no-recorded-location' }] };
  assert.match(renderApplyPreview(r), /unverified: 1/);
  assert.match(renderApplyResult(r), /unverified: 1/);
});

test('the findings ledger records unverified notes by name', () => {
  const f = fixture([]);
  const target = writeFindings(f.vault, {
    created: [], relocated: [], moved: [], renamed: [], unchanged: 0, conflicts: [],
    unverified: [{ title: 'Skill – ogc-reply', reason: 'skill-still-at-recorded-location' }],
  }, { now: new Date('2026-09-01T10:00:00Z') });
  const text = fs.readFileSync(target, 'utf8');
  assert.match(text, /unverified: 1/);
  assert.match(text, /Skill – ogc-reply \(skill-still-at-recorded-location\)/);
});

test('the diff command exits 0 and prints the unverified line', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-cmd-'));
  const ort = livingSkill(root, 'goldoni-empfehlungskarte');
  const f = fixture([{ title: 'Skill – goldoni-empfehlungskarte',
    body: note('goldoni-empfehlungskarte', ort) }]);
  const chunks = [];
  const orig = process.stdout.write;
  process.stdout.write = (c) => { chunks.push(String(c)); return true; };
  let code;
  try { code = main(['diff', f.vault]); } finally { process.stdout.write = orig; }
  assert.strictEqual(code, 0);
  assert.match(chunks.join(''), /unverified: 1/);
});

// The no-frontmatter case belongs to the OLDER, more specific channel: an
// `unstampable-note` conflict refuses the move and names the missing field, so
// the note can be repaired. Claiming it as merely "unverified" would replace a
// precise diagnosis with a vague one. Both paths refuse to move the file --
// what differs is what the user is told.
test('a note with no frontmatter keeps its unstampable diagnosis', () => {
  const f = fixture([{ title: 'Skill – bare',
    body: '# Skill – bare\n\n## Notizen\n\nEigener Text.\n' }]);

  const result = applyPlan(f.vault, { write: true, inventory: OTHER });

  assert.ok(fs.existsSync(path.join(f.lib, 'Skill – bare.md')));
  assert.ok(!fs.existsSync(path.join(f.lib, 'Entfallen', 'Skill – bare.md')));
  assert.strictEqual(result.unverified.length, 0);
  assert.ok(result.conflicts.find((c) => c.kind === 'unstampable-note'));
});
