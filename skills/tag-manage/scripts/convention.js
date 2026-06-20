'use strict';
// convention.js — deterministic tag-convention classification + canonical resolver.
// Pure: no fs, no clock. Mirrors the predecessor's Step 3.5 (first matching rule wins).
const { logicalKey } = require('./tags.js');

const YAML_FIELD_RE = /^(created|modified|last_updated|updated|date|aliases?|status|type)\s*:/i;

function classifyTag(tag, ctx) {
  const t = String(tag);
  const key = logicalKey(t);
  if (t.startsWith('#')) return { violation: 'hashtag-prefix', severity: 'HIGH' };
  if (YAML_FIELD_RE.test(t)) return { violation: 'yaml-artifact', severity: 'HIGH' };
  if (/^[\p{N}/_-]+$/u.test(t)) return { violation: 'numeric-artifact', severity: 'HIGH' };
  if (ctx.brandSet.has(key)) return { violation: null, severity: null };
  if (t.includes('_')) return { violation: 'snake_case', severity: 'MEDIUM' };
  if (/^\p{Ll}/u.test(t) && /\p{Ll}\p{Lu}/u.test(t)) return { violation: 'camelCase', severity: 'MEDIUM' };
  if (/^\p{Ll}[\p{Ll}\p{N}]*$/u.test(t)) return { violation: 'lowercase-concept', severity: 'MEDIUM' };
  if (/^\p{Lu}[\p{L}\p{N}]*-\p{Lu}/u.test(t) && !/^(AI|KI)-/.test(t) && !ctx.brandHyphenSet.has(key)) {
    return { violation: 'upper-kebab', severity: 'MEDIUM' };
  }
  if (!t.includes('/') && ctx.hierarchicalLeaves.has(key)) return { violation: 'flat-where-hierarchical', severity: 'LOW' };
  return { violation: null, severity: null };
}

function capitalize(w) {
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : w;
}

function pascalHeuristic(tag) {
  const ai = tag.match(/^(ai|ki)[-_](.+)$/i);
  if (ai) return ai[1].toUpperCase() + '-' + tag.slice(ai[1].length + 1).split(/[-_]/).map(capitalize).join('-');
  return tag.split('/').map((seg) => seg.split(/[-_]/).map(capitalize).join('')).join('/');
}

function canonicalForm(tag, dict) {
  const key = logicalKey(tag);
  if (dict.brands.has(key)) return { canonical: dict.brands.get(key), source: 'brand' };
  if (dict.compounds.has(key)) return { canonical: dict.compounds.get(key), source: 'compound' };
  return { canonical: pascalHeuristic(tag), source: 'heuristic' };
}

module.exports = { classifyTag, canonicalForm, pascalHeuristic };
