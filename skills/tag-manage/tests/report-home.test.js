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

const { setReportDir } = require('../scripts/report-home.js');

test('setReportDir: creates Tag Manage Config.md when absent', () => {
  const v = tmpVault({ 'a.md': 'x\n' });
  const r = setReportDir(v, 'Meta/Tag Management');
  assert.equal(r.created, true);
  const txt = fs.readFileSync(path.join(v, 'Tag Manage Config.md'), 'utf8');
  assert.match(txt, /```json[\s\S]*"reportDir": "Meta\/Tag Management"[\s\S]*```/);
});

test('setReportDir: updates reportDir but preserves existing brands', () => {
  const v = tmpVault({ 'Tag Manage Config.md': '# cfg\n\n```json\n{\n  "brands": { "mcp": "MCP" }\n}\n```\n' });
  setReportDir(v, 'Meta/TM');
  const cfg = require('../scripts/config.js').extractJsonFence(
    fs.readFileSync(path.join(v, 'Tag Manage Config.md'), 'utf8'));
  assert.equal(cfg.reportDir, 'Meta/TM');
  assert.equal(cfg.brands.mcp, 'MCP'); // preserved
});

test('setReportDir: is idempotent', () => {
  const v = tmpVault({ 'a.md': 'x\n' });
  setReportDir(v, 'Meta/TM');
  const once = fs.readFileSync(path.join(v, 'Tag Manage Config.md'), 'utf8');
  setReportDir(v, 'Meta/TM');
  assert.equal(fs.readFileSync(path.join(v, 'Tag Manage Config.md'), 'utf8'), once);
});

test('setReportDir: rejects absolute and .. paths, writes nothing', () => {
  const v = tmpVault({ 'a.md': 'x\n' });
  assert.throws(() => setReportDir(v, '/etc/evil'), /vault-relative|absolute/);
  assert.throws(() => setReportDir(v, '../outside'), /escape|\.\./);
  assert.equal(fs.existsSync(path.join(v, 'Tag Manage Config.md')), false);
});

const { spawnSync } = require('node:child_process');
const CLI = path.join(__dirname, '..', 'scripts', 'cli.js');

test('CLI suggest-report-dir: prints ranked JSON', () => {
  const v = tmpVault({ 'Meta/x.md': 'x\n' });
  const r = spawnSync('node', [CLI, 'suggest-report-dir', v], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.recommended, 'Meta/Tag Management');
});

test('CLI set-report-dir: writes the config note', () => {
  const v = tmpVault({ 'a.md': 'x\n' });
  const r = spawnSync('node', [CLI, 'set-report-dir', v, 'Meta/Tag Management'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(fs.readFileSync(path.join(v, 'Tag Manage Config.md'), 'utf8'), /"reportDir": "Meta\/Tag Management"/);
});
