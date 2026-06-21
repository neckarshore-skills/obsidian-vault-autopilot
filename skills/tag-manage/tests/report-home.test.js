'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { suggestReportDir } = require('../scripts/report-home.js');

function tmpVault(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tagm-rh-'));
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text, 'utf8');
  }
  return dir;
}

test('suggestReportDir: Meta folder present -> recommends Meta/Tag Management', () => {
  const v = tmpVault({ 'Meta/x.md': 'x\n', 'Notes/y.md': 'y\n' });
  const r = suggestReportDir(v);
  assert.equal(r.recommended, 'Meta/Tag Management');
  assert.equal(r.candidates[0].relpath, 'Meta/Tag Management');
});

test('suggestReportDir: no Meta, admin-like dir -> recommends <dir>/Tag Management', () => {
  const v = tmpVault({ 'System/x.md': 'x\n' });
  assert.equal(suggestReportDir(v).recommended, 'System/Tag Management');
});

test('suggestReportDir: bare vault -> root fallback Tag Management', () => {
  const v = tmpVault({ 'note.md': 'x\n' });
  assert.equal(suggestReportDir(v).recommended, 'Tag Management');
});

test('suggestReportDir: existing tag-management folder is a continuity alternative, not the default', () => {
  const v = tmpVault({ 'Area/Tag Management for Obsidian/old.md': 'x\n', 'Meta/z.md': 'z\n' });
  const r = suggestReportDir(v);
  assert.equal(r.recommended, 'Meta/Tag Management'); // fresh wins
  const cont = r.candidates.find((c) => c.exists === true);
  assert.ok(cont && /Tag Management for Obsidian/.test(cont.relpath), 'continuity option surfaced');
});
