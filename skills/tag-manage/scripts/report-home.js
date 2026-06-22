'use strict';
// report-home.js — detect candidate report homes (suggestReportDir) and persist the
// chosen one (setReportDir, Task 2). Deterministic: the agent runs the human "where?"
// gate; these functions do the byte/path work so they are unit-testable.
const fs = require('node:fs');
const path = require('node:path');
const { extractJsonFence } = require('./config.js');
const { upsertHierarchyCluster } = require('./hierarchy.js');

const SKIP = (name) => name.startsWith('.') || name.startsWith('_') || name === 'node_modules';
const ADMIN_RE = /(^|[^a-z])(meta|system|admin)([^a-z]|$)/i;
const isTagMgmtName = (n) => /tag/i.test(n) && /manage|management/i.test(n);

function topLevelDirs(vault) {
  return fs.readdirSync(vault, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !SKIP(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

function walkDirs(vault, base = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(vault, base), { withFileTypes: true })) {
    if (!e.isDirectory() || SKIP(e.name)) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    out.push(rel);
    out.push(...walkDirs(vault, rel));
  }
  return out;
}

function suggestReportDir(vault) {
  const dirs = topLevelDirs(vault);
  const candidates = [];
  const metaDir = dirs.find((d) => d.toLowerCase() === 'meta');
  if (metaDir) candidates.push({ relpath: `${metaDir}/Tag Management`, reason: 'existing Meta folder', exists: false });
  const adminDir = dirs.find((d) => ADMIN_RE.test(d) && d.toLowerCase() !== 'meta');
  if (adminDir) candidates.push({ relpath: `${adminDir}/Tag Management`, reason: 'admin-like area', exists: false });
  candidates.push({ relpath: 'Tag Management', reason: 'vault root (fallback)', exists: false });
  const cont = walkDirs(vault).filter((rel) => isTagMgmtName(path.basename(rel))).sort()[0];
  if (cont) candidates.push({ relpath: cont, reason: 'existing tag-management folder (continuity)', exists: true });
  return { recommended: candidates[0].relpath, candidates };
}

function validateRelpath(relpath) {
  if (!relpath || typeof relpath !== 'string') throw new Error('report dir path required');
  if (path.isAbsolute(relpath) || relpath.startsWith('/')) throw new Error(`report dir must be vault-relative, got absolute: ${relpath}`);
  if (relpath.split(/[\\/]/).includes('..')) throw new Error(`report dir must not escape the vault (..): ${relpath}`);
  return relpath.replace(/\/+$/, '');
}

function findConfigNote(vault, base = '') {
  for (const e of fs.readdirSync(path.join(vault, base), { withFileTypes: true })) {
    if (SKIP(e.name)) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) { const f = findConfigNote(vault, rel); if (f) return f; }
    else if (e.name === 'Tag Manage Config.md') return rel;
  }
  return null;
}

// Shared config-note persistence: find the note, update its json fence in place (or create
// the note when absent). `mutate(cfg)` edits the parsed config BEFORE any write — so a
// throwing mutate (e.g. an invalid hierarchy cluster) aborts cleanly, nothing written.
// `createTemplate(cfg)` renders the new note. Extracted from setReportDir so set-hierarchy
// reuses the exact fence/create/preserve behavior (the $-substitution and unparseable-fence
// guards are now one implementation, not two).
function updateConfigNote(vault, mutate, createTemplate) {
  const existingRel = findConfigNote(vault);
  if (existingRel) {
    const full = path.join(vault, existingRel);
    const text = fs.readFileSync(full, 'utf8');
    const hasFence = /```json\s*\n[\s\S]*?\n```/.test(text);
    const parseable = extractJsonFence(text) != null;
    if (hasFence && !parseable) {
      throw new Error(`existing ${existingRel} has an unparseable json fence — fix it manually before writing`);
    }
    const cfg = extractJsonFence(text) || {};
    mutate(cfg);
    const fence = '```json\n' + JSON.stringify(cfg, null, 2) + '\n```';
    const updated = parseable
      ? text.replace(/```json\s*\n[\s\S]*?\n```/, () => fence)  // function repl: no $-substitution
      : `${text.replace(/\s*$/, '')}\n\n${fence}\n`;
    fs.writeFileSync(full, updated, 'utf8');
    return { configPath: full, created: false };
  }
  const cfg = {};
  mutate(cfg);
  const full = path.join(vault, 'Tag Manage Config.md');
  fs.writeFileSync(full, createTemplate(cfg), 'utf8');
  return { configPath: full, created: true };
}

function setReportDir(vault, relpathRaw) {
  const relpath = validateRelpath(relpathRaw);
  return updateConfigNote(vault,
    (cfg) => { cfg.reportDir = relpath; },
    (cfg) => `# Tag Manage Config\n\nVault-local config for the tag-manage skill. \`reportDir\` is the permanent home for tag analysis reports.\n\n\`\`\`json\n${JSON.stringify(cfg, null, 2)}\n\`\`\`\n`);
}

// Persist one approved parent -> children cluster into the `hierarchy` block. The validated
// merge (upsertHierarchyCluster) throws on an invalid cluster, so nothing is written.
function setHierarchy(vault, parent, children) {
  return updateConfigNote(vault,
    (cfg) => { cfg.hierarchy = upsertHierarchyCluster(cfg, parent, children).hierarchy; },
    (cfg) => `# Tag Manage Config\n\nVault-local config for the tag-manage skill. \`hierarchy\` declares parent -> child tag clusters; a flat child tag is promoted to \`Parent/Child\` via the nest recommendation.\n\n\`\`\`json\n${JSON.stringify(cfg, null, 2)}\n\`\`\`\n`);
}

module.exports = { suggestReportDir, setReportDir, setHierarchy };
