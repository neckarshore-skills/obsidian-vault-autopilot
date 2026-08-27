'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildInventory } = require('../scripts/inventory.js');

function skill(dir, name, description) {
  const d = path.join(dir, name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
  return d;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-'));
  const own = path.join(root, 'skills');
  skill(own, 'note-rename', 'renames notes');
  const plugin = path.join(root, 'cache', 'vendor', 'thing', '1.0.0');
  skill(path.join(plugin, 'skills'), 'thing-do', 'does a thing');
  const repo = path.join(root, 'repo');
  skill(path.join(repo, 'skills'), 'photo-dedup', 'finds duplicate photos');
  const installed = path.join(root, 'installed_plugins.json');
  fs.writeFileSync(installed, JSON.stringify({
    plugins: { 'thing@vendor': [{ installPath: plugin, version: '1.0.0' }] },
  }));
  return { root, own, installed, repo };
}

test('own skills, installed plugins and source roots are all found', () => {
  const f = fixture();
  const inv = buildInventory({
    ownSkillsDir: f.own,
    installedPluginsPath: f.installed,
    sourceRoots: [f.repo],
  });
  const byName = Object.fromEntries(inv.map((e) => [e.name, e]));
  assert.strictEqual(byName['note-rename'].herkunft, 'eigen');
  assert.strictEqual(byName['thing-do'].herkunft, 'extern');
  assert.strictEqual(byName['thing-do'].plugin, 'vendor/thing@1.0.0');
  assert.strictEqual(byName['photo-dedup'].herkunft, 'org-plugin');
});

test('a neckarshore plugin counts as org-plugin, not extern', () => {
  const f = fixture();
  fs.writeFileSync(f.installed, JSON.stringify({
    plugins: { 'ova@neckarshore-ai': [{ installPath: path.dirname(path.dirname(f.own)), version: '0.4.0' }] },
  }));
  const inv = buildInventory({ ownSkillsDir: f.own, installedPluginsPath: f.installed, sourceRoots: [] });
  assert.ok(inv.every((e) => e.herkunft !== 'extern'));
});

test('the description is read from SKILL.md', () => {
  const f = fixture();
  const inv = buildInventory({ ownSkillsDir: f.own, installedPluginsPath: f.installed, sourceRoots: [] });
  assert.strictEqual(inv.find((e) => e.name === 'note-rename').description, 'renames notes');
});

test('a source root that does not exist is skipped, not fatal', () => {
  const f = fixture();
  const inv = buildInventory({
    ownSkillsDir: f.own,
    installedPluginsPath: f.installed,
    sourceRoots: [path.join(f.root, 'nope')],
  });
  assert.ok(inv.length >= 1);
});

test('a directory without SKILL.md is not a skill', () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.own, '_social_common'), { recursive: true });
  const inv = buildInventory({ ownSkillsDir: f.own, installedPluginsPath: f.installed, sourceRoots: [] });
  assert.ok(!inv.some((e) => e.name === '_social_common'));
});

test('the inventory reaches exactly one level deep and never walks the tree', () => {
  const f = fixture();
  skill(path.join(f.repo, 'skills', 'photo-dedup', 'nested'), 'not-a-skill', 'buried');
  const inv = buildInventory({ ownSkillsDir: f.own, installedPluginsPath: f.installed, sourceRoots: [f.repo] });
  assert.ok(!inv.some((e) => e.name === 'not-a-skill'));
});

test('a corrupt manifest (invalid JSON) throws with the file path in the message', () => {
  const f = fixture();
  fs.writeFileSync(f.installed, 'not valid json {{{');
  assert.throws(
    () => buildInventory({ ownSkillsDir: f.own, installedPluginsPath: f.installed, sourceRoots: [] }),
    (err) => err.message.includes(f.installed) && err.message.includes('unreadable'),
  );
});

test('a missing manifest does not throw; own skills are still found', () => {
  const f = fixture();
  fs.unlinkSync(f.installed);
  const inv = buildInventory({ ownSkillsDir: f.own, installedPluginsPath: f.installed, sourceRoots: [] });
  assert.ok(inv.some((e) => e.name === 'note-rename'));
  assert.strictEqual(inv.filter((e) => e.herkunft === 'eigen').length, 1);
});

test('readSkillDescription throws when SKILL.md is not readable (e.g., is a directory)', () => {
  const f = fixture();
  const skillDir = path.join(f.own, 'bad-skill');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'SKILL.md'), { recursive: true });
  const { readSkillDescription } = require('../scripts/inventory.js');
  assert.throws(
    () => readSkillDescription(skillDir),
    (err) => err.code !== 'ENOENT',
  );
});

test('readSkillDescription returns empty string for missing SKILL.md', () => {
  const f = fixture();
  const skillDir = path.join(f.own, 'no-skill-md');
  fs.mkdirSync(skillDir, { recursive: true });
  const { readSkillDescription } = require('../scripts/inventory.js');
  assert.strictEqual(readSkillDescription(skillDir), '');
});

test('a skills directory that is not readable (e.g., is a file) throws with the directory path', () => {
  const f = fixture();
  const unreadableSkillsPath = path.join(f.root, 'bad-plugin', 'skills');
  fs.mkdirSync(path.dirname(unreadableSkillsPath), { recursive: true });
  fs.writeFileSync(unreadableSkillsPath, 'this is a file, not a directory');
  fs.writeFileSync(f.installed, JSON.stringify({
    plugins: { 'bad@plugin': [{ installPath: path.dirname(unreadableSkillsPath), version: '1.0.0' }] },
  }));
  assert.throws(
    () => buildInventory({ ownSkillsDir: f.own, installedPluginsPath: f.installed, sourceRoots: [] }),
    (err) => err.message.includes(unreadableSkillsPath),
  );
});

// A hand-edited or half-written installed_plugins.json is not a theoretical
// shape: the file lives in the user's ~/.claude and no schema guards it. An
// entry that is a bare string, or an object with no installPath, reached
// path.join() unchecked and killed the run with a TypeError -- a crash where
// the honest answer is "this entry is unusable, here are the rest".
test('a malformed manifest entry is skipped, not crashed on', () => {
  const f = fixture();
  const broken = path.join(f.root, 'broken_plugins.json');
  fs.writeFileSync(broken, JSON.stringify({
    plugins: {
      'bare-string@vendor': ['just-a-string'],
      'no-path@vendor': [{ version: '2.0.0' }],
      'null-entry@vendor': [null],
    },
  }));
  const inv = buildInventory({ ownSkillsDir: f.own, installedPluginsPath: broken, sourceRoots: [] });
  assert.deepStrictEqual(inv.map((e) => e.name), ['note-rename']);
});

// The good half of the same manifest must still be read: skipping the broken
// entry is only correct if it does not take its neighbours with it.
test('a malformed entry does not suppress the well-formed entries beside it', () => {
  const f = fixture();
  const mixed = path.join(f.root, 'mixed_plugins.json');
  const good = JSON.parse(fs.readFileSync(f.installed, 'utf8')).plugins['thing@vendor'];
  fs.writeFileSync(mixed, JSON.stringify({
    plugins: { 'broken@vendor': [{ version: '1.0.0' }], 'thing@vendor': good },
  }));
  const inv = buildInventory({ ownSkillsDir: f.own, installedPluginsPath: mixed, sourceRoots: [] });
  assert.ok(inv.some((e) => e.name === 'thing-do'), 'the well-formed entry was lost with the broken one');
});
