'use strict';
// hierarchy.js — Phase 1 deterministic NEST mechanics (declared parent -> children).
//
// Pure logic, no fs, no clock. The declared taxonomy lives in the vault-local
// `Tag Manage Config.md` `hierarchy` block (parent -> [children], human-readable);
// parseHierarchy derives the internal childKey -> {parent, child, path} map and
// validates it hard (invalid tag / one-parent-per-child / no cycles). A `nest`
// recommendation promotes a FLAT declared child to `Parent/Child` — it is a normal
// rename onto a slash path, so it flows through the existing applyOps/survival/
// mass-change write path with no new write code.
//
// See docs/superpowers/specs/2026-06-22-tag-manage-hierarchy-design.md.
const { logicalKey, isValidTag, isReserved, applyOps } = require('./tags.js');

// Derive + validate the declared taxonomy.
// Returns { map: Map<childKey, {parent, child, path}>, errors: string[] }.
// Invalid entries are reported and EXCLUDED — never applied (design § Config validation).
function parseHierarchy(hierarchyObj) {
  const map = new Map();        // childKey -> {parent, child, path}
  const parentOf = new Map();   // childKey -> parentKey  (for cycle detection)
  const errors = [];

  for (const [parent, children] of Object.entries(hierarchyObj || {})) {
    if (!isValidTag(parent)) {
      errors.push(`invalid parent tag "${parent}" — must be a valid Obsidian tag (letters/digits/_/-//, no spaces); children excluded`);
      continue;
    }
    const parentKey = logicalKey(parent);
    for (const child of children || []) {
      if (!isValidTag(child)) {
        errors.push(`invalid child tag "${child}" under "${parent}" — must be a valid Obsidian tag (no spaces); excluded`);
        continue;
      }
      const childKey = logicalKey(child);
      if (map.has(childKey)) {
        errors.push(`child "${child}" (${childKey}) declared under more than one parent — keeping "${map.get(childKey).parent}", ignoring "${parent}"`);
        continue;
      }
      if (createsCycle(parentOf, childKey, parentKey)) {
        errors.push(`cycle: "${child}" under "${parent}" would make a tag its own ancestor — edge dropped`);
        continue;
      }
      map.set(childKey, { parent, child, path: `${parent}/${child}` });
      parentOf.set(childKey, parentKey);
    }
  }
  return { map, errors };
}

// True iff adding childKey -> parentKey would close a cycle: a self-edge, or
// parentKey already reaching childKey through the existing parentOf chain.
function createsCycle(parentOf, childKey, parentKey) {
  if (childKey === parentKey) return true;
  let cur = parentKey;
  const seen = new Set();
  while (parentOf.has(cur)) {
    if (cur === childKey) return true;
    if (seen.has(cur)) break; // defensive: never loop on already-validated data
    seen.add(cur);
    cur = parentOf.get(cur);
  }
  return cur === childKey;
}

// Build `nest` recommendations: a FLAT tag that is a declared child gets promoted to
// `Parent/Child`. Mirrors recommend.js shape ({id, kind, severity, from, to, notesAffected,
// source, ops}) so the report + selectOps + the plan/apply path reuse it unchanged.
//
// nest is a SEPARATE class from the cleanup recs (design § Engine): it changes tag
// identity across potentially many notes, so it is opt-in per id — never bundled into
// the default "apply all" cleanup. notesAffected comes from the real engine, never a claim.
function buildNestRecommendations(inventory, hierMap, notes) {
  if (!hierMap || hierMap.size === 0) return [];
  const byPath = notes ? new Map(notes.map((n) => [n.path, n.text])) : null;
  const recs = [];
  for (const r of inventory) {
    if (isReserved(r.key)) continue;
    if (r.key.includes('/')) continue;        // already nested -> convergence (no re-nest)
    if (!hierMap.has(r.key)) continue;         // only declared children, only where they occur flat
    const { path } = hierMap.get(r.key);
    const ops = [{ type: 'rename', from: r.key, to: path }];
    let notesAffected = r.noteCount;
    if (byPath) {
      notesAffected = r.files
        .map((p) => byPath.get(p))
        .filter((t) => t !== undefined)
        .filter((t) => applyOps(t, ops).changed)
        .length;
    }
    // targetMayBeNew: an ENGINE-authored nest whose `to` is a slash path (Parent/Leaf) whose
    // parent is created on apply. Trusted opt-out from the apply-boundary both-exist guard
    // (validate.js); model-authored cross-language merges carry no marker -> strict both-exist.
    recs.push({ id: 0, kind: 'nest', severity: 'LOW', from: r.variants.join(', '),
      to: path, notesAffected, source: 'hierarchy', ops, targetMayBeNew: true });
  }
  recs.sort((a, b) => b.notesAffected - a.notesAffected || a.to.localeCompare(b.to));
  recs.forEach((rr, i) => { rr.id = i + 1; });
  return recs;
}

// Merge one approved cluster (parent -> children) into a config object and VALIDATE the
// result. Pure (returns a new config object; does not mutate the input). Unlike the audit
// path (which reports + excludes invalid entries), a deliberate write REFUSES to persist an
// invalid taxonomy: it throws. Children are unioned into the matching parent (case-insensitive
// parent match, declared display preserved), deduped by logical key, order preserved.
function upsertHierarchyCluster(configObj, parent, children) {
  const cfg = configObj || {};
  const merged = {};
  for (const [p, ch] of Object.entries(cfg.hierarchy || {})) merged[p] = [...(ch || [])];
  // Merge into an existing parent key that matches case-insensitively (avoid a split
  // "Investing"/"investing"); else add a new parent under the declared casing.
  const targetKey = Object.keys(merged).find((k) => logicalKey(k) === logicalKey(parent)) || parent;
  const existing = merged[targetKey] || [];
  const seen = new Set(existing.map(logicalKey));
  const add = [];
  for (const c of children || []) {
    if (!seen.has(logicalKey(c))) { seen.add(logicalKey(c)); add.push(c); }
  }
  merged[targetKey] = [...existing, ...add];
  const { errors } = parseHierarchy(merged);
  if (errors.length) throw new Error(`invalid hierarchy: ${errors.join('; ')}`);
  return { ...cfg, hierarchy: merged };
}

module.exports = { parseHierarchy, buildNestRecommendations, upsertHierarchyCluster };
