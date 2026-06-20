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
const { applyOps, auditFindings, buildInventory } = require('./tags.js');
const { analyze } = require('./analysis.js');
const { classifyTag } = require('./convention.js');
const { buildRecommendations, buildContext } = require('./recommend.js');
const { renderReport } = require('./report.js');
const { loadConfig, extractJsonFence } = require('./config.js');

// Default mass-change ceiling: a single op touching more notes than this aborts.
const DEFAULT_MASS_CHANGE_THRESHOLD = 50;
const SKIP_DIRS = new Set(['node_modules']);

class MassChangeError extends Error {
  constructor(count, threshold, op) {
    const what = op ? `operation ${JSON.stringify(op)}` : 'this plan';
    super(`Mass-change guard: ${what} would touch ${count} notes (> threshold ${threshold}). Aborting; nothing written. Re-run with a higher --max or split the operation.`);
    this.name = 'MassChangeError';
    this.count = count;
    this.threshold = threshold;
    this.op = op || null;
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

  // Mass-change guard is PER-OP (the brief: "if an operation would touch more than
  // a threshold of notes"). A single catastrophic op aborts even if the plan total
  // is modest; several individually-safe ops do not aggregate past the threshold.
  // Skipped when a transform is injected (test seam) since per-op counting uses the
  // real engine, not the injected transform.
  if (!opts.transform) {
    for (const op of ops) {
      const opCount = notes.filter((n) => applyOps(n.text, [op]).changed).length;
      if (opCount > threshold) throw new MassChangeError(opCount, threshold, op);
    }
  }

  const planned = notes.map((n) => {
    const r = transform(n.text); // may throw SurvivalError or an injected error
    return { path: n.path, before: n.text, after: r.text, changed: !!r.changed, bodyResidual: r.bodyResidual || [] };
  });

  const changedCount = planned.filter((p) => p.changed).length;

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

function runAudit(dir, { date, defaultsPath, configText, reportDirAbs }) {
  const dict = loadConfig({ defaultsPath, configText });
  // Exclude the report directory from the scan so a written report note does not poison the
  // next audit (the original skill suffered this: its Meta/TagManagement-tagged reports were
  // re-counted on every run).
  const notes = readNotes(dir).filter((n) => !reportDirAbs || !n.path.startsWith(reportDirAbs));
  const inventory = buildInventory(notes);
  const findings = auditFindings(notes);
  const analysis = analyze(notes, inventory);
  const recommendations = buildRecommendations(inventory, dict);
  const ctx = buildContext(inventory, dict);
  const violators = inventory.filter((r) => classifyTag(r.display, ctx).violation).length;
  const conformityPct = inventory.length ? Math.round(((inventory.length - violators) / inventory.length) * 100) : 100;
  const coveragePct = analysis.totalNotes ? Math.round((analysis.taggedNotes / analysis.totalNotes) * 100) : 0;
  const singletonRatioPct = inventory.length ? Math.round((analysis.singletons.length / inventory.length) * 100) : 0;
  const report = renderReport({ scope: 'Vault-wide', date, analysis, findings,
    recommendations, healthScore: { conformityPct, coveragePct, singletonRatioPct } });
  let reportPath = null;
  if (reportDirAbs) {
    reportPath = path.join(reportDirAbs, `${date} Tag Analysis Report - Vault-wide.md`);
    fs.writeFileSync(reportPath, report, 'utf8');
    fs.writeFileSync(path.join(reportDirAbs, `.tag-manage-recommendations.json`), JSON.stringify(recommendations, null, 2), 'utf8');
  }
  return { report, recommendations, reportPath };
}

module.exports = { walkMarkdown, readNotes, auditVault, applyToVault, planVault, MassChangeError, DEFAULT_MASS_CHANGE_THRESHOLD, runAudit };

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
      if (!target) throw Object.assign(new Error('usage: cli.js audit <vault> [--report-dir DIR] [--config FILE] [--date YYYY-MM-DD]'), { usage: true });
      const defaultsPath = path.join(__dirname, '..', 'references', 'tag-overrides.default.json');
      const cfgFlag = getFlagValue(rest, '--config');
      let configText = null;
      if (cfgFlag) {
        configText = fs.readFileSync(cfgFlag, 'utf8');
      } else {
        const found = walkMarkdown(target).find((p) => path.basename(p) === 'Tag Manage Config.md');
        configText = found ? fs.readFileSync(found, 'utf8') : null;
      }
      const cfg = configText ? extractJsonFence(configText) : null;
      const reportDirFlag = getFlagValue(rest, '--report-dir');
      const reportDirAbs = reportDirFlag
        ? path.resolve(reportDirFlag)
        : (cfg && cfg.reportDir ? path.join(target, cfg.reportDir) : null);
      const date = getFlagValue(rest, '--date') || new Date().toISOString().slice(0, 10);
      const out = runAudit(target, { date, defaultsPath, configText, reportDirAbs });
      console.log(out.report);
      if (out.reportPath) console.error(`Report written to ${out.reportPath}`);
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
