'use strict';
// report.js — pure markdown builder. Date is injected (no clock).
function table(headers, rows) {
  const h = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
  return `${h}\n${sep}\n${body}`;
}

function renderReport({ scope, date, analysis: a, findings: f, recommendations: recs, healthScore: h }) {
  const lines = [];
  lines.push(`---\ntitle: 'Tag Analysis Report - ${scope} - ${date}'\ntype: inbox\nstatus: draft\ncreated: ${date}\ntags:\n  - Meta/TagManagement\n---\n`);
  lines.push(`# Tag Analysis Report\n`);
  lines.push(`> [!summary]\n> **Scope:** ${scope}\n> **Analyzed:** ${a.totalNotes} notes, ${a.uniqueTags} unique tags, ${a.totalAssignments} assignments\n> **Coverage:** ${h.coveragePct}% tagged\n> **Recommendations:** ${recs.length}\n`);
  lines.push(`## Key Metrics\n\n` + table(['Metric', 'Value'], [
    ['Total notes', a.totalNotes], ['Tagged', a.taggedNotes], ['Untagged', a.untaggedNotes],
    ['Unique tags', a.uniqueTags], ['Avg tags/note', a.avgTagsPerNote], ['Max depth', a.maxDepth], ['Singletons', a.singletons.length],
  ]) + '\n');
  lines.push(`## Top 20 Tags\n\n` + table(['#', 'Tag', 'Count', '% tagged'], a.topN.map((t, i) => [i + 1, `\`${t.display}\``, t.noteCount, `${t.pct}%`])) + '\n');
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
