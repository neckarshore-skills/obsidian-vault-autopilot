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

// ---- Confidence triage (2026-06-25): scoreCluster ----
const { scoreCluster } = require('../scripts/induce.js');

// scored-cluster factory. Single-token child names (Alpha/Beta/...) carry NO enumeration
// suffix, so size/frequency tests are not perturbed by the +15 enum bonus.
const fam = (parent, childNames, notesTotal = 0) => ({
  parent,
  children: childNames.map((name) => ({ name, count: 0 })),
  notesTotal,
});

test('scoreCluster: base score for a plain 2-child family with no signals', () => {
  const r = scoreCluster(fam('Customer', ['Alpha', 'Beta'], 0));
  assert.equal(r.score, 40);     // base only
  assert.equal(r.category, 'decide');
  assert.equal(r.basis, 'base');
});

test('scoreCluster: size bonus is +10 per child over 2, capped at +30', () => {
  assert.equal(scoreCluster(fam('A', ['Alpha', 'Beta', 'Gamma'], 0)).score, 50);                       // +10
  assert.equal(scoreCluster(fam('A', ['Alpha', 'Beta', 'Gamma', 'Delta'], 0)).score, 60);              // +20
  assert.equal(scoreCluster(fam('A', ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'], 0)).score, 70); // cap +30
});

test('scoreCluster: frequency tiers add 0 / 10 / 20', () => {
  assert.equal(scoreCluster(fam('A', ['Alpha', 'Beta'], 4)).score, 40);   // <5 -> +0
  assert.equal(scoreCluster(fam('A', ['Alpha', 'Beta'], 5)).score, 50);   // 5..60 -> +10
  assert.equal(scoreCluster(fam('A', ['Alpha', 'Beta'], 60)).score, 50);  // boundary -> +10
  assert.equal(scoreCluster(fam('A', ['Alpha', 'Beta'], 61)).score, 60);  // >60 -> +20
});

test('scoreCluster: enumeration-suffix majority adds +15', () => {
  const r = scoreCluster(fam('Phase', ['Phase0', 'Phase1', 'Phase2'], 0));
  assert.equal(r.score, 65);  // base 40 + size 10 (3 children) + enum 15
  assert.match(r.basis, /enum/);
});

test('scoreCluster: declared-parent match adds +25 (case-insensitive)', () => {
  const r = scoreCluster(fam('Business', ['Alpha', 'Beta'], 0), { declaredParents: ['business', 'AI'] });
  assert.equal(r.score, 65);  // base 40 + declared 25
  assert.match(r.basis, /declared/);
});

test('scoreCluster: coincidence-prefix subtracts 35', () => {
  const r = scoreCluster(fam('Open', ['OpenAI', 'OpenSource'], 0));
  assert.equal(r.score, 5);   // base 40 - 35
  assert.equal(r.category, 'ignore');
  assert.match(r.basis, /coincidence-prefix/);
});

test('scoreCluster: thresholds — implement >= 70, decide 40..69, ignore < 40', () => {
  assert.equal(scoreCluster(fam('A', ['Alpha', 'Beta'], 0)).category, 'decide');             // 40
  assert.equal(scoreCluster(fam('A', ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'], 61)).category, 'implement'); // 40+30+20=90
  assert.equal(scoreCluster(fam('Open', ['OpenAI', 'OpenSource'], 0)).category, 'ignore'); // 5
});

test('scoreCluster: score clamps to 0..100', () => {
  // max-stacked: declared + size cap + freq + enum = 40+25+30+20+15 = 130 -> 100
  const hi = scoreCluster(
    fam('Phase', ['Phase0', 'Phase1', 'Phase2', 'Phase3', 'Phase4', 'Phase5'], 61),
    { declaredParents: ['Phase'] },
  );
  assert.equal(hi.score, 100);
  assert.equal(scoreCluster(fam('Open', ['OpenAI', 'OpenSource'], 0)).score >= 0, true);
});
