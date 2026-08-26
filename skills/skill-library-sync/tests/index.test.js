'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { renderIndex } = require('../scripts/render.js');
const { rebuildIndex } = require('../scripts/cli.js');
const { renderNote } = require('../scripts/render.js');

const row = (title, herkunft, status, hint = '') => ({ title, herkunft, status, hint });

test('rows are grouped by origin in the fixed order Eigene, Externe, Andere', () => {
  const md = renderIndex([
    row('Skill – x', 'extern', 'referenz'),
    row('Skill – a', 'eigen', 'aktiv'),
    row('Skill – m', 'org-plugin', 'aktiv'),
  ]);
  const order = ['## Eigene', '## Externe', '## Andere'].map((h) => md.indexOf(h));
  assert.ok(order.every((i) => i > -1), 'a group heading is missing');
  assert.deepStrictEqual(order, [...order].sort((p, q) => p - q), 'groups out of order');
});

test('org-plugin, projekt-lokal and kandidat all land under Andere', () => {
  const md = renderIndex([
    row('Skill – o', 'org-plugin', 'aktiv'),
    row('Skill – p', 'projekt-lokal', 'aktiv'),
    row('Skill – k', 'kandidat', 'kandidat'),
  ]);
  const andere = md.slice(md.indexOf('## Andere'));
  for (const t of ['Skill – o', 'Skill – p', 'Skill – k']) assert.ok(andere.includes(t), t);
  assert.ok(!md.includes('## Eigene'), 'an empty group was rendered');
});

test('status subgroups are named for the status values, never aktiv/inaktiv', () => {
  const md = renderIndex([
    row('Skill – a', 'eigen', 'aktiv'),
    row('Skill – b', 'eigen', 'referenz'),
    row('Skill – c', 'eigen', 'entfallen'),
  ]);
  assert.ok(md.includes('### aktiv'));
  assert.ok(md.includes('### referenz'));
  assert.ok(md.includes('### entfallen'));
  assert.ok(!/inaktiv/i.test(md), 'the forbidden two-way split reappeared');
});

test('an empty group or subgroup is omitted, not rendered empty', () => {
  const md = renderIndex([row('Skill – a', 'eigen', 'aktiv')]);
  assert.ok(!md.includes('## Externe'));
  assert.ok(!md.includes('### entfallen'));
});

test('numbering is continuous across groups, 1..N with no restart', () => {
  const md = renderIndex([
    row('Skill – a', 'eigen', 'aktiv'),
    row('Skill – x', 'extern', 'referenz'),
    row('Skill – m', 'org-plugin', 'aktiv'),
  ]);
  const nums = [...md.matchAll(/^\| (\d+) \|/gm)].map((m) => Number(m[1]));
  assert.deepStrictEqual(nums, [1, 2, 3]);
});

test('rows are sorted A to Z inside each subgroup', () => {
  const md = renderIndex([
    row('Skill – c', 'eigen', 'aktiv'),
    row('Skill – a', 'eigen', 'aktiv'),
    row('Skill – b', 'eigen', 'aktiv'),
  ]);
  assert.ok(md.indexOf('Skill – a') < md.indexOf('Skill – b'));
  assert.ok(md.indexOf('Skill – b') < md.indexOf('Skill – c'));
});

test('a column legend follows the table, and nothing follows it', () => {
  const md = renderIndex([row('Skill – a', 'eigen', 'aktiv')]);
  const legend = md.indexOf('## Legende');
  assert.ok(legend > md.lastIndexOf('| 1 |'), 'the legend is not below the table');
  for (const col of ['Herkunft', 'Status', 'Plugin/Ort-Hinweis']) {
    assert.ok(md.slice(legend).includes(col), `legend does not explain ${col}`);
  }
});

function libraryFixture(names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-idx-'));
  for (const [name, herkunft, status] of names) {
    fs.writeFileSync(path.join(dir, `Skill – ${name}.md`), renderNote({
      name, suffix: '', description: 'd', herkunft, ort: `/${name}`,
      plugin: '', status, created: '2026-08-26 17:00', lastModified: '2026-08-26 17:00',
    }, ''));
  }
  fs.writeFileSync(path.join(dir, '_Skill Library.md'),
    ['---', 'title: Skill Library — Index', '---', '', '# Skill Library', '',
     '## Bestandsaufnahme (2026-07-05)', '', '158 Skills gefunden ueber 4 Quellen.', '',
     '## Skills', '', '| # | old |', '|---|---|', '| 1 | stale |', ''].join('\n'));
  return dir;
}

test('the stale Bestandsaufnahme block is gone after a rebuild', () => {
  const dir = libraryFixture([['a', 'eigen', 'aktiv']]);
  rebuildIndex(dir, { write: true });
  const text = fs.readFileSync(path.join(dir, '_Skill Library.md'), 'utf8');
  assert.ok(!text.includes('Bestandsaufnahme'), 'the stale block survived');
  assert.ok(!text.includes('158'), 'the stale count survived');
  assert.ok(text.includes('title: Skill Library — Index'), 'the frontmatter was lost');
});

test('rebuildIndex does not list notes from the retired subfolder', () => {
  const dir = libraryFixture([['a', 'eigen', 'aktiv']]);
  const retired = path.join(dir, 'Entfallen');
  fs.mkdirSync(retired, { recursive: true });
  fs.writeFileSync(path.join(retired, 'Skill – gone.md'), renderNote({
    name: 'gone', suffix: '', description: 'd', herkunft: 'extern', ort: '/gone',
    plugin: '', status: 'entfallen', created: '2026-08-26 17:00', lastModified: '2026-08-26 17:00',
  }, ''));

  const md = rebuildIndex(dir, { write: false, retiredSubfolder: 'Entfallen' });

  assert.ok(!md.includes('Skill – gone'), 'a tombstone was listed in the live index');
  assert.ok(md.includes('Skill – a'));
});
