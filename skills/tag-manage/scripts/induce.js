'use strict';
// induce.js — Slice 1: deterministic name-based clustering of flat residual tags.
// Pure logic, no fs, no clock, no LLM. Proposes candidate families (tags sharing a
// leading token) that the tag-organize agent reviews and persists via set-hierarchy;
// the nest itself rides the existing Phase-1 applyOps/survival path (no new write code).
// See docs/superpowers/specs/2026-06-23-tag-organize-design.md.

// Index where the first token ends: first separator, camelCase boundary, or letter<->digit.
function firstTokenEnd(tag) {
  for (let i = 1; i < tag.length; i++) {
    const prev = tag[i - 1];
    const cur = tag[i];
    if (cur === '-' || cur === '_' || cur === '/') return i;
    if (/[a-z]/.test(prev) && /[A-Z]/.test(cur)) return i;       // camelCase
    if (/[A-Za-z]/.test(prev) && /[0-9]/.test(cur)) return i;    // letter->digit
    if (/[0-9]/.test(prev) && /[A-Za-z]/.test(cur)) return i;    // digit->letter
  }
  return tag.length;
}

function leadingSegment(tag) {
  return tag.slice(0, firstTokenEnd(tag));
}

function tokenizeTag(tag) {
  const tokens = [];
  let rest = tag;
  while (rest.length) {
    const seg = leadingSegment(rest);
    if (seg) tokens.push(seg.toLowerCase());
    let next = rest.slice(seg.length);
    next = next.replace(/^[-_/]/, ''); // drop the boundary separator
    if (next === rest) break;          // safety: no progress
    rest = next;
  }
  return tokens;
}

module.exports = { tokenizeTag, leadingSegment };
