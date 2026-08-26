# skill-library-sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a skill that reconciles the vault's Skill Library against the real skill inventory — creating missing notes, re-locating stale ones, retiring vanished ones — behind a preview-and-confirm gate.

**Architecture:** The plugin's established split: pure deterministic engine modules with no filesystem access (`library.js`, `diff.js`, `render.js`), and one fs+CLI shell (`cli.js`) that reads, gates, and writes. Plan-then-write throughout — every note is transformed in memory and every guard throws BEFORE the first write, so a refusal leaves the vault untouched.

**Tech Stack:** Node.js CommonJS, `node:test`, no dependencies. Same as `tag-manage` and `ai-paste-cleanup`.

**Spec:** `docs/superpowers/specs/2026-08-26-skill-library-sync-design.md`

## Global Constraints

- **Node CommonJS, `'use strict'`, zero runtime dependencies.** Match `skills/tag-manage/scripts/*.js`.
- **No hardcoded paths.** Vault comes from `$OBSIDIAN_VAULT_PATH` or argv; source roots come from config.
- **English in all skill files and code.** German only in the note content the skill renders, because the user's library is German.
- **No emoji anywhere in skill files.**
- **In-place writes only:** `fs.writeFileSync` on an existing path preserves APFS birthtime because no new inode is created. Never write-to-temp-then-rename for an existing note.
- **Exit codes:** `0` success, `1` findings/refused, `2` usage or guard error.
- **The body boundary:** everything above `## Notizen` is machine-owned, everything below is never written. This is the contract every task defends.
- **Read-only outside the vault, always.** The only writes are inside `library_path` and `_vault-autopilot/`.
- **Never walk a tree looking for skills.** Only paths named by config or by `installed_plugins.json`.

## File Structure

| File | Responsibility |
|---|---|
| `skills/skill-library-sync/SKILL.md` | The skill instructions Claude reads |
| `skills/skill-library-sync/scripts/library.js` | Pure: parse a note into frontmatter / machine body / notes zone; the stub constant |
| `skills/skill-library-sync/scripts/render.js` | Pure: render a note and the index from data |
| `skills/skill-library-sync/scripts/diff.js` | Pure: inventory + notes to four buckets plus renames |
| `skills/skill-library-sync/scripts/inventory.js` | fs: read the real inventory from named sources only |
| `skills/skill-library-sync/scripts/config.js` | fs: read the `skill_library` section of `_vault-autopilot-config.md` |
| `skills/skill-library-sync/scripts/cli.js` | fs + CLI: `scan` / `diff` / `apply`, gates, findings ledger |
| `skills/skill-library-sync/tests/*.test.js` | `node:test` suites, one per module |
| `scripts/test-skill-library-sync.sh` | CI bridge, auto-picked by the `scripts/test-*.sh` loop |

---

### Task 1: The body boundary

The safety contract, first, because everything else writes through it.

**Files:**
- Create: `skills/skill-library-sync/scripts/library.js`
- Test: `skills/skill-library-sync/tests/library.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `NOTES_HEADING` (string `'## Notizen'`), `STUB` (string), `parseNote(text)` returning `{ frontmatter, machineBody, notesZone, hasNotesHeading }` where `frontmatter` is a plain object of scalar strings, `machineBody` is everything between the frontmatter and the heading, `notesZone` is everything after the heading verbatim including leading whitespace, and `hasNotesHeading` is a boolean. `isReplaceableZone(notesZone)` returning a boolean.

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseNote, isReplaceableZone, STUB, NOTES_HEADING } = require('../scripts/library.js');

const NOTE = `---
title: note-rename
herkunft: eigen
status: aktiv
---

# Skill – note-rename (eigen)

**Zweck:** something

${NOTES_HEADING}

${STUB}
`;

test('parseNote splits frontmatter, machine body and notes zone', () => {
  const parsed = parseNote(NOTE);
  assert.strictEqual(parsed.frontmatter.title, 'note-rename');
  assert.strictEqual(parsed.frontmatter.herkunft, 'eigen');
  assert.strictEqual(parsed.hasNotesHeading, true);
  assert.match(parsed.machineBody, /\*\*Zweck:\*\* something/);
  assert.doesNotMatch(parsed.machineBody, /Notizen/);
  assert.strictEqual(parsed.notesZone.trim(), STUB);
});

test('the stub is replaceable', () => {
  assert.strictEqual(isReplaceableZone(`\n\n${STUB}\n`), true);
});

test('real prose is NOT replaceable', () => {
  const prose = '\n\nDieser Skill laeuft montags und schreibt in den Vault.\n';
  assert.strictEqual(isReplaceableZone(prose), false);
});

test('stub PLUS appended prose is NOT replaceable', () => {
  const mixed = `\n\n${STUB}\n\nSpaeter ergaenzt: laeuft nur auf dem M2.\n`;
  assert.strictEqual(isReplaceableZone(mixed), false);
});

test('an empty zone is replaceable', () => {
  assert.strictEqual(isReplaceableZone('\n\n'), true);
});

test('a note without the heading reports hasNotesHeading false and an empty zone', () => {
  const parsed = parseNote('---\ntitle: x\n---\n\n# Skill – x\n');
  assert.strictEqual(parsed.hasNotesHeading, false);
  assert.strictEqual(parsed.notesZone, '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/skill-library-sync/tests/library.test.js`
Expected: FAIL — `Cannot find module '../scripts/library.js'`

- [ ] **Step 3: Write minimal implementation**

```javascript
'use strict';
// library.js — pure parsing of a Skill Library note.
//
// The body boundary is this file's whole reason to exist: everything above
// `## Notizen` belongs to the machine, everything below belongs to the user and
// is never written. The placeholder stub is the one exception, and it is matched
// BYTE-FOR-BYTE. A length threshold would be the obvious shortcut and is exactly
// how an 869-character note survives today and a 90-character one is destroyed
// next month.

const NOTES_HEADING = '## Notizen';
const STUB = '(noch keine vertiefende Dokumentation — Stub aus der Bestandsaufnahme 2026-07-05)';

function parseNote(text) {
  const src = String(text);
  const fmMatch = src.match(/^---\n([\s\S]*?)\n---\n?/);
  const frontmatter = {};
  let rest = src;
  if (fmMatch) {
    rest = src.slice(fmMatch[0].length);
    for (const line of fmMatch[1].split('\n')) {
      const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*): *(.*)$/);
      if (!kv) continue;
      let value = kv[2].trim();
      if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
        value = value.slice(1, -1);
      }
      frontmatter[kv[1]] = value;
    }
  }
  const idx = rest.indexOf(NOTES_HEADING);
  if (idx === -1) {
    return { frontmatter, machineBody: rest, notesZone: '', hasNotesHeading: false };
  }
  return {
    frontmatter,
    machineBody: rest.slice(0, idx),
    notesZone: rest.slice(idx + NOTES_HEADING.length),
    hasNotesHeading: true,
  };
}

// Replaceable means: the machine put this here, so the machine may replace it.
// Anything else -- including the stub with a single line appended -- belongs to
// the user in its entirety. No surgical extraction of a stub from prose.
function isReplaceableZone(notesZone) {
  const trimmed = String(notesZone).trim();
  return trimmed === '' || trimmed === STUB;
}

module.exports = { NOTES_HEADING, STUB, parseNote, isReplaceableZone };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/skill-library-sync/tests/library.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add skills/skill-library-sync/scripts/library.js skills/skill-library-sync/tests/library.test.js
git commit -m "feat(skill-library-sync): the body boundary, matched byte-for-byte

Everything above '## Notizen' is the machine's, everything below is the
user's. The placeholder stub is the one exception and is compared as an
exact string: a length heuristic is how a long hand-written note survives
today and a short one is destroyed next month. Stub-plus-prose is preserved
entirely rather than surgically stripped."
```

---

### Task 2: Rendering a note

**Files:**
- Create: `skills/skill-library-sync/scripts/render.js`
- Test: `skills/skill-library-sync/tests/render.test.js`

**Interfaces:**
- Consumes: `NOTES_HEADING`, `STUB` from `library.js`.
- Produces: `noteTitle({ name, suffix })` returning `Skill – <name>` or `Skill – <name> (<suffix>)`; `renderNote(entry, notesZone)` where `entry` is `{ name, suffix, description, herkunft, ort, plugin, status, created, lastModified }` and `notesZone` is the zone to carry over (pass `''` for a new note); `renderIndex(rows)` where each row is `{ title, herkunft, status, hint }`.

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { renderNote, renderIndex, noteTitle } = require('../scripts/render.js');
const { parseNote, STUB } = require('../scripts/library.js');

const ENTRY = {
  name: 'photo-dedup',
  suffix: 'org-plugin',
  description: 'Use when a photo library has near-duplicate images. Trigger phrases - "find duplicate photos", "dedupe my pictures", "near-duplicate photos".',
  herkunft: 'org-plugin',
  ort: '/Users/x/Developer/projects/neckarshore-skills/photo-autopilot/skills/photo-dedup',
  plugin: 'neckarshore-skills/photo-autopilot',
  status: 'aktiv',
  created: '2026-08-26 17:00',
  lastModified: '2026-08-26 17:00',
};

test('a rendered note round-trips through parseNote', () => {
  const parsed = parseNote(renderNote(ENTRY, ''));
  assert.strictEqual(parsed.frontmatter.title, 'photo-dedup');
  assert.strictEqual(parsed.frontmatter.herkunft, 'org-plugin');
  assert.strictEqual(parsed.hasNotesHeading, true);
});

test('the description is carried in full and never cut mid-word', () => {
  const out = renderNote(ENTRY, '');
  assert.ok(out.includes('near-duplicate photos".'), 'description was truncated');
});

test('a long description is cut on a word boundary with an ellipsis', () => {
  const long = { ...ENTRY, description: 'word '.repeat(200).trim() };
  const parsed = parseNote(renderNote(long, ''));
  const value = parsed.frontmatter.description;
  assert.ok(value.length <= 500, 'over the cap');
  assert.ok(value.endsWith('…'), 'no ellipsis');
  assert.doesNotMatch(value, /wor…$/, 'cut mid-word');
});

test('tags come last in the frontmatter', () => {
  const lines = renderNote(ENTRY, '').split('\n');
  const fmEnd = lines.indexOf('---', 1);
  assert.strictEqual(lines[fmEnd - 3], 'tags:');
});

test('a carried notes zone survives verbatim', () => {
  const zone = '\n\nDieser Skill laeuft nur auf dem M2.\n';
  assert.ok(renderNote(ENTRY, zone).endsWith(zone));
});

test('a new note gets the stub', () => {
  assert.ok(renderNote(ENTRY, '').includes(STUB));
});

test('noteTitle appends the origin suffix only when given', () => {
  assert.strictEqual(noteTitle({ name: 'x' }), 'Skill – x');
  assert.strictEqual(noteTitle({ name: 'x', suffix: 'eigen' }), 'Skill – x (eigen)');
});

test('renderIndex numbers rows 1..N with no gaps and sorts A to Z', () => {
  const md = renderIndex([
    { title: 'Skill – b', herkunft: 'eigen', status: 'aktiv', hint: '' },
    { title: 'Skill – a', herkunft: 'extern', status: 'referenz', hint: 'p@1' },
  ]);
  const rows = md.split('\n').filter((l) => /^\| \d+ \|/.test(l));
  assert.strictEqual(rows.length, 2);
  assert.match(rows[0], /^\| 1 \| \[\[Skill – a\]\]/);
  assert.match(rows[1], /^\| 2 \| \[\[Skill – b\]\]/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/skill-library-sync/tests/render.test.js`
Expected: FAIL — `Cannot find module '../scripts/render.js'`

- [ ] **Step 3: Write minimal implementation**

```javascript
'use strict';
// render.js — pure rendering of a Skill Library note and of the index.

const { NOTES_HEADING, STUB } = require('./library.js');

const DESCRIPTION_CAP = 500;

// The library's existing notes are cut at ~300 characters wherever the character
// landed -- "give this a be". Cutting on a word boundary costs one regex and is
// the difference between a note that reads and a note that embarrasses.
function fitDescription(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= DESCRIPTION_CAP) return s;
  const cut = s.slice(0, DESCRIPTION_CAP - 1);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > 0 ? cut.slice(0, boundary) : cut).replace(/[,;:.\s]+$/, '')}…`;
}

function noteTitle({ name, suffix }) {
  return suffix ? `Skill – ${name} (${suffix})` : `Skill – ${name}`;
}

function yamlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function renderNote(entry, notesZone) {
  const title = noteTitle(entry);
  const description = fitDescription(entry.description);
  const zone = notesZone && notesZone.trim() ? notesZone : `\n\n${STUB}\n`;
  const frontmatter = [
    '---',
    `title: ${entry.name}`,
    'type: skill',
    `description: ${yamlString(description)}`,
    `herkunft: ${entry.herkunft}`,
    `ort: ${yamlString(entry.ort)}`,
    `plugin: ${yamlString(entry.plugin || '')}`,
    `status: ${entry.status}`,
    `created: ${entry.created}`,
    `last_modified: ${entry.lastModified}`,
    'tags:',
    '  - Claude/ClaudeCode',
    `  - Skill/${entry.herkunft}`,
    '---',
  ].join('\n');
  const body = [
    '',
    `# ${title}`,
    '',
    `**Zweck:** ${description}`,
    '',
    `**Ort:** \`${entry.ort}\``,
    '',
    `**Herkunft:** ${entry.herkunft} · **Status:** ${entry.status}`,
    '',
    NOTES_HEADING,
  ].join('\n');
  return `${frontmatter}\n${body}${zone}`;
}

function renderIndex(rows) {
  const sorted = [...rows].sort((a, b) =>
    a.title.localeCompare(b.title, 'de', { sensitivity: 'base' }));
  const header = ['| # | Skill | Herkunft | Status | Plugin/Ort-Hinweis |',
                  '|---|-------|----------|--------|----------------------|'];
  const body = sorted.map((r, i) =>
    `| ${i + 1} | [[${r.title}]] | ${r.herkunft} | ${r.status} | ${r.hint || ''} |`);
  return [...header, ...body].join('\n');
}

module.exports = { renderNote, renderIndex, noteTitle, fitDescription, DESCRIPTION_CAP };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/skill-library-sync/tests/render.test.js`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add skills/skill-library-sync/scripts/render.js skills/skill-library-sync/tests/render.test.js
git commit -m "feat(skill-library-sync): render notes and the index

Two defects of the hand-built library are fixed at the source rather than
inherited: descriptions are cut on a word boundary with an ellipsis instead
of wherever the 300th character landed, and the index is numbered 1..N from
the notes rather than from a number somebody maintained by hand."
```

---

### Task 3: The inventory, with the no-discovery fence

**Files:**
- Create: `skills/skill-library-sync/scripts/inventory.js`
- Test: `skills/skill-library-sync/tests/inventory.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildInventory({ ownSkillsDir, installedPluginsPath, sourceRoots })` returning an array of `{ name, herkunft, ort, plugin, description }` sorted by `name` then `herkunft`. `herkunft` is one of `eigen`, `extern`, `org-plugin`. `readSkillDescription(skillDir)` returning the `description` from a `SKILL.md` frontmatter, or `''`.

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildInventory } = require('../scripts/inventory.js');

function skill(dir, name, description) {
  const d = path.join(dir, name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
  return d;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-'));
  const own = path.join(root, 'skills');
  skill(own, 'note-rename', 'renames notes');
  const plugin = path.join(root, 'cache', 'vendor', 'thing', '1.0.0');
  skill(path.join(plugin, 'skills'), 'thing-do', 'does a thing');
  const repo = path.join(root, 'repo');
  skill(path.join(repo, 'skills'), 'photo-dedup', 'finds duplicate photos');
  const installed = path.join(root, 'installed_plugins.json');
  fs.writeFileSync(installed, JSON.stringify({
    plugins: { 'thing@vendor': [{ installPath: plugin, version: '1.0.0' }] },
  }));
  return { root, own, installed, repo };
}

test('own skills, installed plugins and source roots are all found', () => {
  const f = fixture();
  const inv = buildInventory({
    ownSkillsDir: f.own,
    installedPluginsPath: f.installed,
    sourceRoots: [f.repo],
  });
  const byName = Object.fromEntries(inv.map((e) => [e.name, e]));
  assert.strictEqual(byName['note-rename'].herkunft, 'eigen');
  assert.strictEqual(byName['thing-do'].herkunft, 'extern');
  assert.strictEqual(byName['thing-do'].plugin, 'vendor/thing@1.0.0');
  assert.strictEqual(byName['photo-dedup'].herkunft, 'org-plugin');
});

test('a neckarshore plugin counts as org-plugin, not extern', () => {
  const f = fixture();
  fs.writeFileSync(f.installed, JSON.stringify({
    plugins: { 'ova@neckarshore-ai': [{ installPath: path.dirname(path.dirname(f.own)), version: '0.4.0' }] },
  }));
  const inv = buildInventory({ ownSkillsDir: f.own, installedPluginsPath: f.installed, sourceRoots: [] });
  assert.ok(inv.every((e) => e.herkunft !== 'extern'));
});

test('the description is read from SKILL.md', () => {
  const f = fixture();
  const inv = buildInventory({ ownSkillsDir: f.own, installedPluginsPath: f.installed, sourceRoots: [] });
  assert.strictEqual(inv.find((e) => e.name === 'note-rename').description, 'renames notes');
});

test('a source root that does not exist is skipped, not fatal', () => {
  const f = fixture();
  const inv = buildInventory({
    ownSkillsDir: f.own,
    installedPluginsPath: f.installed,
    sourceRoots: [path.join(f.root, 'nope')],
  });
  assert.ok(inv.length >= 1);
});

test('a directory without SKILL.md is not a skill', () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.own, '_social_common'), { recursive: true });
  const inv = buildInventory({ ownSkillsDir: f.own, installedPluginsPath: f.installed, sourceRoots: [] });
  assert.ok(!inv.some((e) => e.name === '_social_common'));
});

test('the inventory reaches exactly one level deep and never walks the tree', () => {
  const f = fixture();
  skill(path.join(f.repo, 'skills', 'photo-dedup', 'nested'), 'not-a-skill', 'buried');
  const inv = buildInventory({ ownSkillsDir: f.own, installedPluginsPath: f.installed, sourceRoots: [f.repo] });
  assert.ok(!inv.some((e) => e.name === 'not-a-skill'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/skill-library-sync/tests/inventory.test.js`
Expected: FAIL — `Cannot find module '../scripts/inventory.js'`

- [ ] **Step 3: Write minimal implementation**

```javascript
'use strict';
// inventory.js — read the real skill inventory from NAMED sources only.
//
// This is the first OVA skill that reads outside the vault, so the fence is
// explicit: every path here comes from the caller's config or from
// installed_plugins.json. There is no search, no glob over a projects folder,
// no auto-detection. readdir reaches exactly one level into a skills/ directory
// and stops. Outside the vault this module is read-only, always.

const fs = require('node:fs');
const path = require('node:path');

function readSkillDescription(skillDir) {
  try {
    const text = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) return '';
    const m = fm[1].match(/^description: *(.*)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  } catch {
    return '';
  }
}

// One level of readdir, never a recursive walk.
function skillsIn(skillsDir) {
  let entries = [];
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(skillsDir, e.name))
    .filter((d) => fs.existsSync(path.join(d, 'SKILL.md')));
}

function buildInventory({ ownSkillsDir, installedPluginsPath, sourceRoots }) {
  const out = [];

  for (const dir of skillsIn(ownSkillsDir)) {
    out.push({
      name: path.basename(dir), herkunft: 'eigen', ort: dir,
      plugin: '', description: readSkillDescription(dir),
    });
  }

  let installed = { plugins: {} };
  try {
    installed = JSON.parse(fs.readFileSync(installedPluginsPath, 'utf8'));
  } catch { /* no plugins installed is a valid state */ }
  for (const [key, value] of Object.entries(installed.plugins || {})) {
    const [pluginName, marketplace = ''] = key.split('@');
    const herkunft = /neckarshore/i.test(key) ? 'org-plugin' : 'extern';
    for (const entry of Array.isArray(value) ? value : [value]) {
      const hint = `${marketplace}/${pluginName}@${entry.version}`;
      for (const dir of skillsIn(path.join(entry.installPath, 'skills'))) {
        out.push({
          name: path.basename(dir), herkunft, ort: dir,
          plugin: hint, description: readSkillDescription(dir),
        });
      }
    }
  }

  for (const root of sourceRoots || []) {
    const label = path.basename(path.dirname(root)) + '/' + path.basename(root);
    for (const dir of skillsIn(path.join(root, 'skills'))) {
      out.push({
        name: path.basename(dir), herkunft: 'org-plugin', ort: dir,
        plugin: label, description: readSkillDescription(dir),
      });
    }
  }

  return out.sort((a, b) =>
    a.name.localeCompare(b.name) || a.herkunft.localeCompare(b.herkunft));
}

module.exports = { buildInventory, readSkillDescription, skillsIn };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/skill-library-sync/tests/inventory.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add skills/skill-library-sync/scripts/inventory.js skills/skill-library-sync/tests/inventory.test.js
git commit -m "feat(skill-library-sync): read the inventory from named sources only

First OVA skill that reads outside the vault, so the fence is code rather
than a footnote: every path comes from config or from installed_plugins.json,
readdir reaches one level into a skills/ directory and stops, and a test
proves a skill buried deeper is NOT found."
```

---

### Task 4: Configuration

**Files:**
- Create: `skills/skill-library-sync/scripts/config.js`
- Test: `skills/skill-library-sync/tests/config.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `loadConfig(vaultPath)` returning `{ libraryPath, retiredSubfolder, sourceRoots }` with defaults applied and `~` expanded in every source root.

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig, DEFAULTS } = require('../scripts/config.js');

function vaultWith(body) {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-cfg-'));
  if (body !== null) fs.writeFileSync(path.join(v, '_vault-autopilot-config.md'), body);
  return v;
}

test('a vault with no config file gets the defaults', () => {
  const cfg = loadConfig(vaultWith(null));
  assert.strictEqual(cfg.retiredSubfolder, DEFAULTS.retiredSubfolder);
  assert.deepStrictEqual(cfg.sourceRoots, []);
});

test('the skill_library section is read from a yaml fence', () => {
  const v = vaultWith([
    '# Config', '', '```yaml', 'skill_library:',
    '  library_path: "020_Processes/Library Meta/Skill Library"',
    '  retired_subfolder: "Entfallen"',
    '  source_roots_extend:',
    '    - "~/Developer/projects/x"',
    '```', ''].join('\n'));
  const cfg = loadConfig(v);
  assert.strictEqual(cfg.libraryPath, '020_Processes/Library Meta/Skill Library');
  assert.strictEqual(cfg.retiredSubfolder, 'Entfallen');
  assert.strictEqual(cfg.sourceRoots.length, 1);
  assert.ok(cfg.sourceRoots[0].startsWith(os.homedir()));
  assert.ok(!cfg.sourceRoots[0].includes('~'));
});

test('a malformed fence falls back to defaults rather than throwing', () => {
  const cfg = loadConfig(vaultWith('```yaml\nskill_library: [unclosed\n```'));
  assert.strictEqual(cfg.retiredSubfolder, DEFAULTS.retiredSubfolder);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/skill-library-sync/tests/config.test.js`
Expected: FAIL — `Cannot find module '../scripts/config.js'`

- [ ] **Step 3: Write minimal implementation**

```javascript
'use strict';
// config.js — the skill_library section of the vault's _vault-autopilot-config.md.
//
// The plugin already has one config surface (references/config-spec.md). This
// skill uses it rather than adding a second. A missing or malformed config is a
// valid state and yields defaults; it never throws, because a broken config file
// must not be able to stop a read-only scan.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULTS = { libraryPath: '', retiredSubfolder: 'Entfallen', sourceRoots: [] };

function expandHome(p) {
  const s = String(p).trim();
  return s.startsWith('~') ? path.join(os.homedir(), s.slice(1)) : s;
}

// A deliberately small YAML reader: this section is two scalars and a list, and
// pulling in a parser for that would be the larger risk.
function readSection(text) {
  const fence = String(text).match(/```yaml\s*\n([\s\S]*?)\n```/);
  if (!fence) return {};
  const lines = fence[1].split('\n');
  const start = lines.findIndex((l) => /^skill_library: *$/.test(l));
  if (start === -1) return {};
  const out = { sourceRoots: [] };
  let inList = false;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const scalar = line.match(/^ {2}([a-z_]+): *(.+)$/);
    const item = line.match(/^ {4}- *(.+)$/);
    if (scalar) {
      inList = false;
      const value = scalar[2].trim().replace(/^["']|["']$/g, '');
      if (scalar[1] === 'library_path') out.libraryPath = value;
      if (scalar[1] === 'retired_subfolder') out.retiredSubfolder = value;
    } else if (/^ {2}source_roots(_extend)?: *$/.test(line)) {
      inList = true;
    } else if (item && inList) {
      out.sourceRoots.push(item[1].trim().replace(/^["']|["']$/g, ''));
    }
  }
  return out;
}

function loadConfig(vaultPath) {
  let section = {};
  try {
    section = readSection(fs.readFileSync(
      path.join(vaultPath, '_vault-autopilot-config.md'), 'utf8'));
  } catch { /* no config is a valid state */ }
  return {
    libraryPath: section.libraryPath || DEFAULTS.libraryPath,
    retiredSubfolder: section.retiredSubfolder || DEFAULTS.retiredSubfolder,
    sourceRoots: (section.sourceRoots || []).map(expandHome),
  };
}

module.exports = { loadConfig, readSection, expandHome, DEFAULTS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/skill-library-sync/tests/config.test.js`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add skills/skill-library-sync/scripts/config.js skills/skill-library-sync/tests/config.test.js
git commit -m "feat(skill-library-sync): read source roots from the plugin's own config file

Uses the existing _vault-autopilot-config.md rather than adding a second
config surface. A missing or malformed config yields defaults and never
throws -- a broken config file must not be able to stop a read-only scan."
```

---

### Task 5: The diff into four buckets

**Files:**
- Create: `skills/skill-library-sync/scripts/diff.js`
- Test: `skills/skill-library-sync/tests/diff.test.js`

**Interfaces:**
- Consumes: `noteTitle` from `render.js`.
- Produces: `diffLibrary(inventory, notes)` where `notes` is an array of `{ title, name, suffix, frontmatter }`, returning `{ created: [], relocated: [], retired: [], unchanged: [], renamed: [] }`. Each `created`/`relocated` element is an inventory entry plus the `suffix` it must carry; each `retired` element is a note; each `renamed` element is `{ from, to }`.

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { diffLibrary } = require('../scripts/diff.js');

const inv = (name, herkunft, ort) => ({ name, herkunft, ort, plugin: '', description: 'd' });
const note = (name, suffix, ort) => ({
  title: suffix ? `Skill – ${name} (${suffix})` : `Skill – ${name}`,
  name, suffix, frontmatter: { ort, status: 'aktiv' },
});

test('a skill with no note is created', () => {
  const d = diffLibrary([inv('photo-dedup', 'org-plugin', '/a')], []);
  assert.strictEqual(d.created.length, 1);
  assert.strictEqual(d.created[0].name, 'photo-dedup');
});

test('a note whose ort still exists in the inventory is unchanged', () => {
  const d = diffLibrary([inv('a', 'eigen', '/a')], [note('a', 'eigen', '/a')]);
  assert.strictEqual(d.unchanged.length, 1);
  assert.strictEqual(d.relocated.length, 0);
});

test('a note whose ort moved is relocated, not recreated', () => {
  const d = diffLibrary([inv('a', 'eigen', '/new')], [note('a', 'eigen', '/old')]);
  assert.strictEqual(d.relocated.length, 1);
  assert.strictEqual(d.relocated[0].ort, '/new');
  assert.strictEqual(d.created.length, 0);
});

test('a note with no skill anywhere is retired', () => {
  const d = diffLibrary([], [note('sentry-go-sdk', '', '/gone')]);
  assert.strictEqual(d.retired.length, 1);
  assert.strictEqual(d.retired[0].name, 'sentry-go-sdk');
});

test('a skill acquiring a second origin renames the existing suffix-less note', () => {
  const d = diffLibrary(
    [inv('agents-sdk', 'eigen', '/own'), inv('agents-sdk', 'extern', '/plugin')],
    [note('agents-sdk', '', '/own')],
  );
  assert.deepStrictEqual(d.renamed, [
    { from: 'Skill – agents-sdk', to: 'Skill – agents-sdk (eigen)' },
  ]);
  assert.strictEqual(d.created.length, 1);
  assert.strictEqual(d.created[0].suffix, 'extern');
});

test('a single-origin skill gets no suffix', () => {
  const d = diffLibrary([inv('solo', 'eigen', '/a')], []);
  assert.strictEqual(d.created[0].suffix, '');
});

test('every note lands in exactly one bucket', () => {
  const notes = [note('a', 'eigen', '/a'), note('b', '', '/old'), note('c', '', '/gone')];
  const d = diffLibrary([inv('a', 'eigen', '/a'), inv('b', 'eigen', '/new')], notes);
  const total = d.unchanged.length + d.relocated.length + d.retired.length;
  assert.strictEqual(total, notes.length);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/skill-library-sync/tests/diff.test.js`
Expected: FAIL — `Cannot find module '../scripts/diff.js'`

- [ ] **Step 3: Write minimal implementation**

```javascript
'use strict';
// diff.js — pure classification of inventory against library.
//
// Four buckets, and `unchanged` is a real one: a run that changes nothing must
// be able to say so with a number, because silence reads as "nothing was
// checked" and that is the failure mode this whole skill exists to end.

const { noteTitle } = require('./render.js');

function suffixMap(inventory) {
  const counts = new Map();
  for (const e of inventory) counts.set(e.name, (counts.get(e.name) || 0) + 1);
  return counts;
}

function diffLibrary(inventory, notes) {
  const counts = suffixMap(inventory);
  const withSuffix = inventory.map((e) => ({
    ...e, suffix: counts.get(e.name) > 1 ? e.herkunft : '',
  }));

  const created = [];
  const relocated = [];
  const retired = [];
  const unchanged = [];
  const renamed = [];

  const noteByTitle = new Map(notes.map((n) => [n.title, n]));
  const claimed = new Set();

  for (const entry of withSuffix) {
    const wanted = noteTitle(entry);
    let note = noteByTitle.get(wanted);
    if (!note) {
      // A skill that has just acquired a second origin: its old note carries no
      // suffix. Rename rather than orphan it, otherwise the note's history and
      // the user's own prose are silently abandoned next to a fresh stub.
      const bare = noteByTitle.get(noteTitle({ name: entry.name }));
      if (entry.suffix && bare && !claimed.has(bare.title)) {
        renamed.push({ from: bare.title, to: wanted });
        claimed.add(bare.title);
        note = bare;
      }
    }
    if (!note) { created.push(entry); continue; }
    claimed.add(note.title);
    if (note.frontmatter.ort === entry.ort) unchanged.push({ ...entry, note });
    else relocated.push({ ...entry, note });
  }

  for (const note of notes) if (!claimed.has(note.title)) retired.push(note);

  return { created, relocated, retired, unchanged, renamed };
}

module.exports = { diffLibrary };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/skill-library-sync/tests/diff.test.js`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add skills/skill-library-sync/scripts/diff.js skills/skill-library-sync/tests/diff.test.js
git commit -m "feat(skill-library-sync): classify into four buckets, unchanged included

A skill acquiring a second origin RENAMES its existing note instead of
orphaning it beside a fresh stub -- the note carries the user's own prose and
its creation date. A partition test asserts every note lands in exactly one
bucket, which is a stronger contract than any per-bucket count."
```

---

### Task 6: The read-only CLI — `scan` and `diff`

**Files:**
- Create: `skills/skill-library-sync/scripts/cli.js`
- Test: `skills/skill-library-sync/tests/cli.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: `readLibrary(libraryDir)` returning the `notes` array `diffLibrary` expects; `renderPreview(result)` returning the human preview string; `main(argv)` returning an exit code. Subcommands `scan <vault>`, `diff <vault>`, `apply <vault> --write`.

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readLibrary, renderPreview } = require('../scripts/cli.js');
const { renderNote } = require('../scripts/render.js');

function libraryWith(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-lib-'));
  for (const e of entries) {
    const sub = path.join(dir, e.folder || '');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, `${e.title}.md`), renderNote(e, ''));
  }
  return dir;
}

const ENTRY = {
  name: 'a', suffix: 'eigen', description: 'd', herkunft: 'eigen',
  ort: '/a', plugin: '', status: 'aktiv',
  created: '2026-08-26 17:00', lastModified: '2026-08-26 17:00',
  title: 'Skill – a (eigen)', folder: 'Eigene Skills',
};

test('readLibrary finds notes in subfolders and skips underscore files', () => {
  const dir = libraryWith([ENTRY]);
  fs.writeFileSync(path.join(dir, '_Skill Library.md'), '# index\n');
  const notes = readLibrary(dir);
  assert.strictEqual(notes.length, 1);
  assert.strictEqual(notes[0].name, 'a');
  assert.strictEqual(notes[0].suffix, 'eigen');
});

test('readLibrary carries the notes zone through', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-lib2-'));
  fs.writeFileSync(path.join(dir, 'Skill – b.md'),
    renderNote({ ...ENTRY, name: 'b', suffix: '' }, '\n\nEigener Text.\n'));
  assert.match(readLibrary(dir)[0].notesZone, /Eigener Text/);
});

test('the preview names every bucket with a count, zeros included', () => {
  const text = renderPreview({ created: [], relocated: [], retired: [], unchanged: [1, 2], renamed: [] });
  // The preview pads its labels into a column, so the assertion must tolerate
  // the padding rather than pin the exact spacing of a cosmetic choice.
  assert.match(text, /created:\s+0/);
  assert.match(text, /retired:\s+0/);
  assert.match(text, /unchanged:\s+2/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/skill-library-sync/tests/cli.test.js`
Expected: FAIL — `Cannot find module '../scripts/cli.js'`

- [ ] **Step 3: Write minimal implementation**

```javascript
'use strict';
// cli.js — fs + CLI shell over the pure engine.
//
//   scan  <vault>            print the inventory, write nothing
//   diff  <vault>            print the four buckets, write nothing
//   apply <vault> --write    execute behind the confirm gate
//
// Plan-then-write: every note is rendered in memory and every guard throws
// BEFORE the first write, so a refusal leaves the library untouched.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseNote, isReplaceableZone } = require('./library.js');
const { renderNote, renderIndex, noteTitle } = require('./render.js');
const { buildInventory } = require('./inventory.js');
const { diffLibrary } = require('./diff.js');
const { loadConfig } = require('./config.js');

const TITLE_RE = /^Skill – (.+?)(?: \((eigen|extern|org-plugin|projekt-lokal)\))?$/;

function readLibrary(libraryDir) {
  const notes = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.md') || e.name.startsWith('_')) continue;
      const title = e.name.slice(0, -3);
      const m = title.match(TITLE_RE);
      if (!m) continue;
      const parsed = parseNote(fs.readFileSync(p, 'utf8'));
      notes.push({
        title, name: m[1], suffix: m[2] || '', file: p,
        frontmatter: parsed.frontmatter, notesZone: parsed.notesZone,
        replaceable: isReplaceableZone(parsed.notesZone),
      });
    }
  };
  walk(libraryDir);
  return notes.sort((a, b) => a.title.localeCompare(b.title));
}

function renderPreview(result) {
  const lines = [
    `created:   ${result.created.length}`,
    `relocated: ${result.relocated.length}`,
    `retired:   ${result.retired.length}`,
    `renamed:   ${result.renamed.length}`,
    `unchanged: ${result.unchanged.length}`,
  ];
  for (const r of result.renamed) lines.push(`  rename: ${r.from} -> ${r.to}`);
  for (const c of result.created) lines.push(`  create: ${noteTitle(c)}`);
  for (const r of result.retired) lines.push(`  retire: ${r.title}`);
  return lines.join('\n');
}

function collect(vault) {
  const config = loadConfig(vault);
  const inventory = buildInventory({
    ownSkillsDir: path.join(os.homedir(), '.claude', 'skills'),
    installedPluginsPath: path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json'),
    sourceRoots: config.sourceRoots,
  });
  const libraryDir = path.join(vault, config.libraryPath);
  return { config, inventory, libraryDir, notes: readLibrary(libraryDir) };
}

function main(argv) {
  const [command, vault] = argv;
  if (!command || !vault) {
    process.stderr.write('usage: cli.js <scan|diff|apply> <vault> [--write]\n');
    return 2;
  }
  const { inventory, notes } = collect(vault);
  if (command === 'scan') {
    process.stdout.write(`${inventory.length} skills, ${notes.length} notes\n`);
    return 0;
  }
  if (command === 'diff') {
    process.stdout.write(`${renderPreview(diffLibrary(inventory, notes))}\n`);
    return 0;
  }
  process.stderr.write(`unknown command: ${command}\n`);
  return 2;
}

module.exports = { readLibrary, renderPreview, collect, main };

if (require.main === module) process.exit(main(process.argv.slice(2)));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/skill-library-sync/tests/cli.test.js`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add skills/skill-library-sync/scripts/cli.js skills/skill-library-sync/tests/cli.test.js
git commit -m "feat(skill-library-sync): read-only scan and diff

The preview prints every bucket with a count including the zeros, because a
run that changed nothing has to say so with a number -- silence reads as
'nothing was checked', which is the failure this skill exists to end."
```

---

### Task 7: `apply` — the write path

**Files:**
- Modify: `skills/skill-library-sync/scripts/cli.js`
- Test: `skills/skill-library-sync/tests/apply.test.js`

**Interfaces:**
- Consumes: `collect`, `readLibrary` from Task 6.
- Produces: `applyPlan(vault, { write })` returning `{ written: [], moved: [], renamed: [], refused: null }`; throws `MassChangeError` when the plan exceeds the ceiling.

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyPlan } = require('../scripts/cli.js');
const { renderNote } = require('../scripts/render.js');

function vaultFixture({ ownSkills = ['alpha'], notes = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-apply-'));
  const vault = path.join(root, 'vault');
  const lib = path.join(vault, 'Library', 'Skill Library');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(vault, '_vault-autopilot-config.md'),
    ['```yaml', 'skill_library:', '  library_path: "Library/Skill Library"', '```'].join('\n'));
  for (const n of notes) fs.writeFileSync(path.join(lib, `${n.title}.md`), n.body);
  return { root, vault, lib };
}

test('without --write nothing is written', () => {
  const f = vaultFixture();
  const before = fs.readdirSync(f.lib);
  applyPlan(f.vault, { write: false, inventory: [{ name: 'x', herkunft: 'eigen', ort: '/x', plugin: '', description: 'd' }] });
  assert.deepStrictEqual(fs.readdirSync(f.lib), before);
});

test('a relocated note keeps its created value and its birthtime', () => {
  const body = renderNote({
    name: 'alpha', suffix: '', description: 'd', herkunft: 'eigen', ort: '/old',
    plugin: '', status: 'aktiv', created: '2026-07-05 15:45', lastModified: '2026-07-05 15:45',
  }, '');
  const f = vaultFixture({ notes: [{ title: 'Skill – alpha', body }] });
  const file = path.join(f.lib, 'Skill – alpha.md');
  const birthBefore = fs.statSync(file).birthtimeMs;

  applyPlan(f.vault, { write: true, inventory: [{ name: 'alpha', herkunft: 'eigen', ort: '/new', plugin: '', description: 'd' }] });

  const after = fs.readFileSync(file, 'utf8');
  assert.match(after, /ort: "\/new"/);
  assert.match(after, /created: 2026-07-05 15:45/);
  assert.strictEqual(fs.statSync(file).birthtimeMs, birthBefore);
});

test('a hand-written notes zone survives the rewrite verbatim', () => {
  const body = renderNote({
    name: 'alpha', suffix: '', description: 'd', herkunft: 'eigen', ort: '/old',
    plugin: '', status: 'aktiv', created: '2026-07-05 15:45', lastModified: '2026-07-05 15:45',
  }, '\n\nLaeuft nur auf dem M2.\n');
  const f = vaultFixture({ notes: [{ title: 'Skill – alpha', body }] });

  applyPlan(f.vault, { write: true, inventory: [{ name: 'alpha', herkunft: 'eigen', ort: '/new', plugin: '', description: 'd' }] });

  assert.match(fs.readFileSync(path.join(f.lib, 'Skill – alpha.md'), 'utf8'), /Laeuft nur auf dem M2\./);
});

test('a retired note moves and flips status, and is never deleted', () => {
  const body = renderNote({
    name: 'gone', suffix: '', description: 'd', herkunft: 'extern', ort: '/gone',
    plugin: '', status: 'referenz', created: '2026-07-05 15:45', lastModified: '2026-07-05 15:45',
  }, '');
  const f = vaultFixture({ notes: [{ title: 'Skill – gone', body }] });

  applyPlan(f.vault, { write: true, inventory: [] });

  assert.ok(!fs.existsSync(path.join(f.lib, 'Skill – gone.md')));
  const moved = path.join(f.lib, 'Entfallen', 'Skill – gone.md');
  assert.ok(fs.existsSync(moved));
  const text = fs.readFileSync(moved, 'utf8');
  assert.match(text, /status: entfallen/);
  assert.match(text, /entfallen_am: \d{4}-\d{2}-\d{2}/);
});

test('a renamed note is moved to its new title, not recreated beside the old one', () => {
  const body = renderNote({
    name: 'twin', suffix: '', description: 'd', herkunft: 'eigen', ort: '/own',
    plugin: '', status: 'aktiv', created: '2026-07-05 15:45', lastModified: '2026-07-05 15:45',
  }, '\n\nEigener Text.\n');
  const f = vaultFixture({ notes: [{ title: 'Skill – twin', body }] });

  applyPlan(f.vault, { write: true, inventory: [
    { name: 'twin', herkunft: 'eigen', ort: '/own', plugin: '', description: 'd' },
    { name: 'twin', herkunft: 'extern', ort: '/plugin', plugin: 'p@1', description: 'd' },
  ] });

  assert.ok(!fs.existsSync(path.join(f.lib, 'Skill – twin.md')), 'old title survived');
  const renamed = path.join(f.lib, 'Eigene Skills', 'Skill – twin (eigen).md');
  assert.ok(fs.existsSync(renamed), 'renamed note missing');
  assert.match(fs.readFileSync(renamed, 'utf8'), /Eigener Text\./, 'user prose lost in the rename');
  assert.match(fs.readFileSync(renamed, 'utf8'), /created: 2026-07-05 15:45/, 'creation date lost');
});

test('a plan over the mass-change ceiling refuses and writes nothing', () => {
  const f = vaultFixture();
  const inventory = Array.from({ length: 200 }, (_, i) =>
    ({ name: `s${i}`, herkunft: 'eigen', ort: `/s${i}`, plugin: '', description: 'd' }));
  assert.throws(() => applyPlan(f.vault, { write: true, inventory, max: 50 }), /Mass-change guard/);
  assert.deepStrictEqual(fs.readdirSync(f.lib), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/skill-library-sync/tests/apply.test.js`
Expected: FAIL — `applyPlan is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `skills/skill-library-sync/scripts/cli.js`, and add `applyPlan` plus `MassChangeError` to its `module.exports`:

```javascript
const DEFAULT_MAX = 200;

class MassChangeError extends Error {
  constructor(count, threshold) {
    super(`Mass-change guard: this plan would touch ${count} notes (> threshold ${threshold}). Aborting; nothing written. Re-run with a higher --max or narrow the scope.`);
    this.name = 'MassChangeError';
  }
}

function stamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function nowStamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${stamp(date)} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

function applyPlan(vault, options = {}) {
  const write = Boolean(options.write);
  const now = options.now || new Date();
  const max = options.max || DEFAULT_MAX;
  const { config, libraryDir, notes } = collect(vault);
  const inventory = options.inventory || collect(vault).inventory;
  const plan = diffLibrary(inventory, notes);

  const touched = plan.created.length + plan.relocated.length
    + plan.retired.length + plan.renamed.length;
  if (touched > max) throw new MassChangeError(touched, max);

  // Plan-then-write: render everything first, so a throw above leaves the
  // library exactly as it was.
  const writes = [];
  for (const entry of plan.created) {
    const folder = entry.herkunft === 'eigen' ? 'Eigene Skills'
      : entry.herkunft === 'org-plugin' ? 'Org-Plugins' : 'Externe Plugins';
    writes.push({
      kind: 'create',
      file: path.join(libraryDir, folder, `${noteTitle(entry)}.md`),
      body: renderNote({ ...entry, status: entry.herkunft === 'extern' ? 'referenz' : 'aktiv',
        created: nowStamp(now), lastModified: nowStamp(now) }, ''),
    });
  }
  for (const entry of plan.relocated) {
    const note = entry.note;
    writes.push({
      kind: 'relocate',
      file: note.file,
      body: renderNote({
        ...entry,
        status: note.frontmatter.status || 'aktiv',
        created: note.frontmatter.created,
        lastModified: nowStamp(now),
      }, note.replaceable ? '' : note.notesZone),
    });
  }
  // A rename carries the note's file to its new title. The relocate branch above
  // has already rendered the new body against the OLD path, so the rename moves
  // that same content -- the user's prose and the creation date travel with it.
  // Recreating instead of renaming is the failure this exists to prevent.
  const renames = plan.renamed.map((r) => {
    const note = notes.find((n) => n.title === r.from);
    const entry = plan.relocated.concat(plan.unchanged).find((e) => noteTitle(e) === r.to);
    const folder = path.basename(path.dirname(note.file)) === path.basename(libraryDir)
      ? '' : path.basename(path.dirname(note.file));
    return {
      from: note.file,
      to: path.join(libraryDir, folder, `${r.to}.md`),
      body: entry ? renderNote({
        ...entry, status: note.frontmatter.status || 'aktiv',
        created: note.frontmatter.created, lastModified: nowStamp(now),
      }, note.replaceable ? '' : note.notesZone)
        : fs.readFileSync(note.file, 'utf8'),
    };
  });

  const moves = plan.retired.map((note) => ({
    from: note.file,
    to: path.join(libraryDir, config.retiredSubfolder, path.basename(note.file)),
    body: fs.readFileSync(note.file, 'utf8')
      .replace(/^status: .*$/m, 'status: entfallen')
      .replace(/^(last_modified: .*)$/m, `$1\nentfallen_am: ${stamp(now)}`),
  }));

  if (!write) {
    return {
      written: [], moved: [], renamed: [],
      unchanged: plan.unchanged.length,
      planned: writes.length + moves.length + renames.length,
    };
  }

  for (const r of renames) {
    fs.mkdirSync(path.dirname(r.to), { recursive: true });
    fs.writeFileSync(r.to, r.body);
    if (path.resolve(r.from) !== path.resolve(r.to)) fs.rmSync(r.from);
  }
  for (const w of writes) {
    fs.mkdirSync(path.dirname(w.file), { recursive: true });
    // In-place write on an existing path: no new inode, so APFS birthtime is
    // preserved. Never write-to-temp-then-rename here.
    fs.writeFileSync(w.file, w.body);
  }
  for (const m of moves) {
    fs.mkdirSync(path.dirname(m.to), { recursive: true });
    fs.writeFileSync(m.to, m.body);
    fs.rmSync(m.from);
  }
  return {
    written: writes.map((w) => w.file),
    moved: moves.map((m) => m.to),
    renamed: renames.map((r) => r.to),
    // writeFindings (Task 9) reads this as a number. Returning the bucket itself
    // here would put a shape mismatch one task downstream of where it was made.
    unchanged: plan.unchanged.length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/skill-library-sync/tests/apply.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add skills/skill-library-sync/scripts/cli.js skills/skill-library-sync/tests/apply.test.js
git commit -m "feat(skill-library-sync): the write path, plan-then-write

Every note is rendered before the first byte is written, so the mass-change
guard leaves the library untouched when it fires. Relocation writes IN PLACE
so no new inode is created and the APFS birthtime survives -- proven by a test
that reads birthtimeMs before and after. Retired notes move and are relabelled;
nothing is ever deleted."
```

---

### Task 8: Index regeneration

**Files:**
- Modify: `skills/skill-library-sync/scripts/cli.js`
- Test: `skills/skill-library-sync/tests/index.test.js`

**Interfaces:**
- Consumes: `readLibrary`, `renderIndex`.
- Produces: `rebuildIndex(libraryDir, { write })` returning the index markdown.

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { rebuildIndex } = require('../scripts/cli.js');
const { renderNote } = require('../scripts/render.js');

function lib(names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-idx-'));
  for (const n of names) {
    fs.writeFileSync(path.join(dir, `Skill – ${n}.md`), renderNote({
      name: n, suffix: '', description: 'd', herkunft: 'eigen', ort: `/${n}`,
      plugin: '', status: 'aktiv', created: '2026-08-26 17:00', lastModified: '2026-08-26 17:00',
    }, ''));
  }
  fs.writeFileSync(path.join(dir, '_Skill Library.md'),
    '---\ntitle: Skill Library — Index\n---\n\n# Skill Library\n\n## Skills\n\n| # | old |\n|---|---|\n| 1 | stale |\n');
  return dir;
}

test('the index has one numbered row per note, 1..N, no gaps', () => {
  const md = rebuildIndex(lib(['c', 'a', 'b']), { write: false });
  const rows = md.split('\n').filter((l) => /^\| \d+ \|/.test(l));
  assert.strictEqual(rows.length, 3);
  assert.match(rows[0], /\| 1 \| \[\[Skill – a\]\]/);
  assert.match(rows[2], /\| 3 \| \[\[Skill – c\]\]/);
});

test('the index states its count once, derived, not in prose', () => {
  const md = rebuildIndex(lib(['a', 'b']), { write: false });
  assert.match(md, /2 Skills/);
  assert.strictEqual((md.match(/\d+ Skills/g) || []).length, 1);
});

test('writing replaces only the Skills section and keeps the frontmatter', () => {
  const dir = lib(['a']);
  rebuildIndex(dir, { write: true });
  const text = fs.readFileSync(path.join(dir, '_Skill Library.md'), 'utf8');
  assert.match(text, /title: Skill Library — Index/);
  assert.doesNotMatch(text, /stale/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/skill-library-sync/tests/index.test.js`
Expected: FAIL — `rebuildIndex is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `cli.js` and export `rebuildIndex`:

```javascript
const INDEX_FILE = '_Skill Library.md';

function rebuildIndex(libraryDir, options = {}) {
  const notes = readLibrary(libraryDir);
  const rows = notes.map((n) => ({
    title: n.title,
    herkunft: n.frontmatter.herkunft || '',
    status: n.frontmatter.status || '',
    hint: n.frontmatter.plugin || '',
  }));
  // The count is DERIVED and stated once. The hand-built index carried it in a
  // prose paragraph that its own table had already contradicted (158 against 162).
  const section = ['## Skills', '', `${rows.length} Skills.`, '', renderIndex(rows), ''].join('\n');
  const target = path.join(libraryDir, INDEX_FILE);
  let existing = '';
  try { existing = fs.readFileSync(target, 'utf8'); } catch { /* first run */ }
  const head = existing ? existing.split('## Skills')[0] : '---\ntitle: Skill Library — Index\n---\n\n# Skill Library\n\n';
  const out = `${head}${section}`;
  if (options.write) fs.writeFileSync(target, out);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/skill-library-sync/tests/index.test.js`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add skills/skill-library-sync/scripts/cli.js skills/skill-library-sync/tests/index.test.js
git commit -m "feat(skill-library-sync): regenerate the index from the notes

The count is derived and stated once. The hand-built index carried it in a
prose paragraph its own table already contradicted -- 158 against 162 rows --
which is what a fact with two homes looks like after seven weeks."
```

---

### Task 9: The findings ledger

`tag-manage` writes its findings from code (`scripts/cli.js`, `scripts/report.js`),
not from the SKILL.md prose. Follow that: a ledger a model writes free-hand drifts
from its documented schema, which is the exact failure this skill was built to end.

**Files:**
- Modify: `skills/skill-library-sync/scripts/cli.js`
- Test: `skills/skill-library-sync/tests/findings.test.js`

**Interfaces:**
- Consumes: the `applyPlan` result shape from Task 7.
- Produces: `writeFindings(vault, result, { now })` returning the path written.

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeFindings } = require('../scripts/cli.js');

const RESULT = { written: ['/v/a.md'], moved: ['/v/Entfallen/b.md'], renamed: ['Skill – c (eigen)'], unchanged: 12 };

test('the ledger lands at the documented path', () => {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-find-'));
  const out = writeFindings(v, RESULT, { now: new Date('2026-08-26T12:00:00Z') });
  assert.strictEqual(out, path.join(v, '_vault-autopilot', 'findings', '2026-08-26-skill-library-sync.md'));
  assert.ok(fs.existsSync(out));
});

test('the ledger carries the machine schema, not title/description/tags', () => {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-find2-'));
  const text = fs.readFileSync(writeFindings(v, RESULT, { now: new Date('2026-08-26T12:00:00Z') }), 'utf8');
  assert.match(text, /^date: 2026-08-26$/m);
  assert.match(text, /^skill: skill-library-sync$/m);
  assert.match(text, /^counts:$/m);
  assert.doesNotMatch(text, /^description:/m);
});

test('a second run on the same day appends rather than overwrites', () => {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-find3-'));
  const now = new Date('2026-08-26T12:00:00Z');
  writeFindings(v, RESULT, { now });
  const out = writeFindings(v, { ...RESULT, unchanged: 99 }, { now });
  const text = fs.readFileSync(out, 'utf8');
  assert.match(text, /unchanged: 12/);
  assert.match(text, /unchanged: 99/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test skills/skill-library-sync/tests/findings.test.js`
Expected: FAIL — `writeFindings is not a function`

- [ ] **Step 3: Write minimal implementation**

Append to `cli.js` and export `writeFindings`:

```javascript
// The ledger is Storage per references/findings-file.md: a documented machine
// schema, deliberately exempt from the title/description/tags standard OVA
// enforces on the user's own notes. Append-only -- a second run on the same day
// adds a block, it never replaces the morning's record.
function writeFindings(vault, result, options = {}) {
  const now = options.now || new Date();
  const day = stamp(now);
  const dir = path.join(vault, '_vault-autopilot', 'findings');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${day}-skill-library-sync.md`);

  const block = [
    '',
    `## Run ${nowStamp(now)}`,
    '',
    'counts:',
    `  created: ${result.written.length}`,
    `  retired: ${result.moved.length}`,
    `  renamed: ${result.renamed.length}`,
    `  unchanged: ${result.unchanged}`,
    '',
  ].join('\n');

  let existing = '';
  try { existing = fs.readFileSync(target, 'utf8'); } catch { /* first run today */ }
  const header = existing || [
    '---', `date: ${day}`, 'skill: skill-library-sync',
    'scope: skill-library', '---', '',
  ].join('\n');
  fs.writeFileSync(target, `${header}${block}`);
  return target;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test skills/skill-library-sync/tests/findings.test.js`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add skills/skill-library-sync/scripts/cli.js skills/skill-library-sync/tests/findings.test.js
git commit -m "feat(skill-library-sync): write the findings ledger from code

tag-manage writes its findings from code rather than from SKILL.md prose, and
that is the right precedent: a ledger a model writes free-hand drifts from its
documented schema, which is the exact failure this skill exists to end.
Append-only -- a second run on the same day adds a block, never replaces one."
```

---

### Task 10: SKILL.md, CI bridge, and the version bump

**Files:**
- Create: `skills/skill-library-sync/SKILL.md`
- Create: `scripts/test-skill-library-sync.sh`
- Modify: `.claude-plugin/plugin.json` (version `0.3.0` to `0.4.0`)
- Modify: `CHANGELOG.md`, `README.md`, `CLAUDE.md` (skill table)

**Interfaces:**
- Consumes: everything above.
- Produces: a loadable skill and a green CI bridge.

- [ ] **Step 1: Write the failing test**

The repo already gates SKILL.md frontmatter. Add the bridge first and let the existing suites judge:

```bash
cat > scripts/test-skill-library-sync.sh <<'SH'
#!/usr/bin/env bash
# CI bridge: runs the skill-library-sync node:test suites. Picked up by the
# scripts/test-*.sh loop in .github/workflows/test.yml -- no workflow edit needed.
# Uses the *.test.js glob, not a bare directory: on Node v26 the directory form
# resolves the path as a module and fails.
set -euo pipefail
cd "$(dirname "$0")/.."
node --test skills/skill-library-sync/tests/*.test.js
SH
chmod +x scripts/test-skill-library-sync.sh
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash scripts/test-launch-skill-spec.sh`
Expected: FAIL — the new skill has no `SKILL.md`, so the frontmatter gate rejects it.

- [ ] **Step 3: Write the SKILL.md**

```markdown
---
name: skill-library-sync
status: beta
description: Use when a vault holds a library of notes about Claude Code skills and it has drifted from the skills that actually exist. Trigger phrases - "sync the skill library", "is the skill library up to date", "check the skill library", "which skills are missing from the vault", "update the skill notes". Also trigger when the user mentions a skill they built that has no note, an index that no longer matches its folder, or notes pointing at plugin paths that have moved. This skill reads the real inventory from named sources only - it never searches the filesystem for skills.
---

# Skill Library Sync

Reconcile the vault's Skill Library against the skills that actually exist: the
user's own skills, the installed plugins, and the repositories named in the
config. Create what is missing, re-locate what moved, retire what is gone.

The core principle - a library maintained by hand drifts at exactly the rate the
estate grows, and nothing detects it. Scan the ground first, show the difference,
write only after the user confirms.

## Principle - Core + Nahbereich + Report

- **Core:** reconcile the library against the inventory.
- **Nahbereich:** dead wikilinks in the index and a stale count in its prose are
  fixed in passing. Nothing else. This skill does not write skill documentation.
- **Report:** counts per bucket including the zeros, every rename by name, plus a
  findings entry.

## Fences

1. **The body boundary.** Everything above `## Notizen` belongs to this skill.
   Everything below belongs to the user and is never written. The placeholder stub
   is the one exception and is matched byte-for-byte - never by length.
2. **No filesystem discovery.** Only paths the config names or that
   `installed_plugins.json` names. Never a tree walk. Outside the vault this skill
   is read-only, always.
3. **Nothing is deleted.** A skill that vanished gets `status: entfallen` and moves
   to the retired subfolder.

## Shared conventions

1. `../../references/vault-autopilot-note.md` - protected files and folders.
2. `../../references/findings-file.md` - the append-only findings ledger.
3. `../../references/config-spec.md` - the `skill_library` config section.

## Step 1 - Scan

    node scripts/cli.js scan "$OBSIDIAN_VAULT_PATH"

Prints how many skills exist and how many notes describe them. Writes nothing.

## Step 2 - Diff

    node scripts/cli.js diff "$OBSIDIAN_VAULT_PATH"

Prints the four buckets - created, relocated, retired, renamed - each with a count,
and names every note that would change. Writes nothing.

Show this output to the user. Do not proceed without an explicit confirmation.

## Step 3 - Apply

    node scripts/cli.js apply "$OBSIDIAN_VAULT_PATH" --write

Only after the user has seen Step 2 and confirmed. A plan touching more than 200
notes refuses and writes nothing; re-run with `--max` to raise the ceiling
deliberately.

## Report

    ## Skill Library Sync Report - <date>

    ### Done
    - Created N notes
    - Relocated N notes
    - Retired N notes to <subfolder>
    - Renamed N notes (origin suffix)

    ### Unchanged
    - N notes already matched the inventory

    ### Findings
    - <anything the user should act on>

Write the findings entry to
`${OBSIDIAN_VAULT_PATH}/_vault-autopilot/findings/<date>-skill-library-sync.md`.
```

- [ ] **Step 4: Run the suites to verify they pass**

Run: `bash scripts/test-skill-library-sync.sh && bash scripts/test-launch-skill-spec.sh`
Expected: PASS both

- [ ] **Step 5: Bump the version and record it**

The installed plugin has been stale since 2026-06-17 and `claude plugin update`
answers "already at the latest version (0.3.0)", because 42 commits landed without
the version moving. A stale install is invisible at the number. Bump it:

```bash
python3 - <<'PY'
import json, pathlib
p = pathlib.Path('.claude-plugin/plugin.json')
d = json.loads(p.read_text())
d['version'] = '0.4.0'
p.write_text(json.dumps(d, indent=2) + '\n')
PY
```

Add to `CHANGELOG.md` under a new `## 0.4.0` heading: the new skill, and the note
that this release also delivers the #41 boundary fix and #83 payload cleanup which
have been on `main` but unreachable by `plugin update` since June.

Add `skill-library-sync` to the skill tables in `README.md` and `CLAUDE.md`.

- [ ] **Step 6: Run every suite**

Run: `for t in scripts/test-*.sh; do bash "$t" || echo "FAIL $t"; done`
Expected: no FAIL lines

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(skill-library-sync): ship the skill, bump to 0.4.0

The version bump is not bookkeeping. The installed plugin has been stale since
2026-06-17 and 'claude plugin update' answers 'already at the latest version
(0.3.0)', because 42 commits landed without the number moving -- so the #41
boundary fix has been on main and unreachable for weeks. 0.4.0 delivers the new
skill AND everything that has been stranded behind an unmoved version."
```

---

## Verification before the first real run

The plan ends here; running the skill against the user's vault is a separate act
and needs its own confirmation.

- [ ] `node scripts/cli.js diff "$OBSIDIAN_VAULT_PATH"` and read the preview
- [ ] Confirm the counts match today's measurement: 78 created, 40 relocated, 29 retired
- [ ] A divergence from those numbers is a finding, not a rounding error - the vault
      is edited live, so re-measure rather than assume the plan is stale
- [ ] Show the preview to the user, get an explicit yes, then apply
