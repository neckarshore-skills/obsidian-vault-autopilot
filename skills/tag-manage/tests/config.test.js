const { extractJsonFence, mergeOverrides, loadConfig } = require('../scripts/config.js');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('extractJsonFence reads the first json code block', () => {
  const md = '# Config\n\n```json\n{"brands":{"busitec":"Busitec"}}\n```\n';
  assert.deepEqual(extractJsonFence(md), { brands: { busitec: 'Busitec' } });
});
test('extractJsonFence returns null when absent', () => assert.equal(extractJsonFence('# nothing'), null));
test('mergeOverrides: local wins on collision', () => {
  const m = mergeOverrides({ brands: { ai: 'AI' } }, { brands: { ai: 'Ai-Override' }, reportDir: 'X' });
  assert.equal(m.brands.get('ai'), 'Ai-Override');
  assert.equal(m.reportDir, 'X');
});
test('loadConfig with no vault config falls back to defaults only', () => {
  const m = loadConfig({ defaultsPath: path.join(__dirname, '..', 'references', 'tag-overrides.default.json'), configText: null });
  assert.equal(m.brands.get('github'), 'GitHub');
  assert.equal(m.reportDir, null);
});
