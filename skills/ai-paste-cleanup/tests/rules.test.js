'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyAll, RULES, checkRule, FingerprintError, MassDeletionError } = require('../scripts/rules.js');

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
  assert.equal(only('nbsp-to-space', 'Executive Box:\u00A0250 kW'), 'Executive Box: 250 kW');
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

test('fingerprint guard: a rule deleting out-of-allowlist chars throws (incident replay)', () => {
  // Simulate the broken \x{} zero-width rule, which deleted x,B,C,D,E,F,0,2.
  const brokenRule = { name: 'zero-width-broken', allowedRemovals: new Set(['\u200B','\u200C','\u200D','\uFEFF']) };
  const before = 'Executive Box: 250 kW';
  const after  = 'ecutive o: 5 kW'; // E,x,B,2,0 deleted -- out of allowlist
  assert.throws(() => checkRule(brokenRule, before, after), FingerprintError);
});

test('fingerprint guard: an in-allowlist deletion does not throw', () => {
  const rule = { name: 'nbsp', allowedRemovals: new Set([' ']) };
  assert.doesNotThrow(() => checkRule(rule, 'a b', 'a b'));
});

test('idempotency: applyAll twice equals applyAll once', () => {
  const input = '## **Title**\n\n\n\nbody text   \n\n\n';
  const once = applyAll(input).text;
  const twice = applyAll(once);
  assert.equal(twice.text, once);
  assert.equal(twice.changed, false);
  for (const v of Object.values(twice.perRule)) assert.equal(v, 0);
});

test('applyAll reports per-rule hit counts', () => {
  const out = applyAll('## **A**\n## *B*\nplain prose line here\nx\u200By\u00A0z   ');
  assert.equal(out.perRule['unbold-headings'], 1);
  assert.equal(out.perRule['italic-headings-asterisk'], 1);
  assert.equal(out.perRule['zero-width-strip'], 1);
  assert.equal(out.perRule['nbsp-to-space'], 1);
  assert.equal(out.perRule['strip-trailing-whitespace'], 1);
});

test('citation-markers: removes the [cite:...] marker (positive)', () => {
  assert.equal(only('citation-markers', 'The team signed off [cite:smith2020].'), 'The team signed off.');
  assert.equal(only('citation-markers', 'Per the spec[cite:doc-12] this holds.'), 'Per the spec this holds.');
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

test('citation-markers: a non-cite bracket span is left untouched', () => {
  // A long [..] span that is NOT a [cite:...] marker must not be removed.
  const note = '[' + 'x'.repeat(500) + ']';
  assert.doesNotThrow(() => applyAll(note));
  assert.equal(applyAll(note).text, note);
});

test('mass-deletion guard: a note that is mostly [cite:...] markers aborts (positive throw)', () => {
  // With the span-based citation rule, genuine over-deletion is now possible.
  // This drives applyAll past the 25% non-whitespace-drop backstop.
  const note = 'hi ' + '[cite:x] '.repeat(30);
  assert.throws(() => applyAll(note), MassDeletionError);
});
