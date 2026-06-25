'use strict';
// report.js — pure markdown builder. Date is injected (no clock).

// The frontmatter tag every report artifact carries. Single source of truth:
// report.js writes it; cli.js excludes artifacts by it (F1, OBI-2026-06-21-3).
//
// DESIGN INVARIANT: marker-based exclusion only catches artifacts that CARRY this tag.
// Any future artifact writer (Slices C-G: Master Summary, Tag Index, Cookbook, Roadmap)
// MUST write REPORT_MARKER_TAG into its frontmatter, or it will be scanned + apply-eligible
// like a real note. New artifact writer => add a test asserting its output carries this tag.
const REPORT_MARKER_TAG = 'Meta/TagManagement';

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

function renderReport({ scope, date, analysis: a, findings: f, recommendations: recs, healthScore: h, nestRecommendations: nest = [] }) {
  const lines = [];
  lines.push(`---\ntitle: 'Tag Analysis Report - ${scope} - ${date}'\ntype: inbox\nstatus: draft\ncreated: ${date}\ntags:\n  - ${REPORT_MARKER_TAG}\n---\n`);
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
  // Tag Hierarchy (nest) — declared-hierarchy promotions. Rendered only when present, in
  // its OWN section so it is visible in the browsable report (the skill's contract: the
  // report is how the user knows what is possible) while staying out of the cleanup
  // Recommendations table + the default "apply all". from/to are backtick-wrapped (no bare
  // #token -> linter-inert, same invariant as the Next Steps fix, OBI-2026-06-21-2).
  if (nest.length) {
    lines.push(`## Tag Hierarchy (nest - opt-in)\n\n`
      + 'These promote a flat tag to a nested `Parent/Child`. They are **not** part of "apply all" — '
      + 'a nest changes tag identity across many notes, so apply each by id from the separate nest file.\n\n'
      + table(['#', 'From', 'To', 'Notes'], nest.map((r) => [
        r.id, `\`${r.from}\``, `\`${r.to}\``, r.notesAffected,
      ])) + '\n');
  }
  // No `#`-prefixed example tokens: obsidian-linter (move-tags-to-yaml) would promote
  // a `#1`-style token from this prose into the report's own frontmatter as a tag,
  // corrupting it on every save (OBI-2026-06-21-2). Plain numbers are linter-inert.
  lines.push(`> [!tip] Next Steps\n> Say "apply all", "apply 1, 3", or "skip 2" (the numbers are the recommendation IDs). A before/after preview is shown before any write.\n`);
  lines.push(`## Health Score\n\n` + table(['Dimension', 'Score'], [
    ['Convention conformity', `${h.conformityPct}%`], ['Tag coverage', `${h.coveragePct}%`], ['Singleton ratio', `${h.singletonRatioPct}%`],
  ]) + '\n');
  lines.push(`## Update Log\n\n` + table(['Date', 'Change'], [[date, 'Initial analysis']]) + '\n');
  return lines.join('\n');
}

// Human-readable induce proposal artifact. Mirrors renderReport: date injected (no clock),
// carries REPORT_MARKER_TAG so future scans exclude it, backtick-wraps every tag name, and
// emits NO bare #token (the obsidian-linter would promote such a token into this note's own
// frontmatter -> self-poisoning; the OBI-2026-06-21-2 invariant). Name-only proposals to prune.
function renderProposal({ scope, date, clusters }) {
  const CATS = [
    ['implement', 'Implement (recommended — review, then apply as a batch)'],
    ['decide', 'Decide (your call — content-sample the unclear ones)'],
    ['ignore', 'Ignore (likely name-coincidence — skip)'],
  ];
  const counts = { implement: 0, decide: 0, ignore: 0 };
  for (const c of clusters) counts[c.category] = (counts[c.category] || 0) + 1;

  const childrenCell = (c) => c.children.map((ch) => `\`${ch.name}\` (${fmt(ch.count)})`).join(', ');

  const section = ([cat, heading]) => {
    const rows = clusters
      .filter((c) => c.category === cat)
      .sort((a, b) => b.score - a.score || a.parent.localeCompare(b.parent));
    const body = rows.length
      ? table(['#', 'Parent', 'Children', 'Notes', 'Score', 'Basis'], rows.map((c, i) => [
          i + 1, `\`${c.parent}\``, childrenCell(c), fmt(c.notesTotal), c.score, c.basis,
        ]))
      : '_(none)_';
    return `## ${heading}\n\n${body}\n`;
  };

  const lines = [];
  lines.push(`---\ntitle: 'Tag Organize Proposal - ${scope} - ${date}'\ntype: inbox\nstatus: draft\ncreated: ${date}\ntags:\n  - ${REPORT_MARKER_TAG}\n---\n`);
  lines.push(`# Tag Organize Proposal\n`);
  lines.push(`> [!summary]\n> **Scope:** ${scope}\n> **Candidate families:** ${fmt(clusters.length)} -> Implement ${counts.implement} . Decide ${counts.decide} . Ignore ${counts.ignore}\n> Score = structural signal strength (not a probability) — see Basis. Implement is a recommended batch, still applied behind the confirm gate; nothing is auto-applied.\n`);
  for (const c of CATS) lines.push(section(c));
  lines.push(`> [!tip] Next Steps\n> For each family you approve: \`cli.js set-hierarchy <vault> --parent <Parent> --children <Child1,Child2>\`, then re-audit and apply the nests behind the confirm gate. Skip families that do not represent a real parent.\n`);
  return lines.join('\n');
}

module.exports = { renderReport, renderProposal, table, REPORT_MARKER_TAG };
