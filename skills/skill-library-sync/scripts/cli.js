'use strict';
// cli.js — fs + CLI shell over the pure engine.
//
//   scan  <vault>                                print the inventory, write nothing
//   diff  <vault>                                print the four buckets plus conflicts, write nothing
//   apply <vault>                                preview what apply --write would do; write nothing
//   apply <vault> --write [--max n] [--retire-max n]   apply behind the two caps
//
// Plan-then-write: every note is rendered in memory and every guard throws
// BEFORE the first write, so a refusal leaves the library untouched. The one
// check that cannot run before the writes is the index rebuild's zero-row
// refusal -- it compares the rebuilt row count against the file, and the
// rebuilt count is a fact about the library AFTER the writes. It is typed and
// mapped like the other guards; see rebuildIndex.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseNote, isReplaceableZone, NOTES_HEADING } = require('./library.js');
const { noteTitle, renderNote, renderIndex, carryFrontmatter } = require('./render.js');
const { buildInventory } = require('./inventory.js');
const { diffLibrary } = require('./diff.js');
const { loadConfig, expandHome } = require('./config.js');

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
        machineBody: parsed.machineBody, frontmatterRaw: parsed.frontmatterRaw,
        hasFrontmatter: parsed.hasFrontmatter, hasNotesHeading: parsed.hasNotesHeading,
        replaceable: isReplaceableZone(parsed.notesZone),
      });
    }
  };
  walk(libraryDir);
  return notes.sort((a, b) => a.title.localeCompare(b.title));
}

// Describes one conflict on a single line, for the preview and for the
// findings ledger -- this is the one channel built to surface ambiguous
// data, so hiding it in either place would be invisible at the exact
// moment a human decides whether to write, or reads what already ran.
//
// The `detail` shape VARIES between conflict kinds -- one producer's
// `detail.from` is another's `detail.path`, some carry a diagnostic field
// no locator chain would surface (`unstampable-note`'s `missing`), and a
// kind not written yet (this function's own fallback branch) has no known
// shape at all. Two different fixes for two different failure modes:
// a kind with an unrecognized shape still needs SOME rendering of its
// detail (JSON.stringify, guarded so a missing/empty detail never prints
// the literal string "undefined"), while a kind whose diagnostic field is
// the whole point (unstampable-note's `missing`) gets its own branch so
// that field is never silently dropped by a locator match on `path` alone.
function describeConflict(c) {
  if (c.kind === 'duplicate-note-title') {
    return `duplicate-note-title: ${c.detail.title} (${c.detail.notes.length} notes)`;
  }
  if (c.kind === 'duplicate-inventory-entry') {
    const orts = c.detail.entries.map((e) => e.ort).join(', ');
    return `duplicate-inventory-entry: ${c.detail.name} (${c.detail.herkunft}) at ${orts}`;
  }
  if (c.kind === 'unstampable-note') {
    return `unstampable-note: ${c.detail.path} (missing: ${c.detail.missing})`;
  }
  const detail = c.detail || {};
  const locator = detail.path || detail.from || detail.to || detail.title || null;
  if (locator) return `${c.kind}: ${locator}`;
  return `${c.kind}: ${JSON.stringify(detail)}`;
}

function renderPreview(result) {
  // A note claimed by a rename is reported ONCE, as a rename -- it used to be
  // announced as `renamed: 1` and `unchanged: 1` (or `relocated: 1`) for the
  // same file, which `apply --write` then contradicted by reporting it only
  // once. The rename is the truthful label: that branch does the move and the
  // full rewrite.
  const relocated = unclaimedByRename(result.relocated, result.renamed);
  const unchanged = unclaimedByRename(result.unchanged, result.renamed);
  const lines = [
    `created:   ${result.created.length}`,
    `relocated: ${relocated.length}`,
    `retired:   ${result.retired.length}`,
    `unverified: ${(result.unverified || []).length}`,
    `renamed:   ${result.renamed.length}`,
    `unchanged: ${unchanged.length}`,
    `conflicts: ${result.conflicts.length}`,
  ];
  for (const r of result.renamed) lines.push(`  rename: ${r.from} -> ${r.to}`);
  for (const c of result.created) lines.push(`  create: ${noteTitle(c)}`);
  // FIX (round 1, Finding 3): SKILL.md's diff step promises to name "every
  // note that would change" -- relocated was counted but never named, so a
  // confirm gate covering ~40 unnamed relocations at real scale was strictly
  // less informative than the other four buckets it sits beside.
  for (const r of relocated) lines.push(`  relocate: ${r.note.title} -> ${r.ort}`);
  for (const r of result.retired) lines.push(`  retire: ${r.title}`);
  // Named, never merely counted: a note the run declined to retire is exactly
  // the note the user has to decide about, and the reason tells him which fix
  // applies -- configure a source root, or repair the note's `ort`.
  for (const u of result.unverified || []) lines.push(`  unverified: ${u.title} (${u.reason})`);
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

// A usage error (missing command/vault, an unknown flag, a non-numeric or
// missing value for --max/--retire-max) is exit 2 -- the same code a missing
// command already used. It is distinct from the guard errors below, which are
// also exit 2 for a different reason: a usage error means the invocation
// itself was malformed, a guard error means the invocation was well-formed but
// the vault/config was not ready for a write.
class UsageError extends Error {}

// Parses everything after `apply <vault>`. Kept separate from main() so the
// flag grammar -- and its failure modes -- has one place to read.
function parseApplyFlags(rest) {
  const opts = { write: false };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--write') { opts.write = true; continue; }
    if (arg === '--max' || arg === '--retire-max') {
      const value = rest[i + 1];
      if (value === undefined || !/^\d+$/.test(value)) {
        throw new UsageError(`${arg} requires a numeric value, got: ${value === undefined ? '(none)' : value}`);
      }
      i += 1;
      if (arg === '--max') opts.max = Number(value);
      else opts.retireMax = Number(value);
      continue;
    }
    throw new UsageError(`unknown flag: ${arg}`);
  }
  return opts;
}

// applyPlan's write:true result names every action (created/relocated/moved/
// renamed are file-path arrays), so this mirrors renderPreview's shape.
//
// FIX (round 1, Finding 2): applyPlan used to return a single `written`
// array that merged create-kind AND relocate-kind writes, so this function
// labelled the sum `created:` and printed a `create:` line for every
// relocated file too -- a relocation is not a creation, and the SKILL.md
// Report template promises both counts separately. applyPlan's result now
// carries `created` and `relocated` as distinct arrays; render them as such.
function renderApplyResult(result) {
  const lines = [
    `created:   ${result.created.length}`,
    `relocated: ${result.relocated.length}`,
    `retired:   ${result.moved.length}`,
    `unverified: ${(result.unverified || []).length}`,
    `renamed:   ${result.renamed.length}`,
    `unchanged: ${result.unchanged}`,
    `conflicts: ${result.conflicts.length}`,
  ];
  for (const f of result.created) lines.push(`  create: ${f}`);
  for (const f of result.relocated) lines.push(`  relocate: ${f}`);
  for (const f of result.moved) lines.push(`  retire: ${f}`);
  for (const f of result.renamed) lines.push(`  rename: -> ${f}`);
  for (const u of result.unverified || []) lines.push(`  unverified: ${u.title} (${u.reason})`);
  for (const c of result.conflicts) lines.push(`  conflict: ${describeConflict(c)}`);
  return lines.join('\n');
}

// applyPlan's write:false result is NOT diffLibrary's four-bucket shape --
// it also runs the write-side guards (the mass-change/retire caps, the
// library-path checks), so it collapses created/relocated/retired/renamed
// into a single `planned` total rather than naming each bucket. That is a
// real difference from `diff`'s output, not an oversight: `diff` shows what
// would happen; `apply` without `--write` shows whether the guards would let
// it happen, plus the same conflicts channel and (when relevant) the
// library-path warning.
function renderApplyPreview(result) {
  const lines = [];
  if (result.libraryPathWarning) lines.push(`warning: ${result.libraryPathWarning}`);
  lines.push(`planned:   ${result.planned}`);
  lines.push(`unchanged: ${result.unchanged}`);
  lines.push(`unverified: ${(result.unverified || []).length}`);
  for (const u of result.unverified || []) lines.push(`  unverified: ${u.title} (${u.reason})`);
  lines.push(`conflicts: ${result.conflicts.length}`);
  for (const c of result.conflicts) lines.push(`  conflict: ${describeConflict(c)}`);
  return lines.join('\n');
}

function main(argv) {
  const [command, vault, ...rest] = argv;
  if (!command || !vault) {
    process.stderr.write('usage: cli.js <scan|diff|apply> <vault> [--write] [--max <n>] [--retire-max <n>]\n');
    return 2;
  }
  if (command === 'apply') {
    let opts;
    try {
      opts = parseApplyFlags(rest);
    } catch (err) {
      if (err instanceof UsageError) {
        process.stderr.write(`${err.message}\n`);
        return 2;
      }
      throw err;
    }
    try {
      const result = applyPlan(vault, opts);
      process.stdout.write(`${opts.write ? renderApplyResult(result) : renderApplyPreview(result)}\n`);
      return 0;
    } catch (err) {
      // RULING 2: refusals (the run understood the situation and declined)
      // are exit 1; guard errors (the run was misconfigured) are exit 2.
      if (err instanceof MassChangeError || err instanceof RetireCapError
        || err instanceof EmptyInventoryError) {
        process.stderr.write(`${err.message}\n`);
        return 1;
      }
      if (err instanceof LibraryPathNotConfiguredError
        || err instanceof LibraryDirectoryMissingError
        || err instanceof IndexMalformedError
        || err instanceof IndexRowLossError) {
        process.stderr.write(`${err.message}\n`);
        return 2;
      }
      throw err;
    }
  }
  const { inventory, notes } = collect(vault);
  if (command === 'scan') {
    process.stdout.write(`${inventory.length} skills, ${notes.length} notes\n`);
    return 0;
  }
  if (command === 'diff') {
    // The same verification the apply path runs. `diff` is the surface a user
    // reads BEFORE deciding to apply, so showing him a retirement here that
    // apply would decline is the one divergence this command must not have.
    const raw = diffLibrary(inventory, notes);
    const { verified, unverified } = verifyRetirements(raw.retired);
    process.stdout.write(`${renderPreview({ ...raw, retired: verified, unverified })}\n`);
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

// Both index refusals used to throw a bare Error. main() maps its typed
// error classes to exit codes and rethrows everything else, so a malformed index
// surfaced as a raw stack trace under node's default exit code -- a refusal
// the operator could not tell apart from a crash. Both are guard errors (the
// index the run was pointed at is not one it can safely regenerate), so both
// map to exit 2.
class IndexMalformedError extends Error {
  constructor(indexPath) {
    super(`index note at ${indexPath} has no H1 heading (expected a line matching /^# .+$/m) -- refusing to guess a replacement rather than silently discarding its frontmatter`);
    this.name = 'IndexMalformedError';
  }
}

class IndexRowLossError extends Error {
  constructor(existingRowCount) {
    super(`rebuildIndex would write 0 rows over an index holding ${existingRowCount} -- refusing`);
    this.name = 'IndexRowLossError';
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

// RULING 4a: the findings-ledger convention (references/findings-file.md)
// specifies a `## Run HH:MM` section heading -- the date is already carried
// in the frontmatter, so repeating it in every run heading was redundant.
function timeStamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getHours())}:${p(date.getMinutes())}`;
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
// #90: a retirement must mean "I looked where this note says the skill lives
// and it is gone" -- never "I was never told to look". An empty `source_roots`
// is the absence of evidence, not evidence of absence, and using that silence
// to stamp a live skill as entfallen is the one thing a library whose job is
// telling you what you have must not do.
//
// FENCE. inventory.js reads NAMED sources only (config, installed_plugins.json)
// and does no search. This check adds a THIRD named source and it is declared
// here rather than arriving quietly: the single path a note records in its own
// `ort` frontmatter, in the user's own vault. One existsSync per retirement
// candidate, no glob, no walk, no recursion, and never a write. A path-coverage
// test (is `ort` under a root we searched?) was considered and rejected: an
// uninstalled plugin's path is also outside every searched root, so it cannot
// tell a genuinely-gone skill from an unsearched one and would turn the retire
// path off entirely.
function verifyRetirements(retired) {
  const verified = [];
  const unverified = [];
  for (const note of retired) {
    const recorded = String((note.frontmatter && note.frontmatter.ort) || '').trim();
    if (!recorded) {
      // A note with NO frontmatter block at all is a different, older defect
      // with its own channel: the `unstampable-note` conflict, which refuses
      // the move AND names the missing field so the note can be repaired.
      // Claiming it here would silently replace that specific diagnosis with a
      // vaguer one. Let it fall through; the write path still never moves it.
      if (!note.hasFrontmatter) { verified.push(note); continue; }
      // Frontmatter present but no `ort`: there is nowhere to have looked, so
      // this cannot be called gone either. Fail closed.
      unverified.push({ note, title: note.title, reason: 'no-recorded-location' });
      continue;
    }
    let present;
    try {
      // statSync, not existsSync: existsSync swallows EVERY error and returns
      // false, so a path the filesystem cannot even evaluate would be
      // indistinguishable from a skill that is genuinely gone -- and would be
      // retired on the strength of an unanswerable question. `throwIfNoEntry:
      // false` keeps the ordinary "not there" answer cheap while letting a
      // real error (an invalid path, a permissions failure) reach the catch.
      present = fs.statSync(path.join(expandHome(recorded), 'SKILL.md'),
        { throwIfNoEntry: false }) !== undefined;
    } catch {
      // A path the filesystem refuses to evaluate at all is not proof the skill
      // is gone -- it is proof the question could not be asked. Treating the
      // throw as "absent" (the first version of this function did) retires on
      // the strength of an unanswerable question, which is the whole defect
      // this function exists to close.
      unverified.push({ note, title: note.title, reason: 'unreadable-recorded-location' });
      continue;
    }
    if (present) {
      unverified.push({ note, title: note.title, reason: 'skill-still-at-recorded-location' });
    } else {
      verified.push(note);
    }
  }
  return { verified, unverified };
}

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

// These two regexes must accept exactly what parseNote accepts
// (`^key: *(.*)$` -- the space after the colon is optional), or the two
// disagree about the same file.
const STATUS_LINE_RE = /^status:.*$/m;
const LAST_MODIFIED_LINE_RE = /^last_modified:.*$/m;

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
  // parseNote and these checks disagreed -- `status:aktiv` parsed
  // fine and was still reported as missing `status`, a true refusal with a
  // false reason. The REPLACE calls below reuse the SAME two patterns: a
  // check that matches while its replacement does not would silently no-op
  // the entfallen_am insert, which is the identical defect one layer down.
  if (!STATUS_LINE_RE.test(frontmatterText)) return { ok: false, missing: 'status' };
  if (!LAST_MODIFIED_LINE_RE.test(frontmatterText)) return { ok: false, missing: 'last_modified' };
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const newFrontmatter = frontmatterText
    .replace(STATUS_LINE_RE, 'status: entfallen')
    .replace(LAST_MODIFIED_LINE_RE, `$&${eol}entfallen_am: ${stamp(now)}`);
  return { ok: true, body: newFrontmatter + rest };
}

// A relocate and a rename both REPLACE everything above `## Notizen` with a
// freshly rendered template. That is only ours to replace when the note
// carries the contract that says so: a frontmatter block, and the heading
// that marks where the machine's half ends and the user's begins. A
// hand-authored note that merely happens to match the filename pattern never
// opted in -- rendering over it replaces the user's prose with a stub, exit 0,
// conflicts 0. Measured against a throwaway vault before this guard existed.
//
// Same ruling the retire path already carries one function up (a note you
// cannot stamp is a note you do not move) and the index rebuild carries below
// (refuse what you do not understand), in the same `unstampable-note` shape.
// The one exception is a note with nothing below its frontmatter: there is no
// user half yet, so there is nothing to lose.
function rewritableNote(note) {
  const nothingBelowFrontmatter = !note.hasNotesHeading && note.machineBody.trim() === '';
  if (!note.hasFrontmatter) {
    return nothingBelowFrontmatter && note.notesZone.trim() === ''
      ? { ok: true }
      : { ok: false, missing: 'frontmatter' };
  }
  if (!note.hasNotesHeading && !nothingBelowFrontmatter) {
    return { ok: false, missing: 'notes-heading' };
  }
  return { ok: true };
}

// A rename-claimed note is deliberately reachable from BOTH its rename record
// and the unchanged/relocated bucket its entry landed in: the write path needs
// the entry, the classifier needs the note. Reporting it twice is the defect --
// the same note was announced as `renamed: 1` AND `unchanged: 1`, and then
// moved and fully rewritten with a bumped last_modified. Project the bucket
// for reporting; never remove the entry, which the rename write path reads.
function unclaimedByRename(bucket, renamed) {
  const claimed = new Set(renamed.map((r) => r.note));
  return bucket.filter((b) => !claimed.has(b.note));
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

// The H1 line is matched anywhere on its own line, not by the literal
// "# Skill Library" text -- a user who renames their own note's heading in
// Obsidian (e.g. "# Skill-Bibliothek") is doing something normal, and a
// literal-string match would silently discard the whole file below it (fix
// for the "# Skill Library — Index" truncation bug: an unanchored
// indexOf/literal match would slice mid-line and drop the "— Index" suffix).
const H1_RE = /^# .+$/m;

// Splits an existing index note into three parts, controller ruling
// (fix round 1, C1 + I1):
//   - header: everything up to and including the H1 line, verbatim.
//   - intro: everything between the H1 line and the FIRST `## ` heading,
//     verbatim -- this is the user's own hand-written intro zone (prose,
//     wikilinks). The brief's "replace everything below the heading" was a
//     over-generalisation of one named deletion (the stale
//     "Bestandsaufnahme (2026-07-05)" block, itself a `## ` section) and is
//     corrected here: only content from the first `## ` heading onward is
//     regenerated.
//   - existingRowCount: how many numbered table rows the file held before
//     this rebuild, used by the zero-row refusal below.
//
// A MISSING file is a valid empty state (same split Task 3 settled for
// notes): it gets the default header, an empty intro, and existingRowCount
// 0. An EXISTING file with no H1 at all is not a state, it's malformed --
// this throws rather than silently replacing its frontmatter with the
// two-key default (C1: fail closed, loudly, instead of destroying user data).
function readIndexParts(indexPath) {
  let text;
  try {
    text = fs.readFileSync(indexPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { header: DEFAULT_INDEX_HEADER, intro: '\n\n', existingRowCount: 0 };
    throw err;
  }
  const h1 = H1_RE.exec(text);
  if (!h1) {
    throw new IndexMalformedError(indexPath);
  }
  const header = text.slice(0, h1.index + h1[0].length);
  const rest = text.slice(h1.index + h1[0].length);
  const h2 = /^## /m.exec(rest);
  const intro = h2 ? rest.slice(0, h2.index) : rest;
  const existingRowCount = (text.match(/^\| \d+ \|/gm) || []).length;
  return { header, intro, existingRowCount };
}

// Regenerates the index note: reads the live notes (tombstones excluded, same
// as readLibrary elsewhere), groups them via renderIndex, and replaces
// everything from the first `## ` heading onward, preserving the frontmatter,
// the H1 and the user's intro zone verbatim (see readIndexParts). Honours
// { write: false } by returning the computed markdown without touching disk,
// exactly like the rest of this module's plan-then-write shape.
//
// Controller ruling (fix round 1, I2): refuses to write when the computed
// render has ZERO rows but the file on disk currently HAS rows -- that
// combination is never a legitimate sync outcome (a mis-resolved
// library_path, a broken TITLE_RE match, an accidentally-emptied library),
// it is data loss. Zero-against-zero still writes: a first-ever run with no
// notes yet has nothing to lose.
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
  const indexPath = path.join(libraryDir, INDEX_FILE_NAME);
  // `options.parts` lets the caller do this pure read BEFORE its own writes,
  // so the malformed-index refusal lands while the library is still untouched
  // (see applyPlan). Reading here is the fallback for a direct call.
  const { header, intro, existingRowCount } = options.parts || readIndexParts(indexPath);
  if (rows.length === 0 && existingRowCount > 0) {
    throw new IndexRowLossError(existingRowCount);
  }
  const body = renderIndex(rows);
  const full = `${header}${intro}${body}\n`;
  if (options.write) fs.writeFileSync(indexPath, full);
  return full;
}

// The ledger is Storage: a documented machine schema, deliberately exempt
// from the title/description/tags standard OVA enforces on the user's own
// notes. Append-only -- a second run on the same day adds a block, it never
// replaces the morning's record.
//
// RULING (overrides the plan's original four-count spec): the ledger also
// carries conflicts -- a `conflicts:` count beside the other four counts,
// and one line per conflict below it. Task 7 built the conflicts channel
// specifically so a note the run refused to touch is NAMED rather than
// silently skipped; a ledger that reports four counts and stays silent
// about the fifth would tell the reader a clean run happened when notes
// were left behind.
function writeFindings(vault, result, options = {}) {
  const now = options.now || new Date();
  const day = stamp(now);
  const dir = path.join(vault, '_vault-autopilot', 'findings');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${day}-skill-library-sync.md`);

  const conflicts = result.conflicts || [];
  const unverified = result.unverified || [];

  const block = [
    '',
    `## Run ${timeStamp(now)}`,
    '',
    'counts:',
    // FIX (round 1, Finding 2): `created` and `relocated` used to be one
    // merged `written` count reported as "created" -- a relocation is not a
    // creation. Split so the ledger's `created:` means created.
    `  created: ${result.created.length}`,
    `  relocated: ${result.relocated.length}`,
    `  retired: ${result.moved.length}`,
    // The ledger is the record of what a run did to the vault, so it also has
    // to carry what a run DECLINED to do and why -- a retirement that did not
    // happen is invisible everywhere else once the terminal output is gone.
    `  unverified: ${unverified.length}`,
    ...unverified.map((u) => `  - ${u.title} (${u.reason})`),
    `  renamed: ${result.renamed.length}`,
    `  unchanged: ${result.unchanged}`,
    `  conflicts: ${conflicts.length}`,
    ...conflicts.map((c) => `  - ${describeConflict(c)}`),
    '',
  ].join('\n');

  // Append-only, structurally: a header is written once, the first time this
  // file exists, and every run after that only ever ADDS bytes to the end.
  // A read-then-rewrite-the-whole-file shape (the earlier version of this
  // function) makes the append guarantee rest on a blanket try/catch around
  // the read -- any failure other than "file does not exist yet" (a
  // permissions error, the path being a directory) would be silently read
  // as "first run today", and the subsequent writeFileSync would overwrite
  // the day's record with a fresh header plus only the new block. This is
  // the one file the skill calls the record of what a run did to the
  // user's vault, so losing earlier blocks is the one failure mode this
  // function must not have.
  if (!fs.existsSync(target)) {
    const header = [
      '---', `date: ${day}`, 'skill: skill-library-sync',
      'scope: skill-library', '---', '',
    ].join('\n');
    fs.writeFileSync(target, header);
  }
  fs.appendFileSync(target, block);
  return target;
}

function applyPlan(vault, options = {}) {
  const write = Boolean(options.write);
  const now = options.now || new Date();
  // `--max 0` is the natural spelling of "refuse if anything would change" --
  // a dry-run idiom. `||` turned it into the 200-note default, i.e. the exact
  // opposite of what the flag was asked for. Same `!= null` test the retire
  // cap already used.
  const max = options.max != null ? options.max : DEFAULT_MAX;
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

  const rawPlan = diffLibrary(inventory, notes);
  // Split BEFORE the caps: both the mass-change ceiling and the retire cap must
  // compare against the number of notes that would actually be moved, not
  // against a count inflated by skills nobody ever looked for. Otherwise the
  // #90 shape does not merely mislabel notes, it aborts the whole run on a cap.
  const { verified, unverified } = verifyRetirements(rawPlan.retired);
  const plan = { ...rawPlan, retired: verified };

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

  // readIndexParts is a pure read, and this module's contract is that a
  // guard throws BEFORE the first write. It used to run inside rebuildIndex,
  // called after the renames/creates/moves had already hit disk: a malformed
  // index left a half-synced library with no index and no ledger. Hoisted
  // here, with the other pre-write guards and after the caps (so a cap
  // refusal still wins with its exit 1). Preview mode does not run it --
  // preview writes nothing, and making `apply` without --write exit 2 on a
  // malformed index would change the confirm gate's contract. The
  // `existingRowCount` taken here is also the honest baseline for the
  // zero-row comparison: it is what the file held before this run began.
  const indexParts = write ? readIndexParts(path.join(libraryDir, INDEX_FILE_NAME)) : null;

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
    // A note this run does not understand is a note this run does not rewrite.
    const rewritable = rewritableNote(note);
    if (!rewritable.ok) {
      conflicts.push({ kind: 'unstampable-note', detail: { path: note.file, missing: rewritable.missing } });
      continue;
    }
    writes.push({
      kind: 'relocate',
      file: note.file,
      body: renderNote({
        ...entry,
        status: note.frontmatter.status || 'aktiv',
        // A note whose frontmatter carries no `created` gets a fresh stamp --
        // this is today's date, NOT a recovered creation date, and it is the
        // honest value available. Without the default this rendered the
        // literal string `undefined` into the user's YAML.
        created: note.frontmatter.created || nowStamp(now),
        lastModified: nowStamp(now),
      }, note.replaceable ? '' : note.notesZone, carryFrontmatter(note.frontmatterRaw)),
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
    // The entry rides on the rename record too, so this no longer
    // re-derives it by rebuilding and matching a title string across two
    // buckets -- that string-keyed lookup is the pattern that produced a
    // Critical earlier in this plan, and it was also what forced the entry to
    // stay visible in `unchanged` for the write path to find it.
    const entry = r.entry;
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
    // A rename rewrites the same machine half a relocate does, so it asks the
    // same question first: is this note one we understand well enough to
    // replace everything above `## Notizen`?
    const rewritable = rewritableNote(note);
    if (!rewritable.ok) {
      conflicts.push({ kind: 'unstampable-note', detail: { path: note.file, missing: rewritable.missing } });
      continue;
    }
    renames.push({
      from: note.file,
      to,
      body: entry ? renderNote({
        ...entry, status: note.frontmatter.status || 'aktiv',
        // Same default as the relocate branch: a fresh stamp, never the
        // literal `undefined`.
        created: note.frontmatter.created || nowStamp(now),
        lastModified: nowStamp(now),
      }, note.replaceable ? '' : note.notesZone, carryFrontmatter(note.frontmatterRaw))
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
      created: [], relocated: [], moved: [], renamed: [],
      unchanged: unclaimedByRename(plan.unchanged, plan.renamed).length,
      unverified,
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
  rebuildIndex(libraryDir, {
    write: true, retiredSubfolder: config.retiredSubfolder, parts: indexParts,
  });

  const result = {
    // FIX (round 1, Finding 2): `writes` mixes create-kind and relocate-kind
    // entries -- a single `written` array collapsed the two into one count,
    // reported as "created" even for relocated notes. Split by kind here so
    // every downstream consumer (renderApplyResult, writeFindings) reports
    // creations and relocations as the two distinct things they are.
    created: writes.filter((w) => w.kind === 'create').map((w) => w.file),
    relocated: writes.filter((w) => w.kind === 'relocate').map((w) => w.file),
    moved: moves.map((m) => m.to),
    unverified,
    renamed: renames.map((r) => r.to),
    // writeFindings (Task 9) reads this as a number. Returning the bucket itself
    // here would put a shape mismatch one task downstream of where it was made.
    // Projected past the rename records for the same reason renderPreview is:
    // a note the rename branch moved and rewrote is not unchanged.
    unchanged: unclaimedByRename(plan.unchanged, plan.renamed).length,
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
  IndexMalformedError, IndexRowLossError,
  rebuildIndex, writeFindings, verifyRetirements,
  UsageError, parseApplyFlags, renderApplyPreview, renderApplyResult,
};

if (require.main === module) process.exit(main(process.argv.slice(2)));
