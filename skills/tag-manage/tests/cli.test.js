'use strict';
// Stage 1 (audit + plan, read-only) and Stage 2 (apply, write) at the fs layer.
// tmp-vault integration in the ai-paste-cleanup clean.test.js style.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { walkMarkdown, auditVault, planVault, applyToVault, MassChangeError } = require('../scripts/cli.js');

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

test('mass-change throw: exceeding the threshold aborts and writes nothing', () => {
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
