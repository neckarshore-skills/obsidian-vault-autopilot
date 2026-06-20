const { classifyTag } = require('../scripts/convention.js');
const test = require('node:test');
const assert = require('node:assert/strict');

const ctx = { brandSet: new Set(['n8n', 'github']), brandHyphenSet: new Set(['mercedes-benz']), hierarchicalLeaves: new Set(['devtools']) };

test('hashtag-prefix is HIGH', () => assert.deepEqual(classifyTag('#research', ctx), { violation: 'hashtag-prefix', severity: 'HIGH' }));
test('numeric-artifact is HIGH', () => assert.deepEqual(classifyTag('2026', ctx), { violation: 'numeric-artifact', severity: 'HIGH' }));
test('snake_case is MEDIUM', () => assert.deepEqual(classifyTag('ai_agents', ctx), { violation: 'snake_case', severity: 'MEDIUM' }));
test('lowercase-concept is MEDIUM', () => assert.deepEqual(classifyTag('research', ctx), { violation: 'lowercase-concept', severity: 'MEDIUM' }));
test('camelCase is MEDIUM', () => assert.deepEqual(classifyTag('fastAPI', ctx), { violation: 'camelCase', severity: 'MEDIUM' }));
test('upper-kebab is MEDIUM', () => assert.deepEqual(classifyTag('App-Development', ctx), { violation: 'upper-kebab', severity: 'MEDIUM' }));
test('flat-where-hierarchical is LOW', () => assert.deepEqual(classifyTag('DevTools', ctx), { violation: 'flat-where-hierarchical', severity: 'LOW' }));
test('AI-prefixed hyphen is allowed', () => assert.deepEqual(classifyTag('AI-ML', ctx), { violation: null, severity: null }));
test('brand stays compliant lowercase', () => assert.deepEqual(classifyTag('n8n', ctx), { violation: null, severity: null }));
test('brand-hyphen is allowed', () => assert.deepEqual(classifyTag('Mercedes-Benz', ctx), { violation: null, severity: null }));
test('compliant PascalCase passes', () => assert.deepEqual(classifyTag('OpenSource', ctx), { violation: null, severity: null }));

// canonicalForm tests (Task 3)
const { canonicalForm } = require('../scripts/convention.js');
const dict = { brands: new Map([['github', 'GitHub']]), compounds: new Map([['lowcode', 'LowCode'], ['low-code', 'LowCode']]) };

test('brand hit uses official casing', () => assert.deepEqual(canonicalForm('github', dict), { canonical: 'GitHub', source: 'brand' }));
test('compound hit uses merged form', () => assert.deepEqual(canonicalForm('low-code', dict), { canonical: 'LowCode', source: 'compound' }));
test('AI-prefix keeps hyphen (heuristic best-effort; ML-casing is a dictionary job)', () => assert.deepEqual(canonicalForm('ai-foo', dict), { canonical: 'AI-Foo', source: 'heuristic' }));
test('AI-ML resolves via dictionary, not heuristic', () => assert.deepEqual(canonicalForm('ai-ml', { brands: new Map(), compounds: new Map([['ai-ml', 'AI-ML']]) }), { canonical: 'AI-ML', source: 'compound' }));
test('hierarchical PascalCases each segment', () => assert.deepEqual(canonicalForm('software/devtools', dict), { canonical: 'Software/Devtools', source: 'heuristic' }));
test('single lowercase word capitalizes', () => assert.deepEqual(canonicalForm('research', dict), { canonical: 'Research', source: 'heuristic' }));
test('snake_case joins as hyphen-free PascalCase unless AI', () => assert.deepEqual(canonicalForm('ai_agents', dict), { canonical: 'AI-Agents', source: 'heuristic' }));
