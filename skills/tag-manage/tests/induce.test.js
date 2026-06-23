'use strict';
// induce.js — Slice 1: deterministic name-based clustering of flat residual tags.
// See docs/superpowers/specs/2026-06-23-tag-organize-design.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const { tokenizeTag, leadingSegment } = require('../scripts/induce.js');

test('tokenizeTag splits camelCase, separators, and letter->digit', () => {
  assert.deepEqual(tokenizeTag('BusinessModel'), ['business', 'model']);
  assert.deepEqual(tokenizeTag('day-trading'), ['day', 'trading']);
  assert.deepEqual(tokenizeTag('AI_Agents'), ['ai', 'agents']);
  assert.deepEqual(tokenizeTag('GPT4'), ['gpt', '4']);
  assert.deepEqual(tokenizeTag('investing'), ['investing']);
});

test('leadingSegment returns the first token in its original display casing', () => {
  assert.equal(leadingSegment('BusinessModel'), 'Business');
  assert.equal(leadingSegment('AI-Agents'), 'AI');
  assert.equal(leadingSegment('business-dev'), 'business');
  assert.equal(leadingSegment('investing'), 'investing');
});
