'use strict';
// hierarchy.js — Phase 1 deterministic NEST mechanics (declared parent -> children).
// See docs/superpowers/specs/2026-06-22-tag-manage-hierarchy-design.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHierarchy, buildNestRecommendations } = require('../scripts/hierarchy.js');
const { buildInventory, applyOps } = require('../scripts/tags.js');

const hier = (obj) => parseHierarchy(obj).map;

// --- parseHierarchy: derive + validate the declared taxonomy -----------------

test('parseHierarchy derives childKey -> {parent, child, path}, lowercased key, declared casing in path', () => {
  const { map, errors } = parseHierarchy({ Investing: ['DayTrading', 'SwingTrading'] });
  assert.deepEqual(errors, []);
  assert.deepEqual(map.get('daytrading'), { parent: 'Investing', child: 'DayTrading', path: 'Investing/DayTrading' });
  assert.deepEqual(map.get('swingtrading'), { parent: 'Investing', child: 'SwingTrading', path: 'Investing/SwingTrading' });
});

test('parseHierarchy: empty / missing hierarchy -> empty map, no errors', () => {
  assert.equal(parseHierarchy({}).map.size, 0);
  assert.equal(parseHierarchy(undefined).map.size, 0);
  assert.deepEqual(parseHierarchy(undefined).errors, []);
});

test('parseHierarchy: a child with a space is an invalid tag -> reported, excluded, never applied', () => {
  const { map, errors } = parseHierarchy({ Investing: ['Day Trading'] });
  assert.equal(map.size, 0, 'the invalid child must not enter the map');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Day Trading/);
});

test('parseHierarchy: an invalid parent (space) is reported and its children excluded', () => {
  const { map, errors } = parseHierarchy({ 'Inv esting': ['DayTrading'] });
  assert.equal(map.size, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Inv esting/);
});

test('parseHierarchy: one parent per child — a child under two parents keeps the first, reports the second', () => {
  const { map, errors } = parseHierarchy({ Investing: ['Trading'], Finance: ['Trading'] });
  assert.equal(map.get('trading').parent, 'Investing', 'first declaration wins');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /trading/i);
});

test('parseHierarchy: a cycle (A under B, B under A) is reported and the closing edge dropped', () => {
  const { map, errors } = parseHierarchy({ A: ['B'], B: ['A'] });
  // first edge survives (b -> A/B); the edge that would close the loop is dropped
  assert.equal(map.get('b').path, 'A/B');
  assert.equal(map.has('a'), false, 'the cycle-closing edge must be dropped');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /cycle/i);
});

test('parseHierarchy: a self-cycle (A under A) is reported and dropped', () => {
  const { map, errors } = parseHierarchy({ A: ['A'] });
  assert.equal(map.size, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /cycle/i);
});

// --- buildNestRecommendations: flat declared child -> nest op ----------------

test('buildNestRecommendations: a flat declared child becomes a nest rec promoting it to Parent/Child', () => {
  const notes = [{ path: 'a.md', text: '---\ntags:\n  - DayTrading\n---\n' }];
  const recs = buildNestRecommendations(buildInventory(notes), hier({ Investing: ['DayTrading'] }), notes);
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.kind, 'nest');
  assert.equal(r.to, 'Investing/DayTrading');
  assert.equal(r.source, 'hierarchy');
  assert.deepEqual(r.ops, [{ type: 'rename', from: 'daytrading', to: 'Investing/DayTrading' }]);
});

test('buildNestRecommendations: casing composes — a lowercase flat tag nests to the declared canonical path in one op', () => {
  const notes = [{ path: 'a.md', text: '---\ntags:\n  - daytrading\n---\n' }];
  const recs = buildNestRecommendations(buildInventory(notes), hier({ Investing: ['DayTrading'] }), notes);
  assert.equal(recs[0].to, 'Investing/DayTrading');
  assert.deepEqual(recs[0].ops, [{ type: 'rename', from: 'daytrading', to: 'Investing/DayTrading' }]);
});

test('buildNestRecommendations: notesAffected counts notes that actually change, via the real engine', () => {
  const notes = [
    { path: 'a.md', text: '---\ntags:\n  - daytrading\n---\n' },
    { path: 'b.md', text: 'body #daytrading here\n' },
    { path: 'c.md', text: '---\ntags:\n  - unrelated\n---\n' },
  ];
  const recs = buildNestRecommendations(buildInventory(notes), hier({ Investing: ['DayTrading'] }), notes);
  assert.equal(recs[0].notesAffected, 2, 'a.md + b.md change; c.md does not');
});

test('buildNestRecommendations: convergence — an already-nested tag produces NO new nest rec', () => {
  const notes = [{ path: 'a.md', text: 'already #Investing/DayTrading nested\n' }];
  const recs = buildNestRecommendations(buildInventory(notes), hier({ Investing: ['DayTrading'] }), notes);
  assert.equal(recs.length, 0);
});

test('buildNestRecommendations: a declared child not present flat in the vault produces NO rec', () => {
  const notes = [{ path: 'a.md', text: '---\ntags:\n  - somethingelse\n---\n' }];
  const recs = buildNestRecommendations(buildInventory(notes), hier({ Investing: ['DayTrading'] }), notes);
  assert.equal(recs.length, 0);
});

test('buildNestRecommendations: the nest op applied rewrites both frontmatter and body and survives the guard', () => {
  const note = '---\ntags:\n  - daytrading\n---\nSee also #daytrading in the body.\n';
  const recs = buildNestRecommendations(buildInventory([{ path: 'a.md', text: note }]), hier({ Investing: ['DayTrading'] }), [{ path: 'a.md', text: note }]);
  const res = applyOps(note, recs[0].ops);
  assert.equal(res.changed, true);
  assert.match(res.text, /- Investing\/DayTrading/, 'frontmatter rewritten');
  assert.match(res.text, /#Investing\/DayTrading in the body/, 'body rewritten');
  assert.doesNotMatch(res.text, /#daytrading\b/, 'no flat occurrence left');
});

// --- upsertHierarchyCluster: validated merge of one cluster into a config obj -

const { upsertHierarchyCluster } = require('../scripts/hierarchy.js');

test('upsertHierarchyCluster: adds a new cluster to an empty config', () => {
  const out = upsertHierarchyCluster({}, 'Investing', ['DayTrading', 'SwingTrading']);
  assert.deepEqual(out.hierarchy, { Investing: ['DayTrading', 'SwingTrading'] });
});

test('upsertHierarchyCluster: preserves existing config keys (reportDir, brands)', () => {
  const out = upsertHierarchyCluster({ reportDir: 'Meta/TM', brands: { mcp: 'MCP' } }, 'Investing', ['DayTrading']);
  assert.equal(out.reportDir, 'Meta/TM');
  assert.deepEqual(out.brands, { mcp: 'MCP' });
  assert.deepEqual(out.hierarchy, { Investing: ['DayTrading'] });
});

test('upsertHierarchyCluster: merges into an existing parent, dedups children by logical key', () => {
  const out = upsertHierarchyCluster({ hierarchy: { Investing: ['DayTrading'] } }, 'Investing', ['SwingTrading', 'daytrading']);
  assert.deepEqual(out.hierarchy.Investing, ['DayTrading', 'SwingTrading'], 'union, order preserved, case-dup folded');
});

test('upsertHierarchyCluster: a case-variant parent merges into the existing parent key (no split)', () => {
  const out = upsertHierarchyCluster({ hierarchy: { Investing: ['DayTrading'] } }, 'investing', ['SwingTrading']);
  assert.deepEqual(Object.keys(out.hierarchy), ['Investing'], 'must not create a second case-variant parent');
  assert.deepEqual(out.hierarchy.Investing, ['DayTrading', 'SwingTrading']);
});

test('upsertHierarchyCluster: REFUSES (throws) an invalid child — a write never persists a bad taxonomy', () => {
  assert.throws(() => upsertHierarchyCluster({}, 'Investing', ['Day Trading']), /invalid|Day Trading/i);
});

test('upsertHierarchyCluster: REFUSES (throws) a child already declared under a different parent', () => {
  assert.throws(() => upsertHierarchyCluster({ hierarchy: { Finance: ['Trading'] } }, 'Investing', ['Trading']), /more than one parent|invalid/i);
});
