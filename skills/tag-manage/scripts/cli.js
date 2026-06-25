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
const { applyOps, auditFindings, buildInventory, frontmatterTags } = require('./tags.js');
const { analyze } = require('./analysis.js');
const { classifyTag } = require('./convention.js');
const { buildRecommendations, buildContext } = require('./recommend.js');
const { parseHierarchy, buildNestRecommendations } = require('./hierarchy.js');
const { clusterByName } = require('./induce.js');
const { renderReport, renderProposal, REPORT_MARKER_TAG } = require('./report.js');
const { loadConfig, extractJsonFence } = require('./config.js');
const { suggestReportDir, setReportDir, setHierarchy } = require('./report-home.js');

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

  const notes = excludeReportArtifacts(readNotes(dir), dir, opts.reportDirAbs);

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

// Returns true iff fileAbs is located inside dirAbs.
// Handles the root case (dirAbs == scan root) and sibling-prefix false-positives
// (e.g. "Meta/Tag Management" must NOT exclude "Meta/Tag Management Notes/x.md").
function isInside(dirAbs, fileAbs) {
  const rel = path.relative(dirAbs, fileAbs);
  return rel === path.basename(fileAbs) || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

// Returns true iff the note is a report artifact that runAudit (or a later slice) wrote
// into the report home. Two signals:
//   1. filename — the dated `<date> Tag Analysis Report - *.md` + the recs JSON;
//   2. frontmatter marker (Meta/TagManagement) — catches SIBLING artifacts that do NOT
//      match the dated filename (Master Summary, Tag Index, Cookbook, Roadmap, overview
//      notes). F1 / OBI-2026-06-21-3: filename-only exclusion left these scanned (inventory
//      pollution) and apply-eligible (rewritten on --write).
// markerEligible is false when reportDir == the vault root, preserving the documented
// invariant that real notes are never dropped at root (only named artifacts are there).
const isReportArtifact = (note, markerEligible) => {
  const b = path.basename(note.path);
  if (b === '.tag-manage-recommendations.json' || / Tag (Analysis Report|Organize Proposal) - .+\.md$/.test(b)) return true;
  if (markerEligible && frontmatterTags(note.text).some((f) => f.tag.toLowerCase() === REPORT_MARKER_TAG.toLowerCase())) return true;
  return false;
};

// Drop report artifacts that live inside reportDirAbs. Marker-based exclusion is gated to
// a non-root reportDir (path-resolved compare) so reportDir == vault root still scans every
// real note (only named artifacts excluded there). Shared by audit and the apply/plan path.
function excludeReportArtifacts(notes, dir, reportDirAbs) {
  if (!reportDirAbs) return notes;
  const markerEligible = path.resolve(reportDirAbs) !== path.resolve(dir);
  return notes.filter((n) => !(isInside(reportDirAbs, n.path) && isReportArtifact(n, markerEligible)));
}

function runAudit(dir, { date, fileStamp = '', defaultsPath, configText, reportDirAbs, nameSuffix = '' }) {
  const dict = loadConfig({ defaultsPath, configText });
  // Exclude only report artifacts inside reportDirAbs — never real notes.
  // This prevents a written report note from poisoning the next audit scan,
  // while keeping every real note in scope even when reportDirAbs == the vault root.
  const notes = excludeReportArtifacts(readNotes(dir), dir, reportDirAbs);
  const inventory = buildInventory(notes);
  const findings = auditFindings(notes);
  const analysis = analyze(notes, inventory);
  const recommendations = buildRecommendations(inventory, dict, notes);
  // NEST (Phase 1): declared-hierarchy promotions, computed from the parsed config.
  // Kept in a SEPARATE list + file so the default cleanup ("apply all" of the recs
  // file) never silently re-homes tags; nest is opt-in via --from-recs the nest file.
  const { map: hierMap, errors: hierarchyErrors } = parseHierarchy(dict.hierarchy);
  const nestRecommendations = buildNestRecommendations(inventory, hierMap, notes);
  const ctx = buildContext(inventory, dict);
  const violators = inventory.filter((r) => classifyTag(r.display, ctx).violation).length;
  const conformityPct = inventory.length ? Math.round(((inventory.length - violators) / inventory.length) * 100) : 100;
  const coveragePct = analysis.totalNotes ? Math.round((analysis.taggedNotes / analysis.totalNotes) * 100) : 0;
  const singletonRatioPct = inventory.length ? Math.round((analysis.singletons.length / inventory.length) * 100) : 0;
  const report = renderReport({ scope: 'Vault-wide', date, analysis, findings,
    recommendations, nestRecommendations, healthScore: { conformityPct, coveragePct, singletonRatioPct } });
  let reportPath = null;
  if (reportDirAbs) {
    fs.mkdirSync(reportDirAbs, { recursive: true });
    reportPath = path.join(reportDirAbs, `${date}${fileStamp ? ' ' + fileStamp : ''} Tag Analysis Report - Vault-wide${nameSuffix}.md`);
    fs.writeFileSync(reportPath, report, 'utf8');
    fs.writeFileSync(path.join(reportDirAbs, `.tag-manage-recommendations.json`), JSON.stringify(recommendations, null, 2), 'utf8');
    // Separate nest file (dot-prefixed -> never scanned: not .md, not walked).
    // Applied via the existing `--from-recs <nest file> --ids ...` path; no new write code.
    // Write when there are recs, OR when a sidecar already exists -> a converged re-audit
    // (0 recs) clears the stale file to [] instead of leaving old recs that diverge from the
    // report (F-NEST-1). A vault that never had a hierarchy still gets no sidecar (no file,
    // no recs -> skip), mirroring the unconditional `.tag-manage-recommendations.json` write.
    const nestPath = path.join(reportDirAbs, `.tag-manage-nest.json`);
    if (nestRecommendations.length || fs.existsSync(nestPath)) {
      fs.writeFileSync(nestPath, JSON.stringify(nestRecommendations, null, 2), 'utf8');
    }
  }
  return { report, recommendations, reportPath, nestRecommendations, hierarchyErrors };
}

function selectOps(recommendations, selection) {
  const picked = selection === 'all' ? recommendations : recommendations.filter((r) => selection.includes(r.id));
  return picked.flatMap((r) => r.ops);
}

module.exports = { walkMarkdown, readNotes, auditVault, applyToVault, planVault, MassChangeError, DEFAULT_MASS_CHANGE_THRESHOLD, runAudit, selectOps, runInduce, reportStamp, excludeReportArtifacts };

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

// Filename time-stamp. Explicit --date => '' (deterministic names; the test seam).
// Otherwise the UTC HHMM of the run instant, so same-day re-runs get distinct names
// instead of overwriting. Restores pre-2026-06-24 behavior; slice(0,10) had dropped it.
function reportStamp(isoString, hasExplicitDate) {
  if (hasExplicitDate) return '';
  return isoString.slice(11, 16).replace(':', '');
}

// Resolve config discovery + report-dir from CLI flags and vault-level config note.
// Returns { defaultsPath, configText, reportDirAbs, date, fileStamp } — shared by audit and apply.
function resolveReportContext(target, rest) {
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
  const dateFlag = getFlagValue(rest, '--date');
  const iso = new Date().toISOString();
  const date = dateFlag || iso.slice(0, 10);
  const fileStamp = reportStamp(iso, !!dateFlag);
  return { defaultsPath, configText, reportDirAbs, date, fileStamp };
}

// tag-organize Slice 1 (induce-structure): build the inventory, propose name-based
// candidate families, and write them to a dot-prefixed proposal sidecar (never scanned
// by walkMarkdown -> no self-poisoning). The agent reviews the proposal, reads content
// only for uncertain families, then persists approved clusters via set-hierarchy; the
// nest itself rides the existing applyOps path (no new write code in Slice 1).
function runInduce(dir, { reportDirAbs, date, fileStamp = '', scope = 'Vault-wide' } = {}) {
  // Exclude report artifacts before scanning — mirrors runAudit (matters when reportDir is
  // a non-underscore dir that walkMarkdown would otherwise scan, incl. a prior proposal note).
  const inventory = buildInventory(excludeReportArtifacts(readNotes(dir), dir, reportDirAbs));
  const clusters = clusterByName(inventory);
  const outDir = reportDirAbs || dir;
  fs.mkdirSync(outDir, { recursive: true }); // ensure the report home exists before any write
  const outPath = path.join(outDir, '.tag-organize-clusters.json');
  fs.writeFileSync(outPath, JSON.stringify(clusters, null, 2), 'utf8');
  // Human-readable proposal note: written only when a report home is configured (mirrors the
  // audit report, so the root edge-case where nothing excludes it does not arise). The dot-sidecar
  // above is always written (dot-prefixed -> walkMarkdown skips it at root, no self-poisoning).
  let notePath = null;
  if (reportDirAbs) {
    notePath = path.join(reportDirAbs, `${date}${fileStamp ? ' ' + fileStamp : ''} Tag Organize Proposal - ${scope}.md`);
    fs.writeFileSync(notePath, renderProposal({ scope, date, clusters }), 'utf8');
  }
  return { clusters, outPath, notePath };
}

if (require.main === module) {
  const [cmd, ...rest] = process.argv.slice(2);
  // Flags whose value argument must not be mistaken for the vault target.
  const flagsWithValues = new Set(['--ops', '--max', '--from-recs', '--ids', '--report-dir', '--config', '--date', '--parent', '--children']);
  const target = rest.find((a) => !a.startsWith('--') && !flagsWithValues.has(rest[rest.indexOf(a) - 1]));
  const positionals = rest.filter((a, i) => !a.startsWith('--') && !flagsWithValues.has(rest[i - 1]));
  try {
    if (cmd === 'suggest-report-dir') {
      if (!target) throw Object.assign(new Error('usage: cli.js suggest-report-dir <vault>'), { usage: true });
      console.log(JSON.stringify(suggestReportDir(target), null, 2));
      process.exit(0);
    }
    if (cmd === 'set-report-dir') {
      const relpath = positionals[1];
      if (!target || !relpath) throw Object.assign(new Error('usage: cli.js set-report-dir <vault> <relpath>'), { usage: true });
      const r = setReportDir(target, relpath);
      console.error(`${r.created ? 'Created' : 'Updated'} ${r.configPath}`);
      process.exit(0);
    }
    if (cmd === 'set-hierarchy') {
      const parent = getFlagValue(rest, '--parent');
      const childrenRaw = getFlagValue(rest, '--children');
      if (!target || !parent || !childrenRaw) {
        throw Object.assign(new Error('usage: cli.js set-hierarchy <vault> --parent <Parent> --children <Child1,Child2,...>'), { usage: true });
      }
      const children = childrenRaw.split(',').map((s) => s.trim()).filter(Boolean);
      const r = setHierarchy(target, parent, children);
      console.error(`${r.created ? 'Created' : 'Updated'} ${r.configPath} — ${parent}: ${children.join(', ')}`);
      process.exit(0);
    }
    if (cmd === 'induce') {
      if (!target) throw Object.assign(new Error('usage: cli.js induce <vault> [--report-dir DIR]'), { usage: true });
      const { reportDirAbs, date, fileStamp } = resolveReportContext(target, rest);
      const { clusters, outPath, notePath } = runInduce(target, { reportDirAbs, date, fileStamp });
      console.error(`induce: ${clusters.length} candidate ${clusters.length === 1 ? 'family' : 'families'} proposed -> ${outPath}`);
      if (notePath) console.error(`  proposal note: ${notePath}`);
      console.error('  review, then per approved cluster: cli.js set-hierarchy <vault> --parent <P> --children <C1,C2>');
      process.exit(0);
    }
    if (cmd === 'audit') {
      if (!target) throw Object.assign(new Error('usage: cli.js audit <vault> [--report-dir DIR] [--config FILE] [--date YYYY-MM-DD]'), { usage: true });
      const { defaultsPath, configText, reportDirAbs, date, fileStamp } = resolveReportContext(target, rest);
      const out = runAudit(target, { date, fileStamp, defaultsPath, configText, reportDirAbs });
      console.log(out.report);
      if (out.reportPath) console.error(`Report written to ${out.reportPath}`);
      // Report hierarchy config errors (never swallow them) — invalid entries were excluded.
      for (const e of out.hierarchyErrors || []) console.error(`hierarchy config: ${e}`);
      // Make the opt-in nest path discoverable; nest is NOT part of "apply all".
      if (out.nestRecommendations && out.nestRecommendations.length) {
        console.error(`\n${out.nestRecommendations.length} nest recommendation(s) (declared hierarchy). Review, then apply opt-in:`);
        for (const r of out.nestRecommendations) console.error(`  [${r.id}] ${r.from} -> ${r.to} (${r.notesAffected} notes)`);
        if (reportDirAbs) console.error(`  apply: cli.js plan <vault> --from-recs "${path.join(reportDirAbs, '.tag-manage-nest.json')}" --ids <ids>`);
      }
      process.exit(0);
    }
    if (cmd === 'plan' || cmd === 'apply') {
      if (!target) throw Object.assign(new Error(`usage: cli.js ${cmd} <vault> (--ops <file.json> | --from-recs <file.json>) [--ids 1,3] [--max N]${cmd === 'apply' ? ' --write' : ''}`), { usage: true });
      const maxRaw = getFlagValue(rest, '--max');
      const massChangeThreshold = maxRaw ? parseInt(maxRaw, 10) : undefined;
      const write = cmd === 'apply' && rest.includes('--write');
      const fromRecs = getFlagValue(rest, '--from-recs');
      let ops;
      if (fromRecs) {
        const recsData = JSON.parse(fs.readFileSync(fromRecs, 'utf8'));
        const idsRaw = getFlagValue(rest, '--ids');
        const selection = idsRaw ? idsRaw.split(',').map((s) => parseInt(s.trim(), 10)) : 'all';
        ops = selectOps(recsData, selection);
      } else {
        ops = loadOps(rest);
      }
      const { defaultsPath, configText, reportDirAbs, date, fileStamp } = resolveReportContext(target, rest);
      const res = applyToVault(target, ops, { write, massChangeThreshold, reportDirAbs });
      printPlan(res, write ? 'apply (WROTE)' : 'plan (dry-run, nothing written)');
      // After a successful --write apply, emit an after-changes report if --report-dir is set.
      if (write && res.wrote && reportDirAbs) {
        const afterOut = runAudit(target, { date, fileStamp, defaultsPath, configText, reportDirAbs, nameSuffix: ' - after changes' });
        if (afterOut.reportPath) console.error(`After-changes report written to ${afterOut.reportPath}`);
      }
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
