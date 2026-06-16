'use strict';

// Coarse backstop: abort if a run deletes more than this fraction of the
// note's non-whitespace characters (defense-in-depth behind the per-rule guard).
const MASS_DELETION_RATIO = 0.25;

// Ordered rule set. Each rule:
//   name            unique id (also the report key)
//   find            RegExp, flags "gm" (global+multiline, NEVER the u-flag)
//   replace         string ($1/$2 backrefs allowed) or ''
//   allowedRemovals Set<string> of code points the rule may delete,
//                   or null for a span-based rule (citation) exempt from the
//                   charset guard and covered by negative tests instead.
// Citation (#2) is at index 1 below: pattern is byte-exact from the live
// obsidian-linter data.json (user-gated production read). It is marker-scoped
// to [cite:...], NOT a greedy bracket pattern, so no narrowing was needed --
// wikilinks/links/checkboxes are provably untouched (negative tests).
const RULES = [
  { name: 'unbold-headings',            find: /^(#{1,6} )\*\*(.+)\*\*[ \t]*$/gm, replace: '$1$2', allowedRemovals: new Set(['*']) },
  { name: 'citation-markers',           find: /\s?\[cite:[^\]]*\]/gm,           replace: '',     allowedRemovals: null },
  { name: 'nbsp-to-space',              find: /\u00A0/gm,                      replace: ' ',    allowedRemovals: new Set(['\u00A0']) },
  // U+200D (ZWJ) deliberately EXCLUDED: it is the joiner in emoji ZWJ-sequences
  // (e.g. person+ZWJ+laptop = technologist), so stripping it corrupts emoji.
  // Real-vault UAT 2026-06-16: 0 stray ZWJ vs 11 emoji-ZWJ across 1592 notes.
  { name: 'zero-width-strip',           find: /[\u200B\u200C\uFEFF]/gm,        replace: '',     allowedRemovals: new Set(['\u200B','\u200C','\uFEFF']) },
  { name: 'italic-headings-asterisk',   find: /^(#{1,6} )\*([^*]+)\*[ \t]*$/gm,    replace: '$1$2', allowedRemovals: new Set(['*']) },
  { name: 'italic-headings-underscore', find: /^(#{1,6} )_([^_]+)_[ \t]*$/gm,      replace: '$1$2', allowedRemovals: new Set(['_']) },
  { name: 'collapse-blank-lines',       find: /\n{3,}/gm,                       replace: '\n\n', allowedRemovals: new Set(['\n']) },
  { name: 'strip-trailing-whitespace',  find: /[ \t]+$/gm,                      replace: '',     allowedRemovals: new Set([' ','\t']) },
];

class FingerprintError extends Error {
  constructor(ruleName, ch, count) {
    const hex = 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
    super(`Fingerprint guard: rule "${ruleName}" removed disallowed character ${hex} (${count}x). Aborting; nothing written.`);
    this.name = 'FingerprintError';
    this.rule = ruleName; this.char = ch; this.count = count;
  }
}
class MassDeletionError extends Error {
  constructor(origNW, newNW) {
    super(`Mass-deletion guard: non-whitespace content dropped from ${origNW} to ${newNW} (> ${MASS_DELETION_RATIO * 100}%). Aborting; nothing written.`);
    this.name = 'MassDeletionError';
    this.origNW = origNW; this.newNW = newNW;
  }
}

function charCounts(s) {
  const m = new Map();
  for (const ch of s) m.set(ch, (m.get(ch) || 0) + 1);
  return m;
}
function removedChars(before, after) {
  const b = charCounts(before), a = charCounts(after);
  const removed = new Map();
  for (const [ch, n] of b) {
    const delta = n - (a.get(ch) || 0);
    if (delta > 0) removed.set(ch, delta);
  }
  return removed;
}
function checkRule(rule, before, after) {
  if (rule.allowedRemovals === null) return; // span-based: guarded by negative tests
  for (const [ch, count] of removedChars(before, after)) {
    if (!rule.allowedRemovals.has(ch)) throw new FingerprintError(rule.name, ch, count);
  }
}
// NB: JS `\s` does NOT match the zero-width code points it strips (U+200B/200C), so
// they count as non-whitespace here. That is deliberate: a paste padded with
// many zero-width chars will, when zero-width-strip removes them, register as a
// large non-whitespace drop and can legitimately trip the mass-deletion backstop
// below. That fails in the safe direction (abort, never corrupt). NBSP (U+00A0)
// and BOM (U+FEFF) ARE matched by `\s`, so they stay neutral to this count.
function nonWhitespaceLength(s) {
  let n = 0;
  for (const ch of s) if (!/\s/.test(ch)) n++;
  return n;
}

// Apply all rules in order. Throws FingerprintError / MassDeletionError on a
// guard violation BEFORE returning -- callers must not write on throw.
function applyAll(text) {
  let cur = text;
  const perRule = {};
  for (const rule of RULES) {
    const hits = (cur.match(rule.find) || []).length;
    const next = cur.replace(rule.find, rule.replace);
    checkRule(rule, cur, next);
    perRule[rule.name] = hits;
    cur = next;
  }
  const origNW = nonWhitespaceLength(text);
  const newNW = nonWhitespaceLength(cur);
  if (origNW > 0 && (origNW - newNW) / origNW > MASS_DELETION_RATIO) {
    throw new MassDeletionError(origNW, newNW);
  }
  return { text: cur, perRule, changed: cur !== text };
}

module.exports = { RULES, applyAll, removedChars, checkRule, FingerprintError, MassDeletionError, MASS_DELETION_RATIO };
