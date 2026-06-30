'use strict';
// recommend.js — turn the inventory + convention verdicts into prioritized recs with ops.
const { logicalKey, isReserved, isValidTag, applyOps } = require('./tags.js');
const { classifyTag, canonicalForm } = require('./convention.js');

// An acronym spelling: all uppercase letters/digits, >=2 chars, at least one
// letter (so "12" is not an acronym, "MCP"/"B2B"/"E2E" are). Used to prefer a
// real all-caps spelling the vault already uses over a Title-case heuristic guess.
function isAcronym(s) {
  return s.length >= 2 && /^[\p{Lu}\p{N}]+$/u.test(s) && /\p{Lu}/u.test(s);
}

function buildContext(inventory, dict) {
  const leaves = new Set();
  for (const r of inventory) if (r.key.includes('/')) leaves.add(r.key.split('/').pop());
  return { brandSet: new Set(dict.brands.keys()), brandHyphenSet: dict.brandHyphenSet, hierarchicalLeaves: leaves };
}

function buildRecommendations(inventory, dict, notes) {
  const ctx = buildContext(inventory, dict);
  // Build a path -> text map for efficient per-rec changed-note counting.
  // Only constructed when notes are provided; otherwise we fall back to noteCount.
  const byPath = notes ? new Map(notes.map((n) => [n.path, n.text])) : null;
  const recs = [];
  let id = 0;
  for (const r of inventory) {
    if (isReserved(r.key)) continue;
    // Invalid / numeric artifacts (`1`, `1-3`, `Make.com`) are NOT real tags. They are
    // reported under "Invalid tags" for review, never turned into a rename rec (the
    // `1-3 -> 13` UAT bug). Removal of invalids is a separate opt-in, not part of "apply all".
    if (!isValidTag(r.display)) continue;
    const variants = r.variants;
    let { canonical, source } = canonicalForm(r.display, dict);
    // If the resolver fell back to the Title-case heuristic but the vault already uses a real
    // all-caps spelling (GEO, PRD, B2B), prefer that acronym over the heuristic guess (Geo).
    if (source === 'heuristic') {
      const acro = variants.find(isAcronym);
      if (acro) { canonical = acro; source = 'acronym'; }
    }
    const nonCanonical = variants.filter((v) => v !== canonical);
    const dictionaryBacked = source === 'brand' || source === 'compound';
    const anyViolation = variants.some((v) => classifyTag(v, ctx).violation);
    // A real case/spelling duplicate of one logical tag (variants.length > 1) is itself a
    // reason to fold, even when no single variant trips a classifyTag violation
    // (e.g. AI-Testing / AI-testing). A single compliant non-dict tag (one variant) is NOT
    // touched -- the do-no-harm guard against renaming a correct tag to a heuristic guess.
    const isDuplicate = variants.length > 1;
    const needsFold = nonCanonical.length > 0 && (dictionaryBacked || anyViolation || isDuplicate);
    if (!needsFold) continue;
    const kind = variants.length > 1 ? 'merge' : 'rename';
    const ops = nonCanonical.map((v) => ({ type: 'rename', from: logicalKey(v), to: canonical }));
    // from = the non-canonical variant spellings being folded (not the canonical first-seen display).
    const from = nonCanonical.join(', ');
    // notesAffected = notes that actually change. Bounded by r.files (candidate set for this
    // logical tag); we only run applyOps over those, not the full vault. Falls back to
    // r.noteCount when notes are not supplied (backward-compat).
    let notesAffected = r.noteCount;
    if (byPath) {
      notesAffected = r.files
        .map((p) => byPath.get(p))
        .filter((t) => t !== undefined)
        .filter((t) => applyOps(t, ops).changed)
        .length;
    }
    recs.push({ id: ++id, kind, severity: classifyTag(r.display, ctx).severity || 'MEDIUM',
      from, to: canonical, notesAffected, source, ops });
  }
  recs.sort((a, b) => b.notesAffected - a.notesAffected || a.from.localeCompare(b.from));
  recs.forEach((rr, i) => { rr.id = i + 1; });
  return recs;
}

// Slice 1a — deterministic removal candidates for letter-free numeric junk
// (`1`, `42`, `1-3`). numericArtifacts is already the conservative letter-free set
// (auditFindings: /^[\p{N}/_-]+$/u); otherInvalidTags (`Make.com`, `2prio`) is NEVER
// consumed here — those may be real. A removal carries NO `to` (it has no target, so
// the report renders from+notes, not a fake rename). Disjoint from buildRecommendations,
// which skips invalids entirely (line: `if (!isValidTag(...)) continue`). Destructive +
// opt-in: written to a SEPARATE sidecar, never bundled into the default "apply all".
function buildRemovalRecommendations(inventory, numericArtifacts, notes) {
  const byPath = notes ? new Map(notes.map((n) => [n.path, n.text])) : null;
  const rowOf = new Map();
  for (const r of inventory) for (const v of r.variants) rowOf.set(v, r);
  const recs = [];
  for (const tag of numericArtifacts || []) {
    const r = rowOf.get(tag);
    if (!r) continue;
    const ops = [{ type: 'remove', from: logicalKey(tag) }];
    let notesAffected = r.noteCount;
    if (byPath) {
      notesAffected = r.files
        .map((p) => byPath.get(p))
        .filter((t) => t !== undefined)
        .filter((t) => applyOps(t, ops).changed)
        .length;
    }
    recs.push({ kind: 'remove', from: tag, notesAffected, source: 'numeric-artifact', ops });
  }
  recs.sort((a, b) => b.notesAffected - a.notesAffected || a.from.localeCompare(b.from));
  recs.forEach((rr, i) => { rr.id = i + 1; });
  return recs;
}

module.exports = { buildRecommendations, buildRemovalRecommendations, buildContext };
