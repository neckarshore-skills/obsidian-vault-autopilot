'use strict';
// induce.js — Slice 1: deterministic name-based clustering of flat residual tags.
// Pure logic, no fs, no clock, no LLM. Proposes candidate families (tags sharing a
// leading token) that the tag-organize agent reviews and persists via set-hierarchy;
// the nest itself rides the existing Phase-1 applyOps/survival path (no new write code).
// See docs/superpowers/specs/2026-06-23-tag-organize-design.md.
const { logicalKey, isReserved } = require('./tags.js');

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

// Most frequent string; ties broken alphabetically (deterministic).
function mode(strings) {
  const counts = new Map();
  for (const s of strings) counts.set(s, (counts.get(s) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

// Group flat residual tags that share a leading token into candidate families.
// Pure. Excludes reserved tags and already-nested tags (key contains '/'). A family
// needs >= minMembers (default 2) DISTINCT logical tags. Each result:
//   { parent, children, basis } where parent = most-frequent leading display segment,
//   children = member display tags (variants[0]) sorted A->Z, basis = a name-evidence note.
// Sorted by member count desc, then parent A->Z.
function clusterByName(inventory, opts = {}) {
  const minMembers = opts.minMembers || 2;
  const families = new Map(); // stem token -> array of entries
  for (const e of inventory) {
    if (isReserved(e.key)) continue;
    if (e.key.includes('/')) continue;            // already nested -> convergence
    const display = e.variants[0] || e.key;
    const tokens = tokenizeTag(display);
    if (tokens.length < 2) continue;              // single-token tag is not a family member
    const stem = tokens[0];
    // A one-character or purely-numeric leading token is never a meaningful parent
    // (e.g. B2B -> "b", 2-Fix -> "2"). User rule, 2026-06-24 UAT. Two-letter acronym
    // stems ("ai", "ki") are real parents and are intentionally NOT suppressed.
    if (stem.length === 1 || /^\d+$/.test(stem)) continue;
    if (!families.has(stem)) families.set(stem, []);
    families.get(stem).push(e);
  }
  const clusters = [];
  for (const [stem, entries] of families) {
    const distinct = [...new Map(entries.map((e) => [logicalKey(e.variants[0] || e.key), e])).values()];
    if (distinct.length < minMembers) continue;
    const parent = mode(distinct.map((e) => leadingSegment(e.variants[0] || e.key)));
    const children = distinct.map((e) => e.variants[0] || e.key)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())); // A->Z, case-insensitive
    clusters.push({ parent, children, basis: `name: ${children.length} tags share leading token "${stem}"` });
  }
  clusters.sort((a, b) => b.children.length - a.children.length || a.parent.localeCompare(b.parent));
  return clusters;
}

module.exports = { tokenizeTag, leadingSegment, clusterByName };
