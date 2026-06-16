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
