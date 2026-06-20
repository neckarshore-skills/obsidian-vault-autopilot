'use strict';
// config.js — load + merge tag-override dictionaries (defaults (+) vault-local).
const fs = require('node:fs');
const { logicalKey } = require('./tags.js');

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
  return { brands, compounds, brandHyphenSet, folderExclusive: l.folderExclusive || {}, reportDir: l.reportDir || null };
}

function loadConfig({ defaultsPath, configText }) {
  const defaults = JSON.parse(fs.readFileSync(defaultsPath, 'utf8'));
  const local = configText ? extractJsonFence(configText) : null;
  return mergeOverrides(defaults, local);
}

module.exports = { extractJsonFence, toMap, mergeOverrides, loadConfig };
