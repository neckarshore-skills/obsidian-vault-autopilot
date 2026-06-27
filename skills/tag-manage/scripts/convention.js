'use strict';
// convention.js — deterministic tag-convention classification + canonical resolver.
// Pure: no fs, no clock. Mirrors the predecessor's Step 3.5 (first matching rule wins).
const { logicalKey, stripSeparators } = require('./tags.js');

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
  // Lowercase concept tag — single-word ('research') OR hyphenated ('personal-brand',
  // 'digital-garden'). The hyphen was the blind spot (2026-06-24 UAT): lowercase kebab
  // slipped past every rule and read as compliant. AI-/KI- and proper nouns start uppercase
  // (handled below / by the brand dict), so they never reach here.
  if (/^\p{Ll}[\p{Ll}\p{N}-]*$/u.test(t)) return { violation: 'lowercase-concept', severity: 'MEDIUM' };
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
  // Separator-insensitive fallback: a no-separator variant (`mercedesbenz`,
  // `MercedesBenz`) resolves to its hyphenated dictionary canonical (`Mercedes-Benz`).
  // Brand wins over compound (mirrors the direct-lookup precedence above).
  const sk = stripSeparators(key);
  if (dict.brandStripped && dict.brandStripped.has(sk)) return { canonical: dict.brandStripped.get(sk), source: 'brand' };
  if (dict.compoundStripped && dict.compoundStripped.has(sk)) return { canonical: dict.compoundStripped.get(sk), source: 'compound' };
  return { canonical: pascalHeuristic(tag), source: 'heuristic' };
}

module.exports = { classifyTag, canonicalForm, pascalHeuristic };
