'use strict';
// library.js — pure parsing of a Skill Library note.
//
// The body boundary is this file's whole reason to exist: everything above
// `## Notizen` belongs to the machine, everything below belongs to the user and
// is never written. The placeholder stub is the one exception, and it is matched
// BYTE-FOR-BYTE. A length threshold would be the obvious shortcut and is exactly
// how an 869-character note survives today and a 90-character one is destroyed
// next month.

const NOTES_HEADING = '## Notizen';
const STUB = '(noch keine vertiefende Dokumentation — Stub aus der Bestandsaufnahme 2026-07-05)';

function parseNote(text) {
  // Tolerate CRLF (Windows) line endings WITHOUT normalising the source
  // string itself. A note authored with CRLF must still yield its
  // frontmatter -- an earlier version of this function normalised `\r\n`
  // to `\n` into a working copy and then sliced machineBody/notesZone out
  // of THAT normalised copy, which silently converted the user's own CRLF
  // text to LF the moment it passed through here -- exactly the region the
  // body-boundary contract promises never to touch. Instead, the regexes
  // below accept an optional `\r` before each `\n`, and every returned
  // slice (machineBody, notesZone) is taken from the ORIGINAL `src`, so a
  // CRLF file's line endings survive byte-for-byte in what comes back.
  const src = String(text);
  const fmMatch = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const frontmatter = {};
  let rest = src;
  if (fmMatch) {
    rest = src.slice(fmMatch[0].length);
    for (const line of fmMatch[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*): *(.*)$/);
      if (!kv) continue;
      let value = kv[2].trim();
      let wasQuoted = false;
      if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
        wasQuoted = true;
        value = value.slice(1, -1);
        // Unescape YAML: reverse the escaping done by yamlString.
        // Replace \" with ", and \\ with \ (order matters: \\ first to avoid double-unescaping).
        value = value.replace(/\\\\/g, '\x00').replace(/\\"/g, '"').replace(/\x00/g, '\\');
      }
      frontmatter[kv[1]] = value;
    }
  }
  const idx = rest.indexOf(NOTES_HEADING);
  if (idx === -1) {
    return { frontmatter, machineBody: rest, notesZone: '', hasNotesHeading: false };
  }
  return {
    frontmatter,
    machineBody: rest.slice(0, idx),
    notesZone: rest.slice(idx + NOTES_HEADING.length),
    hasNotesHeading: true,
  };
}

// Replaceable means: the machine put this here, so the machine may replace it.
// Anything else -- including the stub with a single line appended -- belongs to
// the user in its entirety. No surgical extraction of a stub from prose.
function isReplaceableZone(notesZone) {
  const trimmed = String(notesZone).trim();
  return trimmed === '' || trimmed === STUB;
}

module.exports = { NOTES_HEADING, STUB, parseNote, isReplaceableZone };
