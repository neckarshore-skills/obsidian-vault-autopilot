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

const { runAudit, applyToVault } = require('../scripts/cli.js');
const DEFAULTS = path.join(__dirname, '..', 'references', 'tag-overrides.default.json');

test('runAudit: creates a not-yet-existing report dir instead of aborting', () => {
  const v = tmpVault({ 'a.md': '---\ntags:\n  - ai\n---\nx\n' });
  const rd = path.join(v, 'Meta', 'Tag Management'); // does NOT exist yet
  const out = runAudit(v, { date: '2026-06-21', defaultsPath: DEFAULTS, configText: null, reportDirAbs: rd });
  assert.ok(fs.existsSync(out.reportPath), 'report written into the auto-created dir');
});

test('applyToVault: a report artifact inside reportDirAbs is left byte-identical', () => {
  const reportName = '2026-06-21 Tag Analysis Report - Vault-wide.md';
  const v = tmpVault({
    'note.md': '---\ntags:\n  - ai\n---\n#ai body\n',
    // report fixture carries an `ai` tag so the op WOULD rewrite it without the exclusion
    // (a `1`-only fixture would stay byte-identical regardless — a false-green test).
    [`Meta/Tag Management/${reportName}`]: '---\ntags:\n  - ai\n---\nSay apply #1, #3 or skip #2\n',
  });
  const rd = path.join(v, 'Meta', 'Tag Management');
  const reportFull = path.join(rd, reportName);
  const before = fs.readFileSync(reportFull, 'utf8');
  applyToVault(v, [{ type: 'rename', from: 'ai', to: 'ML' }], { write: true, reportDirAbs: rd });
  assert.equal(fs.readFileSync(reportFull, 'utf8'), before, 'report note must not be rewritten by apply');
  assert.equal(fs.readFileSync(path.join(v, 'note.md'), 'utf8'), '---\ntags:\n  - ML\n---\n#ML body\n');
});

test('setReportDir: a $-bearing preserved value is not corrupted by replace substitution', () => {
  const v = tmpVault({ 'Tag Manage Config.md': '# cfg\n\n```json\n{\n  "brands": { "x": "A$&B$$C" }\n}\n```\n' });
  setReportDir(v, 'Meta/TM');
  const txt = fs.readFileSync(path.join(v, 'Tag Manage Config.md'), 'utf8');
  assert.equal((txt.match(/```json/g) || []).length, 1, 'exactly one json fence');
  const cfg = require('../scripts/config.js').extractJsonFence(txt);
  assert.equal(cfg.reportDir, 'Meta/TM');
  assert.equal(cfg.brands.x, 'A$&B$$C', 'brand value preserved verbatim');
});

test('setReportDir: throws on an existing but unparseable json fence (surface, not mask)', () => {
  const v = tmpVault({ 'Tag Manage Config.md': '# cfg\n\n```json\n{ not valid json }\n```\n' });
  assert.throws(() => setReportDir(v, 'Meta/TM'), /unparseable/);
});
