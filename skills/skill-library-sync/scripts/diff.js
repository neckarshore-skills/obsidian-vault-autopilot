'use strict';
// diff.js — pure classification of inventory against library.
//
// Four buckets, and `unchanged` is a real one: a run that changes nothing must
// be able to say so with a number, because silence reads as "nothing was
// checked" and that is the failure mode this whole skill exists to end.

const { noteTitle } = require('./render.js');

function suffixMap(inventory) {
  const counts = new Map();
  for (const e of inventory) counts.set(e.name, (counts.get(e.name) || 0) + 1);
  return counts;
}

function diffLibrary(inventory, notes) {
  const counts = suffixMap(inventory);
  const withSuffix = inventory.map((e) => ({
    ...e, suffix: counts.get(e.name) > 1 ? e.herkunft : '',
  }));

  const created = [];
  const relocated = [];
  const retired = [];
  const unchanged = [];
  const renamed = [];

  const noteByTitle = new Map(notes.map((n) => [n.title, n]));
  const claimed = new Set();

  for (const entry of withSuffix) {
    const wanted = noteTitle(entry);
    let note = noteByTitle.get(wanted);
    if (!note) {
      // A skill that has just acquired a second origin: its old note carries no
      // suffix. Rename rather than orphan it, otherwise the note's history and
      // the user's own prose are silently abandoned next to a fresh stub.
      const bare = noteByTitle.get(noteTitle({ name: entry.name }));
      if (entry.suffix && bare && !claimed.has(bare.title)) {
        renamed.push({ from: bare.title, to: wanted });
        claimed.add(bare.title);
        note = bare;
      }
    }
    if (!note && !entry.suffix) {
      // Fallback: if we're looking for a suffix-less note, try to match any
      // note with the same name (preserves old notes that may have had suffixes)
      note = Array.from(noteByTitle.values()).find(
        (n) => n.name === entry.name && !claimed.has(n.title));
    }
    if (!note) { created.push(entry); continue; }
    claimed.add(note.title);
    if (note.frontmatter.ort === entry.ort) unchanged.push({ ...entry, note });
    else relocated.push({ ...entry, note });
  }

  for (const note of notes) if (!claimed.has(note.title)) retired.push(note);

  return { created, relocated, retired, unchanged, renamed };
}

module.exports = { diffLibrary };
