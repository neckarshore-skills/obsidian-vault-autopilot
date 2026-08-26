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
