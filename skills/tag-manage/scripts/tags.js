'use strict';
// tag-manage — deterministic tag engine (pure logic, no fs, no clock).
// Mirrors the ai-paste-cleanup split: this file is logic only; cli.js does I/O.
//
// Step 0 (references/tag-semantics.md): Obsidian matches tags case-insensitively.
// A "logical tag" = the case-folded full string (slash preserved). Every operation
// works on the logical tag across all six on-disk representations.
//
// The survival guard is the structural analog of ai-paste-cleanup's fingerprint
// guard: re-tokenize before/after, assert every NON-tag-token byte is identical.

const RESERVED_TAGS = new Set(['vaultautopilot']); // stored case-folded; plumbing, never a suggestion

class SurvivalError extends Error {
  constructor(detail) {
    super(`Survival guard: a non-tag byte changed during rewrite${detail ? ` (${detail})` : ''}. Aborting; nothing written.`);
    this.name = 'SurvivalError';
  }
}

// --- logical identity -------------------------------------------------------

// Case-folded identity. Strips an optional leading '#'. Preserves '/'.
// Uses String.toLowerCase() (Unicode-aware) — NOT an ASCII-only fold (German vault).
function logicalKey(tag) {
  return String(tag).replace(/^#/, '').toLowerCase();
}

function isReserved(tag) {
  return RESERVED_TAGS.has(logicalKey(tag));
}

// Obsidian validity: allowed charset + at least one non-numerical character.
function isValidTag(tag) {
  const t = String(tag).replace(/^#/, '');
  if (t.length === 0) return false;
  if (!/^[\p{L}\p{N}_/-]+$/u.test(t)) return false; // letters, numbers, _, -, /
  if (!/[\p{L}_]/u.test(t)) return false;           // >=1 non-numeric (letter or _)
  return true;
}

// --- frontmatter split (yaml-edits recipe (a): BOM + line-ending aware) ------

function splitFrontmatter(text) {
  const bom = text.charCodeAt(0) === 0xFEFF ? '﻿' : '';
  const rest = bom ? text.slice(1) : text;
  const ending = rest.includes('\r\n') ? '\r\n' : '\n';
  const lines = rest.split(ending);
  if (lines[0] !== '---') {
    return { hasFrontmatter: false, frontmatter: [], body: lines, ending, bom };
  }
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { close = i; break; }
  }
  if (close === -1) {
    return { hasFrontmatter: false, frontmatter: [], body: lines, ending, bom };
  }
  return {
    hasFrontmatter: true,
    frontmatter: lines.slice(1, close),
    body: lines.slice(close + 1),
    ending, bom,
  };
}

// --- the body survival tokenizer (reps 5 + 6) -------------------------------

function cleanTagValue(v) {
  let s = String(v).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('#')) s = s.slice(1);
  return s;
}

const FENCE_RE = /^(\s*)(`{3,}|~{3,})/;
const TAG_CHAR = /[\p{L}\p{N}_/-]/u;

// Scan one line for inline-code spans, wikilinks, link targets, and tags.
// Pushes tag tokens {tag, start, end} with absolute offsets into `tags`.
function scanLine(body, ls, le, tags) {
  let i = ls;
  while (i < le) {
    const c = body[i];

    // inline code span: a run of k backticks closed by a run of k backticks
    if (c === '`') {
      let k = i;
      while (k < le && body[k] === '`') k++;
      const len = k - i;
      let j = k;
      let closed = -1;
      while (j < le) {
        if (body[j] === '`') {
          let m = j;
          while (m < le && body[m] === '`') m++;
          if (m - j === len) { closed = m; break; }
          j = m;
        } else j++;
      }
      i = closed !== -1 ? closed : k; // skip span (or just the opening run if unmatched)
      continue;
    }

    // wikilink / embed: [[ ... ]]
    if (c === '[' && body[i + 1] === '[') {
      const end = body.indexOf(']]', i + 2);
      if (end !== -1 && end < le) { i = end + 2; continue; }
    }

    // markdown link / image target: ]( ... )
    if (c === ']' && body[i + 1] === '(') {
      const end = body.indexOf(')', i + 2);
      if (end !== -1 && end < le) { i = end + 1; continue; }
    }

    // tag: '#' at line-start or preceded by whitespace, then >=1 tag char.
    // This single boundary rule makes URL fragments (preceded by '/' or a word
    // char) and ATX heading markers ('#' + space) NOT tags — by construction.
    if (c === '#') {
      const atLineStart = i === ls;
      const prev = i > ls ? body[i - 1] : '\n';
      if (atLineStart || /\s/.test(prev)) {
        let k = i + 1;
        while (k < le && TAG_CHAR.test(body[k])) k++;
        const raw = body.slice(i + 1, k);
        if (raw.length > 0 && isValidTag(raw)) {
          tags.push({ tag: raw, start: i, end: k });
          i = k;
          continue;
        }
      }
    }

    i++;
  }
}

// Find every real inline tag in a body string, skipping fenced code blocks.
function scanBody(body) {
  const tags = [];
  // line ranges
  const ranges = [];
  let s = 0;
  for (let k = 0; k < body.length; k++) {
    if (body[k] === '\n') { ranges.push([s, k]); s = k + 1; }
  }
  ranges.push([s, body.length]);

  let fenced = false;
  let fenceChar = null;
  let fenceLen = 0;
  for (const [ls, le] of ranges) {
    const line = body.slice(ls, le);
    const fm = line.match(FENCE_RE);
    if (fm) {
      const marker = fm[2];
      if (!fenced) { fenced = true; fenceChar = marker[0]; fenceLen = marker.length; continue; }
      if (marker[0] === fenceChar && marker.length >= fenceLen) { fenced = false; fenceChar = null; continue; }
    }
    if (fenced) continue;
    scanLine(body, ls, le, tags);
  }
  return tags;
}

function bodyTags(body) {
  return scanBody(body);
}

// --- frontmatter tag reader (reps 1-4) --------------------------------------

const FIELD_RE = /^(\s*)(tags|tag)\s*:(?!:)\s*(.*)$/;
const ITEM_RE = /^(\s*)-\s*(.+?)\s*$/;

function frontmatterTagsFromLines(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(FIELD_RE);
    if (!m) continue;
    const key = m[2];
    const rest = m[3].trim();
    if (rest === '') {
      for (let j = i + 1; j < lines.length; j++) {
        const im = lines[j].match(ITEM_RE);
        if (!im) break;
        out.push({ tag: cleanTagValue(im[2]), key, repr: 'block' });
      }
    } else if (rest.startsWith('[')) {
      const inner = rest.replace(/^\[/, '').replace(/\]$/, '');
      for (const part of inner.split(',')) {
        const v = cleanTagValue(part);
        if (v) out.push({ tag: v, key, repr: 'inline-array' });
      }
    } else {
      out.push({ tag: cleanTagValue(rest), key, repr: 'scalar' });
    }
    break; // first tags/tag field only
  }
  return out;
}

function frontmatterTags(noteText) {
  const fm = splitFrontmatter(noteText);
  if (!fm.hasFrontmatter) return [];
  return frontmatterTagsFromLines(fm.frontmatter);
}

function noteTags(noteText) {
  const out = [];
  for (const f of frontmatterTags(noteText)) out.push({ tag: f.tag, source: 'frontmatter' });
  const fm = splitFrontmatter(noteText);
  for (const b of bodyTags(fm.body.join(fm.ending))) out.push({ tag: b.tag, source: 'body' });
  return out;
}

// --- the rewrite engine -----------------------------------------------------

// Compile an ops list into a Map: logicalKey -> targetString | null (remove).
function compileOps(ops) {
  const map = new Map();
  for (const op of ops) {
    if (op.type === 'rename') map.set(logicalKey(op.from), op.to);
    else if (op.type === 'merge') for (const f of op.from) map.set(logicalKey(f), op.to);
    else if (op.type === 'remove') map.set(logicalKey(op.from), null);
  }
  return map;
}

function rewriteBodyTags(body, map) {
  const tags = scanBody(body);
  let out = '';
  let pos = 0;
  let changed = false;
  for (const t of tags) {
    out += body.slice(pos, t.start);
    const k = logicalKey(t.tag);
    const oldTok = body.slice(t.start, t.end);
    if (map.has(k) && map.get(k) !== null) {
      const newTok = '#' + map.get(k);
      out += newTok;
      if (newTok !== oldTok) changed = true; // a no-op rewrite (target == current) is not a change
    } else {
      out += oldTok; // unchanged (removes are frontmatter-only)
    }
    pos = t.end;
  }
  out += body.slice(pos);
  return { text: out, changed };
}

// Map a single raw tag value to {target, changed}. target===null means remove.
function mapTagEntry(raw, map) {
  const cleaned = cleanTagValue(raw);
  const k = logicalKey(cleaned);
  if (map.has(k)) return { target: map.get(k), changed: true };
  return { target: cleaned, changed: false };
}

// Drop duplicates ONLY when the collision was caused/affected by an op. A
// pre-existing within-note case-duplicate (e.g. [JavaScript, javascript]) that
// no op touched is preserved verbatim — collapsing it is a cosmetic
// case-normalize that the user must opt into (Step 0 / Decision 1: do no harm).
// Returns the kept entries in order; each carries {target, changed, raw}.
function dedupOpCollisions(entries) {
  const out = [];
  const keptKeys = new Map(); // logicalKey -> { changedSeen }
  for (const e of entries) {
    if (e.target === null) continue; // removed
    const k = logicalKey(e.target);
    if (keptKeys.has(k)) {
      const info = keptKeys.get(k);
      if (e.changed || info.changedSeen) continue; // op-caused collision: drop the duplicate
      out.push(e); // pre-existing duplicate, untouched by any op: keep both
    } else {
      keptKeys.set(k, { changedSeen: e.changed });
      out.push(e);
    }
  }
  return out;
}

function rewriteFrontmatterTags(lines, map) {
  let idx = -1;
  let field = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(FIELD_RE);
    if (m) { idx = i; field = m; break; }
  }
  if (idx === -1) return { lines, changed: false };

  const indent = field[1];
  const key = field[2];
  const rest = field[3].trim();

  if (rest === '') {
    // block list — collect item lines, map, dedup op-collisions, preserve unchanged lines verbatim
    let j = idx + 1;
    const items = [];
    while (j < lines.length) {
      const im = lines[j].match(ITEM_RE);
      if (!im) break;
      items.push({ line: lines[j], raw: im[2] });
      j++;
    }
    if (items.length === 0) return { lines, changed: false };
    const itemIndentMatch = lines[idx + 1].match(/^(\s*)-/);
    const itemIndent = itemIndentMatch ? itemIndentMatch[1] : `${indent}  `;
    const entries = items.map((it) => ({ ...mapTagEntry(it.raw, map), line: it.line }));
    const kept = dedupOpCollisions(entries);
    const droppedCount = items.length - kept.length;
    if (droppedCount === 0 && entries.every((e) => !e.changed)) return { lines, changed: false };
    let newLines;
    if (kept.length === 0) {
      newLines = [...lines.slice(0, idx), ...lines.slice(j)];
    } else {
      const keptLines = kept.map((e) => (e.changed ? `${itemIndent}- ${e.target}` : e.line));
      newLines = [...lines.slice(0, idx), `${indent}${key}:`, ...keptLines, ...lines.slice(j)];
    }
    return { lines: newLines, changed: newLines.join('\n') !== lines.join('\n') };
  }

  if (rest.startsWith('[')) {
    const inner = rest.replace(/^\[/, '').replace(/\]$/, '');
    const items = inner.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    const entries = items.map((raw) => mapTagEntry(raw, map));
    const kept = dedupOpCollisions(entries);
    const touched = entries.some((e) => e.changed) || (items.length - kept.length) > 0;
    if (!touched) return { lines, changed: false }; // no op matched — leave byte-identical
    let newLines;
    if (kept.length === 0) {
      newLines = [...lines.slice(0, idx), ...lines.slice(idx + 1)];
    } else {
      newLines = [...lines.slice(0, idx), `${indent}${key}: [${kept.map((e) => e.target).join(', ')}]`, ...lines.slice(idx + 1)];
    }
    return { lines: newLines, changed: newLines.join('\n') !== lines.join('\n') };
  }

  // scalar — only touch when an op matches the value
  const entry = mapTagEntry(rest, map);
  if (!entry.changed) return { lines, changed: false };
  let newLines;
  if (entry.target === null) {
    newLines = [...lines.slice(0, idx), ...lines.slice(idx + 1)];
  } else {
    newLines = [...lines.slice(0, idx), `${indent}${key}: ${entry.target}`, ...lines.slice(idx + 1)];
  }
  return { lines: newLines, changed: newLines.join('\n') !== lines.join('\n') };
}

// Re-tokenize before/after; assert every non-tag-token text segment is identical.
function segments(body) {
  const tags = scanBody(body);
  const segs = [];
  let pos = 0;
  for (const t of tags) { segs.push(body.slice(pos, t.start)); pos = t.end; }
  segs.push(body.slice(pos));
  return segs;
}

function assertSurvival(before, after) {
  const sb = segments(before);
  const sa = segments(after);
  if (sb.length !== sa.length) throw new SurvivalError(`tag-token count changed ${sb.length - 1}->${sa.length - 1}`);
  for (let i = 0; i < sb.length; i++) {
    if (sb[i] !== sa[i]) throw new SurvivalError('protected text segment differs');
  }
}

// Apply ops to a single note. Runs the body survival guard before returning.
// Frontmatter correctness is covered by the representation-matrix tests, not the
// body tokenizer, so the guard runs over the body only.
function applyOps(noteText, ops) {
  const map = compileOps(ops);
  const fm = splitFrontmatter(noteText);

  let changed = false;
  let newFmLines = fm.frontmatter;
  if (fm.hasFrontmatter) {
    const r = rewriteFrontmatterTags(fm.frontmatter, map);
    newFmLines = r.lines;
    if (r.changed) changed = true;
  }

  const bodyStr = fm.body.join(fm.ending);
  const bres = rewriteBodyTags(bodyStr, map);
  if (bres.changed) changed = true;
  assertSurvival(bodyStr, bres.text);

  // body residual: a remove-op tag that still lives inline (reported, never stripped)
  const bodyResidual = [];
  for (const t of scanBody(bres.text)) {
    const k = logicalKey(t.tag);
    if (map.has(k) && map.get(k) === null) bodyResidual.push(t.tag);
  }

  let out = fm.bom;
  if (fm.hasFrontmatter) {
    out += '---' + fm.ending;
    if (newFmLines.length) out += newFmLines.join(fm.ending) + fm.ending;
    out += '---' + fm.ending;
  }
  out += bres.text;

  return { text: out, changed, bodyResidual };
}

// --- audit grouping (pure) --------------------------------------------------

function filterReserved(tags) {
  return tags.filter((t) => !isReserved(t));
}

// Case-only variants of the same logical tag (cosmetic, per Step 0).
function caseVariantGroups(tags) {
  const byKey = new Map();
  for (const t of tags) {
    const k = logicalKey(t);
    if (!byKey.has(k)) byKey.set(k, new Set());
    byKey.get(k).add(t);
  }
  const groups = [];
  for (const [k, set] of byKey) if (set.size > 1) groups.push({ key: k, variants: [...set] });
  return groups;
}

// Separator variants ('-' <-> '_' only; '/' is a nested tag and stays distinct).
function separatorVariantGroups(tags) {
  const norm = (t) => logicalKey(t).replace(/[-_]/g, '');
  const byKey = new Map();
  for (const t of tags) {
    const k = norm(t);
    if (!byKey.has(k)) byKey.set(k, new Map());
    byKey.get(k).set(logicalKey(t), t);
  }
  const groups = [];
  for (const [k, m] of byKey) if (m.size > 1) groups.push({ key: k, variants: [...m.values()] });
  return groups;
}

// --- vault-level audit aggregation (pure: operates on [{path, text}]) --------

// Logical-tag inventory across a set of notes. noteCount counts NOTES (not raw
// occurrences) so single-note tags surface as orphans. display = first-seen casing.
function buildInventory(notes) {
  const byKey = new Map();
  for (const { path, text } of notes) {
    const seenInNote = new Set();
    for (const t of noteTags(text)) {
      const k = logicalKey(t.tag);
      if (!byKey.has(k)) byKey.set(k, { key: k, display: t.tag, variants: new Set(), files: [], noteCount: 0 });
      const rec = byKey.get(k);
      rec.variants.add(t.tag);
      if (!seenInNote.has(k)) { seenInNote.add(k); rec.noteCount++; rec.files.push(path); }
    }
  }
  return [...byKey.values()]
    .map((r) => ({ ...r, variants: [...r.variants] }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function auditFindings(notes) {
  const inventory = buildInventory(notes);
  const spellings = [...new Set(inventory.flatMap((r) => r.variants))];
  const caseGroups = caseVariantGroups(filterReserved(spellings));
  const separatorGroups = separatorVariantGroups(filterReserved(spellings));
  const orphans = inventory
    .filter((r) => r.noteCount === 1 && !isReserved(r.key))
    .map((r) => ({ key: r.key, display: r.display, file: r.files[0] }));
  const invalid = spellings.filter((s) => !isValidTag(s));
  const numericArtifacts = invalid.filter((s) => /^[\p{N}/_-]+$/u.test(s));
  const otherInvalidTags = invalid.filter((s) => !/^[\p{N}/_-]+$/u.test(s));
  const untagged = notes.filter((n) => noteTags(n.text).length === 0).map((n) => n.path);
  return {
    totalNotes: notes.length,
    totalTags: inventory.length,
    inventory, caseGroups, separatorGroups, orphans, numericArtifacts, otherInvalidTags, untagged,
  };
}

module.exports = {
  RESERVED_TAGS, SurvivalError,
  logicalKey, isReserved, isValidTag,
  splitFrontmatter, cleanTagValue,
  bodyTags, scanBody, frontmatterTags, frontmatterTagsFromLines, noteTags,
  compileOps, applyOps, assertSurvival,
  filterReserved, caseVariantGroups, separatorVariantGroups,
  buildInventory, auditFindings,
};
