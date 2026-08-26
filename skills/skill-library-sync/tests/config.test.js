'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig, DEFAULTS } = require('../scripts/config.js');

function vaultWith(body) {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-cfg-'));
  if (body !== null) fs.writeFileSync(path.join(v, '_vault-autopilot-config.md'), body);
  return v;
}

test('a vault with no config file gets the defaults', () => {
  const cfg = loadConfig(vaultWith(null));
  assert.strictEqual(cfg.retiredSubfolder, DEFAULTS.retiredSubfolder);
  assert.deepStrictEqual(cfg.sourceRoots, []);
});

test('the skill_library section is read from a yaml fence', () => {
  const v = vaultWith([
    '# Config', '', '```yaml', 'skill_library:',
    '  library_path: "020_Processes/Library Meta/Skill Library"',
    '  retired_subfolder: "Entfallen"',
    '  source_roots_extend:',
    '    - "~/Developer/projects/x"',
    '```', ''].join('\n'));
  const cfg = loadConfig(v);
  assert.strictEqual(cfg.libraryPath, '020_Processes/Library Meta/Skill Library');
  assert.strictEqual(cfg.retiredSubfolder, 'Entfallen');
  assert.strictEqual(cfg.sourceRoots.length, 1);
  assert.ok(cfg.sourceRoots[0].startsWith(os.homedir()));
  assert.ok(!cfg.sourceRoots[0].includes('~'));
});

test('a malformed fence falls back to defaults rather than throwing', () => {
  const cfg = loadConfig(vaultWith('```yaml\nskill_library: [unclosed\n```'));
  assert.strictEqual(cfg.retiredSubfolder, DEFAULTS.retiredSubfolder);
});
