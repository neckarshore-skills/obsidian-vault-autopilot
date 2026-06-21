# tag-manage First-Run Report Home — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the first report run, detect candidate report homes, propose a smart fresh location, ask the user, and persist the choice in `Tag Manage Config.md` so all follow-up reports land there — plus the two coupled fixes (mkdir, apply self-poisoning).

**Architecture:** Hybrid — a new deterministic module `report-home.js` does detection + persistence (unit-tested, no hallucinated paths); the agent runs the human "where?" gate via SKILL.md. Two CLI subcommands expose the module. Two bug fixes harden the audit/apply write paths.

**Tech Stack:** Node.js (`node:fs`, `node:path`), `node:test` + `node:assert/strict`. No new dependencies.

## Global Constraints

- No new npm dependencies (engine is dependency-free).
- All code/comments in English; files kebab-case.
- No hardcoded vault paths.
- Existing 113-test suite must stay green. Run the full suite with: `node --test skills/tag-manage/tests/*.test.js`.
- Test fixture helper (copy into each new test file): `tmpVault(files)` via `fs.mkdtempSync` (see Task 1 Step 1).
- Determinism is the safety guarantee — detection ranking and config rewrites are pure/deterministic; A→Z sort where order is otherwise undefined.

---

### Task 1: `suggestReportDir` — deterministic candidate detection

**Files:**
- Create: `skills/tag-manage/scripts/report-home.js`
- Test: `skills/tag-manage/tests/report-home.test.js`

**Interfaces:**
- Consumes: `extractJsonFence` from `./config.js` (used in Task 2).
- Produces: `suggestReportDir(vaultAbs) -> { recommended: string, candidates: Array<{ relpath: string, reason: string, exists: boolean }> }`.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/tag-manage/tests/report-home.test.js`
Expected: FAIL — `Cannot find module '../scripts/report-home.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
'use strict';
// report-home.js — detect candidate report homes (suggestReportDir) and persist the
// chosen one (setReportDir, Task 2). Deterministic: the agent runs the human "where?"
// gate; these functions do the byte/path work so they are unit-testable.
const fs = require('node:fs');
const path = require('node:path');
const { extractJsonFence } = require('./config.js');

const SKIP = (name) => name.startsWith('.') || name.startsWith('_') || name === 'node_modules';
const ADMIN_RE = /(^|[^a-z])(meta|system|admin)([^a-z]|$)/i;
const isTagMgmtName = (n) => /tag/i.test(n) && /manage|management/i.test(n);

function topLevelDirs(vault) {
  return fs.readdirSync(vault, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !SKIP(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

function walkDirs(vault, base = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(vault, base), { withFileTypes: true })) {
    if (!e.isDirectory() || SKIP(e.name)) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    out.push(rel);
    out.push(...walkDirs(vault, rel));
  }
  return out;
}

function suggestReportDir(vault) {
  const dirs = topLevelDirs(vault);
  const candidates = [];
  const metaDir = dirs.find((d) => d.toLowerCase() === 'meta');
  if (metaDir) candidates.push({ relpath: `${metaDir}/Tag Management`, reason: 'existing Meta folder', exists: false });
  const adminDir = dirs.find((d) => ADMIN_RE.test(d) && d.toLowerCase() !== 'meta');
  if (adminDir) candidates.push({ relpath: `${adminDir}/Tag Management`, reason: 'admin-like area', exists: false });
  candidates.push({ relpath: 'Tag Management', reason: 'vault root (fallback)', exists: false });
  const cont = walkDirs(vault).filter((rel) => isTagMgmtName(path.basename(rel))).sort()[0];
  if (cont) candidates.push({ relpath: cont, reason: 'existing tag-management folder (continuity)', exists: true });
  return { recommended: candidates[0].relpath, candidates };
}

module.exports = { suggestReportDir };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/tag-manage/tests/report-home.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add skills/tag-manage/scripts/report-home.js skills/tag-manage/tests/report-home.test.js
git commit -m "feat(tag-manage): suggestReportDir — deterministic report-home candidate ranking"
```

---

### Task 2: `setReportDir` — persist the chosen home into `Tag Manage Config.md`

**Files:**
- Modify: `skills/tag-manage/scripts/report-home.js` (add `setReportDir`, export it)
- Test: `skills/tag-manage/tests/report-home.test.js` (append tests)

**Interfaces:**
- Consumes: `extractJsonFence` from `./config.js`.
- Produces: `setReportDir(vaultAbs, relpath) -> { configPath: string, created: boolean }`. Throws on absolute / `..` paths.

- [ ] **Step 1: Write the failing test** (append to `report-home.test.js`)

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/tag-manage/tests/report-home.test.js`
Expected: FAIL — `setReportDir is not a function`.

- [ ] **Step 3: Write minimal implementation** (add to `report-home.js`, extend exports)

```js
function validateRelpath(relpath) {
  if (!relpath || typeof relpath !== 'string') throw new Error('report dir path required');
  if (path.isAbsolute(relpath) || relpath.startsWith('/')) throw new Error(`report dir must be vault-relative, got absolute: ${relpath}`);
  if (relpath.split(/[\\/]/).includes('..')) throw new Error(`report dir must not escape the vault (..): ${relpath}`);
  return relpath.replace(/\/+$/, '');
}

function findConfigNote(vault, base = '') {
  for (const e of fs.readdirSync(path.join(vault, base), { withFileTypes: true })) {
    if (SKIP(e.name)) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) { const f = findConfigNote(vault, rel); if (f) return f; }
    else if (e.name === 'Tag Manage Config.md') return rel;
  }
  return null;
}

function setReportDir(vault, relpathRaw) {
  const relpath = validateRelpath(relpathRaw);
  const existingRel = findConfigNote(vault);
  if (existingRel) {
    const full = path.join(vault, existingRel);
    const text = fs.readFileSync(full, 'utf8');
    const cfg = extractJsonFence(text) || {};
    cfg.reportDir = relpath;
    const fence = '```json\n' + JSON.stringify(cfg, null, 2) + '\n```';
    const updated = extractJsonFence(text) != null
      ? text.replace(/```json\s*\n[\s\S]*?\n```/, fence)
      : `${text.replace(/\s*$/, '')}\n\n${fence}\n`;
    fs.writeFileSync(full, updated, 'utf8');
    return { configPath: full, created: false };
  }
  const full = path.join(vault, 'Tag Manage Config.md');
  const content = `# Tag Manage Config\n\nVault-local config for the tag-manage skill. \`reportDir\` is the permanent home for tag analysis reports.\n\n\`\`\`json\n${JSON.stringify({ reportDir: relpath }, null, 2)}\n\`\`\`\n`;
  fs.writeFileSync(full, content, 'utf8');
  return { configPath: full, created: true };
}

module.exports = { suggestReportDir, setReportDir };
```

(Replace the existing `module.exports` line with the one above.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/tag-manage/tests/report-home.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add skills/tag-manage/scripts/report-home.js skills/tag-manage/tests/report-home.test.js
git commit -m "feat(tag-manage): setReportDir — persist report home into Tag Manage Config.md (path-safe, idempotent)"
```

---

### Task 3: CLI subcommands `suggest-report-dir` + `set-report-dir`

**Files:**
- Modify: `skills/tag-manage/scripts/cli.js` (require report-home; add a positionals array; add two subcommand branches)
- Test: `skills/tag-manage/tests/report-home.test.js` (append spawnSync CLI tests)

**Interfaces:**
- Consumes: `suggestReportDir`, `setReportDir` from `./report-home.js`.
- Produces: CLI `suggest-report-dir <vault>` (prints JSON), `set-report-dir <vault> <relpath>` (prints config path).

- [ ] **Step 1: Write the failing test** (append)

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/tag-manage/tests/report-home.test.js`
Expected: FAIL — `suggest-report-dir` falls through to the usage error, `status` is 1, `JSON.parse` throws.

- [ ] **Step 3: Write minimal implementation**

In `skills/tag-manage/scripts/cli.js`, after the existing `require('./config.js')` line (~line 18) add:

```js
const { suggestReportDir, setReportDir } = require('./report-home.js');
```

Inside `if (require.main === module) {`, after the `target` line (~line 204), add a positionals array:

```js
const positionals = rest.filter((a, i) => !a.startsWith('--') && !flagsWithValues.has(rest[i - 1]));
```

Then, inside the `try {` block, before the `if (cmd === 'audit')` branch, add:

```js
if (cmd === 'suggest-report-dir') {
  if (!target) throw Object.assign(new Error('usage: cli.js suggest-report-dir <vault>'), { usage: true });
  console.log(JSON.stringify(suggestReportDir(target), null, 2));
  process.exit(0);
}
if (cmd === 'set-report-dir') {
  const relpath = positionals[1];
  if (!target || !relpath) throw Object.assign(new Error('usage: cli.js set-report-dir <vault> <relpath>'), { usage: true });
  const r = setReportDir(target, relpath);
  console.error(`${r.created ? 'Created' : 'Updated'} ${r.configPath}`);
  process.exit(0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/tag-manage/tests/report-home.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add skills/tag-manage/scripts/cli.js skills/tag-manage/tests/report-home.test.js
git commit -m "feat(tag-manage): CLI suggest-report-dir + set-report-dir subcommands"
```

---

### Task 4: Fix — `runAudit` creates the report dir (`mkdir -p`)

**Files:**
- Modify: `skills/tag-manage/scripts/cli.js` (`runAudit`, ~line 129)
- Test: `skills/tag-manage/tests/report-home.test.js` (append)

**Interfaces:**
- Consumes: existing `runAudit(dir, { date, defaultsPath, configText, reportDirAbs })`.
- Produces: no signature change — behaviour: a not-yet-existing `reportDirAbs` is created before writing.

- [ ] **Step 1: Write the failing test** (append)

```js
const { runAudit } = require('../scripts/cli.js');
const DEFAULTS = path.join(__dirname, '..', 'references', 'tag-overrides.default.json');

test('runAudit: creates a not-yet-existing report dir instead of aborting', () => {
  const v = tmpVault({ 'a.md': '---\ntags:\n  - ai\n---\nx\n' });
  const rd = path.join(v, 'Meta', 'Tag Management'); // does NOT exist yet
  const out = runAudit(v, { date: '2026-06-21', defaultsPath: DEFAULTS, configText: null, reportDirAbs: rd });
  assert.ok(fs.existsSync(out.reportPath), 'report written into the auto-created dir');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/tag-manage/tests/report-home.test.js`
Expected: FAIL — `ENOENT ... open '.../Meta/Tag Management/2026-06-21 Tag Analysis Report - Vault-wide.md'`.

- [ ] **Step 3: Write minimal implementation**

In `runAudit`, change the `if (reportDirAbs) {` block (~line 129) so the first statement creates the dir:

```js
  if (reportDirAbs) {
    fs.mkdirSync(reportDirAbs, { recursive: true });
    reportPath = path.join(reportDirAbs, `${date} Tag Analysis Report - Vault-wide${nameSuffix}.md`);
    fs.writeFileSync(reportPath, report, 'utf8');
    fs.writeFileSync(path.join(reportDirAbs, `.tag-manage-recommendations.json`), JSON.stringify(recommendations, null, 2), 'utf8');
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/tag-manage/tests/report-home.test.js`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add skills/tag-manage/scripts/cli.js skills/tag-manage/tests/report-home.test.js
git commit -m "fix(tag-manage): runAudit creates the report dir (mkdir -p) instead of aborting on ENOENT"
```

---

### Task 5: Fix — `apply` excludes report artifacts (no self-poisoning)

**Files:**
- Modify: `skills/tag-manage/scripts/cli.js` (`applyToVault` ~line 58; apply CLI branch ~line 229)
- Test: `skills/tag-manage/tests/report-home.test.js` (append)

**Interfaces:**
- Consumes: existing `applyToVault(dir, ops, opts)`, `isInside`, `isReportArtifact`.
- Produces: `applyToVault` accepts `opts.reportDirAbs`; report artifacts inside it are excluded from the scan (and the mass-change count).

- [ ] **Step 1: Write the failing test** (append)

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/tag-manage/tests/report-home.test.js`
Expected: FAIL — the report note is scanned and its `#1/#3/#2` tokens are touched, so the `before` assertion fails.

- [ ] **Step 3: Write minimal implementation**

In `applyToVault` (~line 63), replace `const notes = readNotes(dir);` with a filtered read:

```js
  const notes = readNotes(dir).filter((n) => !(opts.reportDirAbs && isInside(opts.reportDirAbs, n.path) && isReportArtifact(n.path)));
```

In the apply CLI branch (~line 229), resolve `reportDirAbs` BEFORE `applyToVault` and pass it through. Replace:

```js
      const res = applyToVault(target, ops, { write, massChangeThreshold });
```

with:

```js
      const { defaultsPath, configText, reportDirAbs, date } = resolveReportContext(target, rest);
      const res = applyToVault(target, ops, { write, massChangeThreshold, reportDirAbs });
```

Then in the after-report block (~line 232), reuse the already-resolved values instead of re-calling `resolveReportContext`:

```js
      if (write && res.wrote && reportDirAbs) {
        const afterOut = runAudit(target, { date, defaultsPath, configText, reportDirAbs, nameSuffix: ' - after changes' });
        if (afterOut.reportPath) console.error(`After-changes report written to ${afterOut.reportPath}`);
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/tag-manage/tests/report-home.test.js`
Expected: PASS (12 tests).

- [ ] **Step 5: Run the FULL suite (no regression)**

Run: `node --test skills/tag-manage/tests/*.test.js`
Expected: all green (was 113 + 12 new = 125 assertions; no failures).

- [ ] **Step 6: Commit**

```bash
git add skills/tag-manage/scripts/cli.js skills/tag-manage/tests/report-home.test.js
git commit -m "fix(tag-manage): apply excludes report artifacts inside reportDir (kills report self-poisoning)"
```

---

### Task 6: SKILL.md first-run workflow + changelog

**Files:**
- Modify: `skills/tag-manage/SKILL.md` (the "First-run config seeding" section)
- Modify: `logs/changelog.md`

**Interfaces:** none (docs).

- [ ] **Step 1: Update SKILL.md**

Replace the body of the "First-run config seeding (agent workflow)" section with the explicit gate:

```markdown
### First-run report-home gate (agent workflow)

On a report run where no `reportDir` is resolvable (no `Tag Manage Config.md`, or it has no
`reportDir`), seed the permanent report home before writing any report:

1. Run `node ".../cli.js" suggest-report-dir <vault>` — it returns ranked candidates as JSON
   (`recommended` plus `candidates[]` with `relpath`, `reason`, `exists`).
2. Present the recommended fresh location and the alternatives (including any `exists: true`
   continuity folder). State that the choice becomes the permanent home for all future reports.
3. **Gate:** ask the user to confirm or choose a different location. Wait for the answer.
4. Run `node ".../cli.js" set-report-dir <vault> "<chosen relpath>"` to write `reportDir`
   into `Tag Manage Config.md` (created if absent; existing brands/compounds preserved).
5. Proceed with the audit. The report (and every later run's before/after reports) now lands
   in that one home — the gate never repeats.
```

- [ ] **Step 2: Update changelog.md**

Add under the current unreleased section:

```markdown
- tag-manage: first-run report-home gate — `suggest-report-dir` proposes a smart fresh
  location based on vault structure, `set-report-dir` persists it to `Tag Manage Config.md`
  as the permanent home; follow-up reports auto-land there.
- tag-manage fix: `audit` creates the report dir (`mkdir -p`) instead of aborting on ENOENT.
- tag-manage fix: `apply` excludes report artifacts inside the report dir — a report note
  can no longer be rewritten ("self-poisoned") by an apply run.
```

- [ ] **Step 3: Commit**

```bash
git add skills/tag-manage/SKILL.md logs/changelog.md
git commit -m "docs(tag-manage): SKILL.md first-run report-home gate + changelog"
```

---

## Self-Review

**Spec coverage:**
- First-run gate (detect → propose → ask → persist) → Tasks 1, 2, 3, 6. ✓
- Smart fresh placement → Task 1 ranking. ✓
- Permanent home via `Tag Manage Config.md` → Task 2. ✓
- mkdir fix → Task 4. ✓
- apply self-poisoning fix → Task 5. ✓
- Path-safety (no `..`/absolute) → Task 2 Step 1/3. ✓
- Headless do-no-harm (stdout-only when no config) → unchanged existing behaviour; no task needed (the gate is agent-layer; CLI still writes nothing without a resolvable reportDir). ✓
- Tests RED-first, full suite green → each task + Task 5 Step 5. ✓

**Placeholder scan:** no TBD/TODO; every code + command step is concrete. ✓

**Type consistency:** `suggestReportDir -> { recommended, candidates[] }`, `setReportDir -> { configPath, created }`, `applyToVault(dir, ops, { write, massChangeThreshold, reportDirAbs })` — names consistent across Tasks 1/2/3/5. ✓
