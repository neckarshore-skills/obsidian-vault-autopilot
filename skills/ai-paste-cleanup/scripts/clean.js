'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { applyAll } = require('./rules.js');

const SKIP_DIRS = new Set(['_trash', '.obsidian', '.git', 'node_modules']);

function cleanText(text) {
  return applyAll(text).text;
}

// Collect *.md files under a directory, skipping excluded/dot dirs.
function walkMarkdown(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

// Plan-then-write: transform every target in memory first (guards run here and
// throw on violation). Only if ALL succeed AND opts.write is set do we write.
// Returns { files: [{path, changed, perRule}], totals, wrote }.
function cleanPath(target, opts = {}) {
  const stat = fs.statSync(target);
  const files = stat.isDirectory() ? walkMarkdown(target) : [target];

  const transform = opts.transform || applyAll; // seam: lets tests inject a throwing transform
  const planned = files.map((file) => {
    const original = fs.readFileSync(file, 'utf8');
    const result = transform(original); // may throw FingerprintError/MassDeletionError
    return { path: file, original, ...result };
  });

  let wrote = false;
  if (opts.write) {
    for (const p of planned) if (p.changed) fs.writeFileSync(p.path, p.text, 'utf8');
    wrote = true;
  }

  const totals = {};
  for (const p of planned) for (const [k, v] of Object.entries(p.perRule)) totals[k] = (totals[k] || 0) + v;
  return {
    files: planned.map((p) => ({ path: p.path, changed: p.changed, perRule: p.perRule })),
    totals,
    changedCount: planned.filter((p) => p.changed).length,
    fileCount: planned.length,
    wrote,
  };
}

module.exports = { cleanPath, cleanText, walkMarkdown };

// ---- CLI ----
if (require.main === module) {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const stdout = args.includes('--stdout');
  const target = args.find((a) => !a.startsWith('--'));
  if (!target) { console.error('usage: node clean.js <path> [--write] [--stdout]'); process.exit(1); }
  try {
    if (stdout) { process.stdout.write(cleanText(fs.readFileSync(target, 'utf8'))); process.exit(0); }
    const res = cleanPath(target, { write });
    const header = write ? 'WROTE' : 'DRY-RUN (nothing written)';
    console.log(`ai-paste-cleanup — ${header}`);
    console.log(`Files: ${res.changedCount} changed of ${res.fileCount}`);
    const hits = Object.entries(res.totals).filter(([, v]) => v > 0);
    if (hits.length) console.log('Per-rule: ' + hits.map(([k, v]) => `${k}: ${v}`).join(' | '));
    else console.log('Per-rule: (no changes)');
    process.exit(0);
  } catch (e) {
    console.error(`ABORTED — ${e.message}`);
    process.exit(2); // guard violation: nothing written
  }
}
