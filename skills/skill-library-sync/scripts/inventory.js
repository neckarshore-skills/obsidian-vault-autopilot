'use strict';
// inventory.js — read the real skill inventory from NAMED sources only.
//
// This is the first OVA skill that reads outside the vault, so the fence is
// explicit: every path here comes from the caller's config or from
// installed_plugins.json. There is no search, no glob over a projects folder,
// no auto-detection. readdir reaches exactly one level into a skills/ directory
// and stops. Outside the vault this module is read-only, always.

const fs = require('node:fs');
const path = require('node:path');

function readSkillDescription(skillDir) {
  try {
    const text = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) return '';
    const m = fm[1].match(/^description: *(.*)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
}

// One level of readdir, never a recursive walk.
function skillsIn(skillsDir) {
  let entries = [];
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw new Error(`skills directory is not readable at ${skillsDir}: ${err.message}`);
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(skillsDir, e.name))
    .filter((d) => fs.existsSync(path.join(d, 'SKILL.md')));
}

function buildInventory({ ownSkillsDir, installedPluginsPath, sourceRoots }) {
  const out = [];

  for (const dir of skillsIn(ownSkillsDir)) {
    out.push({
      name: path.basename(dir), herkunft: 'eigen', ort: dir,
      plugin: '', description: readSkillDescription(dir),
    });
  }

  let installed = { plugins: {} };
  try {
    installed = JSON.parse(fs.readFileSync(installedPluginsPath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      /* no plugins installed is a valid state */
    } else {
      throw new Error(`installed plugins manifest is unreadable at ${installedPluginsPath}: ${err.message}`);
    }
  }
  for (const [key, value] of Object.entries(installed.plugins || {})) {
    const [pluginName, marketplace = ''] = key.split('@');
    const herkunft = /neckarshore/i.test(key) ? 'org-plugin' : 'extern';
    for (const entry of Array.isArray(value) ? value : [value]) {
      const hint = `${marketplace}/${pluginName}@${entry.version}`;
      for (const dir of skillsIn(path.join(entry.installPath, 'skills'))) {
        out.push({
          name: path.basename(dir), herkunft, ort: dir,
          plugin: hint, description: readSkillDescription(dir),
        });
      }
    }
  }

  for (const root of sourceRoots || []) {
    const label = path.basename(path.dirname(root)) + '/' + path.basename(root);
    for (const dir of skillsIn(path.join(root, 'skills'))) {
      out.push({
        name: path.basename(dir), herkunft: 'org-plugin', ort: dir,
        plugin: label, description: readSkillDescription(dir),
      });
    }
  }

  return out.sort((a, b) =>
    a.name.localeCompare(b.name) || a.herkunft.localeCompare(b.herkunft));
}

module.exports = { buildInventory, readSkillDescription, skillsIn };
