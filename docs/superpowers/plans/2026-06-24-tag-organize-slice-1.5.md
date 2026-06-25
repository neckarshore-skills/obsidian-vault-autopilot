# tag-organize Slice 1.5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `induce` a browsable human-readable proposal note (mirroring the audit's dual artifact) and restore the lost `HHMM` stamp on report filenames so same-day re-runs no longer overwrite.

**Architecture:** Pure renderer (`renderProposal`) in `report.js` + a pure filename-stamp helper (`reportStamp`) in `cli.js`; `runInduce` writes the note only when a report home is configured and excludes report artifacts before scanning. No new write surface for tags — induce stays read-only on notes (it only writes its own artifacts).

**Tech Stack:** Node.js, `node:test`, `node:fs`. No new dependencies.

## Global Constraints

- No emoji in skill files or scripts.
- `report.js` is a **pure** markdown builder: date injected, **no clock**. The clock lives only in `cli.js resolveReportContext`.
- Anti-poisoning invariant (OBI-2026-06-21-2): a report artifact MUST carry the `Meta/TagManagement` frontmatter marker and MUST NOT emit any bare `#token` in its body (the obsidian-linter promotes such tokens into frontmatter on save).
- Filename uniqueness rule: `--date` given => no stamp (deterministic names, tests stay green); no `--date` => `HHMM` (UTC) stamp.
- Test runner: `node --test skills/tag-manage/tests/*.test.js` (via `bash scripts/test-tag-manage.sh`).
- Commit message trailer (every commit):
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011bnSCGVaBM4gxQr9s5HNvC
  ```

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `skills/tag-manage/scripts/report.js` | pure markdown builders | NEW `renderProposal`; export it |
| `skills/tag-manage/scripts/cli.js` | fs + CLI shell | NEW `reportStamp`; `resolveReportContext` returns `fileStamp`; `runAudit` + `runInduce` use it; `runInduce` writes the note + excludes artifacts; `isReportArtifact` regex generalized; export `reportStamp` + `excludeReportArtifacts` |
| `skills/tag-manage/tests/report.test.js` | renderProposal tests | +3 assertions |
| `skills/tag-manage/tests/cli.test.js` | stamp + induce + exclusion tests | +4 assertions |
| `skills/tag-organize/SKILL.md` | skill flow doc | flow step 1 + known-limitations |
| `README.md`, `logs/changelog.md` | user docs | one row each |

---

### Task 1: Filename stamp (Finding A)

**Files:**
- Modify: `skills/tag-manage/scripts/cli.js` (`reportStamp`, `resolveReportContext`, `runAudit`, CLI audit/apply callers, `module.exports`)
- Test: `skills/tag-manage/tests/cli.test.js`

**Interfaces:**
- Produces: `reportStamp(isoString: string, hasExplicitDate: boolean): string` — `''` if explicit date, else `HHMM` of the ISO instant. `resolveReportContext` now also returns `fileStamp: string`. `runAudit` accepts `fileStamp` (default `''`).

- [ ] **Step 1: Write the failing tests**

Add `reportStamp` to the existing `require('../scripts/cli.js')` destructure at the top of `cli.test.js`, then append:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="reportStamp|fileStamp lands" skills/tag-manage/tests/cli.test.js`
Expected: FAIL — `reportStamp is not a function` (not exported) / filename has no stamp.

- [ ] **Step 3: Implement `reportStamp` and thread `fileStamp` through**

In `cli.js`, add the helper directly above `resolveReportContext`:

```js
// Filename time-stamp. Explicit --date => '' (deterministic names; the test seam).
// Otherwise the UTC HHMM of the run instant, so same-day re-runs get distinct names
// instead of overwriting. Restores pre-2026-06-24 behavior; slice(0,10) had dropped it.
function reportStamp(isoString, hasExplicitDate) {
  if (hasExplicitDate) return '';
  return isoString.slice(11, 16).replace(':', '');
}
```

In `resolveReportContext`, replace the `date` line and the `return`:

```js
  const dateFlag = getFlagValue(rest, '--date');
  const iso = new Date().toISOString();
  const date = dateFlag || iso.slice(0, 10);
  const fileStamp = reportStamp(iso, !!dateFlag);
  return { defaultsPath, configText, reportDirAbs, date, fileStamp };
```

In `runAudit`, add `fileStamp = ''` to the destructured options and use it in the report filename:

```js
function runAudit(dir, { date, fileStamp = '', defaultsPath, configText, reportDirAbs, nameSuffix = '' }) {
```
```js
    reportPath = path.join(reportDirAbs, `${date}${fileStamp ? ' ' + fileStamp : ''} Tag Analysis Report - Vault-wide${nameSuffix}.md`);
```

In the CLI `audit` branch, thread `fileStamp`:

```js
      const { defaultsPath, configText, reportDirAbs, date, fileStamp } = resolveReportContext(target, rest);
      const out = runAudit(target, { date, fileStamp, defaultsPath, configText, reportDirAbs });
```

In the CLI `plan`/`apply` branch, thread `fileStamp` into the after-changes report:

```js
      const { defaultsPath, configText, reportDirAbs, date, fileStamp } = resolveReportContext(target, rest);
```
```js
        const afterOut = runAudit(target, { date, fileStamp, defaultsPath, configText, reportDirAbs, nameSuffix: ' - after changes' });
```

Add `reportStamp` to `module.exports`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --test-name-pattern="reportStamp|fileStamp lands" skills/tag-manage/tests/cli.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full cli + report-home suites to confirm `--date` callers stay un-stamped**

Run: `node --test skills/tag-manage/tests/cli.test.js skills/tag-manage/tests/report-home.test.js`
Expected: PASS, 0 failures (all existing `--date` filename assertions still match the un-stamped names, because `fileStamp` defaults to `''`).

- [ ] **Step 6: Commit**

```bash
git add skills/tag-manage/scripts/cli.js skills/tag-manage/tests/cli.test.js
git commit -m "feat(tag-manage): restore HHMM report-filename stamp (Finding A)

$(printf 'Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_011bnSCGVaBM4gxQr9s5HNvC')"
```

---

### Task 2: `renderProposal` pure renderer (Finding B)

**Files:**
- Modify: `skills/tag-manage/scripts/report.js` (new `renderProposal`, export)
- Test: `skills/tag-manage/tests/report.test.js`

**Interfaces:**
- Consumes: `REPORT_MARKER_TAG`, `fmt`, `table` (already in `report.js`).
- Produces: `renderProposal({ scope: string, date: string, clusters: Array<{parent, children, basis}> }): string` — a full note (frontmatter + body). Used by `runInduce` in Task 3.

- [ ] **Step 1: Write the failing tests**

Append to `report.test.js` (add `renderProposal` to the existing `require('../scripts/report.js')` and add `const { frontmatterTags } = require('../scripts/tags.js');` if not present):

```js
const SAMPLE = [
  { parent: 'Linked', children: ['LinkedInMarketing', 'LinkedInOutreach'], basis: 'name: 2 tags share leading token "linked"' },
  { parent: 'Open', children: ['OpenAI', 'OpenSource'], basis: 'name: 2 tags share leading token "open"' },
];

test('renderProposal: frontmatter carries ONLY the report marker tag (no family names leak in)', () => {
  const md = renderProposal({ scope: 'Vault-wide', date: '2026-06-24', clusters: SAMPLE });
  const fm = frontmatterTags(md).map((t) => t.tag);
  assert.deepEqual(fm, ['Meta/TagManagement']);
});

test('renderProposal: body emits NO bare #token (obsidian-linter would promote it -> poisoning)', () => {
  const md = renderProposal({ scope: 'Vault-wide', date: '2026-06-24', clusters: SAMPLE });
  // '#' followed immediately by a tag char is a tag token; '# ' / '## ' headings are safe.
  assert.doesNotMatch(md, /#[A-Za-z0-9_]/);
});

test('renderProposal: every parent and child is backtick-wrapped (readable + linter-inert)', () => {
  const md = renderProposal({ scope: 'Vault-wide', date: '2026-06-24', clusters: SAMPLE });
  for (const c of SAMPLE) {
    assert.match(md, new RegExp('`' + c.parent + '`'));
    for (const ch of c.children) assert.match(md, new RegExp('`' + ch + '`'));
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="renderProposal" skills/tag-manage/tests/report.test.js`
Expected: FAIL — `renderProposal is not a function`.

- [ ] **Step 3: Implement `renderProposal`**

In `report.js`, add above `module.exports`:

```js
// Human-readable induce proposal artifact. Mirrors renderReport: date injected (no clock),
// carries REPORT_MARKER_TAG so future scans exclude it, backtick-wraps every tag name, and
// emits NO bare #token (the obsidian-linter would promote such a token into this note's own
// frontmatter -> self-poisoning; the OBI-2026-06-21-2 invariant). Name-only proposals to prune.
function renderProposal({ scope, date, clusters }) {
  const lines = [];
  lines.push(`---\ntitle: 'Tag Organize Proposal - ${scope} - ${date}'\ntype: inbox\nstatus: draft\ncreated: ${date}\ntags:\n  - ${REPORT_MARKER_TAG}\n---\n`);
  lines.push(`# Tag Organize Proposal\n`);
  lines.push(`> [!summary]\n> **Scope:** ${scope}\n> **Candidate families:** ${fmt(clusters.length)}\n> Name-only groupings by shared leading token. Prune freely — a large family can be semantically empty (e.g. \`Open\` over \`OpenAI\` + \`OpenSource\`). Approve the good ones via \`set-hierarchy\`.\n`);
  lines.push(`## Candidate Families\n\n` + (clusters.length ? table(['#', 'Parent', 'Children', 'Basis'], clusters.map((c, i) => [
    i + 1, `\`${c.parent}\``, c.children.map((ch) => `\`${ch}\``).join(', '), c.basis,
  ])) : '_No candidate families._') + '\n');
  lines.push(`> [!tip] Next Steps\n> For each family you approve: \`cli.js set-hierarchy <vault> --parent <Parent> --children <Child1,Child2>\`, then re-audit and apply the nests behind the confirm gate. Skip families that do not represent a real parent.\n`);
  return lines.join('\n');
}
```

Add `renderProposal` to `module.exports`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --test-name-pattern="renderProposal" skills/tag-manage/tests/report.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add skills/tag-manage/scripts/report.js skills/tag-manage/tests/report.test.js
git commit -m "feat(tag-organize): renderProposal — human-readable induce proposal note (Finding B)

$(printf 'Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_011bnSCGVaBM4gxQr9s5HNvC')"
```

---

### Task 3: `runInduce` writes the note + artifact exclusion (Finding B)

**Files:**
- Modify: `skills/tag-manage/scripts/cli.js` (`require` renderProposal; generalize `isReportArtifact` regex; rewrite `runInduce`; induce CLI branch; export `excludeReportArtifacts`)
- Test: `skills/tag-manage/tests/cli.test.js`

**Interfaces:**
- Consumes: `renderProposal` (Task 2); `reportStamp`/`fileStamp` (Task 1); `excludeReportArtifacts`, `buildInventory`, `clusterByName` (existing).
- Produces: `runInduce(dir, { reportDirAbs?, date, fileStamp?, scope? }): { clusters, outPath, notePath }` — `notePath` is `null` unless `reportDirAbs` is set. `excludeReportArtifacts` is now exported.

- [ ] **Step 1: Write the failing tests**

Add `excludeReportArtifacts` to the `require('../scripts/cli.js')` destructure in `cli.test.js`, then append:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="excludeReportArtifacts|runInduce: writes" skills/tag-manage/tests/cli.test.js`
Expected: FAIL — `excludeReportArtifacts is not a function`; `runInduce` returns no `notePath` and writes no note.

- [ ] **Step 3: Generalize the exclusion regex**

In `cli.js isReportArtifact`, change the filename test:

```js
  if (b === '.tag-manage-recommendations.json' || / Tag (Analysis Report|Organize Proposal) - .+\.md$/.test(b)) return true;
```

- [ ] **Step 4: Rewrite `runInduce` to exclude artifacts and write the note**

Add `renderProposal` to the `require('./report.js')` destructure (alongside `renderReport, REPORT_MARKER_TAG`). Replace `runInduce`:

```js
function runInduce(dir, { reportDirAbs, date, fileStamp = '', scope = 'Vault-wide' } = {}) {
  const inventory = buildInventory(excludeReportArtifacts(readNotes(dir), dir, reportDirAbs));
  const clusters = clusterByName(inventory);
  const outDir = reportDirAbs || dir;
  const outPath = path.join(outDir, '.tag-organize-clusters.json');
  fs.writeFileSync(outPath, JSON.stringify(clusters, null, 2), 'utf8');
  let notePath = null;
  if (reportDirAbs) {
    fs.mkdirSync(reportDirAbs, { recursive: true });
    notePath = path.join(reportDirAbs, `${date}${fileStamp ? ' ' + fileStamp : ''} Tag Organize Proposal - ${scope}.md`);
    fs.writeFileSync(notePath, renderProposal({ scope, date, clusters }), 'utf8');
  }
  return { clusters, outPath, notePath };
}
```

Update the CLI `induce` branch to thread `date`/`fileStamp` and announce the note:

```js
    if (cmd === 'induce') {
      if (!target) throw Object.assign(new Error('usage: cli.js induce <vault> [--report-dir DIR]'), { usage: true });
      const { reportDirAbs, date, fileStamp } = resolveReportContext(target, rest);
      const { clusters, outPath, notePath } = runInduce(target, { reportDirAbs, date, fileStamp });
      console.error(`induce: ${clusters.length} candidate ${clusters.length === 1 ? 'family' : 'families'} proposed -> ${outPath}`);
      if (notePath) console.error(`  proposal note: ${notePath}`);
      console.error('  review, then per approved cluster: cli.js set-hierarchy <vault> --parent <P> --children <C1,C2>');
      process.exit(0);
    }
```

Add `excludeReportArtifacts` to `module.exports`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test --test-name-pattern="excludeReportArtifacts|runInduce" skills/tag-manage/tests/cli.test.js`
Expected: PASS (the new tests + the existing `runInduce` test).

- [ ] **Step 6: Commit**

```bash
git add skills/tag-manage/scripts/cli.js skills/tag-manage/tests/cli.test.js
git commit -m "feat(tag-organize): induce writes a scan-safe proposal note + generalize artifact exclusion (Finding B)

$(printf 'Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_011bnSCGVaBM4gxQr9s5HNvC')"
```

---

### Task 4: Docs + full-suite verification

**Files:**
- Modify: `skills/tag-organize/SKILL.md`, `README.md`, `logs/changelog.md`

- [ ] **Step 1: Update the tag-organize SKILL.md flow + known-limitations**

In `skills/tag-organize/SKILL.md`, the induce step (the paragraph after the `induce` code block) — replace the sentence describing the sidecar with:

```
This writes `.tag-organize-clusters.json` (a dot-prefixed sidecar, never scanned) and,
when a report home is configured, a browsable `<date> Tag Organize Proposal - Vault-wide.md`
note — the human-readable view of the same families. Read either.
```

In the `## Known limitations (Slice 1)` section, add a bullet:

```
- A configured `reportDir` (via `Tag Manage Config.md`) makes `audit` and `induce`
  WRITE their report artifacts even without `--report-dir`. A "read-only audit" is not
  strictly read-only when a report home is set; the dated `HHMM` filename keeps same-day
  re-runs from overwriting each other.
```

- [ ] **Step 2: Add a changelog row**

In `logs/changelog.md`, add under the current in-development section:

```
- tag-organize Slice 1.5: `induce` now writes a human-readable proposal note (not just the
  hidden sidecar); report filenames carry an `HHMM` stamp again so same-day re-runs do not
  overwrite (Finding A regression fix). Artifact exclusion generalized to the proposal note.
```

- [ ] **Step 3: Update the README tag-organize row**

In `README.md`, extend the in-preview `tag-organize` row description to mention the proposal note (keep the existing wording; append): `— proposes a hierarchy over flat tags and writes a browsable proposal note for review.`

- [ ] **Step 4: Run the FULL tag-manage suite (0 regression gate)**

Run: `bash scripts/test-tag-manage.sh`
Expected: PASS — all `*.test.js`, 0 failures, ~177 tests (169 prior + 8 new: 3 stamp/filename, 3 renderProposal, 2 exclusion/induce). Record the exact count.

- [ ] **Step 5: Run the broader shell test loop (cross-skill regression)**

Run: `for t in scripts/test-*.sh; do echo "== $t =="; bash "$t" || echo "FAIL: $t"; done`
Expected: no `FAIL:` lines.

- [ ] **Step 6: End-to-end CLI smoke on a throwaway dir (no vault touched)**

```bash
TMP=$(mktemp -d)
printf -- '---\ntags:\n  - LinkedInMarketing\n---\nx\n' > "$TMP/a.md"
printf -- '---\ntags:\n  - LinkedInOutreach\n---\ny\n' > "$TMP/b.md"
node skills/tag-manage/scripts/cli.js induce "$TMP" --report-dir "$TMP/reports"
ls "$TMP/reports/"   # expect: a dated "Tag Organize Proposal - Vault-wide.md" + .tag-organize-clusters.json
rm -rf "$TMP"
```
Expected: the proposal `.md` (with an `HHMM` stamp, since no `--date`) and the dot-sidecar both present.

- [ ] **Step 7: Commit**

```bash
git add skills/tag-organize/SKILL.md README.md logs/changelog.md
git commit -m "docs(tag-organize): document Slice 1.5 proposal note + read-only-audit caveat

$(printf 'Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_011bnSCGVaBM4gxQr9s5HNvC')"
```

---

## Self-Review

**Spec coverage:**
- Finding A (filename stamp) → Task 1. ✓
- Finding B renderer (`renderProposal`) → Task 2. ✓
- Finding B wiring (`runInduce` note + `excludeReportArtifacts` + write-if-reportDirAbs) → Task 3. ✓
- Exclusion regex generalization → Task 3 Step 3. ✓
- Docs (SKILL.md flow + known-limitation, README, changelog) → Task 4. ✓
- Captured finding (read-only audit caveat) → Task 4 Step 1. ✓
- Out-of-scope items (confidence heuristic, body timestamp, collision suffix, findings 3/4/5) → not built. ✓

**Test-design correction vs the spec:** the spec's Test 1 proposed a `scanBody` contrast. That is **vacuous** — `scanBody` only matches `#`-prefixed inline tags, and the proposal note's family names are never `#`-prefixed. The real poisoning vector is the obsidian-linter promoting bare `#token`s into frontmatter. Task 2's tests pin the correct invariants: (a) frontmatter carries only the marker, (b) the body emits no bare `#token`, (c) names are backtick-wrapped. The spec's Testing section is corrected in the same commit.

**Placeholder scan:** no TBD/TODO; every code step shows complete code; every run step has an exact command + expected result. ✓

**Type consistency:** `reportStamp(iso, hasExplicitDate)`, `fileStamp` (string, default `''`), `renderProposal({scope,date,clusters})`, `runInduce(...) -> {clusters,outPath,notePath}`, `excludeReportArtifacts(notes,dir,reportDirAbs)` — names match across tasks and against the verified source (`tags.js` exports `bodyTags`/`buildInventory`/`frontmatterTags`; `report.js` has `fmt`/`table`/`REPORT_MARKER_TAG`). ✓
