'use strict';
// Stage 1 (audit + plan, read-only) and Stage 2 (apply, write) at the fs layer.
// tmp-vault integration in the ai-paste-cleanup clean.test.js style.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { walkMarkdown, auditVault, planVault, applyToVault, MassChangeError, runAudit, selectOps } = require('../scripts/cli.js');

function tmpVault(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tagm-'));
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text, 'utf8');
  }
  return dir;
}

test('walkMarkdown: *.md only, skips _ and . prefixed dirs/files', () => {
  const dir = tmpVault({
    'a.md': '---\ntags:\n  - ai\n---\nx\n',
    'b.txt': 'not markdown\n',
    '_trash/c.md': '---\ntags:\n  - ai\n---\nx\n',
    '.obsidian/d.md': 'x\n',
    '_vault-autopilot.md': 'protected\n',
  });
  const seen = walkMarkdown(dir).map((p) => path.basename(p)).sort();
  assert.deepEqual(seen, ['a.md']);
});

test('auditVault: surfaces orphans and case groups (read-only)', () => {
  const dir = tmpVault({
    'a.md': '---\ntags: [AI, ml]\n---\n#AI body\n',
    'b.md': '---\ntags:\n  - ai\n---\nx\n',
  });
  const f = auditVault(dir);
  assert.ok(f.caseGroups.some((g) => g.key === 'ai'));        // {AI, ai}
  assert.ok(f.orphans.some((o) => o.key === 'ml'));           // single-note tag
});

test('planVault: dry-run reports changes but writes NOTHING', () => {
  const dir = tmpVault({ 'a.md': '---\ntags:\n  - ai\n---\n#ai body\n' });
  const before = fs.readFileSync(path.join(dir, 'a.md'), 'utf8');
  const plan = planVault(dir, [{ type: 'rename', from: 'ai', to: 'ml' }]);
  assert.equal(plan.changedCount, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'a.md'), 'utf8'), before, 'dry-run must not write');
});

test('applyToVault --write: rewrites in place across frontmatter and body', () => {
  const dir = tmpVault({ 'a.md': '---\ntags:\n  - ai\n---\n#ai body\n' });
  applyToVault(dir, [{ type: 'rename', from: 'ai', to: 'ml' }], { write: true });
  assert.equal(fs.readFileSync(path.join(dir, 'a.md'), 'utf8'), '---\ntags:\n  - ml\n---\n#ml body\n');
});

test('applyToVault idempotency: a second run on the cleaned vault changes nothing', () => {
  const dir = tmpVault({ 'a.md': '---\ntags:\n  - ai\n---\n#ai body\n' });
  const ops = [{ type: 'rename', from: 'ai', to: 'ml' }];
  applyToVault(dir, ops, { write: true });
  const second = applyToVault(dir, ops, { write: true });
  assert.equal(second.changedCount, 0);
});

test('plan-then-write: a transform that throws writes NO file (no partial write)', () => {
  const dir = tmpVault({
    'a.md': '---\ntags:\n  - ai\n---\nx\n',
    'b.md': '---\ntags:\n  - ai\n---\nx\n',
  });
  const beforeA = fs.readFileSync(path.join(dir, 'a.md'), 'utf8');
  let n = 0;
  const transform = () => { if (++n === 2) throw new Error('boom'); return { text: 'X', changed: true }; };
  assert.throws(() => applyToVault(dir, [], { write: true, transform }));
  assert.equal(fs.readFileSync(path.join(dir, 'a.md'), 'utf8'), beforeA, 'no file may be written on abort');
});

test('mass-change is per-op: several small ops do not aggregate past the threshold', () => {
  // n0/n1 carry tag `a`; n2/n3 carry tag `b`. Two ops, each touching 2 notes.
  const files = {
    'n0.md': '---\ntags:\n  - a\n---\nx\n', 'n1.md': '---\ntags:\n  - a\n---\nx\n',
    'n2.md': '---\ntags:\n  - b\n---\nx\n', 'n3.md': '---\ntags:\n  - b\n---\nx\n',
  };
  const dir = tmpVault(files);
  const ops = [{ type: 'rename', from: 'a', to: 'x' }, { type: 'rename', from: 'b', to: 'y' }];
  // per-op counts (2 and 2) are each <= 3, even though the plan total (4) exceeds it.
  const res = applyToVault(dir, ops, { write: true, massChangeThreshold: 3 });
  assert.equal(res.changedCount, 4);
});

test('mass-change throw: a single op exceeding the threshold aborts and writes nothing', () => {
  const files = {};
  for (let i = 0; i < 5; i++) files[`n${i}.md`] = '---\ntags:\n  - ai\n---\nx\n';
  const dir = tmpVault(files);
  const ops = [{ type: 'rename', from: 'ai', to: 'ml' }];
  assert.throws(() => applyToVault(dir, ops, { write: true, massChangeThreshold: 3 }), MassChangeError);
  // nothing written: every note still has the old tag
  for (let i = 0; i < 5; i++) {
    assert.ok(fs.readFileSync(path.join(dir, `n${i}.md`), 'utf8').includes('- ai'));
  }
});

test('runAudit produces a report + recommendations without writing notes', () => {
  const dir = path.join(__dirname, 'fixtures-audit');
  // fixture dir created in Step 3
  const out = runAudit(dir, { date: '2026-06-20', defaultsPath: path.join(__dirname, '..', 'references', 'tag-overrides.default.json'), configText: null, reportDirAbs: null });
  assert.match(out.report, /Tag Analysis Report/);
  assert.ok(Array.isArray(out.recommendations));
  assert.equal(out.reportPath, null); // no reportDir -> report not written
});

test('CLI audit subcommand prints the rich report (no write without --report-dir)', () => {
  const cli = path.join(__dirname, '..', 'scripts', 'cli.js');
  const dir = path.join(__dirname, 'fixtures-audit');
  const r = spawnSync('node', [cli, 'audit', dir, '--date', '2026-06-20'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Tag Analysis Report/);
  assert.match(r.stdout, /Health Score/);
});

// ---- selectOps unit tests (Task 9) ----------------------------------------

const recs = [
  { id: 1, ops: [{ type: 'rename', from: 'research', to: 'Research' }] },
  { id: 2, ops: [{ type: 'rename', from: 'github', to: 'GitHub' }] },
];
test('selectOps all returns every op', () => assert.equal(selectOps(recs, 'all').length, 2));
test('selectOps by id filters', () => assert.deepEqual(selectOps(recs, [2]), [{ type: 'rename', from: 'github', to: 'GitHub' }]));

// ---- CLI integration test: apply --from-recs (Task 9) ----------------------

test('CLI apply --from-recs: loads recs JSON and applies selected ops to vault', () => {
  const cli = path.join(__dirname, '..', 'scripts', 'cli.js');
  const fixtureDir = path.join(__dirname, 'fixtures-audit');

  // Copy fixture vault to a tmp dir so we can write safely.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tagm-from-recs-'));
  fs.cpSync(fixtureDir, tmpDir, { recursive: true });

  // Write a recommendations JSON for the rename research -> Research.
  const recsJson = JSON.stringify([{ id: 1, ops: [{ type: 'rename', from: 'research', to: 'Research' }] }]);
  const recsFile = path.join(tmpDir, 'recs.json');
  fs.writeFileSync(recsFile, recsJson, 'utf8');

  const r = spawnSync('node', [cli, 'apply', tmpDir, '--from-recs', recsFile, '--write'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}\nstdout:${r.stdout}\nstderr:${r.stderr}`);

  const noteContent = fs.readFileSync(path.join(tmpDir, 'note.md'), 'utf8');
  assert.ok(noteContent.includes('- Research'), 'expected Research tag in frontmatter');
  assert.ok(!noteContent.includes('- research'), 'old research tag must be gone');
});
