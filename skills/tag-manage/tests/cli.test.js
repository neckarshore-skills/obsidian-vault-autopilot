'use strict';
// Stage 1 (audit + plan, read-only) and Stage 2 (apply, write) at the fs layer.
// tmp-vault integration in the ai-paste-cleanup clean.test.js style.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { walkMarkdown, walkWithExclusions, auditVault, planVault, applyToVault, MassChangeError, runAudit, selectOps, runInduce, reportStamp, excludeReportArtifacts } = require('../scripts/cli.js');

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

// ---- #236 _-folder blindspot: walkWithExclusions surfaces what was skipped ----
// walkMarkdown silently skips every _-folder (intended for _trash/_vault-autopilot),
// so real content in _Work/_Personal is excluded from every scan and a finding of
// `0` reads as "whole vault clean". walkWithExclusions makes the skipped set visible
// WITHOUT changing what gets scanned (Option 3 of the spec; config opt-in deferred).

const findExcl = (excluded, folder) => excluded.find((e) => e.folder === folder);

test('walkWithExclusions: .files is byte-identical to walkMarkdown (scan behavior unchanged)', () => {
  const dir = tmpVault({
    'a.md': '---\ntags:\n  - ai\n---\nx\n',
    'Projects/b.md': '---\ntags:\n  - ai\n---\nx\n',
    '_Work/w.md': '---\ntags:\n  - ai\n---\nx\n',
    '_trash/t.md': 'deleted\n',
    '.obsidian/d.md': 'config\n',
  });
  assert.deepEqual(walkWithExclusions(dir).files, walkMarkdown(dir),
    'the scan-walk and the back-compat wrapper must return the identical file list');
});

test('walkWithExclusions: a non-protected _-folder is reported with its note count', () => {
  const dir = tmpVault({
    'a.md': '---\ntags:\n  - ai\n---\nx\n',
    '_Work/w1.md': '---\ntags:\n  - ai\n---\nx\n',
    '_Work/w2.md': '---\ntags:\n  - ml\n---\nx\n',
  });
  const { files, excluded } = walkWithExclusions(dir);
  assert.deepEqual(files.map((p) => path.basename(p)), ['a.md']);
  assert.deepEqual(findExcl(excluded, '_Work'), { folder: '_Work', noteCount: 2, protected: false });
});

test('walkWithExclusions: protected folders are flagged; _trash carries a count', () => {
  const dir = tmpVault({
    'a.md': '---\ntags:\n  - ai\n---\nx\n',
    '_trash/t1.md': 'deleted\n',
    '_trash/t2.md': 'deleted\n',
  });
  const { excluded } = walkWithExclusions(dir);
  assert.deepEqual(findExcl(excluded, '_trash'), { folder: '_trash', noteCount: 2, protected: true });
});

test('walkWithExclusions: _secret is flagged protected with a SUPPRESSED count (no leak of how many secret notes exist)', () => {
  const dir = tmpVault({
    'a.md': '---\ntags:\n  - ai\n---\nx\n',
    '_secret/s1.md': 'token\n',
    '_secret/s2.md': 'token\n',
  });
  const { excluded } = walkWithExclusions(dir);
  assert.deepEqual(findExcl(excluded, '_secret'), { folder: '_secret', noteCount: null, protected: true });
});

test('walkWithExclusions: nested _ inside an excluded _-folder folds into the parent (one row, summed count)', () => {
  const dir = tmpVault({
    'a.md': '---\ntags:\n  - ai\n---\nx\n',
    '_Work/sub/x.md': '---\ntags:\n  - ai\n---\nx\n',
    '_Work/_archive/y.md': '---\ntags:\n  - ai\n---\nx\n',
  });
  const { excluded } = walkWithExclusions(dir);
  const workRows = excluded.filter((e) => e.folder.startsWith('_Work'));
  assert.equal(workRows.length, 1, 'a nested _ folder must not produce a separate excluded row');
  assert.deepEqual(workRows[0], { folder: '_Work', noteCount: 2, protected: false });
});

test('walkWithExclusions: a _-folder nested under a normal folder is caught (recursion mirrors walkMarkdown)', () => {
  const dir = tmpVault({
    'Projects/real.md': '---\ntags:\n  - ai\n---\nx\n',
    'Projects/_Work/p.md': '---\ntags:\n  - ai\n---\nx\n',
  });
  const { files, excluded } = walkWithExclusions(dir);
  assert.deepEqual(files.map((p) => path.basename(p)), ['real.md']);
  assert.deepEqual(findExcl(excluded, path.join('Projects', '_Work')),
    { folder: path.join('Projects', '_Work'), noteCount: 1, protected: false });
});

test('walkWithExclusions: an empty _-folder (no .md inside) is not reported (nothing missed)', () => {
  const dir = tmpVault({
    'a.md': '---\ntags:\n  - ai\n---\nx\n',
    '_Work/notes.txt': 'not markdown\n',
  });
  assert.deepEqual(walkWithExclusions(dir).excluded, []);
});

test('walkWithExclusions: excluded is sorted A->Z by folder', () => {
  const dir = tmpVault({
    '_Zebra/z.md': 'x\n', '_alpha/a.md': 'x\n', '_Mango/m.md': 'x\n',
  });
  const folders = walkWithExclusions(dir).excluded.map((e) => e.folder);
  assert.deepEqual(folders, [...folders].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
});

test('walkWithExclusions PARTITION INVARIANT: every .md is scanned XOR under one reported _-folder (dotdirs/node_modules excepted)', () => {
  const dir = tmpVault({
    'root.md': 'x\n',
    'Projects/p.md': 'x\n',
    '_Work/w.md': 'x\n',
    '_Work/deep/w2.md': 'x\n',
    '_trash/t.md': 'x\n',
    '.obsidian/cfg.md': 'x\n',          // outside the partition (dotdir)
    'node_modules/pkg/readme.md': 'x\n', // outside the partition
  });
  const { files, excluded } = walkWithExclusions(dir);
  const scanned = new Set(files.map((p) => path.relative(dir, p)));
  const underExcluded = (rel) => excluded.some((e) => rel === e.folder || rel.startsWith(e.folder + path.sep));
  const outsidePartition = (rel) => rel.split(path.sep).some((seg) => seg.startsWith('.') || seg === 'node_modules');

  // Walk the raw tree for every .md on disk.
  const allMd = [];
  (function raw(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) raw(full);
      else if (e.name.endsWith('.md')) allMd.push(path.relative(dir, full));
    }
  })(dir);

  for (const rel of allMd) {
    if (outsidePartition(rel)) continue;
    const isScanned = scanned.has(rel);
    const isExcluded = underExcluded(rel);
    assert.ok(isScanned !== isExcluded, `${rel} must be EITHER scanned OR under a reported _-folder, never both/neither (scanned=${isScanned} excluded=${isExcluded})`);
  }
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

// ---- tag-organize induce: cluster-proposal sidecar -------------------------

test('runInduce writes a .tag-organize-clusters.json proposal from flat residual tags', () => {
  const dir = tmpVault({
    'a.md': '---\ntags: [Business-Strategy, BusinessModel]\n---\nbody\n',
    'b.md': '---\ntags: [business-dev, Investing]\n---\nbody\n',
  });
  const res = runInduce(dir, {});
  const sidecar = path.join(dir, '.tag-organize-clusters.json');
  assert.ok(fs.existsSync(sidecar), 'proposal sidecar exists');
  const clusters = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].parent, 'Business');
  assert.deepEqual(clusters[0].children.map((c) => c.name), ['business-dev', 'Business-Strategy', 'BusinessModel']);
  assert.equal(res.outPath, sidecar);
});

// ---- #236: runAudit threads the real _-folder exclusions into the report -----

test('runAudit: the written report surfaces _-folders skipped by the scan (Scan Coverage)', () => {
  const dir = tmpVault({
    'a.md': '---\ntags:\n  - research\n---\nbody\n',
    '_Work/w1.md': '---\ntags:\n  - 7\n---\nbody\n', // a numeric tag the scan will never see
    '_Work/w2.md': '---\ntags:\n  - 9\n---\nbody\n',
  });
  try {
    const out = runAudit(dir, {
      date: '2026-06-30',
      defaultsPath: path.join(__dirname, '..', 'references', 'tag-overrides.default.json'),
      configText: null,
      reportDirAbs: null,
    });
    // The scanned vault is genuinely clean of numeric artifacts...
    assert.match(out.report, /Scan Coverage/);
    // ...but the report must say so was scanned, not the whole vault.
    assert.match(out.report, /`_Work`/);
    assert.match(out.report, /\b2\b/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runAudit: a vault with no _-folders affirms full coverage', () => {
  const dir = tmpVault({ 'a.md': '---\ntags:\n  - research\n---\nbody\n' });
  try {
    const out = runAudit(dir, {
      date: '2026-06-30',
      defaultsPath: path.join(__dirname, '..', 'references', 'tag-overrides.default.json'),
      configText: null,
      reportDirAbs: null,
    });
    assert.match(out.report, /Full vault scanned/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- Slice 1a: numeric removal candidates -> separate opt-in sidecar ---------

test('runAudit: numeric removal candidates go to a SEPARATE .tag-manage-removals.json, never the default recs', () => {
  const dir = tmpVault({
    'a.md': '---\ntags:\n  - "1"\n  - research\n---\nx\n',
    'b.md': '---\ntags:\n  - "1"\n---\nx\n',
  });
  const reportDirAbs = path.join(dir, 'Meta', 'Tag Management');
  try {
    const out = runAudit(dir, { date: '2026-06-30', defaultsPath: DEFAULTS, configText: null, reportDirAbs });
    assert.equal(out.removalRecommendations.length, 1);
    assert.equal(out.removalRecommendations[0].from, '1');
    // sidecar written
    const removals = JSON.parse(fs.readFileSync(path.join(reportDirAbs, '.tag-manage-removals.json'), 'utf8'));
    assert.equal(removals[0].ops[0].type, 'remove');
    // disjoint: the DEFAULT recs file must never carry a remove op (apply-all stays non-destructive)
    const main = JSON.parse(fs.readFileSync(path.join(reportDirAbs, '.tag-manage-recommendations.json'), 'utf8'));
    assert.equal(main.some((r) => r.ops.some((o) => o.type === 'remove')), false,
      'the default "apply all" recs must never remove a tag');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runAudit: no numeric artifacts -> no removals file, empty removalRecommendations', () => {
  const dir = tmpVault({ 'a.md': '---\ntags:\n  - research\n---\nx\n' });
  const reportDirAbs = path.join(dir, 'Meta', 'Tag Management');
  try {
    const out = runAudit(dir, { date: '2026-06-30', defaultsPath: DEFAULTS, configText: null, reportDirAbs });
    assert.deepEqual(out.removalRecommendations, []);
    assert.equal(fs.existsSync(path.join(reportDirAbs, '.tag-manage-removals.json')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runAudit: a converged re-audit clears the stale .tag-manage-removals.json to [] (F-NEST-1 class)', () => {
  const dir = tmpVault({ 'a.md': '---\ntags:\n  - "1"\n  - research\n---\nx\n' });
  const reportDirAbs = path.join(dir, 'Meta', 'Tag Management');
  const opts = { date: '2026-06-30', defaultsPath: DEFAULTS, configText: null, reportDirAbs };
  const removalsPath = path.join(reportDirAbs, '.tag-manage-removals.json');
  try {
    runAudit(dir, opts);
    assert.equal(JSON.parse(fs.readFileSync(removalsPath, 'utf8')).length, 1, 'audit #1 writes the removal candidate');
    // Apply the removal -> the numeric tag is gone.
    const ops = selectOps(JSON.parse(fs.readFileSync(removalsPath, 'utf8')), 'all');
    applyToVault(dir, ops, { write: true, reportDirAbs });
    // Audit #2 (convergence): the on-disk sidecar MUST be cleared to [], not left stale.
    const out = runAudit(dir, opts);
    assert.deepEqual(out.removalRecommendations, [], 'converged: no removal candidates computed');
    assert.deepEqual(JSON.parse(fs.readFileSync(removalsPath, 'utf8')), [],
      'the on-disk removals sidecar must be cleared to [] on convergence (no stale recs diverging from the report)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Slice 1a end-to-end: apply --from-recs the removals file removes the numeric tag from frontmatter', () => {
  const dir = tmpVault({ 'a.md': '---\ntags:\n  - "42"\n  - research\n---\nx\n' });
  const reportDirAbs = path.join(dir, 'Meta', 'Tag Management');
  try {
    runAudit(dir, { date: '2026-06-30', defaultsPath: DEFAULTS, configText: null, reportDirAbs });
    const removalRecs = JSON.parse(fs.readFileSync(path.join(reportDirAbs, '.tag-manage-removals.json'), 'utf8'));
    const ops = selectOps(removalRecs, [1]);
    applyToVault(dir, ops, { write: true, reportDirAbs });
    const after = fs.readFileSync(path.join(dir, 'a.md'), 'utf8');
    assert.doesNotMatch(after, /- "?42"?/, 'the numeric tag 42 must be removed');
    assert.match(after, /- research/, 'the real tag must be untouched');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
  try {
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
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---- end-to-end integration test on chaos fixture (Task 10) ----------------

test('end-to-end: audit chaos fixture -> apply -> re-audit has fewer violations', () => {
  const src = path.join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'tag-manage');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-'));
  try {
    fs.cpSync(src, tmp, { recursive: true });
    const opts = { date: '2026-06-20', defaultsPath: path.join(__dirname, '..', 'references', 'tag-overrides.default.json'), configText: null, reportDirAbs: null };
    const before = runAudit(tmp, opts);
    assert.ok(before.recommendations.length >= 1);
    const ops = selectOps(before.recommendations, 'all');
    applyToVault(tmp, ops, { write: true, massChangeThreshold: 100000 });
    const after = runAudit(tmp, opts);
    assert.ok(after.recommendations.length <= before.recommendations.length);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- FIX 2: runAudit root-exclusion unit test (TDD RED -> GREEN) -----------------
// Proves: when reportDirAbs == the scan root, real notes are still scanned (totalNotes > 0)
// and the pre-existing report artifact is excluded (totalNotes == 1, not 2).

test('runAudit: reportDirAbs == scan dir still scans real notes (non-zero) and excludes report artifact', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tagm-root-excl-'));
  try {
    // One real note
    fs.writeFileSync(path.join(tmpDir, 'real-note.md'), '---\ntags:\n  - research\n---\nbody\n', 'utf8');
    // One pre-existing report artifact that should be excluded
    fs.writeFileSync(path.join(tmpDir, '2026-06-20 Tag Analysis Report - Vault-wide.md'),
      '---\ntags:\n  - Meta/TagManagement\n---\nreport body\n', 'utf8');

    const out = runAudit(tmpDir, {
      date: '2026-06-20',
      defaultsPath: path.join(__dirname, '..', 'references', 'tag-overrides.default.json'),
      configText: null,
      reportDirAbs: tmpDir, // reportDirAbs == scan dir (the root case)
    });

    // Real note must be counted (non-zero totalNotes)
    assert.match(out.report, /\*\*Analyzed:\*\* 1 notes/, 'exactly 1 real note must be analyzed (report artifact excluded)');
    // Report path must be set (write happened)
    assert.ok(out.reportPath !== null, 'reportPath should be set when reportDirAbs is given');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---- OBI-2026-06-21-3 (F1): sibling report artifacts excluded by frontmatter marker ----
// A report home accumulates SIBLING artifacts (Master Summary, Tag Index, Cookbook,
// Roadmap, overview notes) that carry the report frontmatter marker (Meta/TagManagement)
// but do NOT match the dated `Tag Analysis Report - *.md` filename. The old filename-only
// exclusion left them SCANNED (inventory pollution) and APPLY-ELIGIBLE (their tag-shaped
// content rewritten on apply --write). Marker-based exclusion (gated to non-root reportDir)
// closes both.

test('F1: sibling report artifact (marker, non-matching name) is excluded from the audit scan', () => {
  const dir = tmpVault({
    'note.md': '---\ntags:\n  - github\n---\nbody\n',
    'reports/Master Summary.md': '---\ntags:\n  - Meta/TagManagement\n  - github\n---\nsummary body\n',
  });
  try {
    const out = runAudit(dir, {
      date: '2026-06-20',
      defaultsPath: path.join(__dirname, '..', 'references', 'tag-overrides.default.json'),
      configText: null,
      reportDirAbs: path.join(dir, 'reports'), // dedicated sub-folder (non-root)
    });
    assert.match(out.report, /\*\*Analyzed:\*\* 1 notes/, 'the marker-bearing sibling must be excluded from the scan');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('F1 (do no harm): apply --write never rewrites a sibling report artifact', () => {
  const dir = tmpVault({
    'note.md': '---\ntags:\n  - github\n---\nbody\n',
    'reports/Master Summary.md': '---\ntags:\n  - Meta/TagManagement\n  - github\n---\nsummary body\n',
  });
  const artifactPath = path.join(dir, 'reports', 'Master Summary.md');
  const before = fs.readFileSync(artifactPath, 'utf8');
  try {
    const res = applyToVault(dir, [{ type: 'rename', from: 'github', to: 'GitHub' }], {
      write: true,
      reportDirAbs: path.join(dir, 'reports'),
    });
    assert.ok(res.changedCount >= 1, 'the real note should be rewritten');
    assert.equal(
      fs.readFileSync(artifactPath, 'utf8'),
      before,
      'the sibling report artifact must be byte-identical after apply (never rewritten)'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('F1 invariant preserved: at reportDir == root, a real note carrying the marker is NOT dropped', () => {
  // The documented invariant (cli.js): real notes stay in scope even when reportDir == root.
  // Marker exclusion must therefore be gated OFF at root — only named artifacts excluded there.
  const dir = tmpVault({
    'real-but-marked.md': '---\ntags:\n  - Meta/TagManagement\n  - github\n---\na real user note that happens to carry the marker\n',
    'plain.md': '---\ntags:\n  - github\n---\nbody\n',
  });
  try {
    const out = runAudit(dir, {
      date: '2026-06-20',
      defaultsPath: path.join(__dirname, '..', 'references', 'tag-overrides.default.json'),
      configText: null,
      reportDirAbs: dir, // root case
    });
    assert.match(out.report, /\*\*Analyzed:\*\* 2 notes/, 'at root, the marker must NOT drop a real note');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- CLI integration test: apply --report-dir produces after-changes report (Task 9 missing deliverable) ----

test('CLI apply --from-recs --report-dir: writes after-changes report to report dir', () => {
  const cli = path.join(__dirname, '..', 'scripts', 'cli.js');
  const fixtureDir = path.join(__dirname, 'fixtures-audit');

  // Copy fixture vault to a tmp dir so we can write safely.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tagm-after-report-'));
  try {
    fs.cpSync(fixtureDir, tmpDir, { recursive: true });

    // Write a recommendations JSON for the rename research -> Research.
    const recsJson = JSON.stringify([{ id: 1, ops: [{ type: 'rename', from: 'research', to: 'Research' }] }]);
    const recsFile = path.join(tmpDir, 'recs.json');
    fs.writeFileSync(recsFile, recsJson, 'utf8');

    const r = spawnSync(
      'node',
      [cli, 'apply', tmpDir, '--from-recs', recsFile, '--write', '--report-dir', tmpDir, '--date', '2026-06-20'],
      { encoding: 'utf8' }
    );
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}\nstdout:${r.stdout}\nstderr:${r.stderr}`);

    // After-changes report must exist with the correct filename suffix.
    const afterReport = path.join(tmpDir, '2026-06-20 Tag Analysis Report - Vault-wide - after changes.md');
    assert.ok(fs.existsSync(afterReport), `after-changes report not found at ${afterReport}`);
    const afterContent = fs.readFileSync(afterReport, 'utf8');
    assert.match(afterContent, /Tag Analysis Report/);
    // Hardened: report must show a non-zero note count — catches self-poisoning (0-note report)
    assert.match(afterContent, /\*\*Analyzed:\*\* [1-9]/, 'after-changes report must show non-zero analyzed note count');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// --- Phase 1 NEST integration: runAudit emits nest recs to a SEPARATE file ----
const DEFAULTS = path.join(__dirname, '..', 'references', 'tag-overrides.default.json');
const cfgWithHierarchy = (h) => '# Tag Manage Config\n\n```json\n' + JSON.stringify({ hierarchy: h }, null, 2) + '\n```\n';

test('runAudit: a configured hierarchy yields nest recommendations, kept OUT of the default cleanup recs', () => {
  const dir = tmpVault({ 'a.md': '---\ntags:\n  - daytrading\n---\n#daytrading body\n' });
  const reportDirAbs = path.join(dir, 'Meta', 'Tag Management');
  const out = runAudit(dir, { date: '2026-06-22', defaultsPath: DEFAULTS,
    configText: cfgWithHierarchy({ Investing: ['DayTrading'] }), reportDirAbs });
  assert.equal(out.nestRecommendations.length, 1);
  assert.equal(out.nestRecommendations[0].to, 'Investing/DayTrading');
  assert.equal(out.recommendations.some((r) => r.kind === 'nest'), false,
    'nest recs must NOT be bundled into the default cleanup recommendations');
});

test('runAudit: nest recs are written to a separate .tag-manage-nest.json (clean recs file stays nest-free)', () => {
  const dir = tmpVault({ 'a.md': '---\ntags:\n  - daytrading\n---\n' });
  const reportDirAbs = path.join(dir, 'Meta', 'Tag Management');
  runAudit(dir, { date: '2026-06-22', defaultsPath: DEFAULTS,
    configText: cfgWithHierarchy({ Investing: ['DayTrading'] }), reportDirAbs });
  const nest = JSON.parse(fs.readFileSync(path.join(reportDirAbs, '.tag-manage-nest.json'), 'utf8'));
  assert.equal(nest[0].to, 'Investing/DayTrading');
  const clean = JSON.parse(fs.readFileSync(path.join(reportDirAbs, '.tag-manage-recommendations.json'), 'utf8'));
  assert.equal(clean.some((r) => r.kind === 'nest'), false);
});

test('runAudit: no hierarchy configured -> no nest file, empty nestRecommendations', () => {
  const dir = tmpVault({ 'a.md': '---\ntags:\n  - daytrading\n---\n' });
  const reportDirAbs = path.join(dir, 'Meta', 'Tag Management');
  const out = runAudit(dir, { date: '2026-06-22', defaultsPath: DEFAULTS, configText: null, reportDirAbs });
  assert.deepEqual(out.nestRecommendations, []);
  assert.equal(fs.existsSync(path.join(reportDirAbs, '.tag-manage-nest.json')), false);
});

test('NEST end-to-end: the written nest file applies through the existing selectOps/applyToVault path', () => {
  const dir = tmpVault({ 'a.md': '---\ntags:\n  - daytrading\n---\nSee #daytrading.\n' });
  const reportDirAbs = path.join(dir, 'Meta', 'Tag Management');
  runAudit(dir, { date: '2026-06-22', defaultsPath: DEFAULTS,
    configText: cfgWithHierarchy({ Investing: ['DayTrading'] }), reportDirAbs });
  const nestRecs = JSON.parse(fs.readFileSync(path.join(reportDirAbs, '.tag-manage-nest.json'), 'utf8'));
  const ops = selectOps(nestRecs, 'all');
  applyToVault(dir, ops, { write: true, reportDirAbs });
  const after = fs.readFileSync(path.join(dir, 'a.md'), 'utf8');
  assert.match(after, /- Investing\/DayTrading/);
  assert.match(after, /#Investing\/DayTrading/);
  assert.doesNotMatch(after, /#daytrading\b/);
});

// --- F-NEST-1 (live UAT, 2026-06-22): converged re-audit clears the stale nest file ---
// After a nest is applied, a re-audit computes 0 nest recs (convergence). The main recs
// file is rewritten to [] unconditionally, but the nest sidecar was written only when
// recs > 0 -> the OLD recs stayed on disk. Result: the report .md (and main recs) say
// "no nests" while .tag-manage-nest.json still lists the applied ones -> a divergence
// between the human-facing report and the machine sidecar. Found by live UAT; the prior
// convergence test only asserted the RETURN value was [], never the on-disk artifact.
test('runAudit: a converged re-audit clears the stale .tag-manage-nest.json to [] (no report/sidecar divergence)', () => {
  const dir = tmpVault({ 'a.md': '---\ntags:\n  - daytrading\n---\nSee #daytrading.\n' });
  const reportDirAbs = path.join(dir, 'Meta', 'Tag Management');
  const opts = { date: '2026-06-22', defaultsPath: DEFAULTS,
    configText: cfgWithHierarchy({ Investing: ['DayTrading'] }), reportDirAbs };
  const nestPath = path.join(reportDirAbs, '.tag-manage-nest.json');

  // Audit #1: the nest rec is written.
  runAudit(dir, opts);
  assert.equal(JSON.parse(fs.readFileSync(nestPath, 'utf8')).length, 1, 'audit #1 writes the nest rec');

  // Apply the nest -> the flat child is now nested; nothing is left to nest.
  const ops = selectOps(JSON.parse(fs.readFileSync(nestPath, 'utf8')), 'all');
  applyToVault(dir, ops, { write: true, reportDirAbs });

  // Audit #2 (convergence): 0 nest recs computed -> the on-disk sidecar MUST be cleared to [].
  const out = runAudit(dir, opts);
  assert.deepEqual(out.nestRecommendations, [], 'converged: no nest recs computed');
  assert.deepEqual(JSON.parse(fs.readFileSync(nestPath, 'utf8')), [],
    'the on-disk nest sidecar must be cleared to [] on convergence (no stale recs diverging from the report)');
});

// ---- Slice 1.5 Task 1: report-filename HHMM stamp (Finding A regression) ----

test('reportStamp: explicit --date suppresses the stamp (deterministic names for tests)', () => {
  assert.equal(reportStamp('2026-06-24T14:30:05.000Z', true), '');
});

test('reportStamp: clock-default path stamps UTC HHMM so same-day re-runs do not collide', () => {
  assert.equal(reportStamp('2026-06-24T14:30:05.000Z', false), '1430');
  assert.equal(reportStamp('2026-06-22T09:07:00.000Z', false), '0907');
});

test('runAudit: a non-empty fileStamp lands in the report filename (no same-day overwrite)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tagm-stamp-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'n.md'), '---\ntags:\n  - research\n---\nx\n', 'utf8');
    const out = runAudit(tmpDir, {
      date: '2026-06-24', fileStamp: '1430',
      defaultsPath: path.join(__dirname, '..', 'references', 'tag-overrides.default.json'),
      configText: null, reportDirAbs: tmpDir,
    });
    assert.ok(out.reportPath.endsWith('2026-06-24 1430 Tag Analysis Report - Vault-wide.md'), out.reportPath);
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

// ---- Slice 1.5 Task 3: induce proposal note + generalized artifact exclusion ----

test('excludeReportArtifacts: drops Tag Organize Proposal + marker siblings, keeps real + near-miss', () => {
  const dir = '/vault';
  const reportDir = path.join(dir, 'Meta', 'Tag Reports'); // non-underscore -> markerEligible
  const notes = [
    { path: path.join(reportDir, '2026-06-24 1430 Tag Organize Proposal - Vault-wide.md'), text: '---\ntags:\n  - Meta/TagManagement\n---\nx\n' },
    { path: path.join(reportDir, 'Master Summary.md'), text: '---\ntags:\n  - Meta/TagManagement\n---\nx\n' },
    { path: path.join(reportDir, 'My Tag Organize Proposal Notes.md'), text: '---\ntags:\n  - research\n---\nx\n' },
    { path: path.join(dir, 'real.md'), text: '---\ntags:\n  - research\n---\nx\n' },
  ];
  const kept = excludeReportArtifacts(notes, dir, reportDir).map((n) => path.basename(n.path));
  assert.ok(!kept.includes('2026-06-24 1430 Tag Organize Proposal - Vault-wide.md'), 'proposal note excluded by regex');
  assert.ok(!kept.includes('Master Summary.md'), 'marker sibling excluded');
  assert.ok(kept.includes('My Tag Organize Proposal Notes.md'), 'near-miss name kept (no marker, no " - " match)');
  assert.ok(kept.includes('real.md'), 'real note kept');
});

test('excludeReportArtifacts (root case): proposal note excluded by the generalized filename regex (marker gated off at root)', () => {
  const dir = '/vault';
  const notes = [
    { path: path.join(dir, '2026-06-24 1430 Tag Organize Proposal - Vault-wide.md'), text: '---\ntags:\n  - Meta/TagManagement\n---\nx\n' },
    { path: path.join(dir, 'real.md'), text: '---\ntags:\n  - research\n---\nx\n' },
  ];
  // reportDir == root -> markerEligible is false, so ONLY the filename regex can exclude.
  const kept = excludeReportArtifacts(notes, dir, dir).map((n) => path.basename(n.path));
  assert.ok(!kept.includes('2026-06-24 1430 Tag Organize Proposal - Vault-wide.md'), 'proposal note excluded by filename regex even at root');
  assert.ok(kept.includes('real.md'), 'real note kept at root');
});

test('runInduce: writes a stamped proposal note only when reportDirAbs is set; dot-sidecar always', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tagm-induce-note-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'a.md'), '---\ntags:\n  - LinkedInMarketing\n---\nx\n', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'b.md'), '---\ntags:\n  - LinkedInOutreach\n---\ny\n', 'utf8');

    const r1 = runInduce(tmpDir, { date: '2026-06-24', fileStamp: '' });
    assert.equal(r1.notePath, null, 'no .md note without reportDirAbs');
    assert.ok(fs.existsSync(r1.outPath), 'dot-sidecar always written');

    const rd = path.join(tmpDir, 'reports');
    const r2 = runInduce(tmpDir, { reportDirAbs: rd, date: '2026-06-24', fileStamp: '1430' });
    assert.ok(r2.notePath.endsWith('2026-06-24 1430 Tag Organize Proposal - Vault-wide.md'), r2.notePath);
    const note = fs.readFileSync(r2.notePath, 'utf8');
    assert.match(note, /Meta\/TagManagement/);
    assert.match(note, /`Linked`/);            // parent (leading token), backtick-wrapped
    assert.match(note, /`LinkedInMarketing`/); // a child
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

test('runInduce: scores clusters; declared-parent + frequency reach implement; JSON carries score/category', () => {
  const dir = tmpVault({
    'p1.md': '---\ntags:\n  - ProjectManagement\n---\nx\n',
    'p2.md': '---\ntags:\n  - ProjectManagement\n---\nx\n',
    'p3.md': '---\ntags:\n  - ProjectManagement\n---\nx\n',
    'p4.md': '---\ntags:\n  - ProjectInstructions\n---\nx\n',
    'p5.md': '---\ntags:\n  - ProjectInstructions\n---\nx\n',
  });
  const reportDirAbs = path.join(dir, '_reports');
  const { clusters } = runInduce(dir, { reportDirAbs, date: '2026-06-25', declaredParents: ['Project'] });
  const project = clusters.find((c) => c.parent === 'Project');
  assert.ok(project, 'Project family proposed');
  assert.equal(project.notesTotal, 5);   // ProjectManagement 3 + ProjectInstructions 2
  assert.equal(project.score, 75);       // base 40 + declared 25 + freq 10
  assert.equal(project.category, 'implement');
  assert.ok(project.children.every((ch) => typeof ch.count === 'number'));
  const written = JSON.parse(fs.readFileSync(path.join(reportDirAbs, '.tag-organize-clusters.json'), 'utf8'));
  assert.ok(written[0].category && typeof written[0].score === 'number', 'JSON carries score + category');
});
