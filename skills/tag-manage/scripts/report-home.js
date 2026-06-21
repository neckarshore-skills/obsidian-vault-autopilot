'use strict';
// report-home.js — detect candidate report homes (suggestReportDir) and persist the
// chosen one (setReportDir, Task 2). Deterministic: the agent runs the human "where?"
// gate; these functions do the byte/path work so they are unit-testable.
const fs = require('node:fs');
const path = require('node:path');
const { extractJsonFence } = require('./config.js');

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

function setReportDir(vault, relpathRaw) {
  const relpath = validateRelpath(relpathRaw);
  const existingRel = findConfigNote(vault);
  if (existingRel) {
    const full = path.join(vault, existingRel);
    const text = fs.readFileSync(full, 'utf8');
    const cfg = extractJsonFence(text) || {};
    cfg.reportDir = relpath;
    const fence = '```json\n' + JSON.stringify(cfg, null, 2) + '\n```';
    const updated = extractJsonFence(text) != null
      ? text.replace(/```json\s*\n[\s\S]*?\n```/, fence)
      : `${text.replace(/\s*$/, '')}\n\n${fence}\n`;
    fs.writeFileSync(full, updated, 'utf8');
    return { configPath: full, created: false };
  }
  const full = path.join(vault, 'Tag Manage Config.md');
  const content = `# Tag Manage Config\n\nVault-local config for the tag-manage skill. \`reportDir\` is the permanent home for tag analysis reports.\n\n\`\`\`json\n${JSON.stringify({ reportDir: relpath }, null, 2)}\n\`\`\`\n`;
  fs.writeFileSync(full, content, 'utf8');
  return { configPath: full, created: true };
}

module.exports = { suggestReportDir, setReportDir };
