const { classifyTag, canonicalForm } = require('../scripts/convention.js');
const { mergeOverrides } = require('../scripts/config.js');
const test = require('node:test');
const assert = require('node:assert/strict');

const ctx = { brandSet: new Set(['n8n', 'github']), brandHyphenSet: new Set(['mercedes-benz']), hierarchicalLeaves: new Set(['devtools']) };

// Finding C: separator-insensitive brand/compound resolution.
test('canonicalForm: no-separator + underscore variants resolve to the hyphenated brand canonical', () => {
  const d = mergeOverrides({ brands: { 'mercedes-benz': 'Mercedes-Benz' } }, {});
  assert.deepEqual(canonicalForm('Mercedes-Benz', d), { canonical: 'Mercedes-Benz', source: 'brand' });
  assert.deepEqual(canonicalForm('MercedesBenz', d), { canonical: 'Mercedes-Benz', source: 'brand' });
  assert.deepEqual(canonicalForm('mercedes_benz', d), { canonical: 'Mercedes-Benz', source: 'brand' });
});
test('canonicalForm: separator-insensitive also applies to hyphenated compounds', () => {
  const d = mergeOverrides({ compounds: { 'ai-ml': 'AI-ML' } }, {});
  assert.deepEqual(canonicalForm('AIML', d), { canonical: 'AI-ML', source: 'compound' });
});
test('canonicalForm: an unknown tag still falls through to the heuristic', () => {
  const d = mergeOverrides({ brands: { 'mercedes-benz': 'Mercedes-Benz' } }, {});
  assert.equal(canonicalForm('SomethingElse', d).source, 'heuristic');
});

test('hashtag-prefix is HIGH', () => assert.deepEqual(classifyTag('#research', ctx), { violation: 'hashtag-prefix', severity: 'HIGH' }));
test('numeric-artifact is HIGH', () => assert.deepEqual(classifyTag('2026', ctx), { violation: 'numeric-artifact', severity: 'HIGH' }));
test('snake_case is MEDIUM', () => assert.deepEqual(classifyTag('ai_agents', ctx), { violation: 'snake_case', severity: 'MEDIUM' }));
test('lowercase-concept is MEDIUM', () => assert.deepEqual(classifyTag('research', ctx), { violation: 'lowercase-concept', severity: 'MEDIUM' }));
// Blind-spot fix (2026-06-24 UAT): a lowercase tag WITH a hyphen ('personal-brand',
// 'digital-garden') was NOT flagged before — only single-word lowercase was. Both violate
// the Title-case-segment convention; canonicalForm already resolves them (-> PersonalBrand).
test('lowercase-kebab is a lowercase-concept violation', () => assert.deepEqual(classifyTag('personal-brand', ctx), { violation: 'lowercase-concept', severity: 'MEDIUM' }));
test('lowercase-kebab multi-segment is flagged', () => assert.deepEqual(classifyTag('ai-assisted-development', ctx), { violation: 'lowercase-concept', severity: 'MEDIUM' }));
test('PascalCase-with-hyphen (AI-Coding) stays compliant', () => assert.deepEqual(classifyTag('AI-Coding', ctx), { violation: null, severity: null }));
test('camelCase is MEDIUM', () => assert.deepEqual(classifyTag('fastAPI', ctx), { violation: 'camelCase', severity: 'MEDIUM' }));
test('upper-kebab is MEDIUM', () => assert.deepEqual(classifyTag('App-Development', ctx), { violation: 'upper-kebab', severity: 'MEDIUM' }));
test('flat-where-hierarchical is LOW', () => assert.deepEqual(classifyTag('DevTools', ctx), { violation: 'flat-where-hierarchical', severity: 'LOW' }));
test('AI-prefixed hyphen is allowed', () => assert.deepEqual(classifyTag('AI-ML', ctx), { violation: null, severity: null }));
test('brand stays compliant lowercase', () => assert.deepEqual(classifyTag('n8n', ctx), { violation: null, severity: null }));
test('brand-hyphen is allowed', () => assert.deepEqual(classifyTag('Mercedes-Benz', ctx), { violation: null, severity: null }));
test('compliant PascalCase passes', () => assert.deepEqual(classifyTag('OpenSource', ctx), { violation: null, severity: null }));

// canonicalForm tests (Task 3) — canonicalForm imported at top
const dict = { brands: new Map([['github', 'GitHub']]), compounds: new Map([['lowcode', 'LowCode'], ['low-code', 'LowCode']]) };

test('brand hit uses official casing', () => assert.deepEqual(canonicalForm('github', dict), { canonical: 'GitHub', source: 'brand' }));
test('compound hit uses merged form', () => assert.deepEqual(canonicalForm('low-code', dict), { canonical: 'LowCode', source: 'compound' }));
test('AI-prefix keeps hyphen (heuristic best-effort; ML-casing is a dictionary job)', () => assert.deepEqual(canonicalForm('ai-foo', dict), { canonical: 'AI-Foo', source: 'heuristic' }));
test('AI-ML resolves via dictionary, not heuristic', () => assert.deepEqual(canonicalForm('ai-ml', { brands: new Map(), compounds: new Map([['ai-ml', 'AI-ML']]) }), { canonical: 'AI-ML', source: 'compound' }));
test('hierarchical PascalCases each segment', () => assert.deepEqual(canonicalForm('software/devtools', dict), { canonical: 'Software/Devtools', source: 'heuristic' }));
test('single lowercase word capitalizes', () => assert.deepEqual(canonicalForm('research', dict), { canonical: 'Research', source: 'heuristic' }));
test('snake_case joins as hyphen-free PascalCase unless AI', () => assert.deepEqual(canonicalForm('ai_agents', dict), { canonical: 'AI-Agents', source: 'heuristic' }));
