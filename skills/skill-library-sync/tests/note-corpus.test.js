'use strict';
// note-corpus.test.js -- the adversarial note corpus.
//
// Why this file exists. Every other suite here feeds the write path notes
// that this tool's OWN renderer could have produced: template frontmatter,
// `## Notizen` present, LF endings, every field filled. That is a closed
// world, and every data-loss defect this skill has had lived at the boundary
// between that world and a real, hand-edited vault -- a note with no
// frontmatter, a note with no `created`, a note whose author never heard of
// `## Notizen`. A green closed-world suite said nothing about any of them.
//
// So the corpus below is deliberately none of those notes, and it is driven
// through the real CLI (scan, diff, apply --write) rather than through the
// pure engine. ONE invariant is asserted across all of them:
//
//     the bytes the body-boundary contract protects survive byte-for-byte,
//     or the note is named in `conflicts` by its own path.
//
// Refusing is always an acceptable answer. Silently rewriting is never one.
// A note that does not carry the contract (no frontmatter, no heading) never
// opted into it, so for those the protected region is the WHOLE file.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { main } = require('../scripts/cli.js');

const LIBRARY_PATH = 'Lib';
const SKILL_NAME = 'alpha';

// The full, well-formed shape -- the one note in the corpus that MUST be
// rewritten rather than refused, so the corpus cannot pass by refusing
// everything. Each case below is this shape with exactly one thing wrong.
function templateLines({ created = 'created: 2026-01-01 00:00', status = 'status: aktiv' } = {}) {
  return [
    '---', 'title: "alpha"', 'type: skill', 'description: "d"',
    'herkunft: eigen', 'ort: "/stale/location"', 'plugin: ""',
    status, created, 'last_modified: 2026-01-01 00:00',
    'tags:', '  - Claude/ClaudeCode', '  - Skill/eigen', '---',
    '', '# Skill – alpha', '', '**Zweck:** d', '', '## Notizen',
  ];
}

const USER_PROSE = [
  '', 'Meine eigene Prosa. Zwei Jahre Gedanken, von Hand geschrieben.',
  '', '- Punkt eins', '- Punkt zwei', '',
].join('\n');

// `protected` names the exact bytes that must come back unchanged. For a note
// that carries the contract that is its notes zone; for one that does not, it
// is the entire file.
const CORPUS = [
  {
    id: 'no-frontmatter (prose only)',
    text: 'Handgeschrieben. Kein Frontmatter, keine Notizen-Ueberschrift.\n\n- Punkt eins\n',
    protectedText: 'Handgeschrieben. Kein Frontmatter, keine Notizen-Ueberschrift.\n\n- Punkt eins\n',
  },
  {
    id: 'no-notes-heading (frontmatter plus prose)',
    text: templateLines().slice(0, 14).join('\n') + '\n\n# Skill – alpha\n\nEigene Prosa ohne Ueberschrift.\n',
    protectedText: 'Eigene Prosa ohne Ueberschrift.',
  },
  {
    id: 'frontmatter without created',
    text: templateLines({ created: 'type_placeholder: x' }).join('\n') + USER_PROSE,
    protectedText: USER_PROSE,
  },
  {
    id: 'frontmatter without status',
    text: templateLines({ status: 'type_placeholder: x' }).join('\n') + USER_PROSE,
    protectedText: USER_PROSE,
  },
  {
    id: 'BOM before the frontmatter',
    text: '﻿' + templateLines().join('\n') + USER_PROSE,
    protectedText: USER_PROSE,
  },
  {
    id: 'mixed EOL (CRLF frontmatter, LF notes zone)',
    text: templateLines().join('\r\n') + USER_PROSE,
    protectedText: USER_PROSE,
  },
  {
    id: 'CRLF throughout, well-formed (must be rewritten, not refused)',
    text: templateLines().join('\r\n') + USER_PROSE.replace(/\n/g, '\r\n'),
    protectedText: USER_PROSE.replace(/\n/g, '\r\n'),
    mustBeRewritten: true,
  },
  {
    id: 'empty file',
    text: '',
    protectedText: '',
    mustBeRewritten: true,
  },
];

function fakeHome({ secondOrigin = false } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-corpus-home-'));
  const dir = path.join(home, '.claude', 'skills', SKILL_NAME);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\ndescription: alpha\n---\n');
  if (!secondOrigin) return { home, orgRoot: null };
  // A second origin for the same name makes the note acquire an origin
  // suffix, which routes it through the RENAME branch instead of relocate --
  // a different write path with the same power to destroy the note.
  const orgRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-corpus-org-'));
  const orgSkill = path.join(orgRoot, 'skills', SKILL_NAME);
  fs.mkdirSync(orgSkill, { recursive: true });
  fs.writeFileSync(path.join(orgSkill, 'SKILL.md'), '---\ndescription: org alpha\n---\n');
  return { home, orgRoot };
}

function vaultWith(noteText, orgRoot) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-corpus-vault-'));
  const config = ['```yaml', 'skill_library:', `  library_path: "${LIBRARY_PATH}"`];
  if (orgRoot) config.push('  source_roots:', `    - ${orgRoot}`);
  config.push('```');
  fs.writeFileSync(path.join(vault, '_vault-autopilot-config.md'), config.join('\n'));
  const noteDir = path.join(vault, LIBRARY_PATH, 'Eigene Skills');
  fs.mkdirSync(noteDir, { recursive: true });
  const notePath = path.join(noteDir, `Skill – ${SKILL_NAME}.md`);
  fs.writeFileSync(notePath, noteText);
  return { vault, notePath };
}

// Every .md under the library, by absolute path -- a note may legitimately
// have MOVED (a rename carries it to a new filename), so "did the protected
// region survive" is a question about the subtree, not about one path.
function libraryFiles(libDir) {
  const out = new Map();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) out.set(p, fs.readFileSync(p, 'utf8'));
    }
  };
  walk(libDir);
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

for (const shape of [{ label: 'relocate', secondOrigin: false }, { label: 'rename', secondOrigin: true }]) {
  for (const c of CORPUS) {
    test(`${shape.label}: ${c.id} -- protected bytes survive or the note is named in conflicts`, () => {
      const { home, orgRoot } = fakeHome({ secondOrigin: shape.secondOrigin });
      const { vault, notePath } = vaultWith(c.text, orgRoot);
      const libDir = path.join(vault, LIBRARY_PATH);

      // scan and diff are read-only, for every shape in the corpus.
      const before = libraryFiles(libDir);
      run(home, ['scan', vault]);
      run(home, ['diff', vault]);
      assert.deepStrictEqual(libraryFiles(libDir), before, 'scan/diff must write nothing');

      const { code, out } = run(home, ['apply', vault, '--write']);
      // A run that leaves notes alone is still a completed run: conflicts are
      // reported on stdout, not through the exit code (see SKILL.md's exit
      // codes -- 1 is a refusal of the whole run, not of one note).
      assert.strictEqual(code, 0, `apply --write should complete; output:\n${out}`);

      const after = libraryFiles(libDir);
      const survived = [...after.values()].some((text) => text.includes(c.protectedText));
      const namedInConflicts = out.split('\n').some(
        (line) => line.includes('conflict:') && line.includes(notePath));

      assert.ok(survived || namedInConflicts,
        `neither survived nor reported: ${c.id}\n--- apply output ---\n${out}`);
      if (c.mustBeRewritten) {
        assert.ok(!namedInConflicts,
          `a well-formed note must be handled, not refused: ${c.id}\n${out}`);
        assert.ok(survived, `the notes zone must survive byte-for-byte: ${c.id}`);
        // `survived` is vacuous when there are no protected bytes -- every
        // string contains ''. The empty-file case is precisely where a bad
        // rewrite would leave a blank note behind and this assertion would
        // still pass, so it has to prove the rewrite HAPPENED.
        if (c.protectedText === '') {
          const rebuilt = [...after.values()].some(
            (text) => /^type: skill$/m.test(text) && text.includes('## Notizen'));
          assert.ok(rebuilt,
            `an empty note must be rebuilt into a full note, not left blank: ${c.id}\n${out}`);
        }
      }

      // No note this run writes may contain the literal string
      // `undefined`. A missing frontmatter field must never be rendered as
      // the word for its absence.
      for (const [file, text] of after) {
        assert.ok(!/^[a-z_]+: undefined$/m.test(text),
          `the literal string "undefined" was rendered into ${file} (${c.id})`);
      }
    });
  }
}

// The corpus above proves refusal-or-survival. This proves the refusals carry
// a TRUE reason: `status:aktiv` (no space after the colon) is what parseNote
// accepts, so the retire path must not report it as a missing `status`.
test('a retire-bound note with no space after status: is stamped, not reported unstampable', () => {
  const { home } = fakeHome();
  const { vault } = vaultWith('placeholder');
  const libDir = path.join(vault, LIBRARY_PATH, 'Eigene Skills');
  // A note for a skill that does NOT exist in the inventory -> retired.
  fs.writeFileSync(path.join(libDir, 'Skill – vanished.md'), [
    '---', 'title: "vanished"', 'type: skill', 'description: "d"',
    'herkunft: eigen', 'ort: "/gone"', 'plugin: ""',
    'status:aktiv', 'created:2026-01-01 00:00', 'last_modified:2026-01-01 00:00',
    '---', '', '# Skill – vanished', '', '## Notizen', '',
  ].join('\n'));

  const { code, out } = run(home, ['apply', vault, '--write']);
  assert.strictEqual(code, 0);
  assert.doesNotMatch(out, /unstampable-note: .*vanished/,
    'status:aktiv parses fine, so reporting it as missing is a false reason');
  const tombstone = path.join(vault, LIBRARY_PATH, 'Entfallen', 'Skill – vanished.md');
  const text = fs.readFileSync(tombstone, 'utf8');
  assert.match(text, /^status: entfallen$/m);
  assert.match(text, /^entfallen_am: \d{4}-\d{2}-\d{2}$/m,
    'the entfallen_am insert must fire on the same spelling the check accepted');
});
