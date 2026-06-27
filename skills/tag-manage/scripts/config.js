'use strict';
// config.js — load + merge tag-override dictionaries (defaults (+) vault-local).
const fs = require('node:fs');
const { logicalKey, stripSeparators } = require('./tags.js');

// Separator-insensitive lookup index for a brand/compound map: maps the
// separator-stripped form of each multi-segment key to its canonical value, so a
// no-separator variant (`mercedesbenz`) resolves to the hyphenated canonical
// (`Mercedes-Benz`). Only keys that CONTAIN a separator are indexed (single-token
// keys already match directly). Ambiguous collisions (two keys strip to the same
// form with different canonicals) are dropped -> do no harm, fall through to heuristic.
function buildStrippedIndex(map) {
  const idx = new Map();
  const collide = new Set();
  for (const [k, v] of map) {
    const s = stripSeparators(k);
    if (s === k) continue;
    if (idx.has(s) && idx.get(s) !== v) { collide.add(s); continue; }
    idx.set(s, v);
  }
  for (const c of collide) idx.delete(c);
  return idx;
}

function extractJsonFence(md) {
  const m = String(md).match(/```json\s*\n([\s\S]*?)\n```/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function toMap(obj) {
  const map = new Map();
  for (const [k, v] of Object.entries(obj || {})) map.set(logicalKey(k), v);
  return map;
}

function mergeOverrides(defaults, local) {
  const d = defaults || {}, l = local || {};
  const brands = toMap(d.brands); for (const [k, v] of toMap(l.brands)) brands.set(k, v);
  const compounds = toMap(d.compounds); for (const [k, v] of toMap(l.compounds)) compounds.set(k, v);
  const brandHyphenSet = new Set([...brands.keys()].filter((k) => k.includes('-')));
  // hierarchy is vault-local only (defaults ship none). Carried through raw (parent ->
  // children); hierarchy.js derives + validates the childKey map at use time.
  const brandStripped = buildStrippedIndex(brands);
  const compoundStripped = buildStrippedIndex(compounds);
  return { brands, compounds, brandStripped, compoundStripped, brandHyphenSet, folderExclusive: l.folderExclusive || {}, reportDir: l.reportDir || null, hierarchy: l.hierarchy || {} };
}

function loadConfig({ defaultsPath, configText }) {
  const defaults = JSON.parse(fs.readFileSync(defaultsPath, 'utf8'));
  const local = configText ? extractJsonFence(configText) : null;
  return mergeOverrides(defaults, local);
}

module.exports = { extractJsonFence, toMap, mergeOverrides, loadConfig };
