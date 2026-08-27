'use strict';
// diff.js -- pure classification of inventory against library.
//
// Four action buckets, and `unchanged` is a real one: a run that changes
// nothing must be able to say so with a number, because silence reads as
// "nothing was checked" and that is the failure mode this whole skill exists
// to end.
//
// `conflicts` sits beside the four buckets as an error channel: duplicate
// note titles and duplicate (name, herkunft) inventory rows with different
// `ort` are data problems this tool SURFACES rather than silently absorbs.
// A note or entry caught in a conflict never enters `created`, `relocated`,
// `retired`, or `unchanged` -- nothing is moved or rewritten on the strength
// of ambiguous data.
//
// Partition invariant: `created` is inventory-side; every NOTE lands in
// exactly one of `relocated`, `retired`, `unchanged`, or `conflicts`.

const { noteTitle } = require('./render.js');

// A separator that cannot occur inside a skill name, herkunft, or suffix
// (unlike a plain space, which paths in this vault legitimately contain --
// e.g. "Library Meta"), so joined keys can never collide across fields.
const KEY_SEP = String.fromCharCode(31);

function nameHerkunftKey(name, herkunft) {
  return name + KEY_SEP + herkunft;
}

// Exact duplicate inventory rows (identical name, herkunft AND ort) are the
// same skill seen twice, not a conflict -- deduplicate them silently before
// anything else runs.
function dedupeExact(inventory) {
  const seen = new Set();
  const out = [];
  for (const e of inventory) {
    const key = nameHerkunftKey(e.name, e.herkunft) + KEY_SEP + e.ort;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

// Two inventory rows sharing (name, herkunft) but disagreeing on `ort` are a
// genuine ambiguity: which location is the real one? Surface it as a
// conflict and exclude every row in the group from classification, rather
// than guessing and computing a target title that collides on write.
function splitInventoryConflicts(deduped) {
  const groups = new Map();
  for (const e of deduped) {
    const key = nameHerkunftKey(e.name, e.herkunft);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const conflicts = [];
  const conflicted = new Set();
  for (const group of groups.values()) {
    if (group.length > 1) {
      // Carry name/herkunft straight from a row in the group -- never
      // re-parse the join key, which would break for a name or herkunft
      // that itself contains the separator.
      conflicts.push({
        kind: 'duplicate-inventory-entry',
        detail: { name: group[0].name, herkunft: group[0].herkunft, entries: group },
      });
      for (const e of group) conflicted.add(e);
    }
  }
  const valid = deduped.filter((e) => !conflicted.has(e));
  return { valid, conflicts };
}

// Two (or more) notes sharing a title collapse to one entry in any
// title-keyed Map. Track matching and `claimed` by note OBJECT identity,
// never by title string, and surface the collision instead of letting one
// note silently vanish from every bucket.
function splitNoteConflicts(notes) {
  const byTitle = new Map();
  for (const n of notes) {
    if (!byTitle.has(n.title)) byTitle.set(n.title, []);
    byTitle.get(n.title).push(n);
  }
  const conflicts = [];
  const clean = [];
  for (const [title, group] of byTitle) {
    if (group.length > 1) {
      conflicts.push({ kind: 'duplicate-note-title', detail: { title, notes: group } });
    } else {
      clean.push(group[0]);
    }
  }
  return { clean, conflicts };
}

// Count UNIQUE herkunft values per name -- two rows with the SAME herkunft
// must not each count as a separate origin.
function multiOriginNames(inventory) {
  const sets = new Map();
  for (const e of inventory) {
    if (!sets.has(e.name)) sets.set(e.name, new Set());
    sets.get(e.name).add(e.herkunft);
  }
  const out = new Set();
  for (const [name, set] of sets) if (set.size > 1) out.add(name);
  return out;
}

// For a name that has just acquired a second (or third) origin, its old note
// carries no suffix. Decide, ONCE per name and independent of inventory
// order, which entry gets to rename that bare note: the one whose `ort`
// matches the note's recorded location. If none matches (the note's
// location is stale) -- or if MORE THAN ONE entry shares that ort -- fall
// back to a single deterministic tie-break, sorted herkunft, over whichever
// candidate set applies. Never let iteration order of the input decide.
function resolveRenameClaims(entriesByName, cleanNoteByNameSuffix) {
  const byHerkunft = (a, b) => a.herkunft.localeCompare(b.herkunft);
  const claimByEntry = new Map();
  for (const [name, entries] of entriesByName) {
    if (entries.length < 2) continue; // single origin: nothing to rename
    const bare = cleanNoteByNameSuffix.get(nameHerkunftKey(name, ''));
    if (!bare) continue;
    const ortMatches = entries.filter((e) => e.ort === bare.frontmatter.ort);
    const candidates = ortMatches.length ? ortMatches : entries;
    const chosen = [...candidates].sort(byHerkunft)[0];
    claimByEntry.set(chosen, bare);
  }
  return claimByEntry;
}

function diffLibrary(inventory, notes) {
  const { valid: validEntries, conflicts: inventoryConflicts } =
    splitInventoryConflicts(dedupeExact(inventory));
  const { clean: cleanNotes, conflicts: noteConflicts } = splitNoteConflicts(notes);

  const multiOrigin = multiOriginNames(validEntries);
  const withSuffix = validEntries.map((e) => ({
    ...e, suffix: multiOrigin.has(e.name) ? e.herkunft : '',
  }));

  // Clean notes, indexed by (name, suffix) so matching does not depend on
  // reconstructing a title string -- and so a stale suffix from a
  // since-collapsed multi-origin skill is visible as data, not hidden
  // inside a title.
  const cleanNoteByNameSuffix = new Map();
  for (const n of cleanNotes) cleanNoteByNameSuffix.set(nameHerkunftKey(n.name, n.suffix), n);

  const entriesByName = new Map();
  for (const e of withSuffix) {
    if (!entriesByName.has(e.name)) entriesByName.set(e.name, []);
    entriesByName.get(e.name).push(e);
  }
  const renameClaimByEntry = resolveRenameClaims(entriesByName, cleanNoteByNameSuffix);

  const created = [];
  const relocated = [];
  const retired = [];
  const unchanged = [];
  const renamed = [];
  const claimed = new Set(); // note objects, never titles

  // Deterministic order: independent of how the caller happened to list the
  // inventory, so the rename decision (and everything downstream of it)
  // never varies by input order.
  const orderedEntries = [...withSuffix].sort((a, b) =>
    a.name === b.name ? a.herkunft.localeCompare(b.herkunft) : a.name.localeCompare(b.name));

  for (const entry of orderedEntries) {
    let note = cleanNoteByNameSuffix.get(nameHerkunftKey(entry.name, entry.suffix));
    if (note && claimed.has(note)) note = undefined;

    if (!note && renameClaimByEntry.has(entry)) {
      const bare = renameClaimByEntry.get(entry);
      if (!claimed.has(bare)) {
        // `note` and `entry` both ride on the record for consumers that act
        // on the rename (the write path): a second string-keyed lookup by
        // title is exactly the pattern that already produced a Critical
        // earlier in this plan, and it is needless when both objects are
        // right here. The entry ALSO stays in whichever bucket it lands in
        // below -- that double membership is what the write path used to
        // depend on, and removing it is not the fix for the double COUNT
        // (cli.js's unclaimedByRename projects the buckets for reporting).
        renamed.push({ from: bare.title, to: noteTitle(entry), note: bare, entry });
        claimed.add(bare);
        note = bare;
      }
    }

    if (!note && entry.suffix === '') {
      // A now-single-origin skill whose note still carries a suffix from a
      // former multi-origin state. Match ONLY if the note's suffix names
      // THIS entry's own herkunft -- a note carrying a DIFFERENT origin's
      // suffix belongs to a different (possibly now-retired) origin and
      // must not be silently claimed.
      note = cleanNotes.find(
        (n) => n.name === entry.name && n.suffix === entry.herkunft && !claimed.has(n));
    }

    if (!note) { created.push(entry); continue; }
    claimed.add(note);
    if (note.frontmatter.ort === entry.ort) unchanged.push({ ...entry, note });
    else relocated.push({ ...entry, note });
  }

  for (const note of cleanNotes) if (!claimed.has(note)) retired.push(note);

  const conflicts = [...inventoryConflicts, ...noteConflicts];

  return { created, relocated, retired, unchanged, renamed, conflicts };
}

module.exports = { diffLibrary };
