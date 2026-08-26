'use strict';
// convergence.test.js -- apply --write is idempotent.
//
// The property: a second `apply --write` over a library the first run just
// finished must report nothing to do and must leave the library byte-identical
// to how run 1 left it. This is not a nicety. The worst defect this skill has
// had was exactly a convergence failure -- run 1 retired a note into the
// tombstone folder, run 2 read the tombstone back as a live note, classified
// it retired again with a move target identical to its source, and the move
// loop's rmSync deleted it. That was demonstrated by hand in review and never
// encoded, which is why it is encoded here.
//
// `_vault-autopilot/` is deliberately OUTSIDE the comparison: the findings
// ledger is append-only by design, so it MUST differ between the two runs.
// The clock is deliberately not pinned either -- proving run 2 writes nothing
// under a different wall clock than run 1 is the stronger property, and a
// stamped `last_modified` bumping on a note nothing asked to change is one of
// the ways this could fail.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { main } = require('../scripts/cli.js');

const LIBRARY_PATH = 'Lib';

function fakeHome(names) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-conv-home-'));
  for (const name of names) {
    const dir = path.join(home, '.claude', 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\ndescription: the ${name} skill\n---\n`);
  }
  return home;
}

function snapshot(dir) {
  const out = new Map();
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, r);
      else out.set(r, fs.readFileSync(p)); // Buffer: byte comparison, not text
    }
  };
  walk(dir, '');
  return out;
}

function run(home, argv) {
  const prevHome = process.env.HOME;
  const write = process.stdout.write.bind(process.stdout);
  let out = '';
  process.env.HOME = home;
  process.stdout.write = (chunk) => { out += chunk; return true; };
  try {
    return { code: main(argv), out };
  } finally {
    process.stdout.write = write;
    process.env.HOME = prevHome;
  }
}

test('apply --write converges: the second run changes nothing and writes identical bytes', () => {
  const home = fakeHome(['alpha', 'beta', 'gamma']);
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-conv-vault-'));
  fs.writeFileSync(path.join(vault, '_vault-autopilot-config.md'),
    ['```yaml', 'skill_library:', `  library_path: "${LIBRARY_PATH}"`, '```'].join('\n'));
  const libDir = path.join(vault, LIBRARY_PATH);
  fs.mkdirSync(path.join(libDir, 'Eigene Skills'), { recursive: true });

  // Run 1 must exercise every write path, or convergence is only proven for
  // the paths it happened to touch: creates (three skills with no note), a
  // relocate (a note at a stale ort), and a retire (a note for a skill that
  // no longer exists -- the tombstone case that produced the deletion bug).
  fs.writeFileSync(path.join(libDir, 'Eigene Skills', 'Skill – alpha.md'), [
    '---', 'title: "alpha"', 'type: skill', 'description: "d"', 'herkunft: eigen',
    'ort: "/stale/location"', 'plugin: ""', 'status: aktiv',
    'created: 2026-01-01 00:00', 'last_modified: 2026-01-01 00:00',
    'tags:', '  - Claude/ClaudeCode', '  - Skill/eigen', '---',
    '', '# Skill – alpha', '', '## Notizen', '', 'Eigene Prosa.', '',
  ].join('\n'));
  fs.writeFileSync(path.join(libDir, 'Eigene Skills', 'Skill – vanished.md'), [
    '---', 'title: "vanished"', 'type: skill', 'description: "d"', 'herkunft: eigen',
    'ort: "/gone"', 'plugin: ""', 'status: aktiv',
    'created: 2026-01-01 00:00', 'last_modified: 2026-01-01 00:00',
    'tags:', '  - Claude/ClaudeCode', '  - Skill/eigen', '---',
    '', '# Skill – vanished', '', '## Notizen', '', 'Prosa, die bleiben muss.', '',
  ].join('\n'));

  const first = run(home, ['apply', vault, '--write']);
  assert.strictEqual(first.code, 0, first.out);
  assert.match(first.out, /created:\s+2/);
  assert.match(first.out, /relocated:\s+1/);
  assert.match(first.out, /retired:\s+1/);

  const afterRun1 = snapshot(libDir);

  const second = run(home, ['apply', vault, '--write']);
  assert.strictEqual(second.code, 0, second.out);
  for (const bucket of ['created', 'relocated', 'retired', 'renamed', 'conflicts']) {
    assert.match(second.out, new RegExp(`${bucket}:\\s+0`),
      `run 2 reported work in "${bucket}"; a converged library has none:\n${second.out}`);
  }

  const afterRun2 = snapshot(libDir);
  assert.deepStrictEqual([...afterRun2.keys()], [...afterRun1.keys()],
    'run 2 added or removed a file in the library');
  for (const [rel, bytes] of afterRun1) {
    assert.ok(afterRun2.get(rel).equals(bytes), `run 2 rewrote ${rel}`);
  }

  // The tombstone specifically: it must still be there, still holding the
  // user's prose, and must NOT have been re-read as a live note.
  const tombstone = path.join(libDir, 'Entfallen', 'Skill – vanished.md');
  assert.ok(fs.existsSync(tombstone), 'the tombstone was deleted by the second run');
  assert.match(fs.readFileSync(tombstone, 'utf8'), /Prosa, die bleiben muss\./);

  // The ledger is the one thing that MUST differ -- it is append-only, so a
  // second run adds a second block rather than replacing the first.
  const ledger = fs.readFileSync(path.join(vault, '_vault-autopilot', 'findings',
    fs.readdirSync(path.join(vault, '_vault-autopilot', 'findings'))[0]), 'utf8');
  assert.strictEqual((ledger.match(/^## Run /gm) || []).length, 2,
    'both runs must be recorded in the append-only ledger');
});
