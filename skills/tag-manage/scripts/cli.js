'use strict';
// tag-manage — fs + CLI shell over the deterministic engine in tags.js.
// Subcommands:
//   audit <vault>                 read-only inventory + findings (Stage 1)
//   plan  <vault> --ops ops.json  dry-run: per-note diffs + guards, writes nothing (Stage 1)
//   apply <vault> --ops ops.json --write   execute behind the confirm gate (Stage 2)
//
// Safety mirrors ai-paste-cleanup: plan-then-write (transform every note in memory,
// guards throw BEFORE any write), in-place fs.writeFileSync (preserves birthtime —
// no new inode, unlike the Edit/Write tools), exit codes 0 / 1 / 2.
const fs = require('node:fs');
const path = require('node:path');
const { applyOps, auditFindings } = require('./tags.js');

// Default mass-change ceiling: a single op touching more notes than this aborts.
const DEFAULT_MASS_CHANGE_THRESHOLD = 50;
const SKIP_DIRS = new Set(['node_modules']);

class MassChangeError extends Error {
  constructor(count, threshold) {
    super(`Mass-change guard: this plan would touch ${count} notes (> threshold ${threshold}). Aborting; nothing written. Re-run with a higher --max or split the operation.`);
    this.name = 'MassChangeError';
    this.count = count;
    this.threshold = threshold;
  }
}

// Walk *.md, skipping dirs/files starting with '.' or '_' (plugin-reserved /
// protected — _trash, _secret, .obsidian, _vault-autopilot.md) and node_modules.
function walkMarkdown(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name.startsWith('_') || SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkMarkdown(full));
    else if (e.isFile() && e.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function readNotes(dir) {
  return walkMarkdown(dir).map((p) => ({ path: p, text: fs.readFileSync(p, 'utf8') }));
}

function auditVault(dir) {
  return auditFindings(readNotes(dir));
}

// Plan-then-write core. Transforms every note in memory first; the survival guard
// inside applyOps (and any injected throwing transform) aborts before any write.
function applyToVault(dir, ops, opts = {}) {
  const write = !!opts.write;
  const threshold = opts.massChangeThreshold ?? DEFAULT_MASS_CHANGE_THRESHOLD;
  const transform = opts.transform || ((text) => applyOps(text, ops));

  const notes = readNotes(dir);
  const planned = notes.map((n) => {
    const r = transform(n.text); // may throw SurvivalError or an injected error
    return { path: n.path, before: n.text, after: r.text, changed: !!r.changed, bodyResidual: r.bodyResidual || [] };
  });

  const changedCount = planned.filter((p) => p.changed).length;
  if (changedCount > threshold) throw new MassChangeError(changedCount, threshold);

  let wrote = false;
  if (write) {
    for (const p of planned) if (p.changed) fs.writeFileSync(p.path, p.after, 'utf8');
    wrote = true;
  }
  return { planned, changedCount, fileCount: planned.length, wrote };
}

function planVault(dir, ops, opts = {}) {
  return applyToVault(dir, ops, { ...opts, write: false });
}

module.exports = { walkMarkdown, readNotes, auditVault, applyToVault, planVault, MassChangeError, DEFAULT_MASS_CHANGE_THRESHOLD };

// ---- CLI -------------------------------------------------------------------

function loadOps(args) {
  const i = args.indexOf('--ops');
  if (i === -1 || !args[i + 1]) { console.error('error: this subcommand requires --ops <file.json>'); process.exit(1); }
  return JSON.parse(fs.readFileSync(args[i + 1], 'utf8'));
}

function getFlagValue(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

function printAudit(f) {
  console.log(`tag-manage audit — ${f.totalNotes} notes, ${f.totalTags} logical tags`);
  console.log(`\nCosmetic (case variants — Obsidian already treats these as one tag; fix is opt-in):`);
  if (f.caseGroups.length) for (const g of f.caseGroups) console.log(`  ${g.key}: ${g.variants.join(' | ')}`);
  else console.log('  (none)');
  console.log(`\nFunctional duplicates (separator variants — real distinct tags):`);
  if (f.separatorGroups.length) for (const g of f.separatorGroups) console.log(`  ${g.variants.join(' | ')}`);
  else console.log('  (none)');
  console.log(`\nOrphan tags (used in a single note):`);
  console.log(f.orphans.length ? f.orphans.map((o) => `  ${o.display} (${o.file})`).join('\n') : '  (none)');
  if (f.numericArtifacts.length) console.log(`\nNumeric artifacts (invalid — not real tags):\n  ${f.numericArtifacts.join(' | ')}`);
  console.log(`\nUntagged notes: ${f.untagged.length}`);
}

function printPlan(res, header) {
  console.log(`tag-manage ${header} — ${res.changedCount} of ${res.fileCount} notes would change`);
  for (const p of res.planned.filter((x) => x.changed)) {
    console.log(`\n--- ${p.path}`);
    if (p.bodyResidual.length) console.log(`  WARN: inline body still contains removed tag(s): ${p.bodyResidual.join(', ')} (frontmatter-only removal)`);
  }
}

if (require.main === module) {
  const [cmd, ...rest] = process.argv.slice(2);
  const target = rest.find((a) => !a.startsWith('--') && rest[rest.indexOf(a) - 1] !== '--ops' && rest[rest.indexOf(a) - 1] !== '--max');
  try {
    if (cmd === 'audit') {
      if (!target) throw Object.assign(new Error('usage: cli.js audit <vault>'), { usage: true });
      printAudit(auditVault(target));
      process.exit(0);
    }
    if (cmd === 'plan' || cmd === 'apply') {
      if (!target) throw Object.assign(new Error(`usage: cli.js ${cmd} <vault> --ops <file.json> [--max N]${cmd === 'apply' ? ' --write' : ''}`), { usage: true });
      const ops = loadOps(rest);
      const maxRaw = getFlagValue(rest, '--max');
      const massChangeThreshold = maxRaw ? parseInt(maxRaw, 10) : undefined;
      const write = cmd === 'apply' && rest.includes('--write');
      const res = applyToVault(target, ops, { write, massChangeThreshold });
      printPlan(res, write ? 'apply (WROTE)' : 'plan (dry-run, nothing written)');
      process.exit(0);
    }
    console.error('usage: cli.js <audit|plan|apply> <vault> [--ops file.json] [--max N] [--write]');
    process.exit(1);
  } catch (e) {
    if (e.usage) { console.error(e.message); process.exit(1); }
    console.error(`ABORTED — ${e.message}`);
    process.exit(2); // guard violation (survival / mass-change): nothing written
  }
}
