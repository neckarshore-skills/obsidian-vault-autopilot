'use strict';
// report.js — pure markdown builder. Date is injected (no clock).

// Thousand separators on integer counts (1272 -> 1,272). Deterministic (regex,
// not toLocaleString); non-integers and non-numbers pass through unchanged.
function fmt(n) {
  if (typeof n !== 'number' || !Number.isInteger(n)) return n;
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function table(headers, rows) {
  const h = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
  return `${h}\n${sep}\n${body}`;
}

function renderFindings(f, a) {
  const parts = [];

  // --- Duplicates (case / separator variants) ---
  parts.push('### Duplicates');
  const hasCaseGroups = f.caseGroups && f.caseGroups.length > 0;
  const hasSepGroups = f.separatorGroups && f.separatorGroups.length > 0;
  if (!hasCaseGroups && !hasSepGroups) {
    parts.push('None.');
  } else {
    if (hasCaseGroups) {
      parts.push('**Case variants**\n');
      parts.push(table(['Logical key', 'Variants'], f.caseGroups.map((g) => [
        `\`${g.key}\``, g.variants.map((v) => `\`${v}\``).join(', '),
      ])));
    }
    if (hasSepGroups) {
      if (hasCaseGroups) parts.push('');
      parts.push('**Separator variants**\n');
      parts.push(table(['Logical key', 'Variants'], f.separatorGroups.map((g) => [
        `\`${g.key}\``, g.variants.map((v) => `\`${v}\``).join(', '),
      ])));
    }
  }

  // --- Invalid tags ---
  parts.push('');
  parts.push('### Invalid tags (not real tags - review for removal)');
  const numericList = f.numericArtifacts && f.numericArtifacts.length > 0 ? f.numericArtifacts : [];
  const otherList = f.otherInvalidTags && f.otherInvalidTags.length > 0 ? f.otherInvalidTags : [];
  if (numericList.length === 0 && otherList.length === 0) {
    parts.push('None.');
  } else {
    if (numericList.length > 0) {
      parts.push(`Numeric artifacts: ${numericList.map((t) => `\`${t}\``).join(', ')}`);
    }
    if (otherList.length > 0) {
      parts.push(`Other invalid: ${otherList.map((t) => `\`${t}\``).join(', ')}`);
    }
  }

  // --- Unused & low-usage ---
  parts.push('');
  parts.push('### Unused & low-usage');
  const singletons = a.singletons || [];
  const lowUsage = a.lowUsage || [];
  if (singletons.length === 0 && lowUsage.length === 0) {
    parts.push('None.');
  } else {
    if (singletons.length > 0) {
      const shown = singletons.slice(0, 50);
      const overflow = singletons.length - shown.length;
      const names = shown.map((t) => `\`${t.display}\``).join(', ') + (overflow > 0 ? ` (+${fmt(overflow)} more)` : '');
      parts.push(`Singletons (used in 1 note): **${fmt(singletons.length)}** — ${names}`);
    } else {
      parts.push('Singletons (used in 1 note): **0**');
    }
    if (lowUsage.length > 0) {
      const shown = lowUsage.slice(0, 50);
      const overflow = lowUsage.length - shown.length;
      const rows = shown.map((t) => [`\`${t.display}\``, fmt(t.noteCount)]);
      if (overflow > 0) rows.push([`(+${fmt(overflow)} more)`, '']);
      parts.push('');
      parts.push(`Low-usage tags (2-3 notes): **${fmt(lowUsage.length)}**\n`);
      parts.push(table(['Tag', 'Notes'], rows));
    }
  }

  return parts.join('\n');
}

function renderReport({ scope, date, analysis: a, findings: f, recommendations: recs, healthScore: h }) {
  const lines = [];
  lines.push(`---\ntitle: 'Tag Analysis Report - ${scope} - ${date}'\ntype: inbox\nstatus: draft\ncreated: ${date}\ntags:\n  - Meta/TagManagement\n---\n`);
  lines.push(`# Tag Analysis Report\n`);
  lines.push(`> [!summary]\n> **Scope:** ${scope}\n> **Analyzed:** ${fmt(a.totalNotes)} notes, ${fmt(a.uniqueTags)} unique tags, ${fmt(a.totalAssignments)} assignments\n> **Coverage:** ${h.coveragePct}% tagged\n> **Recommendations:** ${fmt(recs.length)}\n`);
  lines.push(`## Key Metrics\n\n` + table(['Metric', 'Value'], [
    ['Total notes', fmt(a.totalNotes)], ['Tagged', fmt(a.taggedNotes)], ['Untagged', fmt(a.untaggedNotes)],
    ['Unique tags', fmt(a.uniqueTags)], ['Avg tags/note', a.avgTagsPerNote], ['Max depth', a.maxDepth], ['Singletons', fmt(a.singletons.length)],
  ]) + '\n');
  lines.push(`## Top 20 Tags\n\n` + table(['#', 'Tag', 'Count', '% tagged'], a.topN.map((t, i) => [i + 1, `\`${t.display}\``, fmt(t.noteCount), `${t.pct}%`])) + '\n');
  lines.push(`## Findings\n\n` + renderFindings(f, a) + '\n');
  lines.push(`## Recommendations\n\n` + (recs.length ? table(['#', 'Action', 'From', 'To', 'Notes', 'Note'], recs.map((r) => [
    r.id, `${r.kind} (${r.severity})`, `\`${r.from}\``, `\`${r.to}\``, r.notesAffected, r.source === 'heuristic' ? 'verify casing (not in dictionary)' : r.source,
  ])) : '_No recommendations._') + '\n');
  lines.push(`> [!tip] Next Steps\n> Say "apply all", "apply #1, #3", or "skip #2". A before/after preview is shown before any write.\n`);
  lines.push(`## Health Score\n\n` + table(['Dimension', 'Score'], [
    ['Convention conformity', `${h.conformityPct}%`], ['Tag coverage', `${h.coveragePct}%`], ['Singleton ratio', `${h.singletonRatioPct}%`],
  ]) + '\n');
  lines.push(`## Update Log\n\n` + table(['Date', 'Change'], [[date, 'Initial analysis']]) + '\n');
  return lines.join('\n');
}

module.exports = { renderReport, table };
