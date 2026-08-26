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
const { parseNote, isReplaceableZone, NOTES_HEADING } = require('./library.js');
const { noteTitle, renderNote, renderIndex } = require('./render.js');
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

// CRITICAL 1 (fix 1 of 2): a tombstone is not a library note. Without this
// exclusion, readLibrary re-reads every note already retired into
// `retiredSubfolder`, which is still absent from the inventory, so the next
// run classifies it `retired` again -- with a move target identical to its
// source -- and the move loop's unconditional `fs.rmSync(m.from)` deletes it.
// Measured against a real vault: a note retired on run 1 no longer existed
// after run 2. Excluding the subfolder here is the real fix (a returning
// skill must not be matched against, and rewritten inside, its own
// tombstone; Task 8's index must not list a retired note as live either).
// The move loop below carries the belt-and-braces guard for the same
// failure -- see CRITICAL 1 (fix 2 of 2).
function readLibrary(libraryDir, options = {}) {
  const retiredDir = options.retiredSubfolder
    ? path.resolve(path.join(libraryDir, options.retiredSubfolder))
    : null;
  const notes = [];
  const walk = (dir) => {
    if (retiredDir && path.resolve(dir) === retiredDir) return;
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
  return {
    config, inventory, libraryDir,
    notes: readLibrary(libraryDir, { retiredSubfolder: config.retiredSubfolder }),
  };
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

// CRITICAL 3: an unconfigured library_path defaults to '', and
// path.join(vault, '') is the vault root -- harmless while every command was
// read-only, not harmless once apply writes. Two distinct causes, two
// distinct messages, so a reader knows which one to fix.
class LibraryPathNotConfiguredError extends Error {
  constructor() {
    super('Refusing to write: no library_path is configured '
      + '(skill_library.library_path in _vault-autopilot-config.md is empty '
      + 'or missing). Without it the scan target defaults to the vault root. '
      + 'Configure library_path before running apply --write.');
    this.name = 'LibraryPathNotConfiguredError';
  }
}

class LibraryDirectoryMissingError extends Error {
  constructor(libraryDir) {
    super(`Refusing to write: the configured library directory does not exist `
      + `at ${libraryDir}. Create it (or fix library_path) before running `
      + 'apply --write.');
    this.name = 'LibraryDirectoryMissingError';
  }
}

// IMPORTANT 1: the shared mass-change ceiling (200) sits above the entire
// real library (161 notes), so a plan that retires all of them sails
// through it -- and EmptyInventoryError only covers one of the causes that
// can produce a mass retirement (zero inventory rows), not the others (a
// changed library_path, a vanished source root, a manifest that parses to a
// subset). `retired` is the one bucket that both moves AND rewrites a file,
// so it gets its own library-relative cap: refuse above 25% of the notes
// read, with a floor so a tiny library is not blocked by rounding. A real
// run against the user's 161-note library retires 29 (18%) and must pass.
class RetireCapError extends Error {
  constructor(count, cap, totalNotes) {
    super(`Retire guard: this plan would retire ${count} of ${totalNotes} notes `
      + `read (> cap ${cap}). Aborting; nothing written. Override with a `
      + 'higher --retire-max if this is genuinely intentional.');
    this.name = 'RetireCapError';
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

// CRITICAL 2, belt-and-braces half: every title already named by a
// duplicate-note-title conflict is untouchable on the write side, not just
// excluded from diffLibrary's buckets.
//
// N2 fix: a duplicate-inventory-entry conflict must NOT contribute a title
// here. splitInventoryConflicts already removes the ambiguous rows before
// multiOriginNames runs, so a surviving valid row for that same name can
// legitimately render to the bare title (e.g. inventory
// [(dup,eigen,/a), (dup,eigen,/b), (dup,extern,/plugin)]: the two eigen rows
// conflict and are removed, leaving (dup,extern) as the ONLY row for that
// name -- single-origin, so it gets suffix '' and title "Skill – dup").
// Blocking that title as "conflicted" dropped a legitimate create on every
// run, and the reported target-occupied conflict named a path that does not
// exist -- a wrong reason is worse than no report. duplicate-inventory-entry
// conflicts are already fully handled at the classifier level; no write-side
// block is needed or wanted for them.
function conflictedTitleSet(conflicts) {
  const titles = new Set();
  for (const c of conflicts) {
    if (c.kind === 'duplicate-note-title') titles.add(c.detail.title);
  }
  return titles;
}

// CRITICAL 2, primary half: a `created` entry's target is computed from
// folder + title with no existence check, so it can silently land on a file
// that already sits there for an unrelated reason (here: one half of a
// duplicate-note-title pair, holding the user's own prose). `allowedFrom`
// lets a rename target its own current path without tripping this (a no-op
// move), which is not the collision this guards against.
function targetOccupied(target, allowedFrom) {
  if (!fs.existsSync(target)) return false;
  if (allowedFrom && path.resolve(target) === path.resolve(allowedFrom)) return false;
  return true;
}

// M1 + M2: the retire path used to regex-edit the WHOLE raw file, which is
// the one code path that did not respect the body boundary library.js
// exists to enforce -- a user whose own prose happened to contain a line
// starting with "status: " or "last_modified: " would have that line
// silently mangled too. Fixed by using parseNote to find exactly where the
// frontmatter block ends (everything from there on -- machineBody, the
// Notizen heading, and notesZone -- is carried through completely
// untouched) and editing only the frontmatter text before that point. M2:
// the inserted entfallen_am line now matches the file's OWN line ending
// instead of always inserting a bare "\n".
//
// N3: readLibrary only requires the FILENAME to match -- a note with no
// frontmatter block at all, or one missing `last_modified:`, is still
// readable. Silently moving such a note produced no `status: entfallen` (or
// no `entfallen_am`) and nothing reported it -- a half-labelled tombstone
// with no trace of why. Returns `{ ok: false, missing }` instead of a body
// when the note cannot be correctly stamped, so the caller can refuse to
// move it and report exactly which field was missing.
function retireBody(raw, now) {
  const parsed = parseNote(raw);
  const restLength = parsed.machineBody.length
    + (parsed.hasNotesHeading ? NOTES_HEADING.length + parsed.notesZone.length : 0);
  const frontmatterText = raw.slice(0, raw.length - restLength);
  const rest = raw.slice(raw.length - restLength);
  if (!/^status: .*$/m.test(frontmatterText)) return { ok: false, missing: 'status' };
  if (!/^last_modified: .*$/m.test(frontmatterText)) return { ok: false, missing: 'last_modified' };
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const newFrontmatter = frontmatterText
    .replace(/^status: .*$/m, 'status: entfallen')
    .replace(/^(last_modified: .*)$/m, `$1${eol}entfallen_am: ${stamp(now)}`);
  return { ok: true, body: newFrontmatter + rest };
}

const INDEX_FILE_NAME = '_Skill Library.md';
const INDEX_HEADING = '# Skill Library';
const DEFAULT_INDEX_HEADER = [
  '---',
  'title: "Skill Library — Index"',
  'type: index',
  '---',
  '',
  INDEX_HEADING,
].join('\n');

// Everything above (and including) `# Skill Library` is machine-preserved
// verbatim -- frontmatter and the heading itself. Everything below it is
// regenerated on every rebuild; a hand-written paragraph there (like the
// "Bestandsaufnahme (2026-07-05)" block this replaces) would otherwise go
// stale the moment the sync runs again.
function readIndexHeader(indexPath) {
  let text;
  try {
    text = fs.readFileSync(indexPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return DEFAULT_INDEX_HEADER;
    throw err;
  }
  const idx = text.indexOf(INDEX_HEADING);
  return idx === -1 ? DEFAULT_INDEX_HEADER : text.slice(0, idx + INDEX_HEADING.length);
}

// Regenerates the index note: reads the live notes (tombstones excluded, same
// as readLibrary elsewhere), groups them via renderIndex, and replaces
// everything below the `# Skill Library` heading. Honours { write: false } by
// returning the computed markdown without touching disk, exactly like the
// rest of this module's plan-then-write shape.
function rebuildIndex(libraryDir, options = {}) {
  const notes = readLibrary(libraryDir, { retiredSubfolder: options.retiredSubfolder });
  const rows = notes.map((n) => {
    const plugin = (n.frontmatter.plugin || '').trim();
    return {
      title: n.title,
      herkunft: n.frontmatter.herkunft || '',
      status: n.frontmatter.status || '',
      hint: plugin || n.frontmatter.ort || '',
    };
  });
  const body = renderIndex(rows);
  const indexPath = path.join(libraryDir, INDEX_FILE_NAME);
  const header = readIndexHeader(indexPath);
  const full = `${header}\n\n${body}\n`;
  if (options.write) fs.writeFileSync(indexPath, full);
  return full;
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

  // CRITICAL 3: a missing/empty library_path degrades harmlessly for
  // read-only scan/diff (path.join(vault, '') is just the vault root, and
  // nothing is written), but it is not harmless here. Write mode refuses
  // outright, naming which of the two causes applies. Preview mode still
  // runs -- diff/scan already behaved this way -- but says so plainly via
  // `libraryPathWarning` rather than silently scanning the vault root.
  let libraryPathWarning = null;
  if (!config.libraryPath) {
    libraryPathWarning = 'no library_path is configured -- the scan target defaults to the vault root.';
  } else {
    let isDir = false;
    try { isDir = fs.statSync(libraryDir).isDirectory(); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    if (!isDir) libraryPathWarning = `the configured library directory does not exist at ${libraryDir}.`;
  }
  if (write && libraryPathWarning) {
    throw config.libraryPath
      ? new LibraryDirectoryMissingError(libraryDir)
      : new LibraryPathNotConfiguredError();
  }

  if (inventory.length === 0) throw new EmptyInventoryError();

  const plan = diffLibrary(inventory, notes);

  const touched = plan.created.length + plan.relocated.length
    + plan.retired.length + plan.renamed.length;
  if (touched > max) throw new MassChangeError(touched, max);

  // IMPORTANT 1: retired is the one bucket that both moves AND rewrites a
  // file, and the shared ceiling above does not catch "retire nearly
  // everything" against a library under 200 notes. Both caps are kept --
  // they catch different shapes -- and both are overridable. Floored: the
  // 25%-of-notes-read formula can land on a fraction (e.g. 40.25 for a
  // 161-note library), and the number a user reads in the refusal message
  // must be the number that was actually applied as the comparison.
  const retireCap = Math.floor(options.retireMax != null ? options.retireMax
    : Math.max(10, notes.length * 0.25));
  if (plan.retired.length > retireCap) throw new RetireCapError(plan.retired.length, retireCap, notes.length);

  // CRITICAL 2, belt: any title already named by diffLibrary's own conflict
  // channel is untouchable here too, not just excluded from the buckets.
  const conflictedTitles = conflictedTitleSet(plan.conflicts);
  const conflicts = [...plan.conflicts];

  // Plan-then-write: render everything first, so a throw above leaves the
  // library exactly as it was.
  const writes = [];
  for (const entry of plan.created) {
    const folder = folderFor(entry.herkunft);
    const title = noteTitle(entry);
    const file = path.join(libraryDir, folder, `${title}.md`);
    // CRITICAL 2, primary: a create target is a NEW path by construction --
    // if something already sits there (a stray file, or one half of a
    // duplicate-note-title pair that diffLibrary excluded from `notes` but
    // whose file is still on disk), it must never be silently overwritten.
    // Skip this one create, name it as a conflict, and keep going with
    // everything else -- a single occupied path must not block the run.
    if (conflictedTitles.has(title) || targetOccupied(file)) {
      conflicts.push({ kind: 'target-occupied', detail: { title, path: file } });
      continue;
    }
    writes.push({
      kind: 'create',
      file,
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
  const renames = [];
  for (const r of plan.renamed) {
    // M3: the note object rides on the plan entry already -- no need to
    // re-find it by title string in `notes` (that string-keyed-lookup
    // pattern is exactly what produced a Critical earlier in this plan).
    const note = r.note;
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
    const to = path.join(libraryDir, folder, `${r.to}.md`);
    // CRITICAL 2, belt (rename side): a rename target is also a path this
    // note does not currently occupy, so the same occupied-target check
    // applies -- `allowedFrom` only lets it target ITS OWN current path
    // (a no-op), never a different note's file.
    if (conflictedTitles.has(r.to) || targetOccupied(to, note.file)) {
      conflicts.push({ kind: 'target-occupied', detail: { title: r.to, path: to } });
      continue;
    }
    renames.push({
      from: note.file,
      to,
      body: entry ? renderNote({
        ...entry, status: note.frontmatter.status || 'aktiv',
        created: note.frontmatter.created, lastModified: nowStamp(now),
      }, note.replaceable ? '' : note.notesZone)
        : fs.readFileSync(note.file, 'utf8'),
    });
  }

  // N1: this is the one loop that both WRITES and DELETES, and round 1 gave
  // occupancy checks to create and rename but not here. Two ways this
  // collides in practice: (a) a stale tombstone already sits at the target
  // -- the exact scenario a note that leaves, returns, and leaves again
  // produces (run 1 retires it; run 2 the skill returns and a fresh stub is
  // created back in the live folder; run 3 it retires again, landing on the
  // SAME basename in the retired folder); (b) two notes with the same
  // basename in different live subfolders are retired in the same run, so
  // they target the identical tombstone path. Either way: refuse that one
  // move, report it, and do not touch either file -- inventing a
  // disambiguated filename would just be a second thing to discover later.
  const claimedMoveTargets = new Map(); // resolved target path -> source path, this run only
  const moves = [];
  for (const note of plan.retired) {
    const raw = fs.readFileSync(note.file, 'utf8');
    // N3: a note readable by filename alone can still lack the frontmatter
    // fields the tombstone stamp needs. Moving it anyway would produce a
    // half-labelled file with nothing reporting why -- refuse the move and
    // name exactly which field was missing instead.
    const stamped = retireBody(raw, now);
    if (!stamped.ok) {
      conflicts.push({ kind: 'unstampable-note', detail: { path: note.file, missing: stamped.missing } });
      continue;
    }
    const to = path.join(libraryDir, config.retiredSubfolder, path.basename(note.file));
    const resolvedTo = path.resolve(to);
    if (targetOccupied(to, note.file) || claimedMoveTargets.has(resolvedTo)) {
      conflicts.push({ kind: 'target-occupied', detail: { title: note.title, path: to, from: note.file } });
      continue;
    }
    claimedMoveTargets.set(resolvedTo, note.file);
    moves.push({ from: note.file, to, body: stamped.body });
  }

  if (!write) {
    return {
      written: [], moved: [], renamed: [],
      unchanged: plan.unchanged.length,
      planned: writes.length + moves.length + renames.length,
      // CARRIED RULING 2: conflicts ride along even in preview, so a report
      // (or a human reading the preview) can name every note that was left
      // untouched on purpose, not just the ones that were acted on.
      conflicts,
      libraryPathWarning,
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
    // CRITICAL 1 (fix 2 of 2, belt): if source and target ever coincide --
    // e.g. a retired note somehow re-read as a live one, the failure
    // readLibrary's retiredSubfolder exclusion (fix 1 of 2) already
    // prevents -- never remove the file out from under its own rewrite.
    if (path.resolve(m.from) !== path.resolve(m.to)) fs.rmSync(m.from);
  }
  // An index regenerated only when somebody calls the function by hand is the
  // drift this skill exists to end. Wired here; the findings ledger below it.
  rebuildIndex(libraryDir, { write: true, retiredSubfolder: config.retiredSubfolder });

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
    conflicts,
  };
  writeFindings(vault, result, { now });
  return result;
}

module.exports = {
  readLibrary, renderPreview, collect, main,
  applyPlan, MassChangeError, EmptyInventoryError,
  LibraryPathNotConfiguredError, LibraryDirectoryMissingError, RetireCapError,
  rebuildIndex, writeFindings,
};

if (require.main === module) process.exit(main(process.argv.slice(2)));
