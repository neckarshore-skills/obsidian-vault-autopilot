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
const { noteTitle, renderNote } = require('./render.js');
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

const DEFAULT_MAX = 200;

class MassChangeError extends Error {
  constructor(count, threshold) {
    super(`Mass-change guard: this plan would touch ${count} notes (> threshold ${threshold}). Aborting; nothing written. Re-run with a higher --max or narrow the scope.`);
    this.name = 'MassChangeError';
  }
}

// CARRIED RULING 1: an empty inventory is never trustworthy enough to act
// on. diffLibrary has no way to distinguish "the vault genuinely has zero
// skills" from "a corrupt manifest or misconfigured source root yielded
// nothing" -- and if it is the latter, every existing note gets classified
// `retired`, which the mass-change ceiling does NOT catch (161 real notes
// sits comfortably under 200). So this refuses on its own, before anything
// is classified or rendered, whatever the reason the inventory came back
// empty -- in both preview and write mode, because a preview that quietly
// reports "161 retired" is exactly as misleading as writing it.
class EmptyInventoryError extends Error {
  constructor() {
    super('Refusing to run: the inventory is empty. An empty inventory would '
      + 'make every existing note look retired and move the whole library. '
      + 'Aborting; nothing written. Check the source roots and the installed '
      + 'plugins manifest before re-running.');
    this.name = 'EmptyInventoryError';
  }
}

function stamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function nowStamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${stamp(date)} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

// The one place a herkunft maps to its library subfolder -- used for both
// newly created notes and notes moved by a rename, so the two paths can
// never disagree about where a given herkunft lives.
function folderFor(herkunft) {
  return herkunft === 'eigen' ? 'Eigene Skills'
    : herkunft === 'org-plugin' ? 'Org-Plugins' : 'Externe Plugins';
}

// Forward reference to Task 8 (index regeneration). Task 8 has not landed
// yet in this checkout, but Task 7's write path is specified to call it
// after every write so the index is never left to drift out of a manual
// step. This stub keeps that call from throwing; Task 8 replaces the body
// (and may replace this whole function) without touching the call site.
function rebuildIndex(libraryDir, options = {}) {
  return '';
}

// Forward reference to Task 9 (the findings ledger). Same situation as
// rebuildIndex above: the call is specified here, Task 9 supplies the real
// behaviour. This stub is a deliberate no-op, not a silent drop of the call.
function writeFindings(vault, result, options = {}) {
  return null;
}

function applyPlan(vault, options = {}) {
  const write = Boolean(options.write);
  const now = options.now || new Date();
  const max = options.max || DEFAULT_MAX;
  // ONE collect call. Two would re-scan every plugin directory on disk for a
  // single value, and on a live-edited vault the second call's notes could differ
  // from the first -- an inconsistency, not merely waste.
  const collected = collect(vault);
  const { config, libraryDir, notes } = collected;
  const inventory = options.inventory || collected.inventory;

  if (inventory.length === 0) throw new EmptyInventoryError();

  const plan = diffLibrary(inventory, notes);

  const touched = plan.created.length + plan.relocated.length
    + plan.retired.length + plan.renamed.length;
  if (touched > max) throw new MassChangeError(touched, max);

  // Plan-then-write: render everything first, so a throw above leaves the
  // library exactly as it was.
  const writes = [];
  for (const entry of plan.created) {
    const folder = folderFor(entry.herkunft);
    writes.push({
      kind: 'create',
      file: path.join(libraryDir, folder, `${noteTitle(entry)}.md`),
      body: renderNote({ ...entry, status: entry.herkunft === 'extern' ? 'referenz' : 'aktiv',
        created: nowStamp(now), lastModified: nowStamp(now) }, ''),
    });
  }
  const renamedFrom = new Set(plan.renamed.map((r) => r.from));
  for (const entry of plan.relocated) {
    const note = entry.note;
    // A note that is ALSO being renamed is written by the rename branch alone.
    // Writing it here too would recreate the old path after the rename moved it,
    // leaving two notes for one skill -- and the stale one holds the user's prose.
    if (renamedFrom.has(note.title)) continue;
    writes.push({
      kind: 'relocate',
      file: note.file,
      body: renderNote({
        ...entry,
        status: note.frontmatter.status || 'aktiv',
        created: note.frontmatter.created,
        lastModified: nowStamp(now),
      }, note.replaceable ? '' : note.notesZone),
    });
  }
  // A rename carries the note's file to its new title. The relocate branch above
  // has already rendered the new body against the OLD path, so the rename moves
  // that same content -- the user's prose and the creation date travel with it.
  // Recreating instead of renaming is the failure this exists to prevent.
  const renames = plan.renamed.map((r) => {
    const note = notes.find((n) => n.title === r.from);
    const entry = plan.relocated.concat(plan.unchanged).find((e) => noteTitle(e) === r.to);
    // A rename is driven by the entry acquiring a suffix (a name gaining a
    // second origin), so its destination folder is the entry's OWN herkunft
    // folder -- the same mapping `created` uses -- not wherever the bare
    // note happened to sit before. Only when no entry can be matched (should
    // not happen given diffLibrary's invariants, but cheap to guard) does
    // this fall back to the note's current folder rather than guessing.
    const folder = entry ? folderFor(entry.herkunft)
      : (path.basename(path.dirname(note.file)) === path.basename(libraryDir)
        ? '' : path.basename(path.dirname(note.file)));
    return {
      from: note.file,
      to: path.join(libraryDir, folder, `${r.to}.md`),
      body: entry ? renderNote({
        ...entry, status: note.frontmatter.status || 'aktiv',
        created: note.frontmatter.created, lastModified: nowStamp(now),
      }, note.replaceable ? '' : note.notesZone)
        : fs.readFileSync(note.file, 'utf8'),
    };
  });

  const moves = plan.retired.map((note) => ({
    from: note.file,
    to: path.join(libraryDir, config.retiredSubfolder, path.basename(note.file)),
    body: fs.readFileSync(note.file, 'utf8')
      .replace(/^status: .*$/m, 'status: entfallen')
      .replace(/^(last_modified: .*)$/m, `$1\nentfallen_am: ${stamp(now)}`),
  }));

  if (!write) {
    return {
      written: [], moved: [], renamed: [],
      unchanged: plan.unchanged.length,
      planned: writes.length + moves.length + renames.length,
      // CARRIED RULING 2: conflicts ride along even in preview, so a report
      // (or a human reading the preview) can name every note that was left
      // untouched on purpose, not just the ones that were acted on.
      conflicts: plan.conflicts,
    };
  }

  for (const r of renames) {
    fs.mkdirSync(path.dirname(r.to), { recursive: true });
    fs.writeFileSync(r.to, r.body);
    if (path.resolve(r.from) !== path.resolve(r.to)) fs.rmSync(r.from);
  }
  for (const w of writes) {
    fs.mkdirSync(path.dirname(w.file), { recursive: true });
    // In-place write on an existing path: no new inode, so APFS birthtime is
    // preserved. Never write-to-temp-then-rename here.
    fs.writeFileSync(w.file, w.body);
  }
  for (const m of moves) {
    fs.mkdirSync(path.dirname(m.to), { recursive: true });
    fs.writeFileSync(m.to, m.body);
    fs.rmSync(m.from);
  }
  // An index regenerated only when somebody calls the function by hand is the
  // drift this skill exists to end. Wired here; the findings ledger below it.
  rebuildIndex(libraryDir, { write: true });

  const result = {
    written: writes.map((w) => w.file),
    moved: moves.map((m) => m.to),
    renamed: renames.map((r) => r.to),
    // writeFindings (Task 9) reads this as a number. Returning the bucket itself
    // here would put a shape mismatch one task downstream of where it was made.
    unchanged: plan.unchanged.length,
    // CARRIED RULING 2: conflicts are excluded from every action bucket above
    // (diffLibrary never puts a conflicted note/entry into created,
    // relocated, retired, renamed, or unchanged), but they still need to be
    // NAMED on the result so a report can say what was left alone and why.
    conflicts: plan.conflicts,
  };
  writeFindings(vault, result, { now });
  return result;
}

module.exports = {
  readLibrary, renderPreview, collect, main,
  applyPlan, MassChangeError, EmptyInventoryError, rebuildIndex, writeFindings,
};

if (require.main === module) process.exit(main(process.argv.slice(2)));
