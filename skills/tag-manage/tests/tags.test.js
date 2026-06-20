'use strict';
// Stage 1 contract for the deterministic tag engine (pure logic, no fs).
// Survival + representation-matrix + case-fold + audit grouping + the guard.
// Mirrors the ai-paste-cleanup test style (node:test, real behavior, anti-vacuous-green).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  logicalKey, isValidTag, isReserved, RESERVED_TAGS,
  bodyTags, frontmatterTags, noteTags,
  applyOps, assertSurvival, SurvivalError,
  caseVariantGroups, separatorVariantGroups, filterReserved,
  splitFrontmatter,
} = require('../scripts/tags.js');

// ---------------------------------------------------------------------------
// logicalKey — case-folded identity, preserves '/', Unicode-aware
// ---------------------------------------------------------------------------
test('logicalKey: case variants fold to one key', () => {
  assert.equal(logicalKey('AI'), logicalKey('ai'));
  assert.equal(logicalKey('Ai'), 'ai');
});
test('logicalKey: preserves the nested-tag slash', () => {
  assert.equal(logicalKey('AI/Coding'), 'ai/coding');
});
test('logicalKey: Unicode fold (German vault — not naive ASCII tolower)', () => {
  assert.equal(logicalKey('Künstliche-Intelligenz'), 'künstliche-intelligenz');
});
test('logicalKey: distinct spellings stay distinct (Step 0 — real merge target)', () => {
  assert.notEqual(logicalKey('ai'), logicalKey('a-i'));
});

// ---------------------------------------------------------------------------
// isValidTag — Obsidian validity (>=1 non-numeric char, allowed charset)
// ---------------------------------------------------------------------------
test('isValidTag: numbers-only is invalid, y-prefixed is valid (primary-source rule)', () => {
  assert.equal(isValidTag('1984'), false);
  assert.equal(isValidTag('y1984'), true);
});
test('isValidTag: allowed charset and nested', () => {
  assert.equal(isValidTag('AI-ML'), true);
  assert.equal(isValidTag('ai/ml'), true);
  assert.equal(isValidTag('snake_case'), true);
  assert.equal(isValidTag('ai ml'), false);
  assert.equal(isValidTag('a#b'), false);
});

// ---------------------------------------------------------------------------
// isReserved — VaultAutopilot plumbing is never a suggestion target
// ---------------------------------------------------------------------------
test('isReserved: VaultAutopilot is reserved, case-insensitively', () => {
  assert.equal(isReserved('VaultAutopilot'), true);
  assert.equal(isReserved('vaultautopilot'), true);
  assert.equal(isReserved('ai'), false);
  assert.ok(RESERVED_TAGS instanceof Set);
});

// ---------------------------------------------------------------------------
// bodyTags — the survival tokenizer (reps 5 + 6)
// ---------------------------------------------------------------------------
function keys(arr) { return arr.map((t) => t.tag); }

test('bodyTags: plain inline tags after whitespace', () => {
  assert.deepEqual(keys(bodyTags('Working on #ai and #ml today')), ['ai', 'ml']);
});
test('bodyTags: nested tag is one unit', () => {
  assert.deepEqual(keys(bodyTags('see #parent/child here')), ['parent/child']);
});
test('bodyTags SURVIVAL: ATX heading marker is not a tag, real tag in heading text is', () => {
  assert.deepEqual(keys(bodyTags('# Heading line')), []);
  assert.deepEqual(keys(bodyTags('## Sub heading')), []);
  assert.deepEqual(keys(bodyTags('# My #project notes')), ['project']);
});
test('bodyTags SURVIVAL: # inside a URL is not a tag', () => {
  assert.deepEqual(keys(bodyTags('See https://example.com/page#section now')), []);
  assert.deepEqual(keys(bodyTags('visit example.com/#ai please')), []);
});
test('bodyTags SURVIVAL: # inside fenced code is not a tag', () => {
  assert.deepEqual(keys(bodyTags('text\n```\ngrep #foo file\n```\nmore')), []);
});
test('bodyTags SURVIVAL: # inside inline code is not a tag', () => {
  assert.deepEqual(keys(bodyTags('run `grep #foo` here')), []);
});
test('bodyTags SURVIVAL: # inside a wikilink is not a tag', () => {
  assert.deepEqual(keys(bodyTags('[[Note #section]] body')), []);
  assert.deepEqual(keys(bodyTags('[[Project]] then #real')), ['real']);
});
test('bodyTags SURVIVAL: numbers-only # is not a tag', () => {
  assert.deepEqual(keys(bodyTags('item #1984 here')), []);
});

// ---------------------------------------------------------------------------
// splitFrontmatter — BOM/line-ending aware (yaml-edits recipe (a))
// ---------------------------------------------------------------------------
test('splitFrontmatter: detects frontmatter, body, and absence', () => {
  const r = splitFrontmatter('---\ntags:\n  - ai\n---\nbody\n');
  assert.equal(r.hasFrontmatter, true);
  assert.deepEqual(r.frontmatter, ['tags:', '  - ai']);
  assert.equal(r.body.join('\n').includes('body'), true);
  assert.equal(splitFrontmatter('no frontmatter here\n').hasFrontmatter, false);
});

// ---------------------------------------------------------------------------
// frontmatterTags — reps 1-4
// ---------------------------------------------------------------------------
test('frontmatterTags: block list (rep 1)', () => {
  assert.deepEqual(keys(frontmatterTags('---\ntags:\n  - ai\n  - ml\n---\n')), ['ai', 'ml']);
});
test('frontmatterTags: inline array (rep 2)', () => {
  assert.deepEqual(keys(frontmatterTags('---\ntags: [ai, ml]\n---\n')), ['ai', 'ml']);
});
test('frontmatterTags: single scalar (rep 3)', () => {
  assert.deepEqual(keys(frontmatterTags('---\ntags: ai\n---\n')), ['ai']);
});
test('frontmatterTags: legacy singular key (rep 4)', () => {
  assert.deepEqual(keys(frontmatterTags('---\ntag: ai\n---\n')), ['ai']);
});
test('frontmatterTags: tolerates an optional leading # (robustness, never crash)', () => {
  assert.deepEqual(keys(frontmatterTags('---\ntags:\n  - "#ai"\n---\n')), ['ai']);
});

// ---------------------------------------------------------------------------
// noteTags — union across all six representations (audit inventory)
// ---------------------------------------------------------------------------
test('noteTags: combines frontmatter and body logical tags', () => {
  const note = '---\ntags:\n  - ai\n---\nbody with #ml and #ai\n';
  const keysSet = new Set(noteTags(note).map((t) => logicalKey(t.tag)));
  assert.ok(keysSet.has('ai'));
  assert.ok(keysSet.has('ml'));
});

// ---------------------------------------------------------------------------
// applyOps — rename hits EVERY representation consistently (the matrix proof)
// ---------------------------------------------------------------------------
const RENAME = [{ type: 'rename', from: 'ai', to: 'ml' }];

test('applyOps rename: block list (rep 1)', () => {
  assert.equal(applyOps('---\ntags:\n  - ai\n---\nx\n', RENAME).text,
    '---\ntags:\n  - ml\n---\nx\n');
});
test('applyOps rename: inline array (rep 2) preserves formatting', () => {
  assert.equal(applyOps('---\ntags: [ai, css]\n---\nx\n', RENAME).text,
    '---\ntags: [ml, css]\n---\nx\n');
});
test('applyOps rename: single scalar (rep 3)', () => {
  assert.equal(applyOps('---\ntags: ai\n---\nx\n', RENAME).text,
    '---\ntags: ml\n---\nx\n');
});
test('applyOps rename: legacy singular key (rep 4)', () => {
  assert.equal(applyOps('---\ntag: ai\n---\nx\n', RENAME).text,
    '---\ntag: ml\n---\nx\n');
});
test('applyOps rename: body inline (rep 5)', () => {
  assert.equal(applyOps('body with #ai here\n', RENAME).text, 'body with #ml here\n');
});
test('applyOps rename: case-insensitive match (Step 0), target casing preserved exactly', () => {
  const r = applyOps('text #AI and #Ai\n', [{ type: 'rename', from: 'ai', to: 'ML' }]);
  assert.equal(r.text, 'text #ML and #ML\n');
});
test('applyOps rename: frontmatter AND body rewritten in one pass', () => {
  const note = '---\ntags:\n  - ai\n---\nbody #ai end\n';
  assert.equal(applyOps(note, RENAME).text, '---\ntags:\n  - ml\n---\nbody #ml end\n');
});
test('applyOps rename: nested child is NOT cascaded by a parent rename (no cascade)', () => {
  assert.equal(applyOps('#ai/coding stays\n', RENAME).text, '#ai/coding stays\n');
});

// ---------------------------------------------------------------------------
// applyOps: MULTI-KEY frontmatter — keys before AND after the tag block must be
// preserved byte-for-byte (the only path where the slice arithmetic does work).
// ---------------------------------------------------------------------------
test('applyOps: block-list tags between other frontmatter keys — surrounding keys untouched', () => {
  const note = '---\ntitle: Mein Titel\ncreated: 2026-06-20\ntags:\n  - ai\naliases: [foo]\n---\n#ai body\n';
  const out = applyOps(note, RENAME).text;
  assert.equal(out, '---\ntitle: Mein Titel\ncreated: 2026-06-20\ntags:\n  - ml\naliases: [foo]\n---\n#ml body\n');
});
test('applyOps: inline-array tags between other keys — surrounding keys untouched', () => {
  const note = '---\ntitle: X\ntags: [ai, css]\ncreated: 2026-06-20\n---\nx\n';
  const out = applyOps(note, RENAME).text;
  assert.equal(out, '---\ntitle: X\ntags: [ml, css]\ncreated: 2026-06-20\n---\nx\n');
});
test('applyOps: an unrelated op on a multi-key note is a byte-identical no-op', () => {
  const note = '---\ntitle: X\ntags:\n  - keep\nstatus: active\n---\nbody\n';
  const r = applyOps(note, RENAME);
  assert.equal(r.text, note);
  assert.equal(r.changed, false);
});

// ---------------------------------------------------------------------------
// applyOps: CRLF line endings round-trip (repo tests CRLF deliberately elsewhere)
// ---------------------------------------------------------------------------
test('applyOps: CRLF note keeps its CRLF endings and rewrites correctly', () => {
  const note = '---\r\ntags:\r\n  - ai\r\n---\r\nbody #ai end\r\n';
  const out = applyOps(note, RENAME).text;
  assert.equal(out, '---\r\ntags:\r\n  - ml\r\n---\r\nbody #ml end\r\n');
});

// ---------------------------------------------------------------------------
// applyOps SURVIVAL: protected regions are byte-for-byte untouched
// ---------------------------------------------------------------------------
test('applyOps SURVIVAL: a #ai-looking token in code/URL/heading/wikilink survives', () => {
  for (const note of [
    'before\n```\nrun #ai now\n```\nafter\n',
    'visit https://x.com/#ai today\n',
    '# ai is not a tag heading\n',
    '[[Note #ai ref]] body\n',
  ]) {
    assert.equal(applyOps(note, RENAME).text, note, `must not touch: ${JSON.stringify(note)}`);
    assert.equal(applyOps(note, RENAME).changed, false);
  }
});

// ---------------------------------------------------------------------------
// applyOps merge: N->1 with in-note dedup
// ---------------------------------------------------------------------------
test('applyOps merge: distinct spellings collapse to one, deduped within a note', () => {
  const note = '---\ntags:\n  - a-i\n  - AI\n  - css\n---\nx\n';
  const r = applyOps(note, [{ type: 'merge', from: ['a-i', 'AI'], to: 'ai' }]);
  assert.equal(r.text, '---\ntags:\n  - ai\n  - css\n---\nx\n');
});

// ---------------------------------------------------------------------------
// applyOps remove: frontmatter-only; body occurrence is NOT stripped (reported)
// ---------------------------------------------------------------------------
test('applyOps remove: drops the frontmatter tag but leaves the body #tag intact', () => {
  const note = '---\ntags:\n  - old\n  - keep\n---\nbody #old stays\n';
  const r = applyOps(note, [{ type: 'remove', from: 'old' }]);
  assert.equal(r.text, '---\ntags:\n  - keep\n---\nbody #old stays\n');
  assert.equal(r.bodyResidual.includes('old'), true);
});
test('applyOps remove: dropping the last tag removes the empty tags key', () => {
  const r = applyOps('---\ntags:\n  - only\n---\nx\n', [{ type: 'remove', from: 'only' }]);
  assert.equal(r.text, '---\n---\nx\n');
});

// ---------------------------------------------------------------------------
// applyOps: an UNRELATED op must not silently collapse a pre-existing within-note
// case-duplicate (Decision 1: case-normalize is opt-in; do not touch other notes).
// Regression: dedup once collapsed [JavaScript, javascript] on any op.
// ---------------------------------------------------------------------------
test('applyOps: an unrelated op leaves a pre-existing case-duplicate byte-identical', () => {
  const note = '---\ntags: [ai, JavaScript, javascript]\n---\nx\n';
  const r = applyOps(note, [{ type: 'rename', from: 'realtag', to: 'mytag' }]);
  assert.equal(r.text, note);
  assert.equal(r.changed, false);
});
test('applyOps: an explicit case-normalize op DOES collapse the duplicate (opt-in)', () => {
  const note = '---\ntags: [JavaScript, javascript]\n---\nx\n';
  const r = applyOps(note, [{ type: 'rename', from: 'javascript', to: 'JavaScript' }]);
  assert.equal(r.text, '---\ntags: [JavaScript]\n---\nx\n');
});

// ---------------------------------------------------------------------------
// applyOps idempotency: a re-run finds nothing to do (no-op)
// ---------------------------------------------------------------------------
test('applyOps idempotency: re-applying a rename on the cleaned note is a no-op', () => {
  const once = applyOps('---\ntags:\n  - ai\n---\n#ai\n', RENAME).text;
  const twice = applyOps(once, RENAME);
  assert.equal(twice.text, once);
  assert.equal(twice.changed, false);
});

// ---------------------------------------------------------------------------
// applyOps: a rewrite whose target equals the current token is NOT a change.
// Regression (found in UAT): a case-normalize op (AI->ai) over a note that
// already has lowercase #ai flagged `changed` on the no-op body rewrite,
// inflating the idempotency + mass-change counts.
// ---------------------------------------------------------------------------
test('applyOps: a body rewrite to the identical value does not flag changed', () => {
  const r = applyOps('body #ai here\n', [{ type: 'rename', from: 'ai', to: 'ai' }]);
  assert.equal(r.text, 'body #ai here\n');
  assert.equal(r.changed, false);
});
test('applyOps: case-normalize AI->ai is idempotent on a vault that already has #ai', () => {
  const once = applyOps('mix #ai and #AI\n', [{ type: 'rename', from: 'AI', to: 'ai' }]);
  assert.equal(once.text, 'mix #ai and #ai\n');
  const twice = applyOps(once.text, [{ type: 'rename', from: 'AI', to: 'ai' }]);
  assert.equal(twice.changed, false);
  assert.equal(twice.text, once.text);
});

// ---------------------------------------------------------------------------
// assertSurvival: the structural guard throws when a non-tag byte changes
// (anti-vacuous-green — the guard itself must be provably able to fire)
// ---------------------------------------------------------------------------
test('assertSurvival: identical non-tag bytes pass', () => {
  assert.doesNotThrow(() => assertSurvival('a #ai b', 'a #ml b'));
});
test('assertSurvival POSITIVE THROW: a tampered code span trips the guard', () => {
  const before = 'keep this\n```\ncode line\n```\n#ai\n';
  const after = 'keep this\n```\nCODE LINE\n```\n#ml\n'; // code span illegally altered
  assert.throws(() => assertSurvival(before, after), SurvivalError);
});

// ---------------------------------------------------------------------------
// Audit grouping: case (cosmetic) vs separator (functional), '/' excluded
// ---------------------------------------------------------------------------
test('caseVariantGroups: folds case-only variants into one cosmetic group', () => {
  const groups = caseVariantGroups(['AI', 'ai', 'ml']);
  assert.equal(groups.length, 1);
  assert.deepEqual(new Set(groups[0].variants), new Set(['AI', 'ai']));
});
test('separatorVariantGroups: groups - <-> _ but NOT / (nested is distinct)', () => {
  const groups = separatorVariantGroups(['ai-ml', 'ai_ml', 'ai/ml']);
  assert.equal(groups.length, 1);
  assert.deepEqual(new Set(groups[0].variants), new Set(['ai-ml', 'ai_ml']));
});
test('filterReserved: strips VaultAutopilot from an inventory before grouping', () => {
  assert.deepEqual(filterReserved(['ai', 'VaultAutopilot', 'ml']), ['ai', 'ml']);
});
