'use strict';
// cli.js — fs + CLI shell over the pure engine.
//
//   scan  <vault>            print the inventory, write nothing
//   diff  <vault>            print the four buckets plus conflicts, write nothing
//   apply <vault> --write    execute behind the confirm gate (later task)
//
// Plan-then-write: every note is rendered in memory and every guard throws
// BEFORE the first write, so a refusal leaves the library untouched.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseNote, isReplaceableZone } = require('./library.js');
const { noteTitle } = require('./render.js');
const { buildInventory } = require('./inventory.js');
const { diffLibrary } = require('./diff.js');
const { loadConfig } = require('./config.js');

const TITLE_RE = /^Skill – (.+?)(?: \((eigen|extern|org-plugin|projekt-lokal)\))?$/;

// A missing library directory is a legitimate state -- the config may point
// at a folder that does not exist yet -- so it degrades to no entries,
// exactly like inventory.js's skillsIn() and config.js's loadConfig(). Any
// OTHER error (permissions, not-a-directory, ...) throws, naming the
// directory, rather than surfacing a bare ENOENT-shaped stack trace from a
// read-only inspection command.
function readdirSafe(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw new Error(`library directory is not readable at ${dir}: ${err.message}`);
  }
}

function readLibrary(libraryDir) {
  const notes = [];
  const walk = (dir) => {
    for (const e of readdirSafe(dir)) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.md') || e.name.startsWith('_')) continue;
      const title = e.name.slice(0, -3);
      const m = title.match(TITLE_RE);
      if (!m) continue;
      const parsed = parseNote(fs.readFileSync(p, 'utf8'));
      notes.push({
        title, name: m[1], suffix: m[2] || '', file: p,
        frontmatter: parsed.frontmatter, notesZone: parsed.notesZone,
        replaceable: isReplaceableZone(parsed.notesZone),
      });
    }
  };
  walk(libraryDir);
  return notes.sort((a, b) => a.title.localeCompare(b.title));
}

// Describes one conflict on a single line, for the preview -- this is the
// one channel built to surface ambiguous data, so a preview that hides it
// would be invisible at the exact moment a human decides whether to write.
function describeConflict(c) {
  if (c.kind === 'duplicate-note-title') {
    return `duplicate-note-title: ${c.detail.title} (${c.detail.notes.length} notes)`;
  }
  if (c.kind === 'duplicate-inventory-entry') {
    const orts = c.detail.entries.map((e) => e.ort).join(', ');
    return `duplicate-inventory-entry: ${c.detail.name} (${c.detail.herkunft}) at ${orts}`;
  }
  return `${c.kind}: ${JSON.stringify(c.detail)}`;
}

function renderPreview(result) {
  const lines = [
    `created:   ${result.created.length}`,
    `relocated: ${result.relocated.length}`,
    `retired:   ${result.retired.length}`,
    `renamed:   ${result.renamed.length}`,
    `unchanged: ${result.unchanged.length}`,
    `conflicts: ${result.conflicts.length}`,
  ];
  for (const r of result.renamed) lines.push(`  rename: ${r.from} -> ${r.to}`);
  for (const c of result.created) lines.push(`  create: ${noteTitle(c)}`);
  for (const r of result.retired) lines.push(`  retire: ${r.title}`);
  for (const c of result.conflicts) lines.push(`  conflict: ${describeConflict(c)}`);
  return lines.join('\n');
}

function collect(vault) {
  const config = loadConfig(vault);
  const inventory = buildInventory({
    ownSkillsDir: path.join(os.homedir(), '.claude', 'skills'),
    installedPluginsPath: path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json'),
    sourceRoots: config.sourceRoots,
  });
  const libraryDir = path.join(vault, config.libraryPath);
  return { config, inventory, libraryDir, notes: readLibrary(libraryDir) };
}

function main(argv) {
  const [command, vault] = argv;
  if (!command || !vault) {
    process.stderr.write('usage: cli.js <scan|diff|apply> <vault> [--write]\n');
    return 2;
  }
  const { inventory, notes } = collect(vault);
  if (command === 'scan') {
    process.stdout.write(`${inventory.length} skills, ${notes.length} notes\n`);
    return 0;
  }
  if (command === 'diff') {
    process.stdout.write(`${renderPreview(diffLibrary(inventory, notes))}\n`);
    return 0;
  }
  process.stderr.write(`unknown command: ${command}\n`);
  return 2;
}

module.exports = { readLibrary, renderPreview, collect, main };

if (require.main === module) process.exit(main(process.argv.slice(2)));
