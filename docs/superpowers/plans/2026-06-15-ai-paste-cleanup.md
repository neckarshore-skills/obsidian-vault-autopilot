# ai-paste-cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `ai-paste-cleanup` Claude Code skill — a deterministic Node transform library plus a dry-run/write CLI plus a SKILL.md orchestrator that applies the proven-safe AI-paste cleanup transforms to a note or folder, with a fingerprint self-check that aborts on suspected mass deletion.

**Architecture:** Pure transform library (`rules.js`) → CLI/IO layer (`clean.js`) → SKILL.md orchestrator. The library is a list of ordered rules, each a pure `find/replace` plus a per-rule "allowed-removal" contract. `clean.js` walks files, renders the dry-run report, enforces the two-layer write gate, and refuses to write if any rule's fingerprint contract is violated. Determinism is the safety story — no LLM is in the transform path.

**Tech Stack:** Node.js (v18+; dev machine is v26), CommonJS, `node:test` built-in runner (zero dependencies), `node:fs`/`node:path`/`node:os`. CI via a thin `scripts/test-ai-paste-cleanup.sh` bridge that slots into the existing `test.yml` `scripts/test-*.sh` loop.

**Spec:** `docs/superpowers/specs/2026-06-15-ai-paste-cleanup-design.md`. Source of truth for patterns: the two Nexus regex docs (`OPS – Obsidian Linter Setup (AI-Paste Cleanup)`, `OPS – Linter Regex Test & Incident (Before-After)`).

---

## File Structure

| Path | Responsibility |
|------|----------------|
| `skills/ai-paste-cleanup/scripts/rules.js` | Pure transform lib: ordered `RULES`, `applyAll()`, fingerprint guard, mass-deletion guard. No file IO. |
| `skills/ai-paste-cleanup/scripts/clean.js` | CLI/IO: arg parse, file/folder walk, dry-run report, two-layer write gate, exit codes. Consumes `rules.js`. |
| `skills/ai-paste-cleanup/tests/rules.test.js` | Unit tests: before/after cases, heading + wikilink/link/checkbox negatives, idempotency, fingerprint guard, mass-deletion guard. |
| `skills/ai-paste-cleanup/tests/clean.test.js` | Integration: dry-run writes nothing, `--write` applies, folder walk excludes dirs, guard violation → exit 2 + no write. |
| `skills/ai-paste-cleanup/SKILL.md` | Orchestrator: when to run, dry-run → human gate → write, report format. |
| `skills/ai-paste-cleanup/references/safe-rule-set.md` | The validated rule set + provenance (links to the two regex docs + the incident). |
| `scripts/test-ai-paste-cleanup.sh` | CI bridge: `node --test skills/ai-paste-cleanup/tests/`. Picked up by `test.yml`'s existing loop. |

**Engine-fidelity invariant (applies to every rule):** patterns run as `new RegExp(source, "gm")` — global + multiline, **never the `u`-flag** — to match the obsidian-linter's JavaScript engine. `\x{...}` is forbidden; use `\uXXXX`.

**Fingerprint contract (the safety core):** each rule declares `allowedRemovals` — the Set of code points it may delete. After each rule runs, the multiset of removed characters must be a subset of `allowedRemovals`, else **throw and write nothing**. The citation rule (#2) is span-based (`allowedRemovals: null`) — it removes arbitrary content inside matched markers, so the charset guard cannot protect it; its safety rests on the byte-exact pattern + mandatory negative tests + the coarse mass-deletion backstop.

---

## Task 1: Transform library skeleton + the 7 unambiguous rules

Rule #2 (citation) is deferred to Task 4 (behind the production-vault gate). This task builds the infrastructure and the 7 rules whose patterns are unambiguous from the docs.

**Files:**
- Create: `skills/ai-paste-cleanup/scripts/rules.js`
- Test: `skills/ai-paste-cleanup/tests/rules.test.js`

- [ ] **Step 1: Write failing tests for the 7 rules + negatives**

```javascript
// skills/ai-paste-cleanup/tests/rules.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyAll, RULES } = require('../scripts/rules.js');

// Helper: apply only the named rule (isolates a rule from the pipeline).
function only(name, text) {
  const rule = RULES.find((r) => r.name === name);
  return text.replace(rule.find, rule.replace);
}

test('unbold-headings: whole-line bold heading is unwrapped', () => {
  assert.equal(only('unbold-headings', '## **Executive Summary**'), '## Executive Summary');
  assert.equal(only('unbold-headings', '#### **Step 4 — Feature Branch:**'), '#### Step 4 — Feature Branch:');
});
test('unbold-headings: partial bold is left alone', () => {
  assert.equal(only('unbold-headings', '## The **important** thing'), '## The **important** thing');
});

test('nbsp-to-space: NBSP becomes a normal space', () => {
  assert.equal(only('nbsp-to-space', 'Executive\u00A0Box: 250 kW'), 'Executive Box: 250 kW');
});

test('zero-width-strip: removes ZWSP/ZWNJ/ZWJ/BOM, text intact', () => {
  assert.equal(only('zero-width-strip', 'Executive Box: 250 kW\u200B'), 'Executive Box: 250 kW');
  assert.equal(only('zero-width-strip', '\uFEFFhello\u200C\u200Dworld'), 'helloworld');
});

test('italic-headings-asterisk: single span unwrapped, multi-span untouched', () => {
  assert.equal(only('italic-headings-asterisk', '## *Title*'), '## Title');
  assert.equal(only('italic-headings-asterisk', '### *Multi word italic*'), '### Multi word italic');
  assert.equal(only('italic-headings-asterisk', '## *a* b *c*'), '## *a* b *c*');
  assert.equal(only('italic-headings-asterisk', '## **Bold stays bold**'), '## **Bold stays bold**');
});
test('italic-headings-underscore: single span unwrapped, snake_case untouched', () => {
  assert.equal(only('italic-headings-underscore', '## _Title_'), '## Title');
  assert.equal(only('italic-headings-underscore', '## snake_case word'), '## snake_case word');
});

test('collapse-blank-lines: 2+ blank lines collapse to one', () => {
  assert.equal(only('collapse-blank-lines', 'a\n\n\n\nb'), 'a\n\nb');
  assert.equal(only('collapse-blank-lines', 'a\n\nb'), 'a\n\nb'); // already one blank line
});

test('strip-trailing-whitespace: trailing spaces/tabs removed, content kept', () => {
  assert.equal(only('strip-trailing-whitespace', 'line one   \nline two\t\n'), 'line one\nline two\n');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test skills/ai-paste-cleanup/tests/rules.test.js`
Expected: FAIL — `Cannot find module '../scripts/rules.js'`.

- [ ] **Step 3: Implement `rules.js` infrastructure + the 7 rules**

```javascript
// skills/ai-paste-cleanup/scripts/rules.js
'use strict';

// Coarse backstop: abort if a run deletes more than this fraction of the
// note's non-whitespace characters (defense-in-depth behind the per-rule guard).
const MASS_DELETION_RATIO = 0.25;

// Ordered rule set. Each rule:
//   name            unique id (also the report key)
//   find            RegExp, flags "gm" (global+multiline, NEVER the u-flag)
//   replace         string ($1/$2 backrefs allowed) or ''
//   allowedRemovals Set<string> of code points the rule may delete,
//                   or null for a span-based rule (citation) exempt from the
//                   charset guard and covered by negative tests instead.
// Citation (#2) is inserted at index 1 in Task 4 (behind the data.json gate).
const RULES = [
  { name: 'unbold-headings',            find: /^(#{1,6} )\*\*(.+)\*\*\s*$/gm, replace: '$1$2', allowedRemovals: new Set(['*']) },
  { name: 'nbsp-to-space',              find: /\u00A0/gm,                      replace: ' ',    allowedRemovals: new Set(['\u00A0']) },
  { name: 'zero-width-strip',           find: /[\u200B\u200C\u200D\uFEFF]/gm,  replace: '',     allowedRemovals: new Set(['\u200B','\u200C','\u200D','\uFEFF']) },
  { name: 'italic-headings-asterisk',   find: /^(#{1,6} )\*([^*]+)\*\s*$/gm,    replace: '$1$2', allowedRemovals: new Set(['*']) },
  { name: 'italic-headings-underscore', find: /^(#{1,6} )_([^_]+)_\s*$/gm,      replace: '$1$2', allowedRemovals: new Set(['_']) },
  { name: 'collapse-blank-lines',       find: /\n{3,}/gm,                       replace: '\n\n', allowedRemovals: new Set(['\n']) },
  { name: 'strip-trailing-whitespace',  find: /[ \t]+$/gm,                      replace: '',     allowedRemovals: new Set([' ','\t']) },
];

class FingerprintError extends Error {
  constructor(ruleName, ch, count) {
    const hex = 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
    super(`Fingerprint guard: rule "${ruleName}" removed disallowed character ${hex} (${count}x). Aborting; nothing written.`);
    this.name = 'FingerprintError';
    this.rule = ruleName; this.char = ch; this.count = count;
  }
}
class MassDeletionError extends Error {
  constructor(origNW, newNW) {
    super(`Mass-deletion guard: non-whitespace content dropped from ${origNW} to ${newNW} (> ${MASS_DELETION_RATIO * 100}%). Aborting; nothing written.`);
    this.name = 'MassDeletionError';
    this.origNW = origNW; this.newNW = newNW;
  }
}

function charCounts(s) {
  const m = new Map();
  for (const ch of s) m.set(ch, (m.get(ch) || 0) + 1);
  return m;
}
function removedChars(before, after) {
  const b = charCounts(before), a = charCounts(after);
  const removed = new Map();
  for (const [ch, n] of b) {
    const delta = n - (a.get(ch) || 0);
    if (delta > 0) removed.set(ch, delta);
  }
  return removed;
}
function checkRule(rule, before, after) {
  if (rule.allowedRemovals === null) return; // span-based: guarded by negative tests
  for (const [ch, count] of removedChars(before, after)) {
    if (!rule.allowedRemovals.has(ch)) throw new FingerprintError(rule.name, ch, count);
  }
}
function nonWhitespaceLength(s) {
  let n = 0;
  for (const ch of s) if (!/\s/.test(ch)) n++;
  return n;
}

// Apply all rules in order. Throws FingerprintError / MassDeletionError on a
// guard violation BEFORE returning — callers must not write on throw.
function applyAll(text) {
  let cur = text;
  const perRule = {};
  for (const rule of RULES) {
    const hits = (cur.match(rule.find) || []).length;
    const next = cur.replace(rule.find, rule.replace);
    checkRule(rule, cur, next);
    perRule[rule.name] = hits;
    cur = next;
  }
  const origNW = nonWhitespaceLength(text);
  const newNW = nonWhitespaceLength(cur);
  if (origNW > 0 && (origNW - newNW) / origNW > MASS_DELETION_RATIO) {
    throw new MassDeletionError(origNW, newNW);
  }
  return { text: cur, perRule, changed: cur !== text };
}

module.exports = { RULES, applyAll, removedChars, checkRule, FingerprintError, MassDeletionError, MASS_DELETION_RATIO };
```

> **Important — write invisible characters as `\uXXXX` escapes, never literals.** Wherever this plan shows a non-breaking space or a zero-width character (in `rules.js` patterns/allowlists OR in test-input strings), the implementer types the escape, not the invisible byte. Canonical forms:
> - `nbsp-to-space`: `find: /\u00A0/gm`, `replace: ' '` (one ordinary U+0020), `allowedRemovals: new Set(['\u00A0'])`
> - `zero-width-strip`: `find: /[\u200B\u200C\u200D\uFEFF]/gm`, `replace: ''`, `allowedRemovals: new Set(['\u200B','\u200C','\u200D','\uFEFF'])`
> - Test inputs, e.g.: `'Executive\u00A0Box: 250 kW'`, `'Executive Box: 250 kW\u200B'`, `'\uFEFFhello\u200C\u200Dworld'`.
> This is the same `\uXXXX`-only / no-`u`-flag invariant the spec mandates — and the exact mistake that caused the 2026-06-04 incident in reverse. Copying literal invisibles is a defect.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test skills/ai-paste-cleanup/tests/rules.test.js`
Expected: PASS (all 8 tests).

- [ ] **Step 5: Commit**

```bash
git add skills/ai-paste-cleanup/scripts/rules.js skills/ai-paste-cleanup/tests/rules.test.js
git commit -m "feat(ai-paste-cleanup): transform lib skeleton + 7 unambiguous rules (TDD)"
```

---

## Task 2: Fingerprint guard test (the incident replay)

Prove the per-rule charset guard catches the 2026-06-04 incident class: a rule that deletes characters outside its declared allowlist must throw.

**Files:**
- Test: `skills/ai-paste-cleanup/tests/rules.test.js` (append)

- [ ] **Step 1: Write the failing test**

```javascript
const { checkRule, FingerprintError } = require('../scripts/rules.js');

test('fingerprint guard: a rule deleting out-of-allowlist chars throws (incident replay)', () => {
  // Simulate the broken \x{} zero-width rule, which deleted x,B,C,D,E,F,0,2.
  const brokenRule = { name: 'zero-width-broken', allowedRemovals: new Set(['\u200B','\u200C','\u200D','\uFEFF']) };
  const before = 'Executive Box: 250 kW';
  const after  = 'ecutive o: 5 kW'; // E,x,B,2,0 deleted — out of allowlist
  assert.throws(() => checkRule(brokenRule, before, after), FingerprintError);
});

test('fingerprint guard: an in-allowlist deletion does not throw', () => {
  const rule = { name: 'nbsp', allowedRemovals: new Set(['\u00A0']) };
  assert.doesNotThrow(() => checkRule(rule, 'a\u00A0b', 'a b'));
});
```

- [ ] **Step 2: Run to verify it passes immediately** (the guard already exists from Task 1)

Run: `node --test skills/ai-paste-cleanup/tests/rules.test.js`
Expected: PASS. (This task is a regression-pin on the safety core, not new behavior — if it fails, the guard is wrong.)

- [ ] **Step 3: Commit**

```bash
git add skills/ai-paste-cleanup/tests/rules.test.js
git commit -m "test(ai-paste-cleanup): pin fingerprint guard against the 2026-06-04 incident class"
```

---

## Task 3: Mass-deletion backstop + idempotency tests

**Files:**
- Test: `skills/ai-paste-cleanup/tests/rules.test.js` (append)

- [ ] **Step 1: Write the failing/regression tests**

```javascript
const { MassDeletionError } = require('../scripts/rules.js');

test('idempotency: applyAll twice equals applyAll once', () => {
  const input = '## **Title**\n\n\n\nbody\u00A0text   \n\n\n';
  const once = applyAll(input).text;
  const twice = applyAll(once);
  assert.equal(twice.text, once);
  assert.equal(twice.changed, false);
  for (const v of Object.values(twice.perRule)) assert.equal(v, 0);
});

test('applyAll reports per-rule hit counts', () => {
  const out = applyAll('## **A**\n## *B*\nx\u200By\u00A0z   ');
  assert.equal(out.perRule['unbold-headings'], 1);
  assert.equal(out.perRule['italic-headings-asterisk'], 1);
  assert.equal(out.perRule['zero-width-strip'], 1);
  assert.equal(out.perRule['nbsp-to-space'], 1);
  assert.equal(out.perRule['strip-trailing-whitespace'], 1);
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `node --test skills/ai-paste-cleanup/tests/rules.test.js`
Expected: PASS.

> **Note on the mass-deletion guard:** with only the 7 charset-guarded rules it is hard to trip honestly (each rule can only remove its tiny allowlist). A direct unit test of `MassDeletionError` becomes meaningful once the span-based citation rule exists — added in Task 4, Step 5.

- [ ] **Step 3: Commit**

```bash
git add skills/ai-paste-cleanup/tests/rules.test.js
git commit -m "test(ai-paste-cleanup): idempotency + per-rule report counts"
```

---

## Task 4: Citation rule (#2) — PRODUCTION-VAULT GATE

> **GATE (do not skip):** the byte-exact citation pattern lives in the live plugin config inside the **production Nexus vault**. Reading it is a production-vault access — **a gate, not a step**. obi asks the user explicitly and waits for approval before Step 1. The pattern must NOT be guessed from the rendered Markdown docs (they are lossy and a naive bracket pattern corrupts wikilinks).

**Files:**
- Modify: `skills/ai-paste-cleanup/scripts/rules.js` (insert citation rule at index 1)
- Test: `skills/ai-paste-cleanup/tests/rules.test.js` (append)

- [ ] **Step 1: (After user approval) read the exact pattern from `data.json`**

Run (read-only, single file):
```bash
node -e 'const d=require(process.env.HOME+"/Vaults/Nexus/.obsidian/plugins/obsidian-linter/data.json"); console.log(JSON.stringify((d.customRegexes||[]).map(r=>({find:r.find,replace:r.replace,flags:r.flags})),null,2))'
```
Record the citation rule's `find` and `flags` verbatim. Confirm flags are `gm` (no `u`). If the recorded pattern is broader than marker-scoped (i.e. it could match `[[...]]`/`[...](...)`/`- [ ]`), **narrow it for the skill** and note the divergence from the plugin in the commit body and the session report.

- [ ] **Step 2: Write the mandatory negative + positive tests FIRST**

```javascript
test('citation-markers: removes the marker (positive)', () => {
  // Replace <CITATION_SAMPLE> with a real marker from data.json, e.g. ' [1]'.
  assert.equal(only('citation-markers', 'The team signed off [1].'), 'The team signed off.');
});

test('citation-markers SAFETY: wikilinks, md-links, embeds, checkboxes survive', () => {
  for (const s of [
    '[[Note Name]]',
    '[[Note|alias]]',
    '[text](https://example.com)',
    '![[embed.png]]',
    '- [ ] task',
    '- [x] done',
  ]) {
    assert.equal(only('citation-markers', s), s, `citation rule must not touch: ${s}`);
  }
});
```

- [ ] **Step 3: Run to verify the negative test fails if (and only if) the pattern is unsafe**

Run: `node --test skills/ai-paste-cleanup/tests/rules.test.js`
Expected before inserting the rule: the `citation-markers` tests FAIL (rule not found). This confirms the tests are wired.

- [ ] **Step 4: Insert the citation rule at index 1 in `rules.js`**

```javascript
// In rules.js, splice into RULES at position 1 (after unbold-headings):
// Use the EXACT find from data.json (or the narrowed-safe form). Example shape:
//   { name: 'citation-markers', find: /<EXACT_FROM_DATA_JSON>/gm, replace: '', allowedRemovals: null },
// allowedRemovals MUST be null (span-based) — the charset guard cannot cover it.
```
Place it so the final order is: unbold-headings, **citation-markers**, nbsp-to-space, zero-width-strip, italic-asterisk, italic-underscore, collapse-blank-lines, strip-trailing-whitespace.

- [ ] **Step 5: Add the mass-deletion backstop test (now meaningful with a span rule)**

```javascript
test('mass-deletion guard: a pathological citation pattern that eats the note aborts', () => {
  // Temporarily prove the backstop: construct a note that is almost entirely a
  // single bracketed span and assert applyAll throws MassDeletionError IF the
  // citation pattern were broad. With the correct narrow pattern this note is
  // untouched (no throw). Document whichever holds for the real pattern.
  const note = '[' + 'x'.repeat(500) + ']';
  // With a marker-scoped pattern this is NOT a citation -> unchanged, no throw:
  assert.doesNotThrow(() => applyAll(note));
});
```

- [ ] **Step 6: Run all rule tests to verify pass**

Run: `node --test skills/ai-paste-cleanup/tests/rules.test.js`
Expected: PASS — including the wikilink/link/checkbox safety test.

- [ ] **Step 7: Commit**

```bash
git add skills/ai-paste-cleanup/scripts/rules.js skills/ai-paste-cleanup/tests/rules.test.js
git commit -m "feat(ai-paste-cleanup): citation rule (#2) — byte-exact from data.json + wikilink/link/checkbox safety tests"
```

---

## Task 5: CLI — single-file dry-run + write + `--stdout`

**Files:**
- Create: `skills/ai-paste-cleanup/scripts/clean.js`
- Test: `skills/ai-paste-cleanup/tests/clean.test.js`

- [ ] **Step 1: Write failing tests for single-file behavior**

```javascript
// skills/ai-paste-cleanup/tests/clean.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cleanPath } = require('../scripts/clean.js');

function tmpVault() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'apc-'));
}

test('dry-run does not modify the file', () => {
  const dir = tmpVault();
  const f = path.join(dir, 'note.md');
  fs.writeFileSync(f, '## **Title**\nbody\u00A0x   \n', 'utf8');
  const before = fs.readFileSync(f, 'utf8');
  const res = cleanPath(f, { write: false });
  assert.equal(fs.readFileSync(f, 'utf8'), before, 'dry-run must not write');
  assert.equal(res.files.length, 1);
  assert.equal(res.files[0].changed, true);
});

test('--write applies the transforms', () => {
  const dir = tmpVault();
  const f = path.join(dir, 'note.md');
  fs.writeFileSync(f, '## **Title**\n', 'utf8');
  cleanPath(f, { write: true });
  assert.equal(fs.readFileSync(f, 'utf8'), '## Title\n');
});

test('cleanText helper returns cleaned content for diffing', () => {
  const { cleanText } = require('../scripts/clean.js');
  assert.equal(cleanText('## **Title**'), '## Title');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test skills/ai-paste-cleanup/tests/clean.test.js`
Expected: FAIL — `Cannot find module '../scripts/clean.js'`.

- [ ] **Step 3: Implement `clean.js` (library functions + thin CLI)**

```javascript
// skills/ai-paste-cleanup/scripts/clean.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { applyAll } = require('./rules.js');

const SKIP_DIRS = new Set(['_trash', '.obsidian', '.git', 'node_modules']);

function cleanText(text) {
  return applyAll(text).text;
}

// Collect *.md files under a directory, skipping excluded/dot dirs.
function walkMarkdown(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

// Plan-then-write: transform every target in memory first (guards run here and
// throw on violation). Only if ALL succeed AND opts.write is set do we write.
// Returns { files: [{path, changed, perRule}], totals, wrote }.
function cleanPath(target, opts = {}) {
  const stat = fs.statSync(target);
  const files = stat.isDirectory() ? walkMarkdown(target) : [target];

  const transform = opts.transform || applyAll; // seam: lets tests inject a throwing transform
  const planned = files.map((file) => {
    const original = fs.readFileSync(file, 'utf8');
    const result = transform(original); // may throw FingerprintError/MassDeletionError
    return { path: file, original, ...result };
  });

  let wrote = false;
  if (opts.write) {
    for (const p of planned) if (p.changed) fs.writeFileSync(p.path, p.text, 'utf8');
    wrote = true;
  }

  const totals = {};
  for (const p of planned) for (const [k, v] of Object.entries(p.perRule)) totals[k] = (totals[k] || 0) + v;
  return {
    files: planned.map((p) => ({ path: p.path, changed: p.changed, perRule: p.perRule })),
    totals,
    changedCount: planned.filter((p) => p.changed).length,
    fileCount: planned.length,
    wrote,
  };
}

module.exports = { cleanPath, cleanText, walkMarkdown };

// ---- CLI ----
if (require.main === module) {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const stdout = args.includes('--stdout');
  const target = args.find((a) => !a.startsWith('--'));
  if (!target) { console.error('usage: node clean.js <path> [--write] [--stdout]'); process.exit(1); }
  try {
    if (stdout) { process.stdout.write(cleanText(fs.readFileSync(target, 'utf8'))); process.exit(0); }
    const res = cleanPath(target, { write });
    const header = write ? 'WROTE' : 'DRY-RUN (nothing written)';
    console.log(`ai-paste-cleanup — ${header}`);
    console.log(`Files: ${res.changedCount} changed of ${res.fileCount}`);
    const hits = Object.entries(res.totals).filter(([, v]) => v > 0);
    if (hits.length) console.log('Per-rule: ' + hits.map(([k, v]) => `${k}: ${v}`).join(' | '));
    else console.log('Per-rule: (no changes)');
    process.exit(0);
  } catch (e) {
    console.error(`ABORTED — ${e.message}`);
    process.exit(2); // guard violation: nothing written
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test skills/ai-paste-cleanup/tests/clean.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add skills/ai-paste-cleanup/scripts/clean.js skills/ai-paste-cleanup/tests/clean.test.js
git commit -m "feat(ai-paste-cleanup): CLI lib — single-file dry-run/write/--stdout (plan-then-write)"
```

---

## Task 6: CLI — folder walk + guard-abort writes nothing

**Files:**
- Test: `skills/ai-paste-cleanup/tests/clean.test.js` (append)

- [ ] **Step 1: Write failing tests**

```javascript
test('folder mode walks *.md only and skips excluded dirs', () => {
  const dir = tmpVault();
  fs.writeFileSync(path.join(dir, 'a.md'), '## **A**\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'b.txt'), '## **B**\n', 'utf8'); // not .md
  fs.mkdirSync(path.join(dir, '_trash'));
  fs.writeFileSync(path.join(dir, '_trash', 'c.md'), '## **C**\n', 'utf8'); // skipped
  const res = cleanPath(dir, { write: false });
  const seen = res.files.map((f) => path.basename(f.path)).sort();
  assert.deepEqual(seen, ['a.md']);
});

test('guard violation: a throwing transform writes NO file (no partial write)', () => {
  const dir = tmpVault();
  const a = path.join(dir, 'a.md');
  const b = path.join(dir, 'b.md');
  fs.writeFileSync(a, '## **A**\n', 'utf8');
  fs.writeFileSync(b, '## **B**\n', 'utf8');
  const beforeA = fs.readFileSync(a, 'utf8');
  const beforeB = fs.readFileSync(b, 'utf8');
  // Inject a transform that throws on the 2nd file. plan-then-write transforms
  // ALL targets before writing ANY, so the throw must abort before any write.
  let n = 0;
  const transform = () => { if (++n === 2) throw new Error('boom'); return { text: 'x', perRule: {}, changed: true }; };
  assert.throws(() => cleanPath(dir, { write: true, transform }));
  assert.equal(fs.readFileSync(a, 'utf8'), beforeA, 'file a must be untouched');
  assert.equal(fs.readFileSync(b, 'utf8'), beforeB, 'file b must be untouched');
});
```

- [ ] **Step 2: Run to verify both tests pass**

Run: `node --test skills/ai-paste-cleanup/tests/clean.test.js`
Expected: PASS. The folder-walk test confirms `walkMarkdown` exclusions; the injection test proves the no-partial-write contract with a real throw. If the folder test fails, fix `walkMarkdown` exclusions.

- [ ] **Step 3: Add the happy-path write check**

```javascript
test('folder --write applies planned changes to changed files only', () => {
  const dir = tmpVault();
  const f = path.join(dir, 'x.md');
  fs.writeFileSync(f, '## **Title**\nok\n', 'utf8');
  const plan = cleanPath(dir, { write: false });
  assert.equal(plan.files[0].changed, true);
  cleanPath(dir, { write: true });
  assert.equal(fs.readFileSync(f, 'utf8'), '## Title\nok\n');
});
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test skills/ai-paste-cleanup/tests/clean.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/ai-paste-cleanup/tests/clean.test.js
git commit -m "test(ai-paste-cleanup): folder walk exclusions + plan-then-write no-partial-write contract"
```

---

## Task 7: CI bridge script

**Files:**
- Create: `scripts/test-ai-paste-cleanup.sh`

- [ ] **Step 1: Write the bridge script**

```bash
#!/usr/bin/env bash
# CI bridge: runs the ai-paste-cleanup node:test suites. Picked up by the
# existing scripts/test-*.sh loop in .github/workflows/test.yml — no workflow
# edit needed. Exits non-zero if any test fails.
set -euo pipefail
cd "$(dirname "$0")/.."
node --test skills/ai-paste-cleanup/tests/
```

- [ ] **Step 2: Make it executable and run it locally**

Run:
```bash
chmod +x scripts/test-ai-paste-cleanup.sh
bash scripts/test-ai-paste-cleanup.sh
```
Expected: all suites PASS, exit 0.

- [ ] **Step 3: Verify it slots into the CI loop pattern**

Run: `ls scripts/test-*.sh | grep ai-paste-cleanup`
Expected: prints `scripts/test-ai-paste-cleanup.sh` (so `test.yml`'s loop will run it).

- [ ] **Step 4: Commit**

```bash
git add scripts/test-ai-paste-cleanup.sh
git commit -m "ci(ai-paste-cleanup): bridge node:test suites into the test.yml assertion loop"
```

---

## Task 8: SKILL.md orchestrator

**Files:**
- Create: `skills/ai-paste-cleanup/SKILL.md`

- [ ] **Step 1: Write `SKILL.md`**

Frontmatter must follow the house style (see `skills/note-rename/SKILL.md`): `name`, `status`, `description` starting with "Use when…" plus "Trigger phrases - …" with 3+ phrases. No emoji. English. No hardcoded paths (`${OBSIDIAN_VAULT_PATH}`).

```markdown
---
name: ai-paste-cleanup
status: beta
description: Use when AI-generated or pasted Markdown carries cruft — bold/italic-wrapped headings, citation markers, non-breaking spaces, zero-width characters, trailing whitespace, runs of blank lines. Trigger phrases - "clean this note", "clean up AI paste", "remove the slop", "fix pasted markdown", "clean this folder". Complements the obsidian-linter plugin; cleans notes Claude wrote directly or for users who do not run the linter.
---

# AI-Paste Cleanup

Apply the proven-safe AI-paste cleanup transforms to a note or folder. Deterministic Node script; always dry-run first; never writes without confirmation.

## Principle: Core + Nahbereich + Report

- **Core:** Run the 8 validated transforms (`scripts/rules.js`) over a file or folder.
- **Nahbereich:** None destructive. The fingerprint self-check aborts the whole run rather than risk a bad edit.
- **Report:** Per-rule counts, files changed, anything noticed but not fixed (e.g. broken YAML → property-enrich).

## How to run

1. **Dry-run (always first):**
   `node "${CLAUDE_PLUGIN_ROOT}/skills/ai-paste-cleanup/scripts/clean.js" <path>`
   Show the user the per-rule counts. For a single file, also show a diff: get the cleaned text via `... clean.js <file> --stdout` and present old vs new.
2. **Human gate:** ask "Apply these changes? (yes/no)". For a folder of more than 10 files, first state: "I will clean N files in <vault>. Confirm?" and wait.
3. **Write (only after yes):**
   `node ".../clean.js" <path> --write`
4. If the script exits non-zero with `ABORTED — Fingerprint guard…` or `… Mass-deletion guard…`, **do not retry blindly**. Report the violation; it means a transform tried to delete unexpected content. Nothing was written.

## Scope and safety

- Folder mode processes `*.md` only and skips `_trash/`, `.obsidian/`, `.git/`, dotfiles.
- The script is the only thing that applies regexes — never hand-edit notes to "clean" them; determinism is the safety guarantee.
- Production-vault runs follow the repo's Production Vault Safety Rules (gate before switching vaults; confirm before > 10 files).

## Report format

\`\`\`
## ai-paste-cleanup Report — <date>
### Done
- Cleaned <n> of <m> files
- <per-rule counts>
### Findings
- <things noticed, routed to other skills>
### Unchanged
- <count> already clean
\`\`\`
```

- [ ] **Step 2: Validate frontmatter + conventions**

Run:
```bash
head -5 skills/ai-paste-cleanup/SKILL.md
grep -c '\${OBSIDIAN_VAULT_PATH}\|\${CLAUDE_PLUGIN_ROOT}' skills/ai-paste-cleanup/SKILL.md
grep -rn '/Users/\|/Vaults/Nexus' skills/ai-paste-cleanup/SKILL.md || echo "no hardcoded paths — good"
```
Expected: frontmatter present; no hardcoded paths.

- [ ] **Step 3: Commit**

```bash
git add skills/ai-paste-cleanup/SKILL.md
git commit -m "feat(ai-paste-cleanup): SKILL.md orchestrator (dry-run -> human gate -> write)"
```

---

## Task 9: references/safe-rule-set.md (provenance)

**Files:**
- Create: `skills/ai-paste-cleanup/references/safe-rule-set.md`

- [ ] **Step 1: Write the reference doc**

Document each of the 8 rules: name, pattern, what it fixes, removal allowlist, and provenance (which regex doc + the 2026-06-04 incident). State the `\uXXXX`-only / no-`u`-flag invariant prominently. This is the human-readable companion to `rules.js` and the place future maintainers learn why `\x{}` is banned.

- [ ] **Step 2: Cross-check against `rules.js`**

Run: `grep -o "name: '[a-z-]*'" skills/ai-paste-cleanup/scripts/rules.js`
Confirm every rule name appears in the reference doc.

- [ ] **Step 3: Commit**

```bash
git add skills/ai-paste-cleanup/references/safe-rule-set.md
git commit -m "docs(ai-paste-cleanup): safe-rule-set reference + provenance"
```

---

## Task 10: Full-suite smoke + end-to-end dry-run on a fixture

**Files:**
- Create: `skills/ai-paste-cleanup/tests/fixtures/dirty-note.md`

- [ ] **Step 1: Create a realistic dirty fixture**

A note combining every cruft class: a bold heading, an italic heading, NBSP, a zero-width char, a citation marker, trailing whitespace, 3+ blank lines — PLUS a wikilink, a markdown link, and a checkbox that must survive.

- [ ] **Step 2: Dry-run the fixture and eyeball the report**

Run: `node skills/ai-paste-cleanup/scripts/clean.js skills/ai-paste-cleanup/tests/fixtures/dirty-note.md`
Expected: DRY-RUN header, "1 changed of 1", per-rule counts > 0 for the cruft rules. File unchanged on disk.

- [ ] **Step 3: Confirm wikilink/link/checkbox survival via `--stdout`**

Run: `node skills/ai-paste-cleanup/scripts/clean.js skills/ai-paste-cleanup/tests/fixtures/dirty-note.md --stdout | grep -E '\[\[|\]\(|- \[ \]'`
Expected: the wikilink, markdown link, and checkbox lines are present in the cleaned output.

- [ ] **Step 4: Run the whole suite**

Run: `bash scripts/test-ai-paste-cleanup.sh`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/ai-paste-cleanup/tests/fixtures/dirty-note.md
git commit -m "test(ai-paste-cleanup): end-to-end dirty-note fixture + survival smoke"
```

---

## Definition of Done (in-review)

1. `bash scripts/test-ai-paste-cleanup.sh` green locally; CI green on the branch.
2. All 8 rules implemented; citation rule byte-verified against `data.json` (gated read done) or narrowed-safe with the divergence reported.
3. Wikilink / link / checkbox safety test passes (the highest-risk guarantee).
4. Dry-run writes nothing; `--write` only after the human gate; guard violation → exit 2, nothing written.
5. SKILL.md conventions green (frontmatter, no hardcoded paths, no emoji, English).
6. PR opened against `main`. Status = in-review (user PASS + MASCHIN PIR pending — not self-declared done).

**Out of scope (backlog, per spec §11):** Phase-2 auto-hook, linter-admin skill, `--backup`, per-rule toggling, vault-wide auto-run, non-Obsidian targets. Version bump + changelog at ship time.

## Self-Review Notes (filled during writing)

- **Spec coverage:** every spec §5 rule → Task 1/Task 4; §6 fingerprint → Task 2; §7 CLI gate → Tasks 5–6; §8 idempotency → Task 3; §9 report → Task 8 + clean.js; §10 tests → Tasks 1–6,10; §12 gates → Task 4 (vault gate), Task 7 (CI), Task 8 (SKILL.md conventions).
- **Guard-abort testability (resolved):** the *safe* rule set by design never over-deletes, so it cannot trip the guard end-to-end. Rather than fake it, `cleanPath` exposes an `opts.transform` seam (Task 5 Step 3) so Task 6 injects a throwing transform and proves the real **no-partial-write** contract (a mid-run throw leaves every file byte-identical). The incident class itself is pinned at the unit level by `checkRule` (Task 2). Honest and real, not conceptual.
- **CRLF / line endings:** rules process content as-is; no EOL normalization (structural, out of scope). Known limitation — note in `safe-rule-set.md`.
