'use strict';
// recommend.js — turn the inventory + convention verdicts into prioritized recs with ops.
const { logicalKey, isReserved } = require('./tags.js');
const { classifyTag, canonicalForm } = require('./convention.js');

function buildContext(inventory, dict) {
  const leaves = new Set();
  for (const r of inventory) if (r.key.includes('/')) leaves.add(r.key.split('/').pop());
  return { brandSet: new Set(dict.brands.keys()), brandHyphenSet: dict.brandHyphenSet, hierarchicalLeaves: leaves };
}

function buildRecommendations(inventory, dict) {
  const ctx = buildContext(inventory, dict);
  const recs = [];
  let id = 0;
  for (const r of inventory) {
    if (isReserved(r.key)) continue;
    const { canonical, source } = canonicalForm(r.display, dict);
    const variants = r.variants;
    const nonCanonical = variants.filter((v) => v !== canonical);
    const dictionaryBacked = source === 'brand' || source === 'compound';
    const anyViolation = variants.some((v) => classifyTag(v, ctx).violation);
    // Dictionary-backed canonicals are ENFORCED: any non-canonical spelling folds, including
    // a uniformly-lowercase brand (github -> GitHub) with no mixed variant. Heuristic
    // canonicals are only PROPOSED when a real convention violation exists -- never fold a
    // compliant tag to a heuristic guess (that would rename a correct AI-ML to a wrong AI-Ml;
    // the survival guard does NOT cover frontmatter tag renames).
    const needsFold = nonCanonical.length > 0 && (dictionaryBacked || anyViolation);
    if (!needsFold) continue;
    const kind = variants.length > 1 ? 'merge' : 'rename';
    const ops = nonCanonical.map((v) => ({ type: 'rename', from: logicalKey(v), to: canonical }));
    recs.push({ id: ++id, kind, severity: classifyTag(r.display, ctx).severity || 'MEDIUM',
      from: r.display, to: canonical, notesAffected: r.noteCount, source, ops });
  }
  recs.sort((a, b) => b.notesAffected - a.notesAffected || a.from.localeCompare(b.from));
  recs.forEach((rr, i) => { rr.id = i + 1; });
  return recs;
}

module.exports = { buildRecommendations, buildContext };
