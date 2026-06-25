'use strict';
// induce.js — Slice 1: deterministic name-based clustering of flat residual tags.
// See docs/superpowers/specs/2026-06-23-tag-organize-design.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const { tokenizeTag, leadingSegment, clusterByName } = require('../scripts/induce.js');

const inv = (key, noteCount = 1, variants = [key]) => ({ key, variants, noteCount, files: [] });

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

test('clusterByName groups flat tags sharing a leading token into a family', () => {
  const inventory = [
    inv('business-strategy', 3, ['Business-Strategy']),
    inv('businessmodel', 2, ['BusinessModel']),
    inv('business-dev', 1, ['business-dev']),
    inv('investing', 5, ['Investing']),       // singleton stem -> no family
    inv('daytrading', 4, ['DayTrading']),      // singleton stem -> no family
  ];
  const clusters = clusterByName(inventory);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].parent, 'Business');  // most frequent leading segment casing
  assert.deepEqual(clusters[0].children.map((c) => c.name), ['business-dev', 'Business-Strategy', 'BusinessModel']); // A->Z case-insensitive
  assert.deepEqual(clusters[0].children.map((c) => c.count), [1, 3, 2]); // noteCount per child, in A->Z child order
  assert.equal(clusters[0].notesTotal, 6); // 1 + 3 + 2
  assert.match(clusters[0].basis, /3 tags share leading token "business"/);
});

test('clusterByName excludes reserved and already-nested tags, honors minMembers', () => {
  const inventory = [
    inv('investing/daytrading', 2, ['Investing/DayTrading']), // already nested
    inv('ai-agents', 2, ['AI-Agents']),
    inv('ai-tools', 1, ['AI-Tools']),
  ];
  const clusters = clusterByName(inventory);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].parent, 'AI');
  assert.deepEqual(clusters[0].children.map((c) => c.name), ['AI-Agents', 'AI-Tools']);
  assert.deepEqual(clusterByName(inventory, { minMembers: 3 }), []); // raise the floor -> nothing
});

test('clusterByName suppresses single-character and purely-numeric stems', () => {
  // A one-letter or all-digit leading token is never a meaningful parent (user rule,
  // 2026-06-24 UAT): B2B* -> stem "b", 2-Fix/2prio -> stem "2" must NOT form a family.
  // A two-letter stem like "ai"/"ki" is a real acronym parent and MUST survive.
  const inventory = [
    inv('b2b', 3, ['B2B']),
    inv('b2bberater', 2, ['B2BBerater']),
    inv('b2bdata', 1, ['B2BData']),     // stem "b" (single char) -> suppressed
    inv('2-fix', 2, ['2-Fix']),
    inv('2prio', 1, ['2prio']),         // stem "2" (numeric) -> suppressed
    inv('ai-agents', 2, ['AI-Agents']),
    inv('ai-tools', 1, ['AI-Tools']),   // stem "ai" (2 chars) -> survives
  ];
  const clusters = clusterByName(inventory);
  assert.deepEqual(clusters.map((c) => c.parent), ['AI']); // only AI; "b" and "2" suppressed
});

test('clusterByName enriches children with note counts and a family total', () => {
  const inventory = [
    inv('phase0', 12, ['Phase0']),
    inv('phase1', 9, ['Phase1']),
    inv('phase2', 4, ['Phase2']),
  ];
  const [family] = clusterByName(inventory);
  assert.equal(family.parent, 'Phase');
  assert.deepEqual(family.children, [
    { name: 'Phase0', count: 12 },
    { name: 'Phase1', count: 9 },
    { name: 'Phase2', count: 4 },
  ]);
  assert.equal(family.notesTotal, 25);
});

// ---- Confidence triage (2026-06-25): scoring helpers ----
const { isEnumerationSuffix, COINCIDENCE_PREFIXES } = require('../scripts/induce.js');

test('isEnumerationSuffix: numeric and version-like suffixes are enumerations', () => {
  assert.equal(isEnumerationSuffix('0'), true);
  assert.equal(isEnumerationSuffix('1'), true);
  assert.equal(isEnumerationSuffix('27001'), true);
  assert.equal(isEnumerationSuffix('v2'), true);
  assert.equal(isEnumerationSuffix('V3'), true);
});

test('isEnumerationSuffix: word suffixes are NOT enumerations', () => {
  assert.equal(isEnumerationSuffix('ai'), false);
  assert.equal(isEnumerationSuffix('source'), false);
  assert.equal(isEnumerationSuffix('hosting'), false);
  assert.equal(isEnumerationSuffix(''), false);
});

test('COINCIDENCE_PREFIXES contains the curated stoplist and is frozen', () => {
  assert.equal(COINCIDENCE_PREFIXES.has('open'), true);
  assert.equal(COINCIDENCE_PREFIXES.has('self'), true);
  assert.equal(COINCIDENCE_PREFIXES.has('work'), true);
  assert.equal(COINCIDENCE_PREFIXES.has('business'), false); // a real parent, not a coincidence prefix
  assert.equal(COINCIDENCE_PREFIXES.size, 25);
  assert.equal(Object.isFrozen(COINCIDENCE_PREFIXES), true); // frozen (intent: do not mutate)
});
